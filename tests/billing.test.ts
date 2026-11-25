import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, test } from 'node:test'
import type Stripe from 'stripe'
import { db } from '../lib/db'
import { applyEvent } from '../lib/stripe'

after(() => db.$disconnect())

test('fatura atrasada e eventos fora de ordem consultam a situação atual', async () => {
  const token = randomUUID()
  const customer = 'cus_' + token
  const invoiceId = 'in_' + token
  const subscriptionId = 'sub_' + token
  const plan = await db.plan.create({ data: {
    name: 'Teste', description: 'Teste', monthlyCents: 5000, annualCents: 50000,
    monthlyPriceId: 'price_m_' + token, annualPriceId: 'price_a_' + token
  } })
  const tenant = await db.tenant.create({ data: { slug: token, name: 'Teste Billing', stripeCustomerId: customer } })
  let status = 'past_due'
  let reads = 0
  const api = {
    invoices: { retrieve: async () => {
      reads++
      return {
        id: invoiceId, customer, amount_due: 5000, amount_paid: status === 'active' ? 5000 : 0, currency: 'brl',
        status: status === 'active' ? 'paid' : 'open', created: Math.floor(Date.now() / 1000),
        parent: { subscription_details: { subscription: subscriptionId } }
      }
    } },
    subscriptions: { retrieve: async () => ({ id: subscriptionId, status, items: { data: [{ price: { id: plan.monthlyPriceId } }] } }) }
  } as unknown as Stripe
  const event = (id: string, type: string) => ({
    id: token + id, type, data: { object: { id: invoiceId, customer } }
  }) as Stripe.Event
  try {
    await applyEvent(event('1', 'invoice.payment_failed'), api)
    assert.equal((await db.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).active, false)
    status = 'active'
    await applyEvent(event('2', 'invoice.paid'), api)
    await applyEvent(event('3', 'invoice.payment_failed'), api)
    await applyEvent(event('3', 'invoice.payment_failed'), api)
    assert.equal(reads, 3)
    assert.equal((await db.tenant.findUniqueOrThrow({ where: { id: tenant.id } })).active, true)
    assert.equal((await db.billingInvoice.findUniqueOrThrow({ where: { id: invoiceId } })).amountPaid, 5000)
  } finally {
    await db.webhookEvent.deleteMany({ where: { id: { startsWith: token } } })
    await db.subscription.deleteMany({ where: { tenantId: tenant.id } })
    await db.tenant.delete({ where: { id: tenant.id } })
    await db.plan.delete({ where: { id: plan.id } })
  }
})
