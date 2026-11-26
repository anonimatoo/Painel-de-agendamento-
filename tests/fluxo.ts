import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { db } from '../lib/db'

const origin = process.env.APP_URL ?? 'http://localhost:3000'
const suffix = randomUUID()
const link = 'teste-' + suffix
const email = link + '@example.test'
const password = 'Senha-de-teste-2026!'
let cookie = ''

async function get(path: string) {
  return fetch(new URL(path, origin), { headers: { cookie }, redirect: 'manual' })
}

function decode(value: string) {
  return value.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

async function submit(path: string, label: string, values: Record<string, string>) {
  const page = await get(path)
  assert.equal(page.status, 200, path)
  const html = await page.text()
  const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/g)]
  const selected = forms.find(([form]) => form.includes('>' + label + '</button>'))
  assert.ok(selected, 'Formulário: ' + label)
  const body = new FormData()
  for (const [input] of selected[0].matchAll(/<input\b[^>]*>/g)) {
    if (!input.includes('type="hidden"')) continue
    const name = input.match(/\bname="([^"]+)"/)?.[1]
    const value = input.match(/\bvalue="([^"]*)"/)?.[1] ?? ''
    if (name) body.append(decode(name), decode(value))
  }
  for (const [name, value] of Object.entries(values)) body.set(name, value)
  return fetch(new URL(path, origin), { method: 'POST', headers: { cookie, origin }, body, redirect: 'manual' })
}

function location(response: Response) {
  assert.equal(response.status, 303)
  const target = response.headers.get('location')
  assert.ok(target)
  return target
}

async function main() {
  const registration = await submit('/cadastro', 'Criar conta', {
    business: 'Estúdio do teste', link, email, password
  })
  assert.equal(location(registration), '/dashboard')
  cookie = registration.headers.get('set-cookie')?.split(';')[0] ?? ''
  assert.match(cookie, /^agenda_session=/)
  const initial = await get('/dashboard')
  assert.match(await initial.text(), /Assinatura necessária/)

  const tenant = await db.tenant.update({ where: { slug: link }, data: { active: true } })
  assert.equal(location(await submit('/dashboard', 'Adicionar serviço', {
    name: 'Corte de teste', description: '', cents: '5500', duration: '45'
  })), '/dashboard')
  assert.equal(location(await submit('/dashboard', 'Adicionar profissional', { name: 'Ana de teste' })), '/dashboard')
  const [service, professional] = await Promise.all([
    db.service.findFirstOrThrow({ where: { tenantId: tenant.id } }),
    db.professional.findFirstOrThrow({ where: { tenantId: tenant.id } })
  ])
  const day = DateTime.now().setZone(tenant.timezone).plus({ days: 2 })
  assert.equal(location(await submit('/dashboard', 'Vincular serviço', {
    serviceId: service.id, professionalId: professional.id
  })), '/dashboard')
  assert.equal(location(await submit('/dashboard', 'Adicionar turno', {
    professionalId: professional.id, weekday: String(day.weekday), startMinute: '09:00', endMinute: '10:00'
  })), '/dashboard')

  cookie = ''
  const selection = new URLSearchParams({ servico: service.id, profissional: professional.id, dia: day.toISODate()! })
  const path = '/estabelecimento/' + link
  const slotsResponse = await get('/api/estabelecimentos/' + link + '/horarios?' + selection)
  assert.equal(slotsResponse.status, 200)
  const { horarios } = await slotsResponse.json()
  assert.equal(horarios.length, 2)
  const target = location(await submit(path + '?' + selection, 'Confirmar agendamento', {
    serviceId: service.id, professionalId: professional.id,
    startsAt: horarios[0].start, name: 'Cliente de teste', phone: '5511999999999'
  }))
  assert.match(target, /\?reserva=/)
  assert.match(await (await get(target)).text(), /Seu agendamento foi confirmado/)
  assert.equal(await db.appointment.count({ where: { tenantId: tenant.id, status: 'CONFIRMED' } }), 1)

  const login = await submit('/login', 'Entrar', { email, password })
  assert.equal(location(login), '/dashboard')
  cookie = login.headers.get('set-cookie')?.split(';')[0] ?? ''
  assert.match(await (await get('/dashboard')).text(), /Cliente de teste/)
  assert.equal((await get('/super-admin')).headers.get('location'), '/login')
  const refresh = '/api/stripe/connect/refresh?estabelecimento='
  const other = await db.tenant.create({ data: { slug: randomUUID(), name: 'Outro estabelecimento', active: true, stripeAccountId: 'acct_' + randomUUID().replaceAll('-', '') } })
  try {
    assert.equal((await get(refresh + other.id)).status, 403)
    assert.equal((await get(refresh + tenant.id)).status, 403)
  } finally {
    await db.tenant.delete({ where: { id: other.id } })
  }
  await submit('/dashboard', 'Sair', {})
  assert.equal((await get('/dashboard')).headers.get('location'), '/login')
  const anonymous = await get(refresh + tenant.id)
  assert.equal(anonymous.status, 303)
  assert.equal(anonymous.headers.get('location'), new URL('/login', origin).href)
  console.log('Fluxo de cadastro, sessão, agenda, reserva e isolamento da renovação Connect aprovado.')
}

async function cleanup() {
  const tenant = await db.tenant.findUnique({ where: { slug: link } })
  if (tenant) {
    const tenantId = tenant.id
    await db.$transaction([
      db.appointment.deleteMany({ where: { tenantId } }),
      db.customer.deleteMany({ where: { tenantId } }),
      db.assignment.deleteMany({ where: { tenantId } }),
      db.workHours.deleteMany({ where: { tenantId } }),
      db.professional.deleteMany({ where: { tenantId } }),
      db.service.deleteMany({ where: { tenantId } }),
      db.tenant.delete({ where: { id: tenantId } })
    ])
  }
  await db.user.deleteMany({ where: { email } })
}

main().finally(async () => {
  try { await cleanup() } finally { await db.$disconnect() }
}).catch(error => { console.error(error); process.exitCode = 1 })
