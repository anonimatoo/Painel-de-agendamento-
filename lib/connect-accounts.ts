import type Stripe from 'stripe'

const apiVersion = '2026-11-18.endive'
const accountsPath = '/v2/core/accounts'
const accountIdPattern = /^acct_[a-zA-Z0-9]+$/
const includes = ['configuration.merchant', 'configuration.recipient', 'requirements']

type ConnectProvider = Pick<Stripe, 'rawRequest' | 'accounts'>
type Capability = { status: string }
type Account = {
  id: string
  object: 'v2.core.account'
  dashboard?: string
  closed?: boolean
  applied_configurations: string[]
  configuration?: {
    merchant?: { capabilities?: { card_payments?: Capability } }
    recipient?: { capabilities?: { stripe_balance?: { stripe_transfers?: Capability } } }
  }
  defaults?: { responsibilities?: { fees_collector: string; losses_collector: string } }
  requirements?: { summary?: { minimum_deadline?: { status: string } } }
}

const responsibilities = { fees_collector: 'application_express', losses_collector: 'application' }

function readAccount(value: unknown): Account {
  const account = value as Partial<Account> | null
  if (account?.object !== 'v2.core.account' || typeof account.id !== 'string' ||
      !accountIdPattern.test(account.id) || !Array.isArray(account.applied_configurations)) {
    throw new Error('Invalid Stripe Connect account response')
  }
  return account as Account
}

export async function createConnectAccount(api: ConnectProvider, tenantId: string, email: string) {
  const account = readAccount(await api.rawRequest('POST', accountsPath, {
    identity: { country: 'br' },
    contact_email: email,
    dashboard: 'express',
    defaults: { responsibilities },
    configuration: {
      merchant: { capabilities: { card_payments: { requested: true } } },
      recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } }
    },
    metadata: { tenantId },
    include: ['defaults']
  }, { apiVersion, idempotencyKey: 'connect-v2:' + tenantId }))

  if (account.closed || account.dashboard !== 'express' ||
      !['merchant', 'recipient'].every(role => account.applied_configurations.includes(role)) ||
      account.defaults?.responsibilities?.fees_collector !== responsibilities.fees_collector ||
      account.defaults.responsibilities.losses_collector !== responsibilities.losses_collector) {
    throw new Error('Unexpected Stripe Connect account configuration')
  }
  return account.id
}

export async function createConnectOnboardingLink(api: ConnectProvider, accountId: string, tenantId: string, origin: string) {
  const refresh = new URL('/api/stripe/connect/refresh', origin)
  refresh.searchParams.set('estabelecimento', tenantId)
  const result = await api.rawRequest('POST', '/v2/core/account_links', {
    account: accountId,
    use_case: {
      type: 'account_onboarding',
      account_onboarding: { refresh_url: refresh.href, return_url: new URL('/dashboard', origin).href }
    }
  }, { apiVersion }) as { account?: string; url?: string }
  if (result?.account !== accountId || !result.url) throw new Error('Invalid Stripe Connect account link')
  const link = new URL(result.url)
  if (link.protocol !== 'https:' || link.host !== 'accounts.stripe.com' || link.username || link.password) {
    throw new Error('Invalid Stripe Connect account link origin')
  }
  return link.href
}

export async function readConnectStatus(api: ConnectProvider, accountId: string) {
  if (!accountIdPattern.test(accountId)) throw new Error('Invalid Stripe Connect account ID')
  const query = new URLSearchParams(includes.map((field, index) => ['include[' + index + ']', field]))
  const [raw, snapshot] = await Promise.all([
    api.rawRequest('GET', accountsPath + '/' + accountId + '?' + query, undefined, { apiVersion }),
    api.accounts.retrieve(accountId)
  ])
  const account = readAccount(raw)
  if (account.id !== accountId || snapshot.id !== accountId) throw new Error('Unexpected Stripe Connect account ID')

  const cardPayments = account.applied_configurations.includes('merchant')
    ? account.configuration?.merchant?.capabilities?.card_payments?.status : undefined
  const transfers = account.applied_configurations.includes('recipient')
    ? account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status : undefined
  const requirements = account.requirements?.summary?.minimum_deadline?.status
  return {
    payments: !account.closed && cardPayments === 'active' && snapshot.charges_enabled,
    pix: !account.closed && account.applied_configurations.includes('merchant') &&
      snapshot.country === 'BR' && snapshot.charges_enabled && snapshot.capabilities?.pix_payments === 'active',
    payouts: !account.closed && snapshot.payouts_enabled,
    submitted: !account.closed && snapshot.details_submitted,
    requirements,
    transfers
  }
}
