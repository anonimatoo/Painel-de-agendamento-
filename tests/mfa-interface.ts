import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Secret, TOTP } from 'otpauth'
import { chromium } from 'playwright-core'
import { hashPassword } from '../lib/auth'
import { db } from '../lib/db'

async function main() {
  const origin = process.env.APP_URL ?? 'http://localhost:3000'
  const email = 'mfa-' + randomUUID() + '@example.test'
  const password = 'Senha-exclusiva-de-teste!'
  const user = await db.user.create({ data: { email, password: await hashPassword(password), platformAdmin: true } })
  let browser
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true })
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] })
    const page = await context.newPage()
    async function login(code?: string) {
      await page.goto(origin + '/login')
      await page.getByLabel('E-mail', { exact: true }).fill(email)
      await page.getByLabel('Senha', { exact: true }).fill(password)
      if (code) {
        await page.getByText('Acesso de Super Admin').click()
        await page.getByLabel('Código do autenticador ou de recuperação').fill(code)
      }
      await page.getByRole('button', { name: 'Entrar', exact: true }).click()
    }

    await login()
    await page.waitForURL('**/conta')
    assert.equal(await page.getByLabel('Código de seis dígitos').count(), 0)
    await page.getByLabel('Sua senha').fill(password)
    await page.getByRole('button', { name: 'Gerar QR Code' }).click()
    const qr = page.getByRole('img', { name: /QR Code/ })
    await qr.waitFor()
    assert.match((await qr.getAttribute('src')) ?? '', /^data:image\/png;base64,/)
    assert.ok(await qr.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0))
    const secret = page.getByLabel('Chave secreta')
    const original = await secret.inputValue()
    await page.getByRole('button', { name: 'Copiar chave' }).click()
    await page.getByText('Chave copiada.').waitFor()
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), original)

    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 })
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    }

    await page.getByLabel('Sua senha').fill('Senha-incorreta-de-teste!')
    await page.getByRole('button', { name: 'Gerar nova chave' }).click()
    await page.getByText('Não foi possível confirmar sua senha.').waitFor()
    assert.equal(await secret.inputValue(), original)
    await page.getByLabel('Sua senha').fill(password)
    await page.getByRole('button', { name: 'Gerar nova chave' }).click()
    await page.getByText('Não foi possível confirmar sua senha.').waitFor({ state: 'hidden' })
    const current = await secret.inputValue()
    assert.notEqual(current, original)
    const code = page.getByLabel('Código de seis dígitos')
    const totp = new TOTP({ secret: Secret.fromBase32(current) })
    const invalid = Array.from({ length: 5 }, (_, index) => '00000' + index).find(value => totp.validate({ token: value, window: 1 }) === null)!
    await code.fill(invalid)
    await page.getByRole('button', { name: 'Ativar autenticação' }).click()
    await page.getByText('Confira o código ou gere uma nova chave.').waitFor()
    await code.fill(totp.generate())
    await page.getByRole('button', { name: 'Ativar autenticação' }).click()
    await page.getByText('Autenticação em duas etapas ativa.').waitFor()
    const recovery = await page.getByRole('list', { name: 'Códigos de recuperação' }).getByRole('listitem').allTextContents()
    assert.equal(recovery.length, 10)
    await page.reload()
    await page.getByText('Autenticação em duas etapas ativa.').waitFor()
    assert.equal(await page.getByRole('list', { name: 'Códigos de recuperação' }).count(), 0)
    await context.clearCookies()
    await login(recovery[0])
    await page.waitForURL('**/super-admin')
    await context.clearCookies()
    await login(recovery[0])
    await page.getByText('Informe um código válido do aplicativo ou um código de recuperação disponível.').waitFor()
    console.log('Interface 2FA aprovada em 390 e 1280 px: QR local, cópia, regeneração, ativação, recuperação e bloqueio de reuso.')
  } finally {
    await browser?.close()
    await db.user.delete({ where: { id: user.id } })
    await db.$disconnect()
  }
}

main().catch(() => {
  console.error('Falha na verificação da interface 2FA.')
  process.exitCode = 1
})
