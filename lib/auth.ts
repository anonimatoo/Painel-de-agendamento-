import { createHash, randomBytes, scrypt as derive, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { cookies } from 'next/headers'
import { db } from './db'

const scrypt = promisify(derive)
const cookieName = 'agenda_session'
const digest = (token: string) => createHash('sha256').update(token).digest('hex')

export async function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  const key = await scrypt(password, salt, 64) as Buffer
  return salt + ':' + key.toString('hex')
}

export async function verifyPassword(password: string, stored?: string) {
  const actual = await hashPassword(password, stored?.split(':')[0] ?? 'unknown-user')
  return !!stored && actual.length === stored.length && timingSafeEqual(Buffer.from(actual), Buffer.from(stored))
}

export async function startSession(userId: string, mfaVerified = false) {
  const token = randomBytes(32).toString('base64url')
  const expires = new Date(Date.now() + 7 * 86_400_000)
  await db.session.create({ data: { tokenHash: digest(token), userId, expiresAt: expires, mfaVerified } })
  ;(await cookies()).set(cookieName, token, {
    expires, httpOnly: true, sameSite: 'lax', path: '/',
    secure: process.env.APP_URL?.startsWith('https://') ?? process.env.NODE_ENV === 'production'
  })
}

export async function userSession() {
  const token = (await cookies()).get(cookieName)?.value
  if (!token) return null
  const session = await db.session.findUnique({ where: { tokenHash: digest(token) }, include: { user: true } })
  return session && session.expiresAt > new Date() ? { ...session.user, adminMfaVerified: session.mfaVerified && Boolean(session.user.mfaSecret) } : null
}

export async function endSession() {
  const jar = await cookies()
  const token = jar.get(cookieName)?.value
  if (token) await db.session.deleteMany({ where: { tokenHash: digest(token) } })
  jar.delete(cookieName)
}

export async function membership(userId: string) {
  return db.member.findFirst({ where: { userId, disabledAt: null }, include: { tenant: true }, orderBy: { tenantId: 'asc' } })
}
