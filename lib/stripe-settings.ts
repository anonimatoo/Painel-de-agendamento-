import Stripe from 'stripe'
import { db } from './db'
import { seal, unseal } from './secrets'
import { AgendaError } from './agenda'

type Credentials = { secret: string; billingWebhook: string; connectWebhook: string }

export function stripeClient(secret: string) {
  return new Stripe(secret, { maxNetworkRetries: 2, timeout: 8_000 })
}

export async function stripeConfiguration() {
  const configuration = await db.stripeSettings.findUnique({ where: { id: 1 } })
  if (configuration) {
    return {
      ...JSON.parse(unseal(configuration.encrypted, 'stripe:' + configuration.accountId + ':' + configuration.mode)) as Credentials,
      mode: configuration.mode
    }
  }
  const secret = process.env.STRIPE_SECRET_KEY
  if (!secret) throw new Error('Stripe configuration missing')
  return {
    secret, mode: secret.startsWith('sk_live_') || secret.startsWith('rk_live_') ? 'live' : 'test',
    billingWebhook: process.env.STRIPE_WEBHOOK_SECRET, connectWebhook: process.env.STRIPE_CONNECT_WEBHOOK_SECRET
  }
}

export async function saveStripeConfiguration(actorId: string, mode: 'test' | 'live', publishableKey: string, credentials: Credentials) {
  if (!publishableKey.startsWith('pk_' + mode + '_') || !credentials.secret.startsWith('sk_' + mode + '_')) {
    throw new AgendaError('As chaves devem corresponder ao ambiente selecionado.')
  }
  const account = await stripeClient(credentials.secret).accounts.retrieve().catch(() => null)
  if (!account) throw new AgendaError('Não foi possível conectar à Stripe. Confira os dados informados.')
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(73520451)) AS lock`
    const previous = await tx.stripeSettings.findUnique({ where: { id: 1 } })
    const [tenants, plans] = await Promise.all([
      tx.tenant.count({ where: { OR: [{ stripeCustomerId: { not: null } }, { stripeAccountId: { not: null } }] } }),
      tx.plan.count()
    ])
    if (tenants || plans) {
      const existing = process.env.STRIPE_SECRET_KEY
      const previousAccount = previous?.accountId ?? (existing ? (await stripeClient(existing).accounts.retrieve()).id : undefined)
      const previousMode = previous?.mode ?? (existing?.includes('_live_') ? 'live' : 'test')
      if (previousAccount !== account.id || previousMode !== mode) {
        throw new AgendaError('Já existem cobranças vinculadas à conta atual. Use a mesma conta e ambiente para atualizar as chaves.')
      }
    }
    const settings = { accountId: account.id, mode, publishableKey, encrypted: seal(JSON.stringify(credentials), 'stripe:' + account.id + ':' + mode) }
    await tx.stripeSettings.upsert({ where: { id: 1 }, create: { id: 1, ...settings }, update: settings })
    await tx.adminAudit.create({ data: { actorId, action: 'STRIPE_CONFIG_UPDATED', targetId: account.id } })
  }, { timeout: 20_000 })
}
