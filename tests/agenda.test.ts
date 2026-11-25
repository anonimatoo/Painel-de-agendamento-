import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { db } from '../lib/db'
import { availability, book, dayBounds } from '../lib/agenda'
import { hashPassword, verifyPassword } from '../lib/auth'

after(() => db.$disconnect())

test('senhas são derivadas com salt e verificadas', async () => {
  const first = await hashPassword('exemplo de teste')
  assert.notEqual(first, await hashPassword('exemplo de teste'))
  assert.equal(await verifyPassword('exemplo de teste', first), true)
  assert.equal(await verifyPassword('senha diferente', first), false)
  assert.equal(await verifyPassword('senha diferente'), false)
})

test('data civil usa o fuso do estabelecimento', () => {
  assert.equal(dayBounds('2026-11-25', 'America/Sao_Paulo').start.toUTC().toISO(), '2026-11-25T03:00:00.000Z')
  assert.throws(() => dayBounds('2026-02-30', 'America/Sao_Paulo'))
})

test('PostgreSQL impede vínculos cruzados e agendamentos sobrepostos', async () => {
  const first = await db.tenant.create({ data: { slug: randomUUID(), name: 'Teste A', active: true } })
  const second = await db.tenant.create({ data: { slug: randomUUID(), name: 'Teste B', active: true } })
  const day = DateTime.now().setZone(first.timezone).plus({ days: 2 })
  try {
    const service = await db.service.create({ data: { tenantId: first.id, name: 'Corte', duration: 45, cents: 5500 } })
    const professional = await db.professional.create({ data: { tenantId: first.id, name: 'Ana' } })
    await assert.rejects(db.assignment.create({ data: { tenantId: second.id, professionalId: professional.id, serviceId: service.id } }), { code: 'P2003' })
    await db.assignment.create({ data: { tenantId: first.id, professionalId: professional.id, serviceId: service.id } })
    await db.workHours.create({ data: { tenantId: first.id, professionalId: professional.id, weekday: day.weekday, startMinute: 540, endMinute: 600 } })
    assert.deepEqual(await availability(second, service.id, professional.id, day.toISODate()!), [])
    const slots = await availability(first, service.id, professional.id, day.toISODate()!)
    assert.equal(slots.length, 2)
    const requests = slots.map((slot, index) => book(first, { serviceId: service.id, professionalId: professional.id, startsAt: slot.start, name: 'Cliente de teste', phone: '551199999999' + index, consent: false, online: false }))
    const result = await Promise.allSettled(requests)
    assert.equal(result.filter(r => r.status === 'fulfilled').length, 1)
    assert.equal(await db.appointment.count({ where: { tenantId: first.id } }), 1)
    assert.deepEqual(await availability(first, service.id, professional.id, day.toISODate()!), [])
  } finally {
    await db.appointment.deleteMany({ where: { tenantId: first.id } })
    await db.customer.deleteMany({ where: { tenantId: first.id } })
    await db.assignment.deleteMany({ where: { tenantId: first.id } })
    await db.workHours.deleteMany({ where: { tenantId: first.id } })
    await db.professional.deleteMany({ where: { tenantId: first.id } })
    await db.service.deleteMany({ where: { tenantId: first.id } })
    await db.tenant.deleteMany({ where: { id: { in: [first.id, second.id] } } })
  }
})
