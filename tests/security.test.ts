import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, test } from 'node:test'
import { allowAttempt, consumeAccountToken, issueAccountToken } from '../lib/account-security'
import { hashPassword, verifyPassword } from '../lib/auth'
import { db } from '../lib/db'

after(() => db.$disconnect())

test('redefinição de senha consome o link uma vez e revoga sessões', async () => {
  const user = await db.user.create({
    data: {
      email: randomUUID() + '@example.test',
      password: await hashPassword('Senha-anterior'),
      sessions: { create: { tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60_000) } }
    }
  })
  try {
    const token = await issueAccountToken(user.id, 'PASSWORD_RESET')
    assert.equal(await consumeAccountToken(token, 'EMAIL_VERIFY'), false)
    const results = await Promise.all([
      consumeAccountToken(token, 'PASSWORD_RESET', 'Senha-nova-teste'),
      consumeAccountToken(token, 'PASSWORD_RESET', 'Senha-nova-teste')
    ])
    assert.equal(results.filter(Boolean).length, 1)
    const updated = await db.user.findUniqueOrThrow({ where: { id: user.id }, include: { sessions: true } })
    assert.equal(await verifyPassword('Senha-nova-teste', updated.password), true)
    assert.equal(updated.sessions.length, 0)
    const verification = await issueAccountToken(user.id, 'EMAIL_VERIFY')
    assert.equal(await consumeAccountToken(verification, 'EMAIL_VERIFY'), true)
    assert.ok((await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt)
  } finally {
    await db.user.delete({ where: { id: user.id } })
  }
})

test('limite compartilhado aplica o máximo sob concorrência', async () => {
  const subject = randomUUID()
  const attempts = await Promise.all(Array.from({ length: 8 }, () => allowAttempt('test', subject, 3, 60)))
  assert.equal(attempts.filter(Boolean).length, 3)
})
