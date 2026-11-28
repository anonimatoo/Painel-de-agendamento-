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
    const invalid = Stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_other_fixture' })
    assert.equal((await fetch(url, { method: 'POST', headers: { 'stripe-signature': invalid }, body: payload })).status, 400)
    assert.equal(await db.webhookEvent.count({ where: { id } }), 0)
    assert.equal((await fetch(url, { method: 'POST', headers: { 'stripe-signature': signature }, body: ' '.repeat(1_048_577) })).status, 413)
    for (let index = 0; index < 2; index++) {
      const response = await fetch(url, { method: 'POST', headers: { 'stripe-signature': signature }, body: payload })
      assert.equal(response.status, 200)
    }
    assert.equal(await db.webhookEvent.count({ where: { id } }), 1)
    const thin = JSON.stringify({ id, object: 'v2.core.event', livemode: false, type: 'v2.core.account.created' })
    const thinSignature = Stripe.webhooks.generateTestHeaderString({ payload: thin, secret })
    const rejected = await fetch(url, { method: 'POST', headers: { 'stripe-signature': thinSignature }, body: thin })
    assert.equal(rejected.status, 400)
    console.log('O endpoint snapshot deduplicou o evento assinado, rejeitou assinatura inválida e thin event e limitou o tamanho do corpo.')
  } finally {
    await db.webhookEvent.deleteMany({ where: { id } })
    await db.$disconnect()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
