import { createHash, randomBytes } from 'node:crypto'
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT, type JWTVerifyGetKey } from 'jose'

export const socialProviders = ['google', 'apple'] as const
export type SocialProvider = typeof socialProviders[number]
export type ProviderCredentials = { clientId: string; secret: string; teamId?: string; keyId?: string }
export type SocialClaims = { subject: string; email?: string; emailVerified: boolean }

const endpoints = {
  google: {
    authorization: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token',
    jwks: 'https://www.googleapis.com/oauth2/v3/certs', issuer: ['https://accounts.google.com', 'accounts.google.com']
  },
  apple: {
    authorization: 'https://appleid.apple.com/auth/authorize', token: 'https://appleid.apple.com/auth/token',
    jwks: 'https://appleid.apple.com/auth/keys', issuer: 'https://appleid.apple.com'
  }
}
const keys = {
  google: createRemoteJWKSet(new URL(endpoints.google.jwks), { timeoutDuration: 5000 }),
  apple: createRemoteJWKSet(new URL(endpoints.apple.jwks), { timeoutDuration: 5000 })
}

export function isSocialProvider(value: string): value is SocialProvider {
  return value === 'google' || value === 'apple'
}

export function socialOrigin() {
  const url = new URL(process.env.APP_URL ?? 'http://localhost:3000')
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Origem de autenticação inválida')
  }
  return url.origin
}

export function callbackUrl(provider: SocialProvider) {
  return new URL('/api/auth/' + provider + '/callback', socialOrigin()).href
}

export function randomToken() {
  return randomBytes(32).toString('base64url')
}

export function tokenDigest(token: string) {
  return createHash('sha256').update(token).digest('base64url')
}

export function authorizationUrl(provider: SocialProvider, clientId: string, state: string, nonce: string, verifier: string) {
  const url = new URL(endpoints[provider].authorization)
  url.search = new URLSearchParams({
    client_id: clientId, redirect_uri: callbackUrl(provider), response_type: 'code', state, nonce,
    scope: provider === 'google' ? 'openid email' : 'email',
    ...(provider === 'google' ? { code_challenge: tokenDigest(verifier), code_challenge_method: 'S256', prompt: 'select_account' }
      : { response_mode: 'form_post' })
  }).toString()
  return url.href
}

async function clientSecret(provider: SocialProvider, input: ProviderCredentials) {
  if (provider === 'google') return input.secret
  const key = await importPKCS8(input.secret, 'ES256')
  return new SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: input.keyId })
    .setIssuer(input.teamId!).setSubject(input.clientId).setAudience('https://appleid.apple.com')
    .setIssuedAt().setExpirationTime('5m').sign(key)
}

async function requestToken(provider: SocialProvider, input: ProviderCredentials, code: string, verifier: string) {
  return fetch(endpoints[provider].token, {
    method: 'POST', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(7000),
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, client_id: input.clientId,
      client_secret: await clientSecret(provider, input), redirect_uri: callbackUrl(provider),
      ...(provider === 'google' ? { code_verifier: verifier } : {})
    })
  })
}

export async function verifyIdentityToken(provider: SocialProvider, token: string, clientId: string, nonce: string, key: JWTVerifyGetKey = keys[provider]): Promise<SocialClaims> {
  const { payload } = await jwtVerify(token, key, {
    issuer: endpoints[provider].issuer, audience: clientId, algorithms: ['RS256'],
    requiredClaims: ['sub', 'exp', 'iat', 'nonce'], maxTokenAge: '10m', clockTolerance: 5
  })
  if (payload.nonce !== nonce || !payload.sub || payload.sub.length > 255 ||
      (payload.azp !== undefined && payload.azp !== clientId) ||
      (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)) {
    throw new Error('Identidade inválida')
  }
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : undefined
  // Google is authoritative for Gmail and managed Workspace domains, not arbitrary e-mail providers.
  const authoritative = provider === 'apple' || email?.endsWith('@gmail.com') || typeof payload.hd === 'string' && !!payload.hd
  const verified = payload.email_verified === true || (provider === 'apple' && payload.email_verified === 'true')
  return { subject: payload.sub, email: verified ? email : undefined, emailVerified: Boolean(email && authoritative && verified) }
}

export async function exchangeSocialCode(provider: SocialProvider, input: ProviderCredentials, code: string, verifier: string, nonce: string) {
  const result = await requestToken(provider, input, code, verifier)
  if (!result.ok) throw new Error('Autorização recusada')
  const { id_token } = await result.json()
  if (typeof id_token !== 'string' || id_token.length > 16_384) throw new Error('Identidade inválida')
  return verifyIdentityToken(provider, id_token, input.clientId, nonce)
}

export async function checkSocialProvider(provider: SocialProvider, input: ProviderCredentials) {
  const result = await requestToken(provider, input, randomToken(), randomToken())
  if (result.status !== 400) return false
  const body: { error?: string } = await result.json()
  return body.error === 'invalid_grant'
}
