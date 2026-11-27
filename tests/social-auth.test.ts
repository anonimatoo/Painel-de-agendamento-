import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, test } from 'node:test'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { db } from '../lib/db'
import { publicSlug } from '../lib/public-identity'
import { registerBusiness } from '../lib/registration'
import { consumeSocialAttempt, resolveSocialIdentity } from '../lib/social-auth'
import { authorizationUrl, randomToken, tokenDigest, verifyIdentityToken } from '../lib/social-oidc'
import { seal } from '../lib/secrets'
import { verifyPassword } from '../lib/auth'

after(() => db.$disconnect())

test('OIDC valida assinatura, emissor, audiência, expiração e nonce; Google envia PKCE', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const key = createLocalJWKSet({ keys: [await exportJWK(publicKey)] })
  const other = createLocalJWKSet({ keys: [await exportJWK((await generateKeyPair('RS256')).publicKey)] })
  const nonce = randomToken()
  const issue = (issuer: string, audience = 'fixture-client', expires = '5m', claim = nonce, apple = false) =>
    new SignJWT({ nonce: claim, email: 'OWNER@gmail.com', email_verified: apple ? 'true' : true })
      .setProtectedHeader({ alg: 'RS256' }).setSubject('123').setIssuedAt().setExpirationTime(expires)
      .setIssuer(issuer).setAudience(audience).sign(privateKey)

  const token = await issue('https://accounts.google.com')
  assert.deepEqual(await verifyIdentityToken('google', token, 'fixture-client', nonce, key), {
    subject: '123', email: 'owner@gmail.com', emailVerified: true
  })
  assert.equal((await verifyIdentityToken('apple', await issue('https://appleid.apple.com', undefined, undefined, nonce, true),
    'fixture-client', nonce, key)).emailVerified, true)
  for (const invalid of [
    issue('https://invalid.example'), issue('https://accounts.google.com', 'another-client'),
    issue('https://accounts.google.com', undefined, '1m ago'), issue('https://accounts.google.com', undefined, undefined, randomToken())
  ]) await assert.rejects(async () => verifyIdentityToken('google', await invalid, 'fixture-client', nonce, key))
  await assert.rejects(verifyIdentityToken('google', token, 'fixture-client', nonce, other))

  const verifier = randomToken()
  const google = new URL(authorizationUrl('google', 'fixture-client', 'state', nonce, verifier))
  assert.equal(google.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(google.searchParams.get('code_challenge'), tokenDigest(verifier))
  assert.equal(google.searchParams.get('nonce'), nonce)
  const apple = new URL(authorizationUrl('apple', 'fixture-client', 'state', nonce, verifier))
  assert.equal(apple.searchParams.get('response_mode'), 'form_post')
  assert.equal(apple.searchParams.has('code_challenge'), false)
})

test('state de callback exige navegador, provedor e validade e é consumido uma única vez', async () => {
  process.env.CREDENTIAL_ENCRYPTION_KEY ??= 'a'.repeat(64)
  const state = randomToken()
  const expired = randomToken()
  const browser = randomToken()
  const payload = { nonce: randomToken(), verifier: randomToken(), revision: 'fixture' }
  await db.socialAttempt.createMany({ data: [state, expired].map((item, index) => ({
    stateHash: tokenDigest(item), browserHash: tokenDigest(browser), provider: 'google',
    encrypted: seal(JSON.stringify(payload), 'social-attempt:' + item), expiresAt: new Date(Date.now() + (index ? -2_000 : 60_000))
  })) })
  try {
    assert.equal(await consumeSocialAttempt('google', state, randomToken()), null)
    assert.equal(await consumeSocialAttempt('apple', state, browser), null)
    assert.equal(await consumeSocialAttempt('google', expired, browser), null)
    const concurrent = await Promise.all([consumeSocialAttempt('google', state, browser), consumeSocialAttempt('google', state, browser)])
    assert.deepEqual(concurrent.filter(Boolean), [payload])
  } finally {
    await db.socialAttempt.deleteMany({ where: { stateHash: { in: [tokenDigest(state), tokenDigest(expired)] } } })
  }
})

