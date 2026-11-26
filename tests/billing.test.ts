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

test('programação de fatura não duplica avisos e cancela cobranças obsoletas', async () => {
  const { enqueueInvoiceNotices } = await import('../lib/commercial-notices')
  const token = randomUUID()
  const tenant = await db.tenant.create({ data: { slug: token, name: 'Testes de comunicação' } })
  const kind = 'DUE_7'
  const prior = await db.commercialRule.findUnique({ where: { kind } })
  const config = { enabled: true, hour: 9, leadDays: 7, template: '{evento} {detalhes}' }
  await db.commercialRule.upsert({ where: { kind }, create: { kind, ...config }, update: config })
  const invoice = {
    id: 'in_' + token, status: 'open', currency: 'brl', amount_remaining: 3500,
    due_date: Math.floor(Date.now() / 1000) + 8 * 86_400
  } as Stripe.Invoice
  try {
    await Promise.all([db.$transaction(tx => enqueueInvoiceNotices(tx, tenant.id, invoice)), db.$transaction(tx => enqueueInvoiceNotices(tx, tenant.id, invoice))])
    const where = { tenantId: tenant.id, kind, invoiceId: invoice.id }
    assert.equal(await db.commercialNotice.count({ where }), 1)
    await db.$transaction(tx => enqueueInvoiceNotices(tx, tenant.id, { ...invoice, status: 'paid', amount_remaining: 0 }))
    assert.equal((await db.commercialNotice.findFirstOrThrow({ where })).state, 'CANCELED')
  } finally {
    await db.tenant.delete({ where: { id: tenant.id } })
    if (prior) await db.commercialRule.update({ where: { kind }, data: prior })
    else await db.commercialRule.delete({ where: { kind } })
  }
})
