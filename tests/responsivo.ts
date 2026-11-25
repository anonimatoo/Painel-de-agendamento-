import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chromium } from 'playwright-core'
import { db } from '../lib/db'
import { hashPassword } from '../lib/auth'

async function main() {
  const origin = process.env.APP_URL ?? 'http://localhost:3000'
  const slug = 'visual-' + randomUUID()
  const email = slug + '@example.test'
  const password = 'Senha-para-teste-visual!'
  const user = await db.user.create({ data: {
    email, password: await hashPassword(password),
    memberships: { create: { role: 'ADMIN', tenant: { create: { name: 'Estúdio de teste visual', slug, active: true } } } }
  } })
  let browser
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true })
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await page.goto(origin + '/login')
    await page.getByLabel('E-mail').fill(email)
    await page.getByLabel('Senha', { exact: true }).fill(password)
    await Promise.all([page.waitForURL('**/dashboard'), page.getByRole('button', { name: 'Entrar', exact: true }).click()])
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      for (const [path, label] of [
        ['/', 'Seu próximo atendimento começa aqui.'],
        ['/dashboard', 'Estúdio de teste visual'],
        ['/agenda', 'Agenda'],
        ['/comercial', 'Estoque e financeiro'],
        ['/personalizacao?visual=celular', 'Personalização'],
        ['/estabelecimento/' + slug, 'Estúdio de teste visual']
      ]) {
        const response = await page.goto(origin + path)
        assert.equal(response?.status(), 200, path)
        assert.equal(await page.getByRole('heading', { name: label, exact: true }).count(), 1)
        const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
        assert.ok(fits, 'Rolagem horizontal indevida em ' + path + ' com ' + width + ' px')
      }
    }
    await page.goto(origin + '/comercial')
    await page.getByLabel('Descrição', { exact: true }).fill('Recebimento de teste')
    await page.getByLabel('Valor em centavos').fill('6500')
    await page.getByLabel('Vencimento').fill(new Date().toISOString().slice(0, 10))
    await page.getByLabel('Já liquidado').check()
    await page.getByRole('button', { name: 'Registrar lançamento' }).click()
    await page.getByText('Recebimento de teste', { exact: false }).waitFor()
    const csv = await page.request.get(origin + '/api/financeiro/csv')
    assert.equal(csv.status(), 200)
    assert.match(await csv.text(), /Recebimento de teste/)
    const xlsx = await page.request.get(origin + '/api/financeiro/xlsx')
    assert.equal(xlsx.status(), 200)
    assert.match(xlsx.headers()['content-type'], /spreadsheetml/)
    assert.equal((await xlsx.body()).subarray(0, 2).toString(), 'PK')
    console.log('Registro financeiro e exportações autenticadas em CSV e XLSX verificados.')
    console.log('Seis telas verificadas no Chromium em 390 px e 1280 px.')
  } finally {
    await browser?.close()
    await db.financialEntry.deleteMany({ where: { tenant: { slug } } })
    await db.user.delete({ where: { id: user.id } })
    await db.tenant.delete({ where: { slug } })
    await db.$disconnect()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
