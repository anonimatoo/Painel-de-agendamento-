import Stripe from 'stripe'
import type { Prisma } from '@prisma/client'
import { db } from './db'
import { seal, unseal } from './secrets'
import { AgendaError } from './agenda'

type WebhookKeys = { billingWebhook: string; connectWebhook: string }
type Credentials = { secret: string; billingWebhook: string; connectWebhook: string }

export function stripeClient(secret: string) {
  return new Stripe(secret, { maxNetworkRetries: 2, timeout: 8_000 })
}

export async function stripeConfiguration(connection: Pick<Prisma.TransactionClient, 'stripeSettings'> = db) {
  const configuration = await connection.stripeSettings.findUnique({ where: { id: 1 } })
  if (configuration) {
    return {
      ...JSON.parse(unseal(configuration.encrypted, 'stripe:' + configuration.accountId + ':' + configuration.mode)) as Credentials,
      mode: configuration.mode, paused: configuration.paused,
      previous: configuration.previousWebhooks && configuration.previousWebhooksUntil && +configuration.previousWebhooksUntil > Date.now()
        ? JSON.parse(unseal(configuration.previousWebhooks, 'stripe-webhooks:' + configuration.accountId + ':' + configuration.mode)) as WebhookKeys
        : undefined
    }
  }
  const secret = process.env.STRIPE_SECRET_KEY
  if (!secret) throw new Error('Stripe configuration missing')
  return {
    secret, paused: false, previous: undefined, mode: secret.startsWith('sk_live_') || secret.startsWith('rk_live_') ? 'live' : 'test',
    billingWebhook: process.env.STRIPE_WEBHOOK_SECRET, connectWebhook: process.env.STRIPE_CONNECT_WEBHOOK_SECRET
  }
}

export async function saveStripeConfiguration(actorId: string, mode: 'test' | 'live', publishableKey: string, credentials: Credentials, provider?: Stripe) {
  if (!publishableKey.startsWith('pk_' + mode + '_') || !credentials.secret.startsWith('sk_' + mode + '_')) {
    throw new AgendaError('As chaves devem corresponder ao ambiente selecionado.')
  }
  const account = await (provider ?? stripeClient(credentials.secret)).accounts.retrieve().catch(() => null)
  if (!account) throw new AgendaError('Não foi possível conectar à Stripe. Confira os dados informados.')
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(73520451)) AS lock`
    const previous = await tx.stripeSettings.findUnique({ where: { id: 1 } })
    const [tenants, plans, journal] = await Promise.all([
      tx.tenant.count({ where: { OR: [{ stripeCustomerId: { not: null } }, { stripeAccountId: { not: null } }, { connectAttemptAt: { not: null } }] } }),
      tx.plan.count(),
      tx.stripeMovement.count()
    ])
    if (tenants || plans || journal) {
      const existing = process.env.STRIPE_SECRET_KEY
      const previousAccount = previous?.accountId ?? (existing ? (await stripeClient(existing).accounts.retrieve()).id : undefined)
      const previousMode = previous?.mode ?? (existing?.includes('_live_') ? 'live' : 'test')
      if (previousAccount !== account.id || previousMode !== mode) {
        throw new AgendaError('Já existem cobranças vinculadas à conta atual. Use a mesma conta e ambiente para atualizar as chaves.')
      }
    }
    const sameAccount = previous?.accountId === account.id && previous.mode === mode
    const context = 'stripe-webhooks:' + account.id + ':' + mode
    const old = sameAccount ? JSON.parse(unseal(previous.encrypted, 'stripe:' + account.id + ':' + mode)) as Credentials : undefined
    const rotated = old && (old.billingWebhook !== credentials.billingWebhook || old.connectWebhook !== credentials.connectWebhook)
    const previousWebhooks = rotated ? seal(JSON.stringify({ billingWebhook: old.billingWebhook, connectWebhook: old.connectWebhook }), context)
      : sameAccount ? previous.previousWebhooks : null
    const previousWebhooksUntil = rotated ? new Date(Date.now() + 24 * 60 * 60_000) : sameAccount ? previous.previousWebhooksUntil : null
    const settings = {
      previousWebhooks, previousWebhooksUntil,
      accountId: account.id, mode, publishableKey, checkedAt: new Date(), checkSucceeded: true,
      paymentsEnabled: account.charges_enabled, payoutsEnabled: account.payouts_enabled,
      encrypted: seal(JSON.stringify(credentials), 'stripe:' + account.id + ':' + mode)
    }
    await tx.stripeSettings.upsert({ where: { id: 1 }, create: { id: 1, ...settings }, update: settings })
    await tx.adminAudit.create({ data: { actorId, action: 'STRIPE_CONFIG_UPDATED', targetId: account.id } })
  }, { timeout: 20_000 })
}

export async function stripeForNewPayments() {
  const config = await stripeConfiguration()
  if (config.paused) throw new AgendaError('Novas cobranças estão temporariamente indisponíveis.')
  return stripeClient(config.secret)
}

export async function checkStripeConnection(actorId: string) {
  const before = await db.stripeSettings.findUnique({ where: { id: 1 } })
  const config = await stripeConfiguration()
  const account = await stripeClient(config.secret).accounts.retrieve().catch(() => null)
  if (before) {
    await db.$transaction([
      db.stripeSettings.updateMany({
        where: { id: 1, encrypted: before.encrypted },
        data: { checkedAt: new Date(), checkSucceeded: Boolean(account),
          paymentsEnabled: account?.charges_enabled ?? null, payoutsEnabled: account?.payouts_enabled ?? null }
      }),
      db.adminAudit.create({ data: { actorId, targetId: before.accountId, action: account ? 'STRIPE_CHECK_OK' : 'STRIPE_CHECK_FAILED' } })
    ])
  }
  if (!account) throw new AgendaError('Não foi possível consultar a conexão com a Stripe.')
}

export async function pauseStripePayments(actorId: string, paused: boolean) {
  await db.$transaction(async tx => {
    const current = await tx.stripeSettings.findUnique({ where: { id: 1 } })
    if (!current) throw new AgendaError('Salve as credenciais no painel antes de alterar o recebimento de novas cobranças.')
    await tx.stripeSettings.update({ where: { id: 1 }, data: { paused } })
    await tx.adminAudit.create({
      data: { actorId, action: paused ? 'STRIPE_PAUSED' : 'STRIPE_RESUMED', targetId: current.accountId }
    })
  })
}

export function verifyStripeEvent(client: Stripe, payload: string, signature: string, settings: Awaited<ReturnType<typeof stripeConfiguration>>, source: 'billing' | 'connect') {
  const field = source === 'billing' ? 'billingWebhook' : 'connectWebhook'
  for (const key of [settings[field], settings.previous?.[field]]) {
    if (!key) continue
    try {
      const event = client.webhooks.constructEvent(payload, signature, key)
      if (!!event.account === (source === 'connect') && event.livemode === (settings.mode === 'live')) return event
    } catch {
      // During rotation, the second key can authenticate a legitimate delivery.
    }
  }
  return null
}
