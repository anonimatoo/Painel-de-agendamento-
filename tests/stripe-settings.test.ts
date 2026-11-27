import assert from 'node:assert/strict'
import { test } from 'node:test'
import Stripe from 'stripe'
import { stripeSettingsForm } from '../lib/stripe-settings-form'
import { saveStripeConfiguration, StripeSettingsError } from '../lib/stripe-settings'

const valid = {
  mode: 'test', publishableKey: 'pk_test_fixture', secret: 'sk_test_fixture',
  billingWebhook: 'whsec_billing', connectWebhook: 'whsec_connect', password: 'senha de teste'
}

test('formulário normaliza chaves, mantém a senha e aponta campos vazios ou incompatíveis', () => {
  const withSpaces = Object.fromEntries(Object.entries(valid).map(([key, value]) =>
    [key, key === 'mode' ? value : ' ' + value + ' ']))
  assert.deepEqual(stripeSettingsForm.parse(withSpaces), { ...valid, password: ' senha de teste ' })
  const empty = stripeSettingsForm.safeParse({ ...valid, billingWebhook: ' ', connectWebhook: '' })
  assert.equal(empty.success, false)
  assert.deepEqual(empty.error?.issues.map(issue => issue.path[0]), ['billingWebhook', 'connectWebhook'])
  const mismatch = stripeSettingsForm.safeParse({ ...valid, mode: 'live' })
  assert.deepEqual(mismatch.error?.issues.map(issue => issue.path[0]), ['publishableKey', 'secret'])
})

test('chave de criptografia ausente bloqueia a gravação antes de contatar a Stripe', async () => {
  const original = process.env.CREDENTIAL_ENCRYPTION_KEY
  delete process.env.CREDENTIAL_ENCRYPTION_KEY
  const provider = { accounts: { retrieve: async () => assert.fail('A Stripe não deve ser chamada') } } as unknown as Stripe
  try {
    await assert.rejects(saveStripeConfiguration('admin', 'test', valid.publishableKey, valid, provider),
      error => error instanceof StripeSettingsError && error.kind === 'encryption')
  } finally {
    if (original !== undefined) process.env.CREDENTIAL_ENCRYPTION_KEY = original
  }
})
