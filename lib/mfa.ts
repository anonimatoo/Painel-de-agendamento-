import { Secret, TOTP } from 'otpauth'
import { cookies } from 'next/headers'
import { db } from './db'
import { seal, unseal } from './secrets'

const cookieName = 'agenda_mfa_setup'

function authenticator(secret: string) {
  return new TOTP({ secret: Secret.fromBase32(secret), algorithm: 'SHA1', digits: 6, period: 30 })
}

function acceptedCounter(secret: string, code: string, now: number) {
  if (!/^\d{6}$/.test(code)) return null
  const offset = authenticator(secret).validate({ token: code, timestamp: now, window: 1 })
  return offset === null ? null : Math.floor(now / 30_000) + offset
}

export async function startMfaSetup(userId: string) {
  const secret = new Secret({ size: 20 }).base32
  const jar = await cookies()
  const expires = new Date(Date.now() + 10 * 60_000)
  jar.set(cookieName, seal(JSON.stringify({ secret, expires: +expires }), 'setup:' + userId), {
    expires, httpOnly: true, path: '/', sameSite: 'strict',
    secure: process.env.APP_URL?.startsWith('https://') ?? process.env.NODE_ENV === 'production'
  })
  return secret
}

export async function finishMfaSetup(userId: string, code: string) {
  const jar = await cookies()
  const encrypted = jar.get(cookieName)?.value
  if (!encrypted) return false
  let setup: { secret: string; expires: number }
  try { setup = JSON.parse(unseal(encrypted, 'setup:' + userId)) } catch { return false }
  if (setup.expires <= Date.now()) return false
  const counter = acceptedCounter(setup.secret, code, Date.now())
  if (counter === null) return false
  const changed = await db.$transaction(async tx => {
    const selected = await tx.user.updateMany({
      where: { id: userId, platformAdmin: true, mfaSecret: null },
      data: { mfaSecret: seal(setup.secret, 'mfa:' + userId), mfaCounter: counter }
    })
    if (!selected.count) return false
    await tx.session.deleteMany({ where: { userId } })
    return true
  })
  if (changed) jar.delete(cookieName)
  return changed
}

export async function verifyMfa(user: { id: string; mfaSecret: string | null }, code: string, now = Date.now()) {
  if (!user.mfaSecret) return false
  const secret = unseal(user.mfaSecret, 'mfa:' + user.id)
  const counter = acceptedCounter(secret, code, now)
  if (counter === null) return false
  const changed = await db.user.updateMany({
    where: { id: user.id, platformAdmin: true, mfaSecret: user.mfaSecret, OR: [{ mfaCounter: null }, { mfaCounter: { lt: counter } }] },
    data: { mfaCounter: counter }
  })
  return changed.count === 1
}
