import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, test } from 'node:test'
import type Stripe from 'stripe'
import { startConnectOnboarding } from '../lib/connect'
import { db } from '../lib/db'

after(() => db.$disconnect())

test('onboarding persiste a conta por estabelecimento e recupera falhas com o mesmo pedido', async () => {
  assert.equal(await db.stripeSettings.count(), 0, 'Use um banco de teste sem credenciais Stripe')
  let failOnboarding = true
  let failCreation = true
  const attempts = new Map<string, { accountId: string; body: unknown }>()
  const links: string[] = []
  const api = {
    accounts: { retrieve: async () => ({ id: 'acct_platform' }) },
    rawRequest: async (_method: string, path: string, body: Record<string, unknown>, options: { idempotencyKey?: string }) => {
      if (path === '/v2/core/accounts') {
        assert.ok(options.idempotencyKey)
        const accountId = 'acct_' + options.idempotencyKey.replace(/[^a-zA-Z0-9]/g, '')
        const previous = attempts.get(options.idempotencyKey)
        if (previous) assert.deepEqual(body, previous.body)
        else attempts.set(options.idempotencyKey, { accountId, body })
        if (failCreation) {
          failCreation = false
          throw new Error('response lost after Stripe created account')
        }
        return {
          id: accountId, object: 'v2.core.account', dashboard: 'express', applied_configurations: ['merchant', 'recipient'],
          defaults: { responsibilities: { fees_collector: 'application_express', losses_collector: 'application' } }
        }
      }
      assert.equal(path, '/v2/core/account_links')
      const account = String(body.account)
      links.push(account)
      if (failOnboarding) {
        failOnboarding = false
        throw new Error('link failed')
      }
      return { account, url: 'https://accounts.stripe.com/r/' + account }
    }
  } as unknown as Stripe
  const tenants = await db.tenant.createManyAndReturn({ data: Array.from({ length: 3 }, () => ({ name: 'Connect fixture', slug: randomUUID() })) })
  const [first, second, expired] = tenants
  const start = (tenantId: string, email = 'admin@example.test') => startConnectOnboarding(
    tenantId, email, 'https://agenda.example.test', secret => {
      assert.equal(secret, 'sk_test_connect_fixture')
      return api
    }
  )
  try {
    await assert.rejects(start(first.id), /response lost/)
    assert.equal((await db.tenant.findUniqueOrThrow({ where: { id: first.id } })).stripeAccountId, null)
    assert.deepEqual(links, [])
    await assert.rejects(start(first.id, 'other@example.test'), /link failed/)
    const connected = await db.tenant.findUniqueOrThrow({ where: { id: first.id } })
    assert.ok(connected.stripeAccountId)
    assert.equal(connected.connectAttemptEmail, null)
    const urls = await Promise.all([start(first.id), start(second.id), start(second.id, 'second@example.test')])
    const other = await db.tenant.findUniqueOrThrow({ where: { id: second.id } })
    assert.ok(other.stripeAccountId)
    assert.notEqual(connected.stripeAccountId, other.stripeAccountId)
    assert.deepEqual(urls.map(url => new URL(url).pathname), [
      '/r/' + connected.stripeAccountId, '/r/' + other.stripeAccountId, '/r/' + other.stripeAccountId
    ])
    assert.equal(attempts.size, 2)
    assert.equal(links.length, 4)
    await db.tenant.update({ where: { id: expired.id }, data: {
      connectAttemptAt: new Date(Date.now() - 30 * 86400_000),
      connectAttemptEmail: 'admin@example.test', connectAttemptScope: 'test:acct_platform'
    } })
    await assert.rejects(start(expired.id), /conciliação/)
    assert.equal(attempts.size, 2)
  } finally {
    await db.tenant.deleteMany({ where: { id: { in: tenants.map(tenant => tenant.id) } } })
  }
})
