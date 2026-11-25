import type { Prisma } from '@prisma/client'
import type Stripe from 'stripe'
import { stripeClient, stripeConfiguration } from './stripe-settings'
import { db } from './db'
import { settleOrder, settleOrderRefund } from './orders'
import { enqueueStatus, scheduleReminder } from './agenda'

export async function stripe() {
  return stripeClient((await stripeConfiguration()).secret)
}

export async function applyEvent(event: Stripe.Event) {
  await db.$transaction(async tx => {
    const inserted = await tx.webhookEvent.createMany({
      data: { id: event.id, type: event.type }, skipDuplicates: true
    })
    if (!inserted.count) return

    if (event.account && ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.expired', 'checkout.session.async_payment_failed'].includes(event.type)) {
      const session = event.data.object as Stripe.Checkout.Session
      const expired = event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed'
      await settleAppointment(tx, event.account, session, event.type === 'checkout.session.expired' && session.status === 'expired')
      await settleOrder(tx, event.account, session, expired)
    }

    if (event.account && ['refund.created', 'refund.updated'].includes(event.type)) {
      const refund = event.data.object as Stripe.Refund
      await settleOrderRefund(tx, event.account, refund)
      if (refund.status === 'succeeded' && refund.metadata?.appointmentId) {
        const paymentIntentId = typeof refund.payment_intent === 'string' ? refund.payment_intent : refund.payment_intent?.id
        const appointment = await tx.appointment.findFirst({
          where: { id: refund.metadata.appointmentId, tenant: { stripeAccountId: event.account }, paymentIntentId, paidAt: { not: null } }
        })
        if (paymentIntentId && appointment && refund.currency === 'brl' && refund.amount === (appointment.chargeCents ?? appointment.cents)) {
          await tx.appointment.update({ where: { id: appointment.id }, data: { refundedAt: new Date(), status: 'CANCELED' } })
        }
      }
    }

    if (!event.account && /^customer\.subscription\.(created|updated|deleted)$/.test(event.type)) {
      const incoming = event.data.object as Stripe.Subscription
      const customer = typeof incoming.customer === 'string' ? incoming.customer : incoming.customer.id
      const tenant = await tx.tenant.findUnique({ where: { stripeCustomerId: customer } })
      if (!tenant) return
      // Serialize recomputation for concurrent subscriptions within the same tenant.
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenant.id} FOR UPDATE`
      const current = await (await stripe()).subscriptions.retrieve(incoming.id)
      const price = current.items.data[0]?.price.id
      if (!price) return
      const plan = await tx.plan.findFirst({ where: { OR: [{ monthlyPriceId: price }, { annualPriceId: price }] } })
      if (!plan) return
      await tx.subscription.upsert({
        where: { id: current.id }, update: { status: current.status, planId: plan.id },
        create: { id: current.id, status: current.status, planId: plan.id, tenantId: tenant.id }
      })
      const active = await tx.subscription.count({ where: { tenantId: tenant.id, status: { in: ['active', 'trialing'] } } })
      await tx.tenant.update({ where: { id: tenant.id }, data: { active: active > 0 } })
    }
  }, { timeout: 20_000 })
}


export async function settleAppointment(tx: Prisma.TransactionClient, account: string, session: Stripe.Checkout.Session, expired: boolean) {
  const appointment = await tx.appointment.findFirst({
    where: { id: session.metadata?.appointmentId ?? '', tenant: { stripeAccountId: account }, status: { in: ['PENDING', 'CANCELED'] } },
    include: { tenant: true }
  })
  if (!appointment || (appointment.checkoutId && appointment.checkoutId !== session.id)) return
  if (appointment.checkoutAccountId && appointment.checkoutAccountId !== account) return
  if (appointment.status === 'CANCELED') {
    if (session.payment_status === 'paid' && !appointment.paidAt) {
      await tx.appointment.updateMany({ where: { id: appointment.id, status: 'CANCELED', paidAt: null }, data: { checkoutId: session.id, checkoutState: 'REVIEW' } })
    }
    return
  }
  if (expired && session.payment_status !== 'paid') {
    await tx.appointment.updateMany({ where: { id: appointment.id, status: 'PENDING' }, data: { checkoutId: session.id, status: 'CANCELED', checkoutState: 'EXPIRED' } })
  } else if (session.payment_status === 'paid' && session.amount_total === (appointment.chargeCents ?? appointment.cents) && session.currency === 'brl') {
    const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
    const updated = await tx.appointment.updateMany({
      where: { id: appointment.id, status: 'PENDING' },
      data: { status: 'CONFIRMED', paidAt: new Date(), checkoutId: session.id, paymentIntentId, checkoutState: 'PAID' }
    })
    if (updated.count) {
      await scheduleReminder(tx, appointment.tenant, { ...appointment, status: 'CONFIRMED' })
      await enqueueStatus(tx, appointment.tenant, appointment, 'PAID')
      await tx.appointmentHistory.create({ data: { appointmentId: appointment.id, operation: 'PAYMENT_CONFIRMED' } })
    }
  }
}
