import Stripe from 'stripe'
import type { Prisma } from '@prisma/client'
import { db } from './db'
import { credentialEncryptionReady, seal, unseal } from './secrets'
import { AgendaError } from './agenda'

type WebhookKeys = { billingWebhook: string; connectWebhook: string }
type Credentials = { secret: string; billingWebhook: string; connectWebhook: string }

export class StripeSettingsError extends AgendaError {
  constructor(readonly kind: 'authentication' | 'communication' | 'encryption' | 'persistence' | 'financial', message: string) {
    super(message)
  }
}

async function retrievePlatformAccount(client: Stripe, previous = false) {
  try {
    return await client.accounts.retrieve()
  } catch (error) {
    const authentication = error instanceof Stripe.errors.StripeAuthenticationError || error instanceof Stripe.errors.StripePermissionError
    const subject = previous ? 'a credencial Stripe anterior do ambiente' : 'a chave secreta informada'
    if (authentication) throw new StripeSettingsError('authentication', 'A Stripe recusou ' + subject + '. Confira a chave e suas permissões.')
    throw new StripeSettingsError('communication', previous
      ? 'Não foi possível consultar a conta Stripe anterior. Tente novamente antes de atualizar as credenciais.'
      : 'Não foi possível comunicar com a Stripe. Tente novamente em instantes.')
  }
}

function encryptCredentials(value: string, context: string) {
  try { return seal(value, context) } catch {
    throw new StripeSettingsError('encryption', 'Não foi possível criptografar as credenciais. Confira CREDENTIAL_ENCRYPTION_KEY no servidor.')
  }
}

function decryptCredentials<T>(value: string, context: string): T {
  try { return JSON.parse(unseal(value, context)) as T } catch {
    throw new StripeSettingsError('encryption', 'Não foi possível ler as credenciais criptografadas com a chave atual do servidor.')
  }
}

export function stripeClient(secret: string) {
  return new Stripe(secret, { maxNetworkRetries: 2, timeout: 8_000 })
}

export async function stripeConfiguration(connection: Pick<Prisma.TransactionClient, 'stripeSettings'> = db) {
  const configuration = await connection.stripeSettings.findUnique({ where: { id: 1 } })
  if (configuration) {
    return {
      ...decryptCredentials<Credentials>(configuration.encrypted, 'stripe:' + configuration.accountId + ':' + configuration.mode),
      mode: configuration.mode, paused: configuration.paused,
      previous: configuration.previousWebhooks && configuration.previousWebhooksUntil && +configuration.previousWebhooksUntil > Date.now()
        ? decryptCredentials<WebhookKeys>(configuration.previousWebhooks, 'stripe-webhooks:' + configuration.accountId + ':' + configuration.mode)
        : undefined
    }
  }
  const secret = process.env.STRIPE_SECRET_KEY?.trim()
  if (!secret) throw new StripeSettingsError('authentication', 'Nenhuma credencial Stripe foi salva ou configurada no servidor.')
  return {
    secret, paused: false, previous: undefined, mode: secret.startsWith('sk_live_') || secret.startsWith('rk_live_') ? 'live' : 'test',
    billingWebhook: process.env.STRIPE_WEBHOOK_SECRET?.trim(), connectWebhook: process.env.STRIPE_CONNECT_WEBHOOK_SECRET?.trim()
  }
}

