import assert from 'node:assert/strict'
import { test } from 'node:test'
import type Stripe from 'stripe'
import { checkoutMethods, failedCheckout } from '../lib/checkout-method'

const session = { status: 'complete', payment_status: 'unpaid', payment_intent: 'pi_fixture' } as Stripe.Checkout.Session

test('Checkout preserva cartão nos registros anteriores e limita a validade do Pix selecionado', () => {
  assert.deepEqual(checkoutMethods('card'), { payment_method_types: ['card'] })
  assert.deepEqual(checkoutMethods('pix'), { payment_method_types: ['pix'], payment_method_options: { pix: { expires_after_seconds: 240 } } })
})

test('Pix em processamento mantém a reserva e só encerra após confirmação da falha na conta conectada', async () => {
  let calls = 0
  let status = 'processing'
  const provider = { paymentIntents: { retrieve: async (id: string, option: { stripeAccount: string }) => {
    calls++
    assert.equal(id, 'pi_fixture')
    assert.equal(option.stripeAccount, 'acct_fixture')
    return { id, status }
  } } } as unknown as Stripe
  assert.equal(await failedCheckout(session, 'card', provider, 'acct_fixture'), false)
  assert.equal(await failedCheckout({ ...session, payment_status: 'paid' }, 'pix', provider, 'acct_fixture'), false)
  assert.equal(calls, 0)
  assert.equal(await failedCheckout(session, 'pix', provider, 'acct_fixture'), false)
  status = 'requires_payment_method'
  assert.equal(await failedCheckout(session, 'pix', provider, 'acct_fixture'), true)
  assert.equal(await failedCheckout({ ...session, status: 'expired' }, 'pix', provider, 'acct_fixture'), true)
  assert.equal(calls, 2)
})
