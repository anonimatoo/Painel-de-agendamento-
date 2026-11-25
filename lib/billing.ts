import { AgendaError } from './agenda'
import { db } from './db'
import { stripe } from './stripe'

export async function subscriptionCheckout(input: { tenantId: string; email: string; planId: string; cycle: 'monthly' | 'annual'; origin: string }) {
  const { tenantId, email, planId, cycle, origin } = input
  const api = await stripe()
  const route = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, include: { billingCheckout: true } })
    if (tenant.suspended) throw new AgendaError('Entre em contato com o suporte para retomar o acesso.')
    const plan = await tx.plan.findFirst({ where: { id: planId, active: true } })
    if (!plan) throw new AgendaError('Esse plano não está disponível.')
    let customerId = tenant.stripeCustomerId
    if (!customerId) {
      const customer = await api.customers.create({ email, name: tenant.name, metadata: { tenantId } }, { idempotencyKey: 'tenant:' + tenantId })
      customerId = customer.id
      await tx.tenant.update({ where: { id: tenantId }, data: { stripeCustomerId: customerId } })
    }
    for await (const subscription of api.subscriptions.list({ customer: customerId, status: 'all', limit: 20 })) {
      if (!['canceled', 'incomplete_expired'].includes(subscription.status)) return { customerId }
    }
    const open = await api.checkout.sessions.list({ customer: customerId, status: 'open', limit: 100 })
    const usable = open.data.find(session => session.mode === 'subscription' && session.url)
    if (usable?.url) return { customerId, url: usable.url }

    if (tenant.billingCheckout && tenant.billingCheckout.expiresAt > new Date()) {
      return { customerId, attempt: tenant.billingCheckout }
    }
    const priorSubscription = await tx.subscription.count({ where: { tenantId } })
    const trialDays = priorSubscription ? 0 : plan.trialDays
    const values = {
      priceId: cycle === 'monthly' ? plan.monthlyPriceId : plan.annualPriceId,
      customerId, trialDays, expiresAt: new Date(Math.floor(Date.now() / 1000) * 1000 + 60 * 60_000)
    }
    if (tenant.billingCheckout) await tx.billingCheckout.delete({ where: { tenantId } })
    const attempt = await tx.billingCheckout.create({ data: { tenantId, ...values } })
    return { customerId, attempt }
  }, { timeout: 25_000 })
  if (route.url) return route.url
  if (!route.attempt) {
    const portal = await api.billingPortal.sessions.create({ customer: route.customerId, return_url: origin + '/assinatura' })
    return portal.url
  }
  const attempt = route.attempt
  const session = await api.checkout.sessions.create({
    mode: 'subscription',
    customer: attempt.customerId,
    expires_at: +attempt.expiresAt / 1000,
    line_items: [{ price: attempt.priceId, quantity: 1 }],
    allow_promotion_codes: true,
    subscription_data: attempt.trialDays ? { trial_period_days: attempt.trialDays } : undefined,
    success_url: origin + '/dashboard?assinatura=recebida',
    cancel_url: origin + '/dashboard'
  }, { idempotencyKey: 'billing:' + attempt.id })
  if (!session.url || session.status !== 'open') throw new AgendaError('O pagamento já foi iniciado. Consulte a situação da assinatura.')
  return session.url
}
