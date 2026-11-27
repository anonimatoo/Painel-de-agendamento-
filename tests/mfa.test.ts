import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, test } from 'node:test'
import { Secret, TOTP, URI } from 'otpauth'
import { db } from '../lib/db'
import { acceptedMfaCounter, mfaQr, mfaUri } from '../lib/mfa-totp'
import { consumeMfaRecovery, finishMfaSetup, issueMfaRecovery, startMfaSetup, verifyMfa } from '../lib/mfa'
import { seal, unseal } from '../lib/secrets'

after(() => db.$disconnect())

test('provisionamento TOTP produz URI interoperável e PNG local', async () => {
  const secret = new Secret({ size: 20 }).base32
  const email = 'admin+homologacao@example.test'
  const uri = mfaUri(secret, email)
  const parsed = URI.parse(uri)
  assert.ok(parsed instanceof TOTP)
  assert.match(uri, /^otpauth:\/\/totp\//)
  assert.equal(parsed.issuer, 'CS Agenda Pro')
  assert.equal(parsed.label, email)
  assert.equal(parsed.secret.base32, secret)
  assert.equal(parsed.digits, 6)
  assert.equal(parsed.algorithm, 'SHA1')
  assert.equal(parsed.period, 30)
  const time = 1_800_000_000_000
  const code = parsed.generate({ timestamp: time })
  assert.equal(acceptedMfaCounter(secret, code, time + 30_000), time / 30_000)
  assert.equal(acceptedMfaCounter(secret, '12345', time), null)
  const qr = await mfaQr(secret, email)
  assert.match(qr, /^data:image\/png;base64,/)
  assert.equal(Buffer.from(qr.split(',')[1], 'base64').subarray(1, 4).toString(), 'PNG')
})

test('ativação, substituição e recuperação são atômicas no PostgreSQL', async () => {
  process.env.CREDENTIAL_ENCRYPTION_KEY ??= 'a'.repeat(64)
  const owner = await db.user.create({ data: { email: randomUUID() + '@example.test', password: 'fixture', platformAdmin: true } })
  const other = await db.user.create({ data: { email: randomUUID() + '@example.test', password: 'fixture', platformAdmin: true } })
  try {
    const first = await startMfaSetup(owner)
    assert.ok(first)
    const stale = await db.user.findUniqueOrThrow({ where: { id: owner.id } })
    assert.ok(stale.mfaPending && !stale.mfaPending.includes(first.secret))
    const current = await startMfaSetup(owner)
    assert.ok(current)
    assert.notEqual(first.secret, current.secret)
    const active = await db.user.findUniqueOrThrow({ where: { id: owner.id } })
    const time = Date.now()
    const firstCode = new TOTP({ secret: Secret.fromBase32(first.secret) }).generate({ timestamp: time })
    const code = new TOTP({ secret: Secret.fromBase32(current.secret) }).generate({ timestamp: time })
    assert.equal(await finishMfaSetup(stale, firstCode, first.challenge, time), null)
    assert.equal(await finishMfaSetup(active, code, first.challenge, time), null)
    assert.equal(await finishMfaSetup(active, '12345', current.challenge, time), null)
    assert.equal(await finishMfaSetup(active, code, current.challenge, time + 11 * 60_000), null)
    assert.equal(await finishMfaSetup({ ...active, id: other.id }, code, current.challenge, time), null)
    await db.session.create({ data: { tokenHash: randomUUID(), userId: owner.id, expiresAt: new Date(time + 60_000) } })
    const results = await Promise.all([
      finishMfaSetup(active, code, current.challenge, time),
      finishMfaSetup(active, code, current.challenge, time)
    ])
    assert.equal(results.filter(Boolean).length, 1)
    const codes = results.find(Boolean)!
    assert.equal(new Set(codes).size, 10)
    const enabled = await db.user.findUniqueOrThrow({ where: { id: owner.id } })
    assert.ok(enabled.mfaSecret)
    assert.notEqual(enabled.mfaSecret, current.secret)
    assert.equal(unseal(enabled.mfaSecret, 'mfa:' + owner.id), current.secret)
    assert.equal(enabled.mfaPending, null)
    assert.equal(enabled.mfaRecoveryHashes.length, 10)
    assert.ok(enabled.mfaRecoveryHashes.every(hash => /^[a-f0-9]{64}$/.test(hash)))
    assert.equal(await db.session.count({ where: { userId: owner.id } }), 0)
    assert.equal(await verifyMfa(enabled, code, time), false)
    assert.equal(await issueMfaRecovery(enabled), null)
    const legacy = await db.user.update({ where: { id: other.id }, data: { mfaSecret: seal(first.secret, 'mfa:' + other.id) } })
    assert.ok(await issueMfaRecovery(legacy))
    assert.equal(await consumeMfaRecovery(legacy, codes[0]), false)
    const used = await Promise.all([
      consumeMfaRecovery(enabled, codes[0].toLowerCase()),
      consumeMfaRecovery(enabled, codes[0]),
      consumeMfaRecovery(enabled, codes[1])
    ])
    assert.equal(used.filter(Boolean).length, 2)
    assert.equal(await consumeMfaRecovery(enabled, codes[0]), false)
    assert.equal(await consumeMfaRecovery(enabled, codes[1]), false)
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: owner.id } })).mfaRecoveryHashes.length, 8)
  } finally {
    await db.user.deleteMany({ where: { id: { in: [owner.id, other.id] } } })
  }
})
