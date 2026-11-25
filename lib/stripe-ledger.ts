import type Stripe from 'stripe'
import { stripe } from './stripe'

export async function stripeLedger(account: string | undefined, from: number, to: number, provider?: Stripe) {
  const api = provider ?? await stripe()
  const options = account ? { stripeAccount: account } : undefined
  const [balance, transactions, payouts, disputes] = await Promise.all([
    api.balance.retrieve(options),
    api.balanceTransactions.list({ created: { gte: from, lt: to }, limit: 100 }, options),
    api.payouts.list({ created: { gte: from, lt: to }, limit: 30 }, options),
    api.disputes.list({ created: { gte: from, lt: to }, limit: 30 }, options)
  ])
  return { balance, transactions, payouts, disputes }
}
