import { createHash, randomBytes } from 'node:crypto'
import type { TokenPurpose } from '@prisma/client'
import { db } from './db'
import { hashPassword } from './auth'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')

export async function allowAttempt(scope: string, subject: string, limit: number, seconds: number) {
  const key = digest(scope + ':' + subject)
  const [row] = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "count", "expiresAt")
    VALUES (${key}, 1, CURRENT_TIMESTAMP + ${seconds} * INTERVAL '1 second')
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."expiresAt" <= CURRENT_TIMESTAMP THEN 1 ELSE LEAST("RateLimit"."count", 1000000) + 1 END,
      "expiresAt" = CASE WHEN "RateLimit"."expiresAt" <= CURRENT_TIMESTAMP THEN EXCLUDED."expiresAt" ELSE "RateLimit"."expiresAt" END
    RETURNING "count"
  `
  return row.count <= limit
}

export async function issueAccountToken(userId: string, purpose: TokenPurpose) {
  const token = randomBytes(32).toString('base64url')
  const update = { tokenHash: digest(token), expiresAt: new Date(Date.now() + (purpose === 'PASSWORD_RESET' ? 30 : 1440) * 60_000) }
  await db.accountToken.upsert({ where: { userId_purpose: { userId, purpose } }, create: { userId, purpose, ...update }, update })
  return token
}

export async function consumeAccountToken(token: string, purpose: TokenPurpose, password?: string) {
  if (!/^[\w-]{43}$/.test(token)) return false
  const tokenHash = digest(token)
  const record = await db.accountToken.findUnique({ where: { tokenHash } })
  if (!record || record.purpose !== purpose || record.expiresAt <= new Date()) return false
  const hashed = purpose === 'PASSWORD_RESET' && password ? await hashPassword(password) : undefined
  if (purpose === 'PASSWORD_RESET' && !hashed) return false
  return db.$transaction(async tx => {
    const removed = await tx.accountToken.deleteMany({ where: { tokenHash, purpose, expiresAt: { gt: new Date() } } })
    if (!removed.count) return false
    await tx.user.update({ where: { id: record.userId }, data: hashed ? { password: hashed } : { emailVerifiedAt: new Date() } })
    if (hashed) await tx.session.deleteMany({ where: { userId: record.userId } })
    return true
  })
}

export function mailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM)
}

export async function sendAccountLink(user: { id: string; email: string }, purpose: TokenPurpose) {
  if (!mailConfigured()) throw new Error('E-mail transacional indisponível')
  const token = await issueAccountToken(user.id, purpose)
  const url = new URL('/conta', process.env.APP_URL)
  url.searchParams.set('token', token)
  if (purpose === 'EMAIL_VERIFY') url.searchParams.set('verificar', '1')
  const title = purpose === 'PASSWORD_RESET' ? 'Redefina sua senha' : 'Confirme seu e-mail'
  const result = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to: [user.email], subject: title + ' · CS Agenda Pro', text: title + ' no CS Agenda Pro pelo link: ' + url })
  })
  if (!result.ok) throw new Error('Falha no serviço de e-mail')
}
