import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { after, test } from 'node:test'
import Stripe from 'stripe'
import { seal } from '../lib/secrets'
import { db } from '../lib/db'
import { saveStripeConfiguration, stripeConfiguration, verifyStripeEvent } from '../lib/stripe-settings'

after(() => db.$disconnect())

test('rotação mantém janela do segredo anterior e isola assinatura, destino e modo', async () => {
  const original = await db.stripeSettings.findUnique({ where: { id: 1 } })
  if (original) throw new Error('Use um banco dedicado sem configuração Stripe.')
  const previousKey = process.env.CREDENTIAL_ENCRYPTION_KEY
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('hex')
  const actor = randomUUID()
  const account = 'acct_' + actor
  const provider = { accounts: { retrieve: async () => ({ id: account, charges_enabled: true, payouts_enabled: true }) } } as unknown as Stripe
  const previous = { secret: 'sk_test_fixture', billingWebhook: 'whsec_previous_billing', connectWebhook: 'whsec_previous_connect' }
  const next = { secret: 'sk_test_replacement', billingWebhook: 'whsec_current_billing', connectWebhook: 'whsec_current_connect' }
  try {
    await db.stripeSettings.create({ data: {
      id: 1, accountId: account, mode: 'test', publishableKey: 'pk_test_fixture',
      encrypted: seal(JSON.stringify(previous), 'stripe:' + account + ':test')
    } })
    await saveStripeConfiguration(actor, 'test', 'pk_test_replacement', next, provider)
    const config = await stripeConfiguration()
    const client = new Stripe(config.secret)
    const payload = JSON.stringify({ id: 'evt_fixture', livemode: false })
    const sign = (secret: string, body = payload) => Stripe.webhooks.generateTestHeaderString({ payload: body, secret })
    assert.ok(verifyStripeEvent(client, payload, sign(next.billingWebhook), config, 'billing'))
    assert.ok(verifyStripeEvent(client, payload, sign(previous.billingWebhook), config, 'billing'))
    assert.equal(verifyStripeEvent(client, payload, sign(previous.connectWebhook), config, 'billing'), null)
    const live = JSON.stringify({ id: 'evt_fixture', livemode: true })
    assert.equal(verifyStripeEvent(client, live, sign(next.billingWebhook, live), config, 'billing'), null)
    assert.equal(verifyStripeEvent(client, payload, sign('whsec_unrelated_fixture'), config, 'billing'), null)
    const stored = await db.stripeSettings.findUniqueOrThrow({ where: { id: 1 } })
    assert.ok(!stored.encrypted.includes(next.secret) && !stored.previousWebhooks?.includes(previous.billingWebhook))
    await db.stripeSettings.update({ where: { id: 1 }, data: { previousWebhooksUntil: new Date(0) } })
    assert.equal(verifyStripeEvent(client, payload, sign(previous.billingWebhook), await stripeConfiguration(), 'billing'), null)
  } finally {
    await db.stripeSettings.deleteMany({ where: { accountId: account } })
    await db.adminAudit.deleteMany({ where: { actorId: actor } })
    if (previousKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY
    else process.env.CREDENTIAL_ENCRYPTION_KEY = previousKey
  }
})
