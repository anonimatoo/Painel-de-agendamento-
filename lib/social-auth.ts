import { Prisma } from '@prisma/client'
import { cookies } from 'next/headers'
import { db } from './db'
import { seal, unseal } from './secrets'
import { authorizationUrl, callbackUrl, exchangeSocialCode, randomToken, socialProviders, tokenDigest, type ProviderCredentials, type SocialClaims, type SocialProvider } from './social-oidc'
import { signupEmail } from './registration'

const life = 10 * 60_000
const signupCookie = 'agenda_social_signup'
type LinkSession = { userId: string; tokenHash: string }
type Attempt = { nonce: string; verifier: string; revision: string; link?: LinkSession; consumerSlug?: string }
export type SocialSignup = { provider: SocialProvider; subject: string; email: string; emailVerified: boolean; revision: string; expires: number; consumerSlug?: string }

export async function socialProviderReadiness() {
  const rows = await db.socialProviderSettings.findMany({ select: { provider: true, enabled: true, encrypted: true } })
  return socialProviders.map(provider => {
    const row = rows.find(item => item.provider === provider)
    try {
      const callback = callbackUrl(provider)
      if (provider === 'apple' && !callback.startsWith('https://')) return { provider, ready: false, status: 'Configure uma URL pública HTTPS para o retorno da Apple.' }
      if (!row) return { provider, ready: false, status: 'Credenciais não cadastradas.' }
      if (!row.enabled) return { provider, ready: false, status: 'Cadastrado e desativado.' }
      const config = JSON.parse(unseal(row.encrypted, 'social:' + provider)) as ProviderCredentials
      if (!config.clientId || !config.secret || (provider === 'apple' && !(config.teamId && config.keyId))) {
        return { provider, ready: false, status: 'Credenciais incompletas.' }
      }
      return { provider, ready: true, status: 'Habilitado. Valide o retorno em uma conta de teste do provedor.' }
    } catch {
      return { provider, ready: false, status: 'Não foi possível verificar a URL ou ler as credenciais protegidas.' }
    }
  })
}

export async function enabledSocialProviders() {
  return (await socialProviderReadiness()).filter(row => row.ready).map(row => row.provider)
}

export async function beginSocial(provider: SocialProvider, link?: LinkSession, consumerSlug?: string) {
  const row = await db.socialProviderSettings.findUnique({ where: { provider } })
  if (!row?.enabled) return null
  const config = JSON.parse(unseal(row.encrypted, 'social:' + provider)) as ProviderCredentials
  const state = randomToken()
  const browser = randomToken()
  const attempt: Attempt = { nonce: randomToken(), verifier: provider === 'google' ? randomToken() : '', revision: row.revision, link, consumerSlug }
  const url = authorizationUrl(provider, config.clientId, state, attempt.nonce, attempt.verifier)
  const secure = process.env.APP_URL?.startsWith('https://') ?? false
  if (provider === 'apple' && !secure) return null
  const expiresAt = new Date(Date.now() + life)
  await db.$transaction([
    db.socialAttempt.deleteMany({ where: { expiresAt: { lte: new Date() } } }),
    db.socialAttempt.create({ data: {
      stateHash: tokenDigest(state), browserHash: tokenDigest(browser), provider,
      encrypted: seal(JSON.stringify(attempt), 'social-attempt:' + state), expiresAt
    } })
  ])
  ;(await cookies()).set('agenda_oauth_' + provider, browser, {
    path: '/api/auth/' + provider, httpOnly: true, secure, sameSite: provider === 'apple' ? 'none' : 'lax', expires: expiresAt
  })
  return url
}

export async function consumeSocialAttempt(provider: SocialProvider, state: string, browser: string) {
  if (!/^[\w-]{43}$/.test(state) || !/^[\w-]{43}$/.test(browser)) return null
  const where = { stateHash: tokenDigest(state), browserHash: tokenDigest(browser), provider, expiresAt: { gt: new Date() } }
  const found = await db.socialAttempt.findFirst({ where })
  if (!found || !(await db.socialAttempt.deleteMany({ where })).count) return null
  return JSON.parse(unseal(found.encrypted, 'social-attempt:' + state)) as Attempt
}

export async function resolveSocialIdentity(provider: SocialProvider, claims: SocialClaims, link?: LinkSession, revision?: string) {
  const email = signupEmail.safeParse(claims.email).data
  try {
    return await db.$transaction(async tx => {
      if (revision) {
        const [settings] = await tx.$queryRaw<{ enabled: boolean; revision: string }[]>`
          SELECT enabled, revision FROM "SocialProviderSettings" WHERE provider = ${provider} FOR SHARE`
        if (!settings?.enabled || settings.revision !== revision) return null
      }
      const identity = await tx.socialIdentity.findUnique({
        where: { provider_subject: { provider, subject: claims.subject } },
        include: { user: { select: { id: true, platformAdmin: true } } }
      })
      if (!link && identity) return identity.user.platformAdmin ? null : { kind: 'login' as const, userId: identity.userId }
      if (link) {
        const [account] = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM "User" WHERE id = ${link.userId} AND NOT "platformAdmin" FOR UPDATE`
        const [session] = await tx.$queryRaw<{ userId: string }[]>`
          SELECT "userId" FROM "Session" WHERE "tokenHash" = ${link.tokenHash}
            AND "userId" = ${link.userId} AND "expiresAt" > CURRENT_TIMESTAMP FOR SHARE`
        if (!account || !session || (identity && identity.userId !== account.id)) return null
      }
      const owner = email ? await tx.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } }) : null
      if (link) {
        if ((owner && owner.id !== link.userId) || !email) return null
        if (!identity) await tx.socialIdentity.create({ data: { provider, subject: claims.subject, userId: link.userId } })
        return { kind: 'link' as const }
      }
      if (!email || owner) return null
      return { kind: 'register' as const, email, emailVerified: claims.emailVerified }
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null
    throw error
  }
}

export async function finishSocial(provider: SocialProvider, state: string, code: string) {
  const jar = await cookies()
  const browser = jar.get('agenda_oauth_' + provider)?.value
  if (!browser || !code || code.length > 4096) return null
  const attempt = await consumeSocialAttempt(provider, state, browser)
  if (!attempt) return null
  const row = await db.socialProviderSettings.findUnique({ where: { provider } })
  if (!row?.enabled || row.revision !== attempt.revision) return null
  const claims = await exchangeSocialCode(provider, JSON.parse(unseal(row.encrypted, 'social:' + provider)), code, attempt.verifier, attempt.nonce)
  const result = await resolveSocialIdentity(provider, claims, attempt.link, row.revision)
  if (result?.kind !== 'register') return result ? { ...result, consumerSlug: attempt.consumerSlug } : null
  const signup: SocialSignup = { provider, subject: claims.subject, revision: row.revision, email: result.email,
    emailVerified: result.emailVerified, consumerSlug: attempt.consumerSlug, expires: Date.now() + life }
  jar.set(signupCookie, seal(JSON.stringify(signup), signupCookie), {
    path: '/', httpOnly: true, secure: process.env.APP_URL?.startsWith('https://') ?? false, sameSite: 'lax', expires: new Date(signup.expires)
  })
  return { kind: 'signup' as const, consumerSlug: attempt.consumerSlug }
}

export async function pendingSocialSignup() {
  const value = (await cookies()).get(signupCookie)?.value
  if (!value) return null
  try {
    const signup = JSON.parse(unseal(value, signupCookie)) as SocialSignup
    return signup.expires > Date.now() ? signup : null
  } catch { return null }
}

export async function clearSocialSignup() {
  ;(await cookies()).delete(signupCookie)
}
