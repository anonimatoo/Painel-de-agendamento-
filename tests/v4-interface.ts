import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium, type Page } from 'playwright-core'
import { db } from '../lib/db'
import { hashPassword } from '../lib/auth'
import { seal } from '../lib/secrets'
import sharp from 'sharp'

const origin = new URL(process.env.APP_URL ?? '')
const evidence = process.env.V4_EVIDENCE
const password = 'Somente-fixture-local-2026!'
const widths = [390, 1280]
const fixture = 'v4-e2e-' + randomUUID().slice(0, 8)

async function main() {
  assert.equal(origin.hostname, '127.0.0.1')
  assert.equal(origin.protocol, 'http:')
  assert.ok(['3295', '3298'].includes(origin.port))
  assert.equal(new URL(process.env.DATABASE_URL ?? '').pathname, '/cs_v4_browser')
  assert.equal(await db.stripeSettings.count(), 0)
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/chromium', headless: true })
  const [page, visitor, outside] = await Promise.all([browser.newPage(), browser.newPage(), browser.newPage()])
  const failures: string[] = []
  page.on('pageerror', error => failures.push(error.name))
  if (evidence) await mkdir(evidence, { recursive: true })
  const [tenant, other] = await Promise.all(['Vitrine de teste', 'Outro estabelecimento'].map(name => db.tenant.create({
    data: { slug: fixture + '-' + name.length, name, active: name.startsWith('Outro') }
  })))
  const users = await Promise.all([tenant, other].map(async shop => db.user.create({
    data: { email: shop.slug + '@example.test', password: await hashPassword(password), memberships: { create: { tenantId: shop.id, role: 'ADMIN' } } }
  })))
  const login = async (tab: Page, email: string) => {
    await tab.goto(new URL('/login', origin).href)
    await tab.getByLabel('E-mail', { exact: true }).fill(email)
    await tab.getByLabel('Senha', { exact: true }).fill(password)
    await tab.getByRole('button', { name: 'Entrar', exact: true }).click()
    await tab.waitForURL('**/dashboard')
  }
  async function capture(tab: Page, path: string, name: string) {
    for (const width of widths) {
      await tab.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      if (path) assert.equal((await tab.goto(new URL(path, origin).href))?.status(), 200, path)
      await tab.locator('h1').first().waitFor()
      await tab.evaluate(() => document.fonts.ready)
      await delay(100)
      assert.ok(await tab.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' overflow at ' + width)
      if (evidence) await tab.screenshot({ path: evidence + '/' + name + '-' + width + '.png', fullPage: true, animations: 'disabled' })
    }
  }
  try {
    const loginPath = new URL('/login', origin).href
    await visitor.goto(loginPath)
    assert.equal(await visitor.getByRole('button', { name: 'Continuar com Google' }).count(), 0)
    await visitor.getByText('Se Google ou Apple não aparecer', { exact: false }).waitFor()
    await visitor.getByRole('link', { name: 'Enviar e-mail ao suporte' }).waitFor()
    assert.equal(await visitor.getByRole('link', { name: 'Enviar e-mail ao suporte' }).getAttribute('href'), 'mailto:cs.solucoesdigitais@protonmail.com')
    await capture(visitor, '/login', '01-login')
    await db.socialProviderSettings.create({ data: {
      provider: 'google', enabled: true, revision: randomUUID(),
      encrypted: seal(JSON.stringify({ clientId: 'ficticio.apps.googleusercontent.com', secret: 'fixture-project-only' }), 'social:google')
    } })
    await visitor.goto(loginPath)
    await visitor.getByRole('button', { name: 'Continuar com Google' }).waitFor()
    await visitor.goto(loginPath + '?acesso=admin')
    assert.equal(await visitor.getByRole('button', { name: 'Continuar com Google' }).count(), 0)
    await db.socialProviderSettings.delete({ where: { provider: 'google' } })

    await login(page, users[0].email)
    await login(outside, users[1].email)
    await page.getByLabel('Plano para preparação privada').selectOption('annual')
    await page.getByRole('button', { name: 'Salvar preferência' }).click()
    await page.goto(new URL('/catalogo', origin).href)
    await page.getByRole('link', { name: 'Novo produto', exact: true }).click()
    await page.getByRole('heading', { name: 'Novo produto' }).waitFor()
    await page.getByLabel('Nome', { exact: true }).fill('Produto de demonstração')
    await page.getByLabel('Código de barras').fill('7891234567890')
    await page.getByLabel('Preço (R$)', { exact: true }).fill('59,99')
    await page.getByLabel('Custo unitário (R$)', { exact: true }).fill('12,00')
    await page.getByLabel('Estoque atual').fill('5')
    const files = await Promise.all(['#7048dd', '#21aa98', '#d85174'].map(async (background, index) => ({
      name: 'imagem-' + index + '.png', mimeType: 'image/png',
      buffer: await sharp({ create: { width: 180, height: 140, channels: 3, background } }).png().toBuffer()
    })))
    await page.getByLabel('Selecionar fotos').setInputFiles(files)
    await page.getByText('3 de 30 fotos.', { exact: false }).waitFor()
    await page.getByRole('button', { name: 'Remover prévia 3' }).click()
    await page.getByRole('button', { name: 'Subir prévia 2' }).click()
    await page.getByRole('button', { name: 'Salvar produto' }).click()
    const saveFeedback = page.getByText('Produto salvo.', { exact: true }).or(page.locator('form').getByRole('alert'))
    await saveFeedback.first().waitFor()
    assert.equal(await saveFeedback.first().textContent(), 'Produto salvo.')
    const product = await db.product.findFirstOrThrow({ where: { tenantId: tenant.id, barcode: '7891234567890' } })
    assert.equal(product.published, false)
    const assets = await db.mediaAsset.findMany({ where: { tenantId: tenant.id, kind: 'PRODUCT' }, orderBy: { position: 'asc' } })
    assert.equal(assets.length, 2)
    const image = new URL('/api/imagens/' + assets[0].key, origin).href
    assert.equal((await visitor.request.get(image)).status(), 404)
    assert.equal((await outside.request.get(image)).status(), 404)
    assert.equal((await page.request.get(image)).headers()['cache-control'], 'private, no-store')
    assert.equal((await outside.request.get(new URL('/catalogo/produto/' + product.id, origin).href)).status(), 404)
    const publicPath = '/estabelecimento/' + tenant.slug
    assert.equal((await visitor.request.get(new URL(publicPath, origin).href)).status(), 404)
    await page.getByRole('button', { name: 'Subir foto 2' }).click()
    await page.getByText('Galeria atualizada.').waitFor()
    await capture(page, '/catalogo/produto/' + product.id, '02-cadastro-produto')
    await capture(page, publicPath + '?previa=1', '03-previa-privada')
    await page.getByText('Produto de demonstração', { exact: true }).waitFor()

    await db.tenant.update({ where: { id: tenant.id }, data: { active: true } })
    await page.goto(new URL('/compras', origin).href)
    await page.getByLabel('Nome do fornecedor').fill('Fornecedor de demonstração')
    await page.getByRole('button', { name: 'Cadastrar fornecedor' }).click()
    await page.getByText('Registro salvo.', { exact: true }).waitFor()
    await page.getByLabel('Quantidade recebida').fill('3')
    await page.getByLabel('Custo por unidade (R$)').fill('4,00')
    await page.getByRole('button', { name: 'Registrar compra' }).click()
    await page.getByText('Registro salvo.', { exact: true }).waitFor()
    await page.getByRole('cell', { name: 'Fornecedor de demonstração', exact: true }).waitFor()
    assert.equal((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 8)
    await capture(page, '/compras', '04-compras')
    await capture(page, '/resultado', '05-resultado')

    await page.goto(new URL('/marketing', origin).href)
    await page.getByText('Criar cupom', { exact: true }).click()
    const offers = page.locator('details').filter({ hasText: 'Criar cupom' })
    await offers.getByLabel('Nome da oferta').fill('Cupom de demonstração')
    await offers.getByLabel('Código do cupom').fill('FIXTURE')
    await offers.getByLabel('Desconto (%)').fill('10')
    await offers.getByRole('button', { name: 'Salvar oferta' }).click()
    await page.getByText('Oferta atualizada.').waitFor()
    await page.getByRole('button', { name: 'Gerar prévia' }).click()
    await page.getByRole('button', { name: 'Baixar PNG' }).waitFor()
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Baixar PNG' }).click()
    assert.equal((await download).suggestedFilename(), 'arte-cs-agenda-pro.png')
    await capture(page, '', '06-marketing')

    await page.goto(new URL('/automacoes/editor', origin).href)
    await page.getByLabel('Nome do fluxo').fill('Fluxo de demonstração')
    await page.getByRole('button', { name: 'Desconectar passos' }).click()
    await page.getByRole('button', { name: 'Conectar passos' }).click()
    await page.getByLabel('Ativar fluxo').check()
    await page.getByRole('button', { name: 'Salvar automação' }).click()
    await page.waitForURL('**/editor?fluxo=*')
    await page.getByText('Fluxo de demonstração', { exact: true }).waitFor()
    await capture(page, '/automacoes/editor', '07-automacao')
    for (const [path, name] of [['/marketing/campanhas', '08-campanhas'], ['/agenda', '09-agenda'], ['/fidelidade', '10-fidelidade'],
      ['/comissoes', '11-comissoes'], ['/catalogo', '12-catalogo'], ['/dashboard', '13-dashboard']]) await capture(page, path, name)
    assert.deepEqual(failures, [])
    console.log('Chromium V4: fluxos operados e 13 vistas conferidas em 390 e 1280 px.')
  } catch (error) {
    console.error('Última etapa:', new URL(page.url()).pathname, 'Estado:', await page.locator('form [role="status"], form [role="alert"]').allTextContents().catch(() => []))
    throw error
  } finally {
    await browser.close()
    const where = { tenantId: { in: [tenant.id, other.id] } }
    await db.socialProviderSettings.deleteMany({ where: { provider: 'google' } })
    await db.purchase.deleteMany({ where })
    await db.financialEntry.deleteMany({ where })
    await db.stockMovement.deleteMany({ where })
    await db.supplier.deleteMany({ where })
    await db.commercialOffer.deleteMany({ where })
    await db.product.deleteMany({ where })
    await db.member.deleteMany({ where })
    await db.user.deleteMany({ where: { id: { in: users.map(user => user.id) } } })
    await db.tenant.deleteMany({ where: { id: { in: [tenant.id, other.id] } } })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => db.$disconnect())
