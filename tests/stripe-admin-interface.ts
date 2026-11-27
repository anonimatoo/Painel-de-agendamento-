import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Secret, TOTP } from 'otpauth'
import { chromium } from 'playwright-core'
import { db } from '../lib/db'
import { hashPassword } from '../lib/auth'
import { seal, unseal } from '../lib/secrets'

const origin = new URL(process.env.APP_URL ?? 'http://127.0.0.1:3130')
const valid = {
  publishableKey: 'pk_test_fixturePublic', secret: 'sk_test_fixtureSecret',
  billingWebhook: 'whsec_fixtureBilling', connectWebhook: 'whsec_fixtureConnect'
}
const rejected = 'sk_test_fixtureRejected'
const unavailable = 'sk_test_fixtureUnavailable'
const platform = 'acct_fixtureBR'
const password = 'Senha-exclusiva-de-teste!'
const email = 'stripe-admin-' + randomUUID() + '@example.test'
const totp = new TOTP({ secret: new Secret({ size: 20 }) })
const dbUrl = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid')

async function main() {
  assert.equal(origin.hostname, '127.0.0.1')
  assert.ok(['127.0.0.1', 'localhost'].includes(dbUrl.hostname) && dbUrl.pathname === '/cs_stripe_admin_test', 'Use o banco local dedicado cs_stripe_admin_test.')
  assert.equal(await db.stripeSettings.count(), 0)
  assert.equal(await db.plan.count(), 0)
  assert.equal(await db.tenant.count(), 0)
  assert.equal(await db.stripeMovement.count(), 0)

  const scratch = await mkdtemp(join(tmpdir(), 'agenda-stripe-test-'))
  let calls = 0
  const simulation = createServer((request, response) => {
    calls++
    response.setHeader('Content-Type', 'application/json')
    const key = request.headers.authorization
    setTimeout(() => {
      if (request.url !== '/v1/account' || request.method !== 'GET') {
        response.writeHead(400).end(JSON.stringify({ error: { type: 'invalid_request_error' } }))
      } else if (key === 'Bearer ' + rejected) {
        response.writeHead(401).end(JSON.stringify({ error: { type: 'invalid_request_error', message: rejected } }))
      } else if (key === 'Bearer ' + unavailable) {
        response.writeHead(503).end(JSON.stringify({ error: { type: 'api_error', message: unavailable } }))
      } else if (key === 'Bearer ' + valid.secret) {
        response.end(JSON.stringify({ id: platform, object: 'account', country: 'BR', charges_enabled: true, payouts_enabled: true }))
      } else {
        response.writeHead(401).end(JSON.stringify({ error: { type: 'invalid_request_error' } }))
      }
    }, 350)
  })
  await new Promise<void>(resolve => simulation.listen(0, '127.0.0.1', resolve))
  const preload = join(scratch, 'transport.cjs')
  // Altera só o processo Next de teste. Toda chamada à Stripe fica no provedor loopback.
  await writeFile(preload, `
const https = require('node:https')
const http = require('node:http')
const original = https.request
https.request = function(options, callback) {
  if (options.hostname !== 'api.stripe.com' && options.host !== 'api.stripe.com') return original.apply(this, arguments)
  const request = http.request({ ...options, protocol: 'http:', host: '127.0.0.1', hostname: '127.0.0.1',
    port: ${(simulation.address() as AddressInfo).port}, agent: false }, callback)
  request.prependOnceListener('socket', socket => {
    socket.once('connect', () => socket.emit('secureConnect'))
  })
  return request
}
`)
  const env = { ...process.env, STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '', STRIPE_CONNECT_WEBHOOK_SECRET: '' }
  const server = spawn(process.execPath, ['--require', preload, 'node_modules/next/dist/bin/next', 'start', '--hostname', origin.hostname, '--port', origin.port], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let serverLog = ''
  server.stdout.on('data', chunk => { serverLog += chunk })
  server.stderr.on('data', chunk => { serverLog += chunk })
  const stopped = new Promise(resolve => server.once('exit', resolve))
  const actor = await db.user.create({ data: { email, platformAdmin: true, password: await hashPassword(password) } })
  await db.user.update({ where: { id: actor.id }, data: { mfaSecret: seal(totp.secret.base32, 'mfa:' + actor.id) } })
  let browser
  let tenantId: string | undefined
  try {
    for (let attempt = 0; ; attempt++) {
      if (await fetch(new URL('/login', origin)).then(response => response.ok, () => false)) break
      if (attempt === 60 || server.exitCode !== null) throw new Error('Servidor de teste indisponível')
      await new Promise(resolve => setTimeout(resolve, 200))
    }
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true })
    const page = await browser.newPage()
    await page.goto(new URL('/login', origin).href)
    await page.getByLabel('E-mail', { exact: true }).fill(email)
    await page.getByLabel('Senha', { exact: true }).fill(password)
    await page.getByText('Acesso de Super Admin').click()
    await page.getByLabel('Código do autenticador ou de recuperação').fill(totp.generate())
    await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    await page.waitForURL('**/super-admin')
    const responses: string[] = []
    await page.route('**/super-admin', async route => {
      if (route.request().method() !== 'POST') return route.continue()
      const response = await route.fetch()
      responses.push(await response.text())
      await route.fulfill({ response })
    })
    await page.getByText('Configurar credenciais', { exact: true }).click()
    const form = page.locator('.stripe-settings-form')
    const field = (name: string) => form.locator('[name="' + name + '"]')
    const submit = () => form.getByRole('button', { name: 'Salvar configuração' }).click()

    await submit()
    await form.getByText('Informe sua senha.', { exact: true }).waitFor()
    assert.equal(await form.getByText('Preencha este campo.', { exact: true }).count(), 4)
    assert.equal(calls, 0)
    const fill = async (values: Record<string, string>) => {
      for (const [name, value] of Object.entries(values)) await field(name).fill(value)
      await field('password').fill(password)
    }
    await fill({ ...valid, connectWebhook: '' })
    await submit()
    await form.locator('#stripe-connectWebhook-error').getByText('Preencha este campo.').waitFor()
    assert.equal(calls, 0)
    await fill({ ...valid, secret: 'pk_test_erro' })
    await submit()
    await form.getByText('Informe uma chave secreta Stripe válida.').waitFor()
    assert.equal(calls, 0)
    await fill({ ...valid, secret: rejected })
    await form.getByRole('button', { name: 'Visualizar chave secreta' }).click()
    assert.equal(await field('secret').getAttribute('type'), 'text')
    await form.getByRole('button', { name: 'Ocultar chave secreta' }).click()
    assert.equal(await field('secret').getAttribute('type'), 'password')
    await submit()
    await form.getByText('Conectando à Stripe e verificando a gravação…').waitFor()
    await form.getByText(/A Stripe recusou a chave secreta/).waitFor()
    assert.equal(await db.stripeSettings.count(), 0)
    await fill({ ...valid, secret: unavailable })
    await submit()
    await form.getByText(/Não foi possível comunicar com a Stripe/).waitFor()
    assert.equal(await db.stripeSettings.count(), 0)

    const linked = await db.tenant.create({ data: { name: 'Stripe fixture', slug: randomUUID(), stripeCustomerId: 'cus_fixture' } })
    tenantId = linked.id
    await fill(valid)
    await submit()
    await form.getByText(/Configuração inicial bloqueada/).waitFor()
    assert.equal(await db.stripeSettings.count(), 0)
    await db.tenant.delete({ where: { id: tenantId } })
    tenantId = undefined

    await db.$executeRawUnsafe('ALTER TABLE "AdminAudit" ADD CONSTRAINT "stripe_test_denial" CHECK (action <> \'STRIPE_CONFIG_UPDATED\')')
    try {
      await fill(valid)
      await submit()
      await form.getByText(/Não foi possível salvar a configuração da Stripe no banco/).waitFor()
      assert.equal(await db.stripeSettings.count(), 0)
    } finally {
      await db.$executeRawUnsafe('ALTER TABLE "AdminAudit" DROP CONSTRAINT "stripe_test_denial"')
    }

    await fill(Object.fromEntries(Object.entries(valid).map(([key, value]) => [key, '  ' + value + '  '])))
    await submit()
    await form.getByText('Conexão confirmada. Credenciais criptografadas e salvas.').waitFor()
    await page.getByText('Ambiente configurado · Teste').waitFor()
    assert.equal(await field('secret').inputValue(), '')
    const row = await db.stripeSettings.findUniqueOrThrow({ where: { id: 1 } })
    assert.ok(row.paymentsEnabled && row.payoutsEnabled)
    assert.equal(row.publishableKey, valid.publishableKey)
    const { publishableKey: _publishableKey, ...encryptedFields } = valid
    assert.deepEqual(JSON.parse(unseal(row.encrypted, 'stripe:' + platform + ':test')), encryptedFields)
    assert.equal(await db.adminAudit.count({ where: { actorId: actor.id, action: 'STRIPE_CONFIG_UPDATED' } }), 1)
    assert.equal(responses.length, 8)
    for (const body of [...responses, serverLog]) {
      for (const secret of [...Object.values(encryptedFields), rejected, unavailable]) assert.ok(!body.includes(secret))
    }
    console.log('Admin Stripe aprovado: campos, máscara, carregamento, falhas, bloqueio financeiro, rollback e persistência criptografada.')
  } finally {
    await browser?.close()
    if (server.exitCode === null) server.kill()
    await stopped
    await new Promise<void>(resolve => simulation.close(() => resolve()))
    await rm(scratch, { recursive: true, force: true })
    if (tenantId) await db.tenant.deleteMany({ where: { id: tenantId } })
    await db.stripeSettings.deleteMany({ where: { accountId: platform } })
    await db.adminAudit.deleteMany({ where: { actorId: actor.id } })
    await db.user.deleteMany({ where: { id: actor.id } })
    await db.$disconnect()
  }
}

main().catch(error => {
  // Somente a etapa e a pilha, sem resposta HTTP nem dados de preenchimento.
  console.error(error instanceof Error ? error.stack?.split('\n').filter(line => /^\s+at /.test(line)).join('\n') : 'Falha no teste de interface')
  process.exitCode = 1
})
