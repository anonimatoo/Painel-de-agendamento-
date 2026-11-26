import { db } from './db'
import { settleOrderRefund } from './orders'
import { settleAppointment, stripe } from './stripe'
import { AgendaError } from './agenda'
import { createConnectAccount, createConnectOnboardingLink, readConnectStatus } from './connect-accounts'
import { stripeClient, stripeConfiguration } from './stripe-settings'
import type { Appointment } from '@prisma/client'
import type Stripe from 'stripe'

export async function connectStatus(accountId: string, api?: Stripe) {
  return readConnectStatus(api ?? await stripe(), accountId)
}

export async function startConnectOnboarding(
  tenantId: string,
  email: string,
  origin: string,
  clientFactory: typeof stripeClient = stripeClient
) {
  const attempt = await db.$transaction(async tx => {
    // Coordinate with credential rotation before reserving the Stripe operation.
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(73520451)) AS lock`
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } })
    const config = await stripeConfiguration(tx)
    if (config.paused) throw new AgendaError('Novas cobranças estão temporariamente indisponíveis.')
    const api = clientFactory(config.secret)
    if (tenant.stripeAccountId) return { api, accountId: tenant.stripeAccountId }

    const scope = config.mode + ':' + (await api.accounts.retrieve()).id
    const startedAt = tenant.connectAttemptAt ?? new Date()
    const contactEmail = tenant.connectAttemptEmail ?? email

    // Stripe can replay v2 POST requests for 30 days. Stop before the replay window expires.
    if (tenant.connectAttemptAt && (tenant.connectAttemptScope !== scope ||
        Date.now() - +startedAt >= 29 * 24 * 60 * 60_000)) {
      throw new AgendaError('A criação da conta Stripe precisa de conciliação pelo suporte.')
    }
    if (!tenant.connectAttemptAt) await tx.tenant.update({
      where: { id: tenantId },
      data: { connectAttemptAt: startedAt, connectAttemptEmail: contactEmail, connectAttemptScope: scope }
    })
    return { api, accountId: null, contactEmail, startedAt, scope }
  }, { timeout: 20_000 })

  const { api } = attempt
  if (attempt.accountId !== null) return createConnectOnboardingLink(api, attempt.accountId, tenantId, origin)

  const accountId = await createConnectAccount(api, tenantId, attempt.contactEmail)
  const attached = await db.tenant.updateMany({
    where: { id: tenantId, stripeAccountId: null, connectAttemptAt: attempt.startedAt, connectAttemptScope: attempt.scope },
    data: { stripeAccountId: accountId, connectAttemptAt: null, connectAttemptEmail: null, connectAttemptScope: null }
  })
  if (!attached.count) {
    const current = await db.tenant.findUnique({ where: { id: tenantId }, select: { stripeAccountId: true } })
    if (current?.stripeAccountId !== accountId) throw new AgendaError('A conta Stripe vinculada foi alterada. Consulte o suporte.')
  }
  return createConnectOnboardingLink(api, accountId, tenantId, origin)
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

export async function changeConnectAvailability(tenantId: string, actorId: string, pause: boolean) {
  return db.$transaction(async tx => {
    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId }, select: { stripeAccountId: true, connectPausedAt: true }
    })
    if (!tenant?.stripeAccountId) throw new AgendaError('Nenhuma conta de recebimentos foi conectada.')
    const changed = await tx.tenant.updateMany({
      where: { id: tenantId, stripeAccountId: tenant.stripeAccountId, connectPausedAt: tenant.connectPausedAt },
      data: { connectPausedAt: pause ? new Date() : null }
    })
    if (changed.count) await tx.teamEvent.create({
      data: { tenantId, actorId, subject: 'Recebimentos Stripe', action: pause ? 'CONNECT_PAUSED' : 'CONNECT_RESUMED' }
    })
  })
}

export async function connectObligations(tenantId: string) {
  const [appointments, orders] = await Promise.all([
    db.appointment.count({ where: { tenantId, OR: [{ status: 'PENDING' }, { checkoutState: 'REVIEW' }] } }),
    db.shopOrder.count({ where: { tenantId, OR: [{ status: 'PENDING' }, { paymentReview: true }] } })
  ])
  return { appointments, orders }
}
