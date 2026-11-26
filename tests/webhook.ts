import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Stripe from 'stripe'
import { db } from '../lib/db'

async function main() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  assert.ok(secret, 'Configure o segredo de teste local.')
  const id = 'evt_local_' + randomUUID()
  const payload = JSON.stringify({ id, object: 'event', livemode: false, type: 'payment_intent.processing', data: { object: {} } })
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret })
  const url = new URL('/api/stripe/billing', process.env.APP_URL ?? 'http://localhost:3000')
  try {
    for (let index = 0; index < 2; index++) {
      const response = await fetch(url, { method: 'POST', headers: { 'stripe-signature': signature }, body: payload })
      assert.equal(response.status, 200)
    }
    assert.equal(await db.webhookEvent.count({ where: { id } }), 1)
    console.log('O webhook local aceitou a assinatura de teste e registrou um único evento.')
  } finally {
    await db.webhookEvent.deleteMany({ where: { id } })
    await db.$disconnect()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
