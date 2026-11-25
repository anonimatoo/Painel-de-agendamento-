import { db } from './db'
import { settleOrderRefund } from './orders'
import { settleAppointment, stripe } from './stripe'
import { AgendaError } from './agenda'
import type { Appointment } from '@prisma/client'
import type Stripe from 'stripe'

export async function connectStatus(accountId: string) {
  const account = await (await stripe()).accounts.retrieve(accountId)
  return { payments: account.charges_enabled, payouts: account.payouts_enabled, submitted: account.details_submitted }
}

export async function refundAppointment(tenantId: string, appointmentId: string) {
  const item = await db.appointment.findFirst({
    where: { id: appointmentId, tenantId, status: 'CONFIRMED', paidAt: { not: null } },
    include: { tenant: true }
  })
  if (!item?.tenant.stripeAccountId || !item.checkoutId) throw new AgendaError('Esse atendimento não possui um pagamento passível de estorno.')
  const account = item.tenant.stripeAccountId
  const api = await stripe()
  const session = await api.checkout.sessions.retrieve(item.checkoutId, { stripeAccount: account })
  const intent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
  if (!intent || session.payment_status !== 'paid') throw new AgendaError('O pagamento ainda não pode ser estornado.')
  const refund = await api.refunds.create({
    payment_intent: intent, refund_application_fee: item.platformFeeCents > 0 || undefined, metadata: { appointmentId }
  }, { stripeAccount: account, idempotencyKey: 'appointment-refund:' + appointmentId })
  if (refund.status === 'succeeded') {
    await db.appointment.updateMany({ where: { id: appointmentId, tenantId, paidAt: { not: null } }, data: { refundedAt: new Date(), status: 'CANCELED' } })
  } else if (refund.status !== 'pending' && refund.status !== 'requires_action') {
    throw new AgendaError('O estorno não foi aprovado. Consulte a situação na Stripe.')
  }
}

export async function openAppointmentCheckout(reservation: Appointment, api?: Stripe) {
  const account = reservation.checkoutAccountId
  if (reservation.status !== 'PENDING' || !account || !reservation.checkoutReturnUrl || !reservation.paymentToken || !reservation.expiresAt) return
  const stripeApi = api ?? await stripe()
  if (reservation.checkoutId) return stripeApi.checkout.sessions.retrieve(reservation.checkoutId, { stripeAccount: account })
  if (reservation.checkoutState === 'REVIEW' || +reservation.expiresAt - Date.now() < 30 * 60_000) return
  const session = await stripeApi.checkout.sessions.create({
    mode: 'payment', payment_method_types: ['card'],
    line_items: [{ price_data: { currency: 'brl', unit_amount: reservation.chargeCents ?? reservation.cents, product_data: { name: 'Pagamento de atendimento' } }, quantity: 1 }],
    metadata: { appointmentId: reservation.id },
    payment_intent_data: reservation.platformFeeCents ? { application_fee_amount: reservation.platformFeeCents } : undefined,
    success_url: reservation.checkoutReturnUrl + '?pagamento=' + reservation.paymentToken,
    cancel_url: reservation.checkoutReturnUrl + '?pagamento=' + reservation.paymentToken,
    expires_at: +reservation.expiresAt / 1000
  }, { stripeAccount: account, idempotencyKey: 'appointment:' + reservation.id })
  await db.appointment.updateMany({
    where: { id: reservation.id, status: 'PENDING', OR: [{ checkoutId: null }, { checkoutId: session.id }] },
    data: { checkoutId: session.id, checkoutState: 'OPEN' }
  })
  return session
}

export async function reconcileAppointment(reservation: Appointment, account: string, api: Stripe) {
  let session: Stripe.Checkout.Session | undefined
  if (reservation.checkoutId) {
    session = await api.checkout.sessions.retrieve(reservation.checkoutId, { stripeAccount: account })
  } else {
    session = await openAppointmentCheckout(reservation, api)
    if (!session) {
      for await (const candidate of api.checkout.sessions.list({
        created: { gte: Math.floor(+reservation.createdAt / 1000) - 10 }, limit: 100
      }, { stripeAccount: account })) {
        if (candidate.metadata?.appointmentId === reservation.id) { session = candidate; break }
      }
    }
  }
  if (session) {
    const evidence = session
    await db.$transaction(tx => settleAppointment(tx, account, evidence, evidence.status === 'expired'))
  } else if (!reservation.expiresAt || +reservation.expiresAt <= Date.now()) {
    await db.appointment.updateMany({ where: { id: reservation.id, status: 'PENDING', checkoutId: null }, data: { checkoutState: 'REVIEW' } })
  }
}

export async function reconcileAppointments() {
  const pending = await db.appointment.findMany({
    where: { status: 'PENDING', tenant: { stripeAccountId: { not: null } }, OR: [
      { checkoutState: 'CREATING' },
      { checkoutState: 'OPEN', expiresAt: { lte: new Date() } }
    ] },
    orderBy: { expiresAt: 'asc' }, take: 25,
    include: { tenant: { select: { stripeAccountId: true } } }
  })
  if (!pending.length) return
  const api = await stripe()
  for (const reservation of pending) {
    try {
      await reconcileAppointment(reservation, reservation.checkoutAccountId ?? reservation.tenant.stripeAccountId!, api)
    } catch {
      if (reservation.expiresAt && +reservation.expiresAt <= Date.now()) {
        await db.appointment.updateMany({ where: { id: reservation.id, status: 'PENDING', checkoutState: 'CREATING' }, data: { checkoutState: 'REVIEW' } })
      }
      console.error('appointment-reconciliation', reservation.id)
    }
  }
}

export async function refundOrder(tenantId: string, orderId: string) {
  const order = await db.shopOrder.findFirst({
    where: { tenantId, id: orderId, status: 'PAID' }, include: { tenant: { select: { stripeAccountId: true } } }
  })
  const account = order?.tenant.stripeAccountId
  if (!order?.paymentIntentId || !account) throw new AgendaError('O pedido ainda não pode ser estornado.')
  const refund = await (await stripe()).refunds.create({ payment_intent: order.paymentIntentId, refund_application_fee: order.platformFeeCents > 0 || undefined, metadata: { orderId } },
    { stripeAccount: account, idempotencyKey: 'order-refund:' + orderId })
  if (refund.status === 'succeeded') await db.$transaction(tx => settleOrderRefund(tx, account, refund))
  else if (refund.status !== 'pending' && refund.status !== 'requires_action') throw new AgendaError('O estorno não foi aprovado.')
}
