import { db } from './db'
import type Stripe from 'stripe'
import { stripeConfiguration, stripeClient } from './stripe-settings'
import { stripe } from './stripe'

export async function stripeLedger(account: string | undefined, from: number, to: number, provider?: Stripe) {
  const api = provider ?? await stripe()
  const options = account ? { stripeAccount: account } : undefined
  const [balance, transactions, payouts, disputes] = await Promise.all([
    api.balance.retrieve(options),
    api.balanceTransactions.list({ created: { gte: from, lt: to }, limit: 100, expand: ['data.source'] }, options),
    api.payouts.list({ created: { gte: from, lt: to }, limit: 30 }, options),
    api.disputes.list({ created: { gte: from, lt: to }, limit: 30 }, options)
  ])
  return { balance, transactions, payouts, disputes }
}

export async function ledgerScope(platform: boolean, account?: string | null, snapshot?: { api: Stripe; mode: string }) {
  const config = snapshot ? null : await stripeConfiguration()
  const mode = snapshot?.mode ?? config!.mode
  if (!platform) return account ? mode + ':' + account : null
  const api = snapshot?.api ?? stripeClient(config!.secret)
  return mode + ':platform:' + (await api.accounts.retrieve()).id
}

export async function storeMovements(scope: string, rows: Stripe.BalanceTransaction[]) {
  if (!rows.length) return
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${scope}))) AS lock`
    const previous = await tx.stripeMovement.findMany({
      where: { scope, stripeId: { in: rows.map(row => row.id) } }, orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }], distinct: ['stripeId']
    })
    const byId = new Map(previous.map(row => [row.stripeId, row]))
    const pending = rows.map(row => {
      const source = row.source
      const charge = source && typeof source !== 'string' && source.object === 'charge' ? source : null
      const customerId = typeof charge?.customer === 'string' ? charge.customer : charge?.customer?.id ?? null
      const intentId = typeof charge?.payment_intent === 'string' ? charge.payment_intent : charge?.payment_intent?.id ?? null
      return {
        scope, stripeId: row.id, sourceId: typeof source === 'string' ? source : source?.id ?? null,
        category: row.reporting_category, status: row.status, currency: row.currency, gross: row.amount,
        fee: row.fee, net: row.net, occurredAt: new Date(row.created * 1000), customerId, intentId
      }
    }).filter(row => {
      const prior = byId.get(row.stripeId)
      return !prior || prior.status !== row.status || prior.gross !== row.gross || prior.fee !== row.fee || prior.net !== row.net ||
        prior.category !== row.category || prior.currency !== row.currency || prior.customerId !== row.customerId || prior.intentId !== row.intentId || prior.sourceId !== row.sourceId
    })
    if (pending.length) await tx.stripeMovement.createMany({ data: pending })
  })
}

export async function recordedMovements(scope: string, start: Date, end: Date, filter: { category?: string; status?: string; ref?: string; customer?: string }) {
  const where = { scope, occurredAt: { gte: start, lt: end } }
  const rows = await db.stripeMovement.findMany({
    where, orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }], distinct: ['stripeId'], take: 5000
  })
  return rows.filter(row =>
    (!filter.category || row.category === filter.category) &&
    (!filter.status || row.status === filter.status) &&
    (!filter.ref || row.stripeId === filter.ref || row.sourceId === filter.ref || row.intentId === filter.ref) &&
    (!filter.customer || row.customerId === filter.customer)
  ).sort((a, b) => +b.occurredAt - +a.occurredAt)
}

export async function movementDifferences(tenantId: string, rows: Awaited<ReturnType<typeof recordedMovements>>) {
  const intents = [...new Set(rows.filter(row => ['charge', 'payment'].includes(row.category) && row.intentId).map(row => row.intentId!))]
  if (!intents.length) return []
  const [appointments, orders] = await Promise.all([
    db.appointment.findMany({ where: { tenantId, paymentIntentId: { in: intents }, paidAt: { not: null } }, select: { paymentIntentId: true, cents: true, chargeCents: true } }),
    db.shopOrder.findMany({ where: { tenantId, paymentIntentId: { in: intents }, paidAt: { not: null } }, select: { paymentIntentId: true, cents: true } })
  ])
  const expected = new Map([...appointments.map(row => [row.paymentIntentId, row.chargeCents ?? row.cents] as const), ...orders.map(row => [row.paymentIntentId, row.cents] as const)])
  return rows.filter(row => row.currency === 'brl' && ['charge','payment'].includes(row.category) && row.intentId && expected.has(row.intentId) && expected.get(row.intentId) !== row.gross)
}
