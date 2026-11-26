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

test('carregamento de capa rejeita conteúdo inválido antes de gravar', async () => {
  const { uploadCover } = await import('../lib/storage')
  const file = new File(['<svg>imagem inválida</svg>'], 'foto.png', { type: 'image/png' })
  await assert.rejects(uploadCover('estabelecimento', file), /imagem JPG, PNG ou WebP válida/)
})

test('bloqueios concorrem com reservas e reagendamento preserva histórico', async () => {
  const { blockSchedule, rescheduleAppointment } = await import('../lib/agenda')
  const tenant = await db.tenant.create({ data: { name: 'Agenda de teste', slug: randomUUID(), active: true } })
  const day = DateTime.now().setZone(tenant.timezone).plus({ days: 3 }).startOf('day')
  try {
    const service = await db.service.create({ data: { tenantId: tenant.id, name: 'Corte', duration: 30, cents: 5000 } })
    const professional = await db.professional.create({ data: {
      tenantId: tenant.id, name: 'Ana', hours: { create: { weekday: day.weekday, startMinute: 540, endMinute: 720 } }
    } })
    const values = { tenantId: tenant.id, serviceId: service.id, professionalId: professional.id }
    await db.assignment.create({ data: values })
    const from = day.plus({ hours: 9 }).toJSDate()
    const to = day.plus({ hours: 10 }).toJSDate()
    const customer = { name: 'Cliente', phone: '5511999999999', consent: false, online: false }
    const outcomes = await Promise.allSettled([
      blockSchedule(tenant.id, professional.id, from, to, 'Folga'),
      book(tenant, { ...values, ...customer, startsAt: from.toISOString() })
    ])
    assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1)
    if (outcomes[0].status === 'rejected') {
      await db.appointment.deleteMany({ where: { tenantId: tenant.id } })
      await blockSchedule(tenant.id, professional.id, from, to, 'Folga')
    }
    const slots = await availability(tenant, service.id, professional.id, day.toISODate()!)
    assert.equal(slots[0].label, '10:00')
    const appointment = await book(tenant, { ...values, ...customer, startsAt: slots[0].start })
    await assert.rejects(rescheduleAppointment(tenant, appointment.id, from, 'tester'))
    const moved = await rescheduleAppointment(tenant, appointment.id, new Date(slots[2].start), 'tester')
    assert.equal(moved.startsAt.toISOString(), slots[2].start)
    assert.equal(await db.appointmentHistory.count({ where: { appointmentId: appointment.id, operation: 'RESCHEDULED' } }), 1)
    const { deliverMessage, recoverDelivery } = await import('../lib/delivery')
    const message = await db.reminder.create({ data: { appointmentId: appointment.id, runAt: new Date() } })
    let sends = 0
    const send = async () => { sends++; throw new Error('Resultado desconhecido') }
    await Promise.all([deliverMessage(message.id, send), deliverMessage(message.id, send)])
    assert.equal(sends, 1)
    assert.equal((await db.reminder.findUniqueOrThrow({ where: { id: message.id } })).deliveryState, 'REVIEW')
    await deliverMessage(message.id, send)
    assert.equal(sends, 1)
    await db.reminder.update({ where: { id: message.id }, data: { deliveryState: 'SENDING', claimedAt: new Date(Date.now() - 180_000) } })
    await recoverDelivery()
    assert.equal((await db.reminder.findUniqueOrThrow({ where: { id: message.id } })).deliveryState, 'REVIEW')
    await db.reminder.delete({ where: { id: message.id } })
    const { reconcileAppointment } = await import('../lib/connect')
    const account = 'acct_' + randomUUID()
    const selling = await db.tenant.update({ where: { id: tenant.id }, data: { stripeAccountId: account } })
    const pending = await book(selling, {
      ...values, ...customer, online: true, checkoutReturnUrl: 'http://localhost:3000/estabelecimento/teste',
      startsAt: day.plus({ hours: 11, minutes: 30 }).toUTC().toISO()!
    })
    const sessionIds: string[] = []
    const checkout = { id: 'cs_local_fixture', status: 'open', payment_status: 'unpaid', metadata: { appointmentId: pending.id } }
    const api = { checkout: { sessions: {
      create: async (_payload: unknown, options: { idempotencyKey: string }) => {
        sessionIds.push(options.idempotencyKey)
        if (sessionIds.length === 1) throw new Error('Rede interrompida após criação')
        return checkout
      },
      retrieve: async () => checkout
    } } } as unknown as import('stripe').default
    await assert.rejects(reconcileAppointment(pending, account, api), /Rede interrompida/)
    const afterFailure = await db.appointment.findUniqueOrThrow({ where: { id: pending.id } })
    assert.equal(afterFailure.checkoutState, 'CREATING')
    await reconcileAppointment(afterFailure, account, api)
    assert.equal((await db.appointment.findUniqueOrThrow({ where: { id: pending.id } })).checkoutId, checkout.id)
    assert.deepEqual(sessionIds, ['appointment:' + pending.id, 'appointment:' + pending.id])
    const expired = await db.appointment.update({
      where: { id: pending.id },
      data: { checkoutId: null, checkoutState: 'CREATING', expiresAt: new Date(Date.now() - 900_000) }
    })
    const unconfirmedApi = { checkout: { sessions: { list: async function* () { yield* [] } } } } as unknown as import('stripe').default
    await reconcileAppointment(expired, account, unconfirmedApi)
    const review = await db.appointment.findUniqueOrThrow({ where: { id: pending.id } })
    assert.equal(review.checkoutState, 'REVIEW')
    assert.equal(review.status, 'PENDING')
    const { closeAppointment } = await import('../lib/agenda')
    await db.professional.update({ where: { id: professional.id }, data: { commissionBps: 1250 } })
    await db.appointment.update({
      where: { id: appointment.id }, data: { startsAt: new Date(Date.now() - 3_600_000), endsAt: new Date(Date.now() - 1_800_000) }
    })
    await closeAppointment(tenant.id, appointment.id, 'COMPLETED', 'tester')
    assert.equal((await db.professionalCommission.findUniqueOrThrow({ where: { appointmentId: appointment.id } })).cents, 625)
    const { scheduleBirthdays, scheduleReturn } = await import('../lib/whatsapp-followup')
    const current = new Date()
    await db.tenant.update({ where: { id: tenant.id }, data: { birthdayMessages: true, whatsappInstance: 'fixture-' + tenant.id, returnAfterDays: 30 } })
    await db.customer.update({ where: { id: appointment.customerId }, data: {
      birthMonthDay: DateTime.fromJSDate(current, { zone: tenant.timezone }).toFormat('LL-dd'),
      followupConsentAt: current
    } })
    await Promise.all([scheduleBirthdays(current), scheduleBirthdays(current)])
    assert.equal(await db.reminder.count({ where: { appointmentId: appointment.id, kind: 'BIRTHDAY' } }), 1)
    const completed = await db.appointment.findUniqueOrThrow({ where: { id: appointment.id }, include: { tenant: true, customer: true } })
    await db.$transaction(tx => scheduleReturn(tx, completed))
    assert.equal(await db.reminder.count({ where: { appointmentId: appointment.id, kind: 'RETURN' } }), 1)



  } finally {
    await db.reminder.deleteMany({ where: { appointment: { tenantId: tenant.id } } })
    await db.appointment.deleteMany({ where: { tenantId: tenant.id } })
    await db.customer.deleteMany({ where: { tenantId: tenant.id } })
    await db.scheduleBlock.deleteMany({ where: { tenantId: tenant.id } })
    await db.assignment.deleteMany({ where: { tenantId: tenant.id } })
    await db.workHours.deleteMany({ where: { tenantId: tenant.id } })
    await db.professional.deleteMany({ where: { tenantId: tenant.id } })
    await db.service.deleteMany({ where: { tenantId: tenant.id } })
    await db.tenant.delete({ where: { id: tenant.id } })
  }
})
