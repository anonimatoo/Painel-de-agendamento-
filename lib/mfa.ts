import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Secret } from 'otpauth'
import { db } from './db'
import { acceptedMfaCounter, mfaQr } from './mfa-totp'
import { seal, unseal } from './secrets'

type Credentials = { id: string; password: string }
type PendingSetup = { secret: string; challenge: string; expires: number }

const recoveryHash = (code: string) => createHash('sha256').update(code).digest('hex')

function recoveryBatch() {
  const codes = Array.from({ length: 10 }, () => randomBytes(12).toString('hex').toUpperCase().match(/.{6}/g)!.join('-'))
  return { codes, fields: { mfaRecoveryIssuedAt: new Date(), mfaRecoveryHashes: codes.map(recoveryHash) } }
}

export async function startMfaSetup(user: Credentials & { email: string }) {
  const secret = new Secret({ size: 20 }).base32
  const challenge = randomUUID()
  const qr = await mfaQr(secret, user.email)
  const expires = Date.now() + 10 * 60_000
  const changed = await db.user.updateMany({
    where: { id: user.id, password: user.password, platformAdmin: true, mfaSecret: null },
    data: { mfaPending: seal(JSON.stringify({ secret, challenge, expires }), 'setup:' + user.id) }
  })
  return changed.count === 1 ? { secret, challenge, qr } : null
}

export async function finishMfaSetup(user: Credentials & { mfaPending: string | null }, code: string, challenge: string, now = Date.now()) {
  if (!user.mfaPending) return null
  let setup: PendingSetup
  try { setup = JSON.parse(unseal(user.mfaPending, 'setup:' + user.id)) } catch { return null }
  if (setup.expires <= now || setup.challenge !== challenge) return null
  const counter = acceptedMfaCounter(setup.secret, code, now)
  if (counter === null) return null
  const batch = recoveryBatch()
  return db.$transaction(async tx => {
    const selected = await tx.user.updateMany({
      where: { id: user.id, password: user.password, platformAdmin: true, mfaSecret: null, mfaPending: user.mfaPending },
      data: { mfaSecret: seal(setup.secret, 'mfa:' + user.id), mfaCounter: counter, mfaPending: null, ...batch.fields }
    })
    if (!selected.count) return null
    await tx.session.deleteMany({ where: { userId: user.id } })
    return batch.codes
  })
}

export async function issueMfaRecovery(user: Credentials & { mfaSecret: string | null }) {
  if (!user.mfaSecret) return null
  const batch = recoveryBatch()
  const changed = await db.user.updateMany({
    where: { id: user.id, password: user.password, platformAdmin: true, mfaSecret: user.mfaSecret, mfaRecoveryIssuedAt: null },
    data: batch.fields
  })
  return changed.count === 1 ? batch.codes : null
}

export async function verifyMfa(user: { id: string; mfaSecret: string | null; password?: string }, code: string, now = Date.now()) {
  if (!user.mfaSecret) return false
  const secret = unseal(user.mfaSecret, 'mfa:' + user.id)
  const counter = acceptedMfaCounter(secret, code, now)
  if (counter === null) return false
  const changed = await db.user.updateMany({
    where: {
      id: user.id, platformAdmin: true, mfaSecret: user.mfaSecret, password: user.password,
      OR: [{ mfaCounter: null }, { mfaCounter: { lt: counter } }]
    },
    data: { mfaCounter: counter }
  })
  return changed.count === 1
}

export async function consumeMfaRecovery(user: Credentials & { mfaSecret: string | null }, input: string) {
  const code = input.trim().toUpperCase()
  if (!user.mfaSecret || !/^(?:[A-F0-9]{6}-){3}[A-F0-9]{6}$/.test(code)) return false
  const hash = recoveryHash(code)
  const changed = await db.$executeRaw`
    UPDATE "User"
    SET "mfaRecoveryHashes" = array_remove("mfaRecoveryHashes", ${hash})
    WHERE id = ${user.id} AND "platformAdmin" AND "mfaSecret" = ${user.mfaSecret}
      AND password = ${user.password} AND ${hash} = ANY("mfaRecoveryHashes")
  `
  return changed === 1
}
