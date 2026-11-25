import Stripe from 'stripe'
import { db } from './db'
import { scheduleReminder } from './agenda'

export function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe configuration missing')
  return new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2 })
}

export async function applyEvent(event: Stripe.Event) {
  await db.$transaction(async tx => {
    const inserted = await tx.webhookEvent.createMany({
      data: { id: event.id, type: event.type }, skipDuplicates: true
    })
    if (!inserted.count) return

    if (event.account && ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.expired', 'checkout.session.async_payment_failed'].includes(event.type)) {
      const session = event.data.object as Stripe.Checkout.Session
      const appointment = await tx.appointment.findFirst({
        where: { id: session.metadata?.appointmentId ?? '', tenant: { stripeAccountId: event.account }, status: 'PENDING' },
        include: { tenant: true }
      })
      if (!appointment || (appointment.checkoutId && appointment.checkoutId !== session.id)) return
      if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
        await tx.appointment.updateMany({ where: { id: appointment.id, status: 'PENDING' }, data: { status: 'CANCELED' } })
      } else if (session.payment_status === 'paid' && session.amount_total === appointment.cents && session.currency === 'brl') {
        const updated = await tx.appointment.updateMany({
          where: { id: appointment.id, status: 'PENDING' },
          data: { status: 'CONFIRMED', paidAt: new Date(), checkoutId: session.id }
        })
        if (updated.count) await scheduleReminder(tx, appointment.tenant, { ...appointment, status: 'CONFIRMED' })
      }
    }

    if (!event.account && /^customer\.subscription\.(created|updated|deleted)$/.test(event.type)) {
      const incoming = event.data.object as Stripe.Subscription
      const current = await stripe().subscriptions.retrieve(incoming.id)
      const customer = typeof current.customer === 'string' ? current.customer : current.customer.id
      const tenant = await tx.tenant.findUnique({ where: { stripeCustomerId: customer } })
      const price = current.items.data[0]?.price.id
      if (!tenant || !price) return
      // Serialize recomputation for concurrent subscriptions within the same tenant.
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenant.id} FOR UPDATE`
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
