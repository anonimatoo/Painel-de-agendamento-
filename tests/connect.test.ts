import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import Stripe from 'stripe'
import { createConnectAccount, createConnectOnboardingLink, readConnectStatus } from '../lib/connect-accounts'

const accountId = 'acct_test123'
const fees = { fees_collector: 'application_express', losses_collector: 'application' }

test('o SDK envia JSON para Accounts v2 e mantém a versão v1 ao consultar habilitação', async () => {
  const requests: { path: string; headers: Record<string, unknown>; body: unknown }[] = []
  const v2 = {
    id: accountId, object: 'v2.core.account', dashboard: 'express',
    applied_configurations: ['merchant', 'recipient'], defaults: { responsibilities: fees },
    configuration: {
      merchant: { capabilities: { card_payments: { status: 'active' } } },
      recipient: { capabilities: { stripe_balance: { stripe_transfers: { status: 'pending' } } } }
    },
    requirements: { summary: { minimum_deadline: { status: 'currently_due' } } }
  }
  let chargesEnabled = true
  let linkAccount = accountId
  let rejectCreate = false
  const server = createServer(async (request, response) => {
    let data = ''
    for await (const chunk of request) data += chunk
    const path = request.url ?? ''
    requests.push({ path, headers: request.headers, body: data ? JSON.parse(data) : null })
    response.setHeader('Content-Type', 'application/json')
    if (rejectCreate && path === '/v2/core/accounts') {
      response.writeHead(400)
      response.end(JSON.stringify({ error: { type: 'invalid_request_error', code: 'account_controller_unsupported_configuration', message: 'Unsupported combination' } }))
      return
    }
    const result = path.endsWith('/account_links')
      ? { account: linkAccount, url: 'https://accounts.stripe.com/r/test' }
      : path.startsWith('/v1/')
        ? { id: accountId, charges_enabled: chargesEnabled, payouts_enabled: false, details_submitted: true }
        : v2
    response.end(JSON.stringify(result))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const api = new Stripe('sk_test_local_fixture', {
      host: '127.0.0.1', port: (server.address() as AddressInfo).port, protocol: 'http', maxNetworkRetries: 0
    })
    assert.equal(await createConnectAccount(api, 'tenant-a', 'admin@example.test'), accountId)
    const [creation] = requests
    assert.equal(creation.path, '/v2/core/accounts')
    assert.match(String(creation.headers['content-type']), /^application\/json/)
    assert.equal(creation.headers['stripe-version'], '2026-11-18.endive')
    assert.equal(creation.headers['idempotency-key'], 'connect-v2:tenant-a')
    assert.equal(creation.headers['stripe-account'], undefined)
    assert.deepEqual(creation.body, {
      identity: { country: 'br' }, contact_email: 'admin@example.test', dashboard: 'express',
      defaults: { responsibilities: fees }, metadata: { tenantId: 'tenant-a' }, include: ['defaults'],
      configuration: {
        merchant: { capabilities: { card_payments: { requested: true } } },
        recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } }
      }
    })
    assert.equal(await createConnectOnboardingLink(api, accountId, 'tenant-a', 'https://agenda.example.test'), 'https://accounts.stripe.com/r/test')
    assert.equal(requests[1].path, '/v2/core/account_links')
    assert.equal(requests[1].headers['stripe-version'], '2026-11-18.endive')
    assert.deepEqual(requests[1].body, {
      account: accountId,
      use_case: { type: 'account_onboarding', account_onboarding: {
        refresh_url: 'https://agenda.example.test/api/stripe/connect/refresh?estabelecimento=tenant-a',
        return_url: 'https://agenda.example.test/dashboard'
      } }
    })
    assert.deepEqual(await readConnectStatus(api, accountId), {
      payments: true, payouts: false, submitted: true, requirements: 'currently_due', transfers: 'pending'
    })
    const snapshot = requests.find(item => item.path === '/v1/accounts/' + accountId)
    assert.equal(snapshot?.headers['stripe-version'], '2025-08-27.basil')
    const lookup = requests.find(item => item.path.startsWith('/v2/core/accounts/' + accountId))
    const query = new URL(lookup!.path, 'https://api.stripe.com').searchParams
    assert.deepEqual([...query.values()], ['configuration.merchant', 'configuration.recipient', 'requirements'])

    chargesEnabled = false
    assert.equal((await readConnectStatus(api, accountId)).payments, false)
    chargesEnabled = true
    v2.configuration.merchant.capabilities.card_payments.status = 'restricted'
    assert.equal((await readConnectStatus(api, accountId)).payments, false)
    await assert.rejects(readConnectStatus(api, 'acct_other'), /Unexpected Stripe Connect account ID/)
    linkAccount = 'acct_other'
    await assert.rejects(createConnectOnboardingLink(api, accountId, 'tenant-a', 'https://agenda.example.test'), /Invalid Stripe Connect account link/)
    rejectCreate = true
    const before = requests.length
    await assert.rejects(createConnectAccount(api, 'tenant-b', 'admin@example.test'), /Unsupported combination/)
    assert.equal(requests.length, before + 1)
    assert.equal(requests[before].headers['idempotency-key'], 'connect-v2:tenant-b')
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
})
