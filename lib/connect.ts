import { db } from './db'
import { settleAppointment, stripe } from './stripe'
import { AgendaError } from './agenda'
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
    payment_intent: intent, metadata: { appointmentId }
  }, { stripeAccount: account, idempotencyKey: 'appointment-refund:' + appointmentId })
  if (refund.status === 'succeeded') {
    await db.appointment.updateMany({ where: { id: appointmentId, tenantId, paidAt: { not: null } }, data: { refundedAt: new Date(), status: 'CANCELED' } })
  } else if (refund.status !== 'pending' && refund.status !== 'requires_action') {
    throw new AgendaError('O estorno não foi aprovado. Consulte a situação na Stripe.')
  }
}

export async function reconcileAppointments() {
  const now = new Date()
  const pending = await db.appointment.findMany({
    where: { status: 'PENDING', expiresAt: { lte: now }, tenant: { stripeAccountId: { not: null } } },
    orderBy: { expiresAt: 'asc' }, take: 25,
    select: { id: true, checkoutId: true, createdAt: true, expiresAt: true, tenant: { select: { stripeAccountId: true } } }
  })
  if (!pending.length) return
  const api = await stripe()
  for (const reservation of pending) {
    const account = reservation.tenant.stripeAccountId!
    try {
      let session: Stripe.Checkout.Session | undefined
      if (reservation.checkoutId) {
        session = await api.checkout.sessions.retrieve(reservation.checkoutId, { stripeAccount: account })
      } else {
        for await (const candidate of api.checkout.sessions.list({
          created: { gte: Math.floor(+reservation.createdAt / 1000) - 10, lte: Math.floor(+reservation.expiresAt! / 1000) },
          limit: 100
        }, { stripeAccount: account })) {
          if (candidate.metadata?.appointmentId === reservation.id) { session = candidate; break }
        }
      }
      if (session) {
        await db.$transaction(tx => settleAppointment(tx, account, session, session.status === 'expired'))
      } else if (+now - +reservation.expiresAt! > 10 * 60_000) {
        await db.appointment.updateMany({
          where: { id: reservation.id, status: 'PENDING', checkoutId: null },
          data: { status: 'CANCELED' }
        })
      }
    } catch {
      console.error('appointment-reconciliation', reservation.id)
    }
  }
}
