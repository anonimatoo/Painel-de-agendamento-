import type { Prisma } from '@prisma/client'
import type Stripe from 'stripe'
import { stripeClient, stripeConfiguration } from './stripe-settings'
import { refreshAccess, updateInvoice, updateSubscription } from './billing-sync'
import { db } from './db'
import { settleOrder } from './orders'
import { applyConnectedRefund } from './connected-refunds'
import { enqueueMerchantConfirmation, enqueueStatus, scheduleReminder } from './agenda'

export async function stripe() {
  return stripeClient((await stripeConfiguration()).secret)
}

export async function applyEvent(event: Stripe.Event, client?: Stripe) {
  await db.$transaction(async tx => {
    const inserted = await tx.webhookEvent.createMany({
      data: { id: event.id, type: event.type, source: event.account ? 'connect' : 'billing' }, skipDuplicates: true
    })
    if (!inserted.count) return

    if (event.account && ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.expired', 'checkout.session.async_payment_failed'].includes(event.type)) {
      const session = event.data.object as Stripe.Checkout.Session
      const expired = (event.type === 'checkout.session.expired' && session.status === 'expired') ||
        (event.type === 'checkout.session.async_payment_failed' && session.status === 'complete' && session.payment_status === 'unpaid')
      await settleAppointment(tx, event.account, session, expired)
      await settleOrder(tx, event.account, session, expired)
    }

    if (event.account && ['refund.created', 'refund.updated', 'refund.failed'].includes(event.type)) {
      await applyConnectedRefund(tx, event.account, event.data.object as Stripe.Refund)
    }

    if (event.account) return
    const subscriptionEvent = /^customer\.subscription\.(created|updated|deleted|paused|resumed)$/.test(event.type)
    const invoiceEvent = ['invoice.finalized', 'invoice.paid', 'invoice.payment_failed', 'invoice.payment_action_required',
      'invoice.finalization_failed', 'invoice.voided', 'invoice.marked_uncollectible'].includes(event.type)
    if (!subscriptionEvent && !invoiceEvent) return
    const incoming = event.data.object as Stripe.Subscription | Stripe.Invoice
    const customer = typeof incoming.customer === 'string' ? incoming.customer : incoming.customer?.id
    if (!customer) return
    const tenant = await tx.tenant.findUnique({ where: { stripeCustomerId: customer } })
    if (!tenant) return
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenant.id} FOR UPDATE`
    const api = client ?? await stripe()
    let subscriptionId = subscriptionEvent ? incoming.id : undefined
    if (invoiceEvent && incoming.id) {
      const invoice = await api.invoices.retrieve(incoming.id)
      const invoiceCustomer = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id
      if (invoiceCustomer !== customer) return
      await updateInvoice(tx, tenant.id, invoice, event.type)
      const subscription = invoice.parent?.subscription_details?.subscription
      subscriptionId = typeof subscription === 'string' ? subscription : subscription?.id
    }
    if (subscriptionId) {
      await updateSubscription(tx, tenant.id, await api.subscriptions.retrieve(subscriptionId))
      await refreshAccess(tx, tenant.id)
    }
  }, { timeout: 20_000 })
}


export async function settleAppointment(tx: Prisma.TransactionClient, account: string, session: Stripe.Checkout.Session, expired: boolean) {
  const appointment = await tx.appointment.findFirst({
    where: { id: session.metadata?.appointmentId ?? '', OR: [{ checkoutAccountId: account }, { checkoutAccountId: null, tenant: { stripeAccountId: account } }], status: { in: ['PENDING', 'CANCELED'] } },
    include: { tenant: true }
  })
  if (!appointment || (appointment.checkoutId && appointment.checkoutId !== session.id)) return
  if (appointment.checkoutAccountId && appointment.checkoutAccountId !== account) return
  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
  const approved = session.payment_status === 'paid' && session.amount_total === (appointment.chargeCents ?? appointment.cents) &&
    session.currency === 'brl' && Boolean(paymentIntentId)
  if (appointment.status === 'CANCELED') {
    if (approved && !appointment.paidAt) {
      const late = await tx.appointment.updateMany({
        where: { id: appointment.id, status: 'CANCELED', paidAt: null },
        data: { checkoutId: session.id, paymentIntentId, paidAt: new Date(), checkoutState: 'REVIEW' }
      })
      if (late.count) await tx.appointmentHistory.create({ data: { appointmentId: appointment.id, operation: 'PAYMENT_LATE' } })
    }
    return
  }
  if (expired && session.payment_status !== 'paid') {
    const expired = await tx.appointment.updateMany({ where: { id: appointment.id, status: 'PENDING' }, data: { checkoutId: session.id, status: 'CANCELED', checkoutState: 'EXPIRED' } })
    if (expired.count) await tx.appointmentHistory.create({ data: { appointmentId: appointment.id, operation: 'PAYMENT_EXPIRED' } })
  } else if (approved) {
    const updated = await tx.appointment.updateMany({
      where: { id: appointment.id, status: 'PENDING' },
      data: { status: 'CONFIRMED', paidAt: new Date(), checkoutId: session.id, paymentIntentId, checkoutState: 'PAID' }
    })
    if (updated.count) {
      await scheduleReminder(tx, appointment.tenant, { ...appointment, status: 'CONFIRMED' })
      await enqueueStatus(tx, appointment.tenant, appointment, 'PAID')
      await enqueueMerchantConfirmation(tx, appointment.tenant, appointment)
      await tx.appointmentHistory.create({ data: { appointmentId: appointment.id, operation: 'PAYMENT_CONFIRMED' } })
    }
  }
}
