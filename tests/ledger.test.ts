import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, test } from 'node:test'
import type Stripe from 'stripe'
import { db } from '../lib/db'
import { recordedMovements, storeMovements } from '../lib/stripe-ledger'

after(() => db.$disconnect())

test('livro Stripe preserva revisões e separa conta e ambiente', async () => {
  const suffix = randomUUID()
  const first = 'test:acct_' + suffix
  const other = 'live:acct_' + suffix
  const now = new Date()
  const row = {
    id: 'txn_' + suffix, source: 'ch_' + suffix, reporting_category: 'charge',
    status: 'pending', currency: 'brl', amount: 5000, fee: 250, net: 4750, created: Math.floor(+now / 1000)
  } as Stripe.BalanceTransaction
  const range = [new Date(+now - 60_000), new Date(+now + 60_000)] as const
  try {
    await Promise.all([storeMovements(first, [row]), storeMovements(first, [row])])
    assert.equal(await db.stripeMovement.count({ where: { scope: first } }), 1)
    await storeMovements(first, [{ ...row, status: 'available' }])
    await storeMovements(other, [row])
    assert.equal(await db.stripeMovement.count({ where: { scope: first } }), 2)
    assert.equal((await recordedMovements(first, ...range, { status: 'available' }))[0].net, 4750)
    assert.equal((await recordedMovements(first, ...range, { status: 'pending' })).length, 0)
    assert.equal((await recordedMovements(other, ...range, { ref: row.id }))[0].status, 'pending')
  } finally {
    await db.stripeMovement.deleteMany({ where: { scope: { in: [first, other] } } })
  }
})
