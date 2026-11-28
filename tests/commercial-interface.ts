import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DateTime } from 'luxon'
import type Stripe from 'stripe'
import { chromium } from 'playwright-core'
import { book, availability } from '../lib/agenda'
import { hashPassword } from '../lib/auth'
import { db } from '../lib/db'
import { deleteMedia, storeMedia } from '../lib/storage'
import { applyEvent } from '../lib/stripe'

const origin = new URL(process.env.APP_URL ?? 'http://127.0.0.1:3095')
const suffix = randomUUID().slice(0, 8)
const slug = 'studio-clara-' + suffix
const secondSlug = slug + '-outra-unidade'
const owner = 'comerciante-' + suffix + '@example.test'
const consumer = 'cliente-' + suffix + '@example.test'
const stranger = 'vizinho-' + suffix + '@example.test'
const password = 'Senha-ficticia-de-teste-2026!'
const evidence = process.env.COMMERCIAL_EVIDENCE
const sizes = [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }, { width: 1440, height: 900 }, { width: 1920, height: 1080 }]

async function main() {
  const datasource = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid')
  assert.equal(origin.hostname, '127.0.0.1')
  assert.ok(['127.0.0.1', 'localhost'].includes(datasource.hostname) && /^\/cs_commercial_test(?:_[a-z0-9]+)?$/.test(datasource.pathname))
  assert.equal(await db.stripeSettings.count(), 0)
  assert.equal(new URL(process.env.S3_ENDPOINT ?? 'https://invalid').hostname, '127.0.0.1')
  if (evidence) await mkdir(evidence, { recursive: true })
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true })
  const store = await db.tenant.create({ data: {
    slug, name: 'Studio Clara', active: true, description: 'Cuidados especializados em cabelo e bem-estar.',
    address: 'Rua das Flores, 123 · São Paulo', policies: 'Alterações online até uma hora antes do atendimento.',
    consumerNoticeHours: 1, merchantNoticePhone: '5511987654321'
  } })
  const other = await db.tenant.create({ data: { slug: secondSlug, name: 'Outro estúdio', active: true } })
  const [service, professional] = await Promise.all([
    db.service.create({ data: { tenantId: store.id, name: 'Corte feminino', cents: 12000, duration: 45, description: 'Corte, lavagem e finalização.' } }),
    db.professional.create({ data: { tenantId: store.id, name: 'Ana Souza' } })
  ])
  const day = DateTime.now().setZone(store.timezone).plus({ days: 2 })
  const dayValue = day.toISODate()!
  const storePath = '/estabelecimento/' + slug
  const portalPath = '/cliente/' + slug
  const bookingPath = storePath + '?' + new URLSearchParams({ servico: service.id, profissional: professional.id, dia: dayValue })
  const fakeAccount = 'acct_visual' + suffix
  const mainPage = await browser.newPage({ locale: 'pt-BR' })
  const client = await browser.newPage({ viewport: sizes[0], locale: 'pt-BR' })
  const anonymous = await browser.newPage({ locale: 'pt-BR' })
  const sessionUser = await db.user.create({ data: {
    email: owner, password: await hashPassword(password), memberships: { create: { tenantId: store.id, role: 'ADMIN' } }
  } })
  const eventId = 'evt_visual_' + suffix
  try {
    await Promise.all([
      db.assignment.create({ data: { tenantId: store.id, professionalId: professional.id, serviceId: service.id } }),
      db.workHours.create({ data: { tenantId: store.id, professionalId: professional.id, weekday: day.weekday, startMinute: 540, endMinute: 720 } }),
      readFile('public/marketing/recepcao-salao.webp').then(bytes => storeMedia(store.id, 'BANNER', '', new File([new Uint8Array(bytes)], 'banner.webp', { type: 'image/webp' }))),
      db.product.create({ data: { tenantId: store.id, name: 'Máscara hidratante', description: 'Tratamento capilar', category: 'Cabelos', sku: 'MAS-01', cents: 8990, stock: 12 } }),
      db.financialEntry.create({ data: { tenantId: store.id, title: 'Atendimento presencial', cents: 9000, kind: 'INCOME', paidAt: new Date(), dueAt: new Date() } }),
      ...[['Hidratação', 9000, 30], ['Escova', 10000, 45], ['Coloração', 28000, 120]].map(async ([name, cents, duration]) => {
        const extra = await db.service.create({ data: { name: String(name), cents: Number(cents), duration: Number(duration), tenantId: store.id } })
        await db.assignment.create({ data: { tenantId: store.id, serviceId: extra.id, professionalId: professional.id } })
      })
    ])
    assert.equal((await mainPage.goto(origin.href + 'login'))?.status(), 200)
    await mainPage.getByLabel('E-mail', { exact: true }).fill(owner)
    await mainPage.getByLabel('Senha', { exact: true }).fill(password)
    await mainPage.getByRole('button', { name: 'Entrar', exact: true }).click()
    await mainPage.waitForURL('**/dashboard')
    await mainPage.goto(new URL('/catalogo?novo=produto', origin).href)
    await mainPage.getByLabel('Nome', { exact: true }).fill('Shampoo revitalizante')
    await mainPage.getByLabel('Preço normal (R$)', { exact: true }).fill('59,90')
    await mainPage.getByLabel('Estoque atual').fill('4')
    await mainPage.getByLabel('Publicar no catálogo').check()
    await mainPage.getByRole('button', { name: 'Salvar alterações' }).click()
    await mainPage.getByText('Shampoo revitalizante', { exact: true }).first().waitFor()
    const product = await db.product.findFirstOrThrow({ where: { tenantId: store.id, name: 'Shampoo revitalizante' } })
    assert.equal(product.cents, 5990)
    assert.equal(product.published, true)
    await mainPage.goto(new URL('/personalizacao', origin).href)
    await mainPage.getByLabel('Cor secundária').fill('#e4d3fb')
    await mainPage.getByLabel('Shampoo revitalizante', { exact: true }).check()
    await mainPage.getByRole('button', { name: 'Salvar rascunho' }).click()
    await mainPage.getByText('Rascunho salvo.', { exact: false }).waitFor()
    await mainPage.getByRole('link', { name: 'Visualizar página', exact: true }).click()
    await mainPage.getByText('Prévia do rascunho.', { exact: false }).waitFor()
    await anonymous.goto(new URL(storePath + '?previa=1', origin).href)
    assert.equal(await anonymous.getByText('Prévia do rascunho.', { exact: false }).count(), 0)
    assert.equal(await anonymous.getByText('Em destaque', { exact: true }).count(), 0)
    await mainPage.getByRole('link', { name: 'Voltar ao editor' }).click()
    await mainPage.getByRole('button', { name: 'Publicar', exact: true }).click()
    await mainPage.getByText('Alterações publicadas.', { exact: true }).waitFor()
    await anonymous.goto(new URL(storePath, origin).href)
    await anonymous.getByText('Em destaque', { exact: true }).waitFor()

    await client.goto(new URL(portalPath + '?criar=1', origin).href)
    await client.getByLabel('Nome completo').fill('Cliente de Homologação')
    await client.getByLabel('E-mail', { exact: true }).fill(consumer)
    await client.getByLabel('Senha (pelo menos 12 caracteres)').fill(password)
    await client.getByLabel('WhatsApp ou telefone com DDI (55)').fill('5511999998888')
    await client.getByRole('button', { name: 'Criar conta', exact: true }).click()
    await client.getByRole('heading', { name: 'Olá, Cliente!' }).waitFor()
    const profile = await db.consumerProfile.findFirstOrThrow({ where: { tenantId: store.id, user: { email: consumer } } })
    assert.equal(await db.member.count({ where: { userId: profile.userId } }), 0)
    assert.equal((await client.request.get(new URL('/super-admin', origin).href, { maxRedirects: 0 })).status(), 307)

    await client.goto(new URL(storePath, origin).href)
    await client.getByLabel('Corte feminino', { exact: false }).check()
    await client.getByText('Shampoo revitalizante', { exact: true }).waitFor()
    await client.getByLabel('Ana Souza').check()
    await client.getByLabel('Escolha um dia').fill(dayValue)
    await client.getByRole('button', { name: 'Consultar horários' }).click()
    await client.getByLabel('09:00', { exact: true }).check()
    assert.equal(await client.getByLabel('Nome', { exact: true }).inputValue(), profile.name)
    await client.getByRole('button', { name: 'Confirmar agendamento' }).click()
    await client.getByText('Seu agendamento foi confirmado.', { exact: true }).waitFor()
    const reservation = await db.appointment.findFirstOrThrow({ where: { tenantId: store.id, consumerUserId: profile.userId } })
    assert.equal(reservation.status, 'CONFIRMED')
    assert.equal(await db.reminder.count({ where: { appointmentId: reservation.id, kind: 'MERCHANT_CONFIRMED', deliveryState: 'QUEUED' } }), 1)
    assert.ok(!(await availability(store, service.id, professional.id, dayValue)).some(slot => slot.start === reservation.startsAt.toISOString()))

    await client.goto(new URL('/cliente/' + secondSlug, origin).href)
    assert.equal(await client.getByText('Corte feminino', { exact: true }).count(), 0)
    await db.user.create({ data: { email: stranger, password: await hashPassword(password), consumerProfiles: { create: { tenantId: store.id, name: 'Outro cliente', phone: profile.phone } } } })
    const outsiderContext = await browser.newContext()
    const token = randomBytes(32).toString('base64url')
    await db.session.create({ data: { tokenHash: createHash('sha256').update(token).digest('hex'), userId: (await db.user.findUniqueOrThrow({ where: { email: stranger } })).id, expiresAt: new Date(Date.now() + 60_000) } })
    await outsiderContext.addCookies([{ name: 'agenda_session', value: token, url: origin.origin }])
    const outsider = await outsiderContext.newPage()
    await outsider.goto(new URL(portalPath + '?atendimento=' + reservation.id, origin).href)
    assert.equal(await outsider.getByText('Corte feminino', { exact: true }).count(), 0)
    await outsiderContext.close()
    await client.goto(new URL(portalPath, origin).href)
    await client.getByRole('link', { name: 'Reagendar' }).click()
    await client.getByLabel('Nova data').fill(dayValue)
    await client.getByRole('button', { name: 'Consultar horários' }).click()
    await client.getByLabel('Novo horário').selectOption({ label: '10:30' })
    await client.getByRole('button', { name: 'Confirmar reagendamento' }).click()
    await client.getByRole('status').getByText('Atendimento atualizado.').waitFor()
    assert.equal(await db.appointmentHistory.count({ where: { appointmentId: reservation.id, operation: 'RESCHEDULED' } }), 1)

    // Settles a synthetic Stripe event inside the test database. The browser never calls Stripe.
    const connected = await db.tenant.update({ where: { id: store.id }, data: { stripeAccountId: fakeAccount } })
    const paid = await book(connected, {
      serviceId: service.id, professionalId: professional.id, startsAt: reservation.startsAt.toISOString(),
      name: profile.name, phone: profile.phone, consumerUserId: profile.userId, consent: false, online: true,
      checkoutReturnUrl: new URL(storePath, origin).href
    })
    const snapshot = { id: eventId, type: 'checkout.session.completed', account: fakeAccount, data: { object: {
      id: 'cs_test_' + suffix, metadata: { appointmentId: paid.id }, payment_status: 'paid', amount_total: paid.chargeCents,
      currency: 'brl', payment_intent: 'pi_' + suffix
    } } } as unknown as Stripe.Event
    await applyEvent(snapshot)
    await applyEvent(snapshot)
    assert.equal(await db.appointmentHistory.count({ where: { appointmentId: paid.id, operation: 'PAYMENT_CONFIRMED' } }), 1)
    assert.equal((await db.appointment.findUniqueOrThrow({ where: { id: paid.id } })).status, 'CONFIRMED')
    await client.goto(new URL(portalPath, origin).href)
    await client.getByRole('button', { name: 'Solicitar estorno' }).click()
    await client.getByText('Solicitação de estorno registrada.', { exact: false }).waitFor()
    assert.equal(await db.appointmentHistory.count({ where: { appointmentId: paid.id, operation: 'REFUND_REQUESTED' } }), 1)
    const resultPath = storePath + '?pagamento=' + paid.paymentToken
    await db.tenant.update({ where: { id: store.id }, data: { onlinePayment: true } })
    const paidProof = portalPath + '/comprovante?tipo=agendamento&id=' + paid.id
    assert.equal((await anonymous.request.get(new URL(paidProof, origin).href)).status(), 404)

    const screens = [
      { name: 'inicio', path: '/', page: anonymous, heading: /Seu próximo atendimento/ },
      { name: 'cadastro', path: '/cadastro', page: anonymous, heading: 'Criar conta' },
      { name: 'login', path: '/login', page: anonymous, heading: 'Entrar' },
      { name: 'comerciante', path: '/dashboard', page: mainPage, heading: 'Studio Clara' },
      { name: 'agenda', path: '/agenda?visual=semana&dia=' + dayValue, page: mainPage, heading: 'Agenda' },
      { name: 'catalogo', path: '/catalogo?editar=' + product.id, page: mainPage, heading: 'Produtos e serviços' },
      { name: 'publica', path: bookingPath, page: anonymous, heading: 'Agende seu atendimento' },
      { name: 'cliente', path: portalPath, page: client, heading: 'Olá, Cliente!' },
      { name: 'confirmacao', path: resultPath, page: anonymous, heading: 'Pagamento aprovado' },
      { name: 'automacoes', path: '/automacoes', page: mainPage, heading: 'Central de automações' },
      { name: 'financeiro', path: '/relatorios', page: mainPage, heading: 'Relatórios financeiros' }
    ]
    for (const { width, height } of sizes) {
      for (const screen of screens) {
        await screen.page.setViewportSize({ width, height })
        assert.equal((await screen.page.goto(new URL(screen.path, origin).href))?.status(), 200, screen.path)
        await screen.page.getByRole('heading', { name: screen.heading }).first().waitFor()
        const overflow = await screen.page.evaluate(() => {
          if (document.documentElement.scrollWidth <= innerWidth + 1) return []
          const elements = [...document.querySelectorAll('body *')].filter(el => !el.closest('.scroll'))
            .filter(el => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 12)
            .map(el => el.tagName + '.' + String(el.getAttribute('class') ?? '') + '=' + Math.round(el.getBoundingClientRect().right))
          return elements.length ? elements : ['documento=' + document.documentElement.scrollWidth]
        })
        assert.equal(overflow.length, 0, screen.name + ' · ' + width + ' · ' + overflow.join(', '))
        if (evidence) await screen.page.screenshot({ path: resolve(evidence, `${screen.name}-${width}x${height}.png`), animations: 'disabled' })
      }
    }

    await client.goto(new URL(portalPath, origin).href)
    await client.getByRole('button', { name: 'Cancelar agendamento', exact: true }).click()
    await client.getByText('Atendimento atualizado.', { exact: true }).waitFor()
    const canceled = await db.appointment.findUniqueOrThrow({ where: { id: reservation.id } })
    assert.equal(canceled.status, 'CANCELED')
    assert.ok((await availability(store, service.id, professional.id, dayValue)).some(slot => slot.start === canceled.startsAt.toISOString()))
    console.log('Chromium: 55 verificações em cinco resoluções, cadastro sem comércio, publicação, reserva, rearranjo, confirmação simulada, estorno solicitado, cancelamento e isolamento.')
  } finally {
    await browser.close()
    for (const image of await db.mediaAsset.findMany({ where: { tenantId: store.id } })) await deleteMedia(store.id, image.id)
    const tenantId = { in: [store.id, other.id] }
    await db.$transaction([
      db.webhookEvent.deleteMany({ where: { id: eventId } }),
      db.reminder.deleteMany({ where: { appointment: { tenantId } } }),
      db.appointment.deleteMany({ where: { tenantId } }),
      db.customer.deleteMany({ where: { tenantId } }),
      db.assignment.deleteMany({ where: { tenantId } }),
      db.workHours.deleteMany({ where: { tenantId } }),
      db.professional.deleteMany({ where: { tenantId } }),
      db.service.deleteMany({ where: { tenantId } }),
      db.consumerProfile.deleteMany({ where: { tenantId } }),
      db.stockMovement.deleteMany({ where: { tenantId } }),
      db.product.deleteMany({ where: { tenantId } }),
      db.financialEntry.deleteMany({ where: { tenantId } }),
      db.mediaAsset.deleteMany({ where: { tenantId } }),
      db.tenant.deleteMany({ where: { id: tenantId } }),
      db.user.deleteMany({ where: { email: { in: [sessionUser.email, consumer, stranger] } } })
    ])
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => db.$disconnect())