test('cadastros concorrentes preservam aliases e vínculo confirmado nunca eleva privilégios', async () => {
  const suffix = randomUUID()
  const emails = ['owner', 'other', 'admin', 'social'].map(part => part + suffix + '@example.test')
  const business = 'Estúdio Àgua ' + suffix
  const slug = publicSlug(business)
  assert.equal(slug, 'estudio-agua-' + suffix)
  const reserved = await db.tenant.create({ data: { name: 'Fixture', slug: 'reserva-' + suffix, aliases: { create: { slug } } } })
  const tenants = [reserved.id]
  try {
    const credentials = await Promise.all(emails.slice(0, 2).map(email => registerBusiness({ email, business, password: 'hash-fixture' })))
    tenants.push(...credentials.map(user => user.memberships[0].tenantId))
    const addresses = await db.tenant.findMany({ where: { id: { in: tenants.slice(1) } }, orderBy: { slug: 'asc' } })
    assert.deepEqual(addresses.map(tenant => tenant.slug), [slug + '-2', slug + '-3'])
    assert.ok(await db.tenantAlias.findUnique({ where: { slug } }))
    await assert.rejects(registerBusiness({ email: emails[0], business, password: 'hash-fixture' }), /Já existe uma conta/)

    const [owner, other] = credentials
    const admin = await db.user.create({ data: { email: emails[2], password: 'hash-fixture', platformAdmin: true } })
    const session = await db.session.create({ data: { tokenHash: randomUUID(), userId: owner.id, expiresAt: new Date(Date.now() + 60_000) } })
    const otherSession = await db.session.create({ data: { tokenHash: randomUUID(), userId: other.id, expiresAt: new Date(Date.now() + 60_000) } })
    const adminSession = await db.session.create({ data: { tokenHash: randomUUID(), userId: admin.id, expiresAt: new Date(Date.now() + 60_000), mfaVerified: true } })
    const claims = { subject: suffix, email: owner.email, emailVerified: true }
    assert.equal(await resolveSocialIdentity('google', claims), null)
    assert.equal(await resolveSocialIdentity('google', claims, { userId: other.id, tokenHash: otherSession.tokenHash }), null)
    assert.equal(await resolveSocialIdentity('google', claims, { userId: owner.id, tokenHash: otherSession.tokenHash }), null)
    assert.equal(await resolveSocialIdentity('google', { ...claims, email: admin.email }, { userId: admin.id, tokenHash: adminSession.tokenHash }), null)
    assert.deepEqual(await resolveSocialIdentity('google', claims, { userId: owner.id, tokenHash: session.tokenHash }), { kind: 'link' })
    assert.deepEqual(await resolveSocialIdentity('google', { subject: suffix, emailVerified: false }), { kind: 'login', userId: owner.id })
    await db.user.update({ where: { id: owner.id }, data: { platformAdmin: true } })
    assert.equal(await resolveSocialIdentity('google', claims), null)

    const provider = await db.socialProviderSettings.create({ data: { provider: 'apple', enabled: true, encrypted: 'fixture', revision: suffix } })
    try {
      const registration = { email: emails[3], business, emailVerified: true, identity: { provider: provider.provider, subject: suffix, revision: suffix } }
      const outcomes = await Promise.allSettled([registerBusiness(registration), registerBusiness(registration)])
      assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1)
      const social = await db.user.findUniqueOrThrow({ where: { email: emails[3] }, include: { memberships: true } })
      tenants.push(social.memberships[0].tenantId)
      assert.equal(social.password, null)
      assert.equal(social.platformAdmin, false)
      assert.equal(await verifyPassword('qualquer senha', social.password), false)
    } finally {
      await db.socialProviderSettings.delete({ where: { provider: provider.provider } })
    }
  } finally {
    await db.user.deleteMany({ where: { email: { in: emails } } })
    await db.tenant.deleteMany({ where: { id: { in: tenants } } })
  }
})
