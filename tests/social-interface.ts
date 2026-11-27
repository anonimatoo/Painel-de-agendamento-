import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportJWK, exportPKCS8, generateKeyPair, jwtVerify, SignJWT } from 'jose'
import { Secret, TOTP } from 'otpauth'
import { chromium } from 'playwright-core'
import { db } from '../lib/db'
import { hashPassword } from '../lib/auth'
import { seal } from '../lib/secrets'
import { randomToken, tokenDigest } from '../lib/social-oidc'

const base = new URL(process.env.APP_URL ?? 'http://127.0.0.1:3133')
const google = 'fixture.apps.googleusercontent.com'
const apple = 'com.example.fixture'
const suffix = randomUUID()
const email = 'social-' + suffix + '@gmail.com'
const appleEmail = 'apple-' + suffix + '@privaterelay.appleid.com'
const googleSecret = 'google-secret-fixture'
const adminEmail = 'admin-' + suffix + '@example.test'
const adminPassword = 'Senha-exclusiva-para-teste!'
const grants = new Map<string, { nonce: string; challenge?: string; email: string; subject: string }>()
const tenantIds: string[] = []

async function main() {
  const datasource = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid')
  assert.equal(base.hostname, '127.0.0.1')
  assert.ok(['127.0.0.1', 'localhost'].includes(datasource.hostname) && datasource.pathname === '/cs_social_test', 'Use o banco local dedicado cs_social_test.')
  assert.equal(await db.socialProviderSettings.count(), 0)
  const signing = await generateKeyPair('RS256')
  const appleClient = await generateKeyPair('ES256', { extractable: true })
  const jwk = { ...await exportJWK(signing.publicKey), kid: 'fixture', alg: 'RS256' }
  let exchanges = 0
  let verifiedAppleClient = false
  const simulation = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/keys') {
      response.end(JSON.stringify({ keys: [jwk] }))
      return
    }
    try {
      const data: Buffer[] = []
      for await (const chunk of request) data.push(chunk)
      const form = new URLSearchParams(Buffer.concat(data).toString())
      const code = form.get('code') ?? ''
      const grant = grants.get(code)
      grants.delete(code)
      if (!grant) throw new Error('Unknown grant')
      const isApple = request.url === '/apple'
      const clientId = isApple ? apple : google
      assert.equal(form.get('client_id'), clientId)
      assert.equal(form.get('redirect_uri'), new URL('/api/auth/' + (isApple ? 'apple' : 'google') + '/callback', base).href)
      if (isApple) {
        assert.equal(form.has('code_verifier'), false)
        const assertion = await jwtVerify(form.get('client_secret')!, appleClient.publicKey, {
          issuer: 'TEAM123456', audience: 'https://appleid.apple.com', subject: apple
        })
        assert.equal(assertion.protectedHeader.kid, 'KEY1234567')
        verifiedAppleClient = true
      } else {
        assert.equal(form.get('client_secret'), googleSecret)
        assert.equal(tokenDigest(form.get('code_verifier') ?? ''), grant.challenge)
      }
      exchanges++
      const token = await new SignJWT({ nonce: grant.nonce, email: grant.email, email_verified: isApple ? 'true' : true })
        .setProtectedHeader({ alg: 'RS256', kid: 'fixture' }).setIssuedAt().setExpirationTime('5m')
        .setSubject(grant.subject).setAudience(clientId).setIssuer(isApple ? 'https://appleid.apple.com' : 'https://accounts.google.com')
        .sign(signing.privateKey)
      response.end(JSON.stringify({ id_token: token }))
    } catch {
      response.writeHead(400).end(JSON.stringify({ error: 'invalid_grant' }))
    }
  })
  const scratch = await mkdtemp(join(tmpdir(), 'agenda-social-'))
  await new Promise<void>(resolve => simulation.listen(0, '127.0.0.1', resolve))
  const port = (simulation.address() as AddressInfo).port
  const preload = join(scratch, 'mock.cjs')
  await writeFile(preload, `
const original = globalThis.fetch
const routes = {
  'https://oauth2.googleapis.com/token': '/google',
  'https://appleid.apple.com/auth/token': '/apple',
  'https://www.googleapis.com/oauth2/v3/certs': '/keys',
  'https://appleid.apple.com/auth/keys': '/keys'
}
globalThis.fetch = (input, options) => {
  const route = routes[input instanceof Request ? input.url : String(input)]
  return original(route ? 'http://127.0.0.1:${port}' + route : input, options)
}
`)
  const child = spawn(process.execPath, ['--require', preload, 'node_modules/next/dist/bin/next', 'start',
    '--hostname', base.hostname, '--port', base.port], { env: process.env, stdio: 'ignore' })
  const stopped = new Promise(resolve => child.once('exit', resolve))
  let browser
  try {
    await db.socialProviderSettings.create({ data: {
      provider: 'apple', revision: suffix, enabled: true, encrypted: seal(JSON.stringify({
        clientId: apple, secret: await exportPKCS8(appleClient.privateKey), teamId: 'TEAM123456', keyId: 'KEY1234567'
      }), 'social:apple')
    } })
    const totp = new TOTP({ secret: new Secret({ size: 20 }) })
    const admin = await db.user.create({ data: { email: adminEmail, password: await hashPassword(adminPassword), platformAdmin: true } })
    await db.user.update({ where: { id: admin.id }, data: { mfaSecret: seal(totp.secret.base32, 'mfa:' + admin.id) } })
    for (let attempt = 0; ; attempt++) {
      if (await fetch(new URL('/login', base)).then(response => response.ok, () => false)) break
      if (attempt === 60 || child.exitCode !== null) throw new Error('Servidor de teste indisponível')
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true })
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    await page.goto(new URL('/login', base).href)
    assert.equal(await page.getByRole('button', { name: 'Continuar com Google' }).count(), 0)
    await page.getByLabel('E-mail', { exact: true }).fill(adminEmail)
    await page.getByLabel('Senha', { exact: true }).fill(adminPassword)
    await page.getByText('Acesso de Super Admin').click()
    await page.getByLabel('Código do autenticador ou de recuperação').fill(totp.generate())
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await page.waitForURL('**/super-admin')
    const settings = page.locator('.provider-settings').filter({ has: page.getByRole('heading', { name: 'Google', exact: true }) })
    assert.equal(await settings.getByLabel('URL de callback').inputValue(), new URL('/api/auth/google/callback', base).href)
    await settings.getByText('Inserir credenciais').click()
    await settings.getByLabel('Client ID').fill(google)
    await settings.getByLabel('Client Secret').fill(googleSecret)
    await settings.getByLabel('Sua senha').fill(adminPassword)
    await settings.getByRole('button', { name: 'Salvar credenciais' }).click()
    await settings.getByText(/Credenciais criptografadas e salvas/).waitFor()
    const saved = await db.socialProviderSettings.findUniqueOrThrow({ where: { provider: 'google' } })
    assert.equal(saved.enabled, false)
    assert.ok(!saved.encrypted.includes(googleSecret))
    assert.equal(await settings.getByLabel('Client Secret').inputValue(), '')
    await settings.getByLabel('Sua senha').fill(adminPassword)
    await settings.getByRole('button', { name: 'Testar configuração' }).click()
    await settings.getByText(/Teste preliminar aceito/).waitFor()
    await settings.getByLabel('Sua senha').fill(adminPassword)
    await settings.getByRole('button', { name: 'Ativar', exact: true }).click()
    await settings.getByText('Provedor ativado.').waitFor()
    await context.clearCookies()

    let badState = true
    let callback: URL | undefined
    await context.route('https://accounts.google.com/o/oauth2/v2/auth?**', async route => {
      const auth = new URL(route.request().url())
      const code = randomToken()
      const nonce = auth.searchParams.get('nonce')!
      const challenge = auth.searchParams.get('code_challenge')!
      assert.equal(auth.searchParams.get('code_challenge_method'), 'S256')
      grants.set(code, { nonce, challenge, email, subject: suffix })
      callback = new URL('/api/auth/google/callback', base)
      callback.searchParams.set('state', badState ? randomToken() : auth.searchParams.get('state')!)
      callback.searchParams.set('code', code)
      await route.fulfill({ status: 303, headers: { Location: callback.href } })
    })
    await page.goto(new URL('/cadastro', base).href)
    assert.equal(await page.getByLabel(/Endereço da página/).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Continuar com Apple' }).count(), 1)
    await page.getByLabel('Nome do estabelecimento').fill('Nome preservado')
    await page.getByLabel('E-mail', { exact: true }).fill('inválido')
    await page.getByLabel('Senha', { exact: true }).fill('curta')
    await page.getByRole('button', { name: 'Mostrar senha' }).click()
    assert.equal(await page.getByLabel('Senha', { exact: true }).getAttribute('type'), 'text')
    await page.getByRole('button', { name: 'Criar conta' }).click()
    await page.getByText('Informe um e-mail válido.').waitFor()
    assert.equal(await page.getByLabel('Nome do estabelecimento').inputValue(), 'Nome preservado')
    assert.equal(await page.getByLabel('E-mail', { exact: true }).inputValue(), 'inválido')

    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      for (const path of ['/login', '/cadastro']) {
        await page.goto(new URL(path, base).href)
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
        assert.equal(await page.getByRole('button', { name: 'Continuar com Google' }).count(), 1)
      }
    }
    await page.getByRole('button', { name: 'Continuar com Google' }).click()
    await page.waitForURL('**/login?social=erro')
    assert.equal(exchanges, 0)
    badState = false
    await page.getByRole('button', { name: 'Continuar com Google' }).click()
    await page.waitForURL('**/cadastro/social')
    assert.equal(await page.locator('input[type=password]').count(), 0)
    await page.getByLabel('Nome do estabelecimento').fill('Estúdio Çafé ' + suffix)
    await page.getByRole('button', { name: 'Concluir cadastro' }).click()
    await page.waitForURL('**/primeiro-acesso?novo=1')
    await page.getByText(/Seu endereço público é/).waitFor()
    const socialUser = await db.user.findUniqueOrThrow({ where: { email }, include: { memberships: true, socialIdentities: true } })
    tenantIds.push(socialUser.memberships[0].tenantId)
    assert.equal(socialUser.password, null)
    assert.equal(socialUser.platformAdmin, false)
    assert.equal(socialUser.socialIdentities.length, 1)
    assert.equal(exchanges, 1)
    assert.equal((await context.request.get(callback!.href, { maxRedirects: 0 })).headers().location, new URL('/login?social=erro', base).href)
    await context.clearCookies()
    await page.goto(new URL('/login', base).href)
    await page.getByRole('button', { name: 'Continuar com Google' }).click()
    await page.waitForURL('**/dashboard')
    assert.equal(exchanges, 2)

    const state = randomToken()
    const browserToken = randomToken()
    const nonce = randomToken()
    const code = randomToken()
    grants.set(code, { nonce, email: appleEmail, subject: suffix })
    await db.socialAttempt.create({ data: {
      stateHash: tokenDigest(state), provider: 'apple', browserHash: tokenDigest(browserToken), expiresAt: new Date(Date.now() + 60_000),
      encrypted: seal(JSON.stringify({ nonce, verifier: '', revision: suffix }), 'social-attempt:' + state)
    } })
    const appleUrl = new URL('/api/auth/apple/callback', base)
    const headers = { Cookie: 'agenda_oauth_apple=' + browserToken }
    const refused = await fetch(appleUrl, { headers, redirect: 'manual' })
    assert.equal(refused.headers.get('location'), new URL('/login?social=erro', base).href)
    const accepted = await fetch(appleUrl, { method: 'POST', headers, body: new URLSearchParams({ state, code }), redirect: 'manual' })
    assert.equal(accepted.headers.get('location'), new URL('/cadastro/social', base).href)
    assert.ok(accepted.headers.get('set-cookie')?.includes('agenda_social_signup='))
    assert.equal(verifiedAppleClient, true)
    assert.equal(exchanges, 3)

    await db.socialProviderSettings.updateMany({ data: { enabled: false } })
    await page.goto(new URL('/login', base).href)
    assert.equal(await page.getByRole('button', { name: /Continuar com (Google|Apple)/ }).count(), 0)
    console.log('Chromium 390/1280 px: configuração Super Admin, formulário, cadastro e login Google simulados, estado inválido, reuso e provedores desativados. Callback Apple POST e JWT verificados em HTTP simulado.')
  } finally {
    await browser?.close()
    if (child.exitCode === null) child.kill()
    await stopped
    await new Promise<void>(resolve => simulation.close(() => resolve()))
    await rm(scratch, { recursive: true, force: true })
    await db.user.deleteMany({ where: { email: { in: [email, appleEmail, adminEmail] } } })
    await db.tenant.deleteMany({ where: { id: { in: tenantIds } } })
    await db.socialAttempt.deleteMany({})
    await db.socialProviderSettings.deleteMany({ where: { provider: { in: ['google', 'apple'] } } })
    await db.$disconnect()
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack?.split('\n').filter(line => /^\s+at /.test(line)).join('\n') : 'Falha no teste de autenticação social')
  process.exitCode = 1
})