export async function saveStripeConfiguration(actorId: string, mode: 'test' | 'live', publishableKey: string, credentials: Credentials, provider?: Stripe) {
  if (!publishableKey.startsWith('pk_' + mode + '_') || !credentials.secret.startsWith('sk_' + mode + '_')) {
    throw new AgendaError('As chaves devem corresponder ao ambiente selecionado.')
  }
  if (!credentialEncryptionReady()) {
    throw new StripeSettingsError('encryption', 'Criptografia indisponível. Configure CREDENTIAL_ENCRYPTION_KEY com 64 caracteres hexadecimais no servidor.')
  }
  const account = await retrievePlatformAccount(provider ?? stripeClient(credentials.secret))
  const credentialContext = 'stripe:' + account.id + ':' + mode
  const encrypted = encryptCredentials(JSON.stringify(credentials), credentialContext)
  try {
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(73520451)) AS lock`
      const previous = await tx.stripeSettings.findUnique({ where: { id: 1 } })
      const tenants = await tx.tenant.count({ where: { OR: [
        { stripeCustomerId: { not: null } }, { stripeAccountId: { not: null } }, { connectAttemptAt: { not: null } }
      ] } })
      const linked = tenants > 0 || await tx.plan.count() > 0 || await tx.stripeMovement.count() > 0
      if (linked) {
        const existing = process.env.STRIPE_SECRET_KEY?.trim()
        if (!previous && !existing) {
          throw new StripeSettingsError('financial', 'Configuração inicial bloqueada: existem vínculos financeiros e a credencial Stripe anterior do ambiente está ausente.')
        }
        const previousMode = previous?.mode ?? (existing?.includes('_live_') ? 'live' : 'test')
        if (previousMode !== mode) {
          throw new StripeSettingsError('financial', 'Existem vínculos financeiros. Selecione o mesmo ambiente Stripe utilizado anteriormente.')
        }
        const previousAccount = previous?.accountId ?? (existing === credentials.secret ? account.id :
          (await retrievePlatformAccount(new Stripe(existing!, { maxNetworkRetries: 0, timeout: 5_000 }), true)).id)
        if (previousAccount !== account.id) {
          throw new StripeSettingsError('financial', 'Existem vínculos financeiros. Use credenciais da mesma conta Stripe utilizada anteriormente.')
        }
      }
      const sameAccount = previous?.accountId === account.id && previous.mode === mode
      const context = 'stripe-webhooks:' + account.id + ':' + mode
      const old = sameAccount ? decryptCredentials<Credentials>(previous.encrypted, credentialContext) : undefined
      const rotated = old && (old.billingWebhook !== credentials.billingWebhook || old.connectWebhook !== credentials.connectWebhook)
      const previousWebhooks = rotated ? encryptCredentials(JSON.stringify({ billingWebhook: old.billingWebhook, connectWebhook: old.connectWebhook }), context)
        : sameAccount ? previous.previousWebhooks : null
      const previousWebhooksUntil = rotated ? new Date(Date.now() + 24 * 60 * 60_000) : sameAccount ? previous.previousWebhooksUntil : null
      const settings = {
        previousWebhooks, previousWebhooksUntil, encrypted,
        accountId: account.id, mode, publishableKey, checkedAt: new Date(), checkSucceeded: true,
        paymentsEnabled: account.charges_enabled, payoutsEnabled: account.payouts_enabled
      }
      const stored = await tx.stripeSettings.upsert({
        where: { id: 1 }, create: { id: 1, ...settings }, update: settings,
        select: { accountId: true, mode: true, encrypted: true, publishableKey: true }
      })
      if (stored.accountId !== account.id || stored.mode !== mode || stored.encrypted !== encrypted || stored.publishableKey !== publishableKey) {
        throw new StripeSettingsError('persistence', 'O banco não confirmou a gravação das credenciais criptografadas.')
      }
      await tx.adminAudit.create({ data: { actorId, action: 'STRIPE_CONFIG_UPDATED', targetId: account.id } })
    }, { timeout: 20_000 })
  } catch (error) {
    if (error instanceof StripeSettingsError) throw error
    throw new StripeSettingsError('persistence', 'Não foi possível salvar a configuração da Stripe no banco de dados. Nenhuma alteração foi confirmada.')
  }
}

export async function stripeForNewPayments() {
  const config = await stripeConfiguration()
  if (config.paused) throw new AgendaError('Novas cobranças estão temporariamente indisponíveis.')
  return stripeClient(config.secret)
}

export async function checkStripeConnection(actorId: string) {
  const before = await db.stripeSettings.findUnique({ where: { id: 1 } })
  const config = await stripeConfiguration()
  let account: Stripe.Account | undefined
  let failure: unknown
  try {
    account = await retrievePlatformAccount(stripeClient(config.secret))
  } catch (error) {
    failure = error
  }
  if (before) {
    try {
      await db.$transaction([
        db.stripeSettings.updateMany({
          where: { id: 1, encrypted: before.encrypted },
          data: { checkedAt: new Date(), checkSucceeded: Boolean(account),
            paymentsEnabled: account?.charges_enabled ?? null, payoutsEnabled: account?.payouts_enabled ?? null }
        }),
        db.adminAudit.create({ data: { actorId, targetId: before.accountId, action: account ? 'STRIPE_CHECK_OK' : 'STRIPE_CHECK_FAILED' } })
      ])
    } catch {
      throw new StripeSettingsError('persistence', 'Não foi possível registrar no banco o resultado do teste de conexão.')
    }
  }
  if (failure) throw failure
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
