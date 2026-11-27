import { createHash, randomBytes, scrypt as derive, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { cookies } from 'next/headers'
import { db } from './db'

const scrypt = promisify(derive)
const cookieName = 'agenda_session'
export const sessionDuration = 7 * 86_400_000
const digest = (token: string) => createHash('sha256').update(token).digest('hex')

export async function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  const key = await scrypt(password, salt, 64) as Buffer
  return salt + ':' + key.toString('hex')
}

export async function verifyPassword(password: string, stored?: string | null) {
  const actual = await hashPassword(password, stored?.split(':')[0] ?? 'unknown-user')
  return !!stored && actual.length === stored.length && timingSafeEqual(Buffer.from(actual), Buffer.from(stored))
}

export async function startSession(userId: string, mfaVerified = false, social = false) {
  const token = randomBytes(32).toString('base64url')
  const expires = new Date(Date.now() + sessionDuration)
  const data = { tokenHash: digest(token), userId, expiresAt: expires, mfaVerified: social ? false : mfaVerified }
  if (social) {
    await db.$transaction(async tx => {
      const allowed = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "User" WHERE id = ${userId} AND NOT "platformAdmin" FOR UPDATE`
      if (!allowed.length) throw new Error('Conta indisponível para autenticação social')
      await tx.session.create({ data })
    })
  } else await db.session.create({ data })
  ;(await cookies()).set(cookieName, token, {
    expires, httpOnly: true, sameSite: 'lax', path: '/',
    secure: process.env.APP_URL?.startsWith('https://') ?? process.env.NODE_ENV === 'production'
  })
}

export async function sessionTokenHash() {
  const token = (await cookies()).get(cookieName)?.value
  return token ? digest(token) : null
}

export async function userSession() {
  const tokenHash = await sessionTokenHash()
  if (!tokenHash) return null
  const session = await db.session.findUnique({ where: { tokenHash }, include: { user: true } })
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
