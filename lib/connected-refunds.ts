import type { Prisma } from '@prisma/client'
import type Stripe from 'stripe'
import { db } from './db'
import { AgendaError, enqueueStatus } from './agenda'

const states = new Set(['pending', 'requires_action', 'succeeded', 'failed', 'canceled'])
const terminal = new Set(['succeeded', 'failed', 'canceled'])

async function settleRefundRecord(tx: Prisma.TransactionClient, account: string, refund: Stripe.Refund) {
  const intent = typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id
  const state = refund.status
  if (!intent || !state || !states.has(state) || refund.currency !== 'brl' || !Number.isSafeInteger(refund.amount) || refund.amount <= 0) return null
  const appointment = await tx.appointment.findFirst({
    where: { paidAt: { not: null }, paymentIntentId: intent,
      OR: [{ checkoutAccountId: account }, { checkoutAccountId: null, tenant: { stripeAccountId: account } }] }
  })
  const order = appointment ? null : await tx.shopOrder.findFirst({
    where: { paidAt: { not: null }, paymentIntentId: intent, tenant: { stripeAccountId: account } }
  })
  if (!appointment && !order) return null
  if ((refund.metadata?.appointmentId && refund.metadata.appointmentId !== appointment?.id) ||
      (refund.metadata?.orderId && refund.metadata.orderId !== order?.id)) return null
  const original = appointment ? appointment.chargeCents ?? appointment.cents : order!.cents
  if (refund.amount > original) return null

  if (appointment) await tx.$queryRaw`SELECT id FROM "Appointment" WHERE id = ${appointment.id} FOR UPDATE`
  else await tx.$queryRaw`SELECT id FROM "ShopOrder" WHERE id = ${order!.id} FOR UPDATE`
  const key = { accountId: account, id: refund.id }
  const previous = await tx.connectedRefund.findUnique({ where: { accountId_id: key } })
  if (previous && (previous.appointmentId !== (appointment?.id ?? null) || previous.orderId !== (order?.id ?? null) ||
      previous.amount !== refund.amount || terminal.has(previous.state))) return null
  const succeededAt = state === 'succeeded' ? new Date() : null
  const scope = appointment ? { appointmentId: appointment.id } : { orderId: order!.id }
  await tx.connectedRefund.upsert({
    where: { accountId_id: key }, update: { state, succeededAt },
    create: { ...key, ...scope, amount: refund.amount, state, succeededAt }
  })
  if (appointment && refund.metadata?.automatic === 'yes') {
    await tx.appointmentRefundRequest.updateMany({
      where: { appointmentId: appointment.id, accountId: account, paymentIntentId: intent,
        amount: refund.amount, OR: [{ stripeRefundId: null }, { stripeRefundId: refund.id }] },
      data: { state: state === 'succeeded' ? 'SUCCEEDED' : terminal.has(state) ? 'REVIEW' : 'SUBMITTED', stripeRefundId: refund.id,
        retryAt: new Date(Date.now() + 5 * 60_000) }
    })
  }
  if (!succeededAt) return null
  const { _sum } = await tx.connectedRefund.aggregate({ where: { accountId: account, ...scope, state: 'succeeded' }, _sum: { amount: true } })
  return { appointment, order, fullyRefunded: (_sum.amount ?? 0) === original }
}

export async function applyConnectedRefund(tx: Prisma.TransactionClient, account: string, refund: Stripe.Refund) {
  const result = await settleRefundRecord(tx, account, refund)
  if (!result?.fullyRefunded) return
  const { appointment, order } = result
  if (appointment) {
    const fresh = await tx.appointment.findUniqueOrThrow({ where: { id: appointment.id }, select: { status: true } })
    const changed = await tx.appointment.updateMany({
      where: { id: appointment.id, refundedAt: null },
      data: { refundedAt: new Date(), status: fresh.status === 'CONFIRMED' ? 'CANCELED' : undefined }
    })
    if (!changed.count) return
    await tx.appointmentRefundRequest.updateMany({ where: { appointmentId: appointment.id, state: { not: 'SUCCEEDED' } }, data: { state: 'SUCCEEDED' } })
    await tx.appointmentHistory.create({ data: { appointmentId: appointment.id, operation: 'REFUNDED' } })
    if (fresh.status === 'CONFIRMED') {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: appointment.tenantId } })
      await enqueueStatus(tx, tenant, appointment, 'CANCELED')
    }
  } else if (order) {
    const fresh = await tx.shopOrder.findUniqueOrThrow({ where: { id: order.id }, select: { status: true } })
    const refundedAt = new Date()
    const changed = await tx.shopOrder.updateMany({
      where: { id: order.id, status: { in: ['PAID', 'CANCELED'] }, refundedAt: null },
      data: { status: 'REFUNDED', refundedAt, paymentReview: false, recognizedSale: fresh.status === 'PAID', stockReturnedAt: fresh.status === 'PAID' ? refundedAt : undefined }
    })
    if (!changed.count || fresh.status !== 'PAID') return
    const items = await tx.shopOrderItem.findMany({ where: { tenantId: order.tenantId, orderId: order.id }, orderBy: { productId: 'asc' } })
    for (const item of items) {
      await tx.product.update({ where: { tenantId_id: { tenantId: order.tenantId, id: item.productId } }, data: { stock: { increment: item.quantity } } })
    }
  }
}

export async function requestConsumerRefund(tenantId: string, appointmentId: string, userId: string, after: Date) {
  return db.$transaction(async tx => {
    const [eligible] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Appointment" WHERE id = ${appointmentId} AND "tenantId" = ${tenantId}
        AND "consumerUserId" = ${userId} AND status = 'CONFIRMED' AND "startsAt" > ${after} AND "paidAt" IS NOT NULL
      FOR UPDATE`
    if (!eligible) throw new AgendaError('Atendimento indisponível ou fora do prazo de alteração.')
    const appointment = await tx.appointment.findUniqueOrThrow({ where: { id: appointmentId } })
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } })
    if (!tenant.active || tenant.suspended) throw new AgendaError('Estabelecimento indisponível.')
    if (await tx.appointmentHistory.count({ where: { appointmentId, operation: 'REFUND_REQUESTED' } })) return false
    await tx.appointmentHistory.create({ data: { appointmentId, actorId: userId, operation: 'REFUND_REQUESTED' } })
    const accountId = appointment.checkoutAccountId ?? tenant.stripeAccountId
    if (!tenant.automaticAppointmentRefunds || !appointment.paymentIntentId || !accountId || appointment.refundedAt ||
        await tx.connectedRefund.count({ where: { appointmentId, state: { in: ['succeeded', 'pending', 'requires_action'] } } })) return false
    await tx.appointmentRefundRequest.create({ data: {
      appointmentId, accountId, paymentIntentId: appointment.paymentIntentId,
      amount: appointment.chargeCents ?? appointment.cents, includeFee: appointment.platformFeeCents > 0
    } })
    await tx.appointment.update({ where: { id: appointmentId }, data: { status: 'CANCELED' } })
    await tx.appointmentHistory.create({ data: { appointmentId, actorId: userId, operation: 'CANCELED' } })
    await enqueueStatus(tx, tenant, appointment, 'CANCELED')
    return true
  })
}

export async function processAppointmentRefunds(getApi: () => Promise<Stripe>, now = new Date()) {
  const pending = await db.appointmentRefundRequest.findMany({
    where: { state: { in: ['QUEUED', 'SUBMITTED'] }, retryAt: { lte: now } }, orderBy: { retryAt: 'asc' }, take: 25
  })
  if (!pending.length) return
  const api = await getApi()
  for (const job of pending) {
    const lease = await db.appointmentRefundRequest.updateMany({
      where: { appointmentId: job.appointmentId, state: job.state, retryAt: job.retryAt },
      data: { retryAt: new Date(+now + 5 * 60_000) }
    })
    if (!lease.count) continue
    if (!job.stripeRefundId && +now >= +job.createdAt + 22 * 3_600_000) {
      await db.appointmentRefundRequest.updateMany({
        where: { appointmentId: job.appointmentId, state: 'QUEUED', stripeRefundId: null }, data: { state: 'REVIEW' }
      })
      continue
    }
    try {
      const options = { stripeAccount: job.accountId }
      const refund = job.stripeRefundId ? await api.refunds.retrieve(job.stripeRefundId, options) : await api.refunds.create({
        payment_intent: job.paymentIntentId, amount: job.amount, refund_application_fee: job.includeFee || undefined,
        metadata: { appointmentId: job.appointmentId, automatic: 'yes' }
      }, { ...options, idempotencyKey: 'automatic-appointment-refund:' + job.appointmentId })
      await db.$transaction(tx => applyConnectedRefund(tx, job.accountId, refund))
    } catch {
      // Persisted lease keeps the request retryable without logging provider or customer data.
      console.error('appointment-refund-reconciliation')
    }
  }
}
