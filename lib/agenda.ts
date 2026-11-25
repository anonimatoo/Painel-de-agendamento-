import { DateTime } from 'luxon'
import { Prisma, Tenant } from '@prisma/client'
import { db } from './db'

export function dayBounds(day: string, zone: string) {
  const start = DateTime.fromISO(day, { zone }).startOf('day')
  if (!start.isValid || start.toISODate() !== day) throw new AgendaError('Selecione uma data válida.')
  return { start, end: start.plus({ days: 1 }) }
}

export class AgendaError extends Error {}

export async function availability(tenant: Tenant, serviceId: string, professionalId: string, day: string, client: Prisma.TransactionClient = db, excludeAppointment?: string) {
  const { start, end } = dayBounds(day, tenant.timezone)
  const now = DateTime.now()
  if (end <= now || start > now.plus({ days: 90 })) return []
  const assignment = await client.assignment.findFirst({
    where: { tenantId: tenant.id, professionalId, serviceId, service: { active: true }, professional: { active: true } },
    include: { service: true, professional: { include: { hours: { where: { weekday: start.weekday } } } } }
  })
  if (!assignment) return []
  const overlap = { startsAt: { lt: end.toJSDate() }, endsAt: { gt: start.toJSDate() } }
  const [busy, blocks] = await Promise.all([client.appointment.findMany({
    where: { tenantId: tenant.id, professionalId, status: { not: 'CANCELED' }, id: excludeAppointment ? { not: excludeAppointment } : undefined, ...overlap },
    select: { startsAt: true, endsAt: true }
  }), client.scheduleBlock.findMany({
    where: { tenantId: tenant.id, professionalId, ...overlap },
    select: { startsAt: true, endsAt: true }
  })])
  const occupied = [...busy, ...blocks]
  const slots = new Map<string, { start: string; end: string; label: string }>()
  for (const hours of assignment.professional.hours) {
    for (let minutes = hours.startMinute; minutes + assignment.service.duration <= hours.endMinute; minutes += 15) {
      const from = start.set({ hour: Math.floor(minutes / 60), minute: minutes % 60 })
      const to = from.plus({ minutes: assignment.service.duration })
      if (from.hour !== Math.floor(minutes / 60) || from.minute !== minutes % 60 || from <= now) continue
      if (occupied.some(row => row.startsAt < to.toJSDate() && row.endsAt > from.toJSDate())) continue
      const iso = from.toUTC().toISO()!
      slots.set(iso, { start: iso, end: to.toUTC().toISO()!, label: from.toFormat('HH:mm') })
    }
  }
  return [...slots.values()].sort((a, b) => a.start.localeCompare(b.start))
}

export async function book(tenant: Tenant, data: { serviceId: string; professionalId: string; startsAt: string; name: string; phone: string; consent: boolean; online: boolean }) {
  const day = DateTime.fromISO(data.startsAt, { zone: tenant.timezone }).toISODate()
  if (!day) throw new AgendaError('Selecione um horário válido.')
  return db.$transaction(async tx => {
    await lockProfessional(tx, tenant.id, data.professionalId)
    const slots = await availability(tenant, data.serviceId, data.professionalId, day, tx)
    const slot = slots.find(s => s.start === new Date(data.startsAt).toISOString())
    if (!slot) throw new AgendaError('Esse horário não está mais disponível.')
    const service = await tx.service.findUniqueOrThrow({ where: { tenantId_id: { tenantId: tenant.id, id: data.serviceId } } })
    const { name, phone } = data
    const customer = await tx.customer.upsert({
      where: { tenantId_phone: { tenantId: tenant.id, phone } },
      update: {},
      create: { tenantId: tenant.id, name, phone }
    })
    const appointment = await tx.appointment.create({ data: {
      tenantId: tenant.id, customerId: customer.id, professionalId: data.professionalId,
      serviceId: data.serviceId, startsAt: slot.start, endsAt: slot.end, cents: service.cents,
      status: data.online ? 'PENDING' : 'CONFIRMED', consent: data.consent,
      chargeCents: data.online ? Math.ceil(service.cents * tenant.depositPercent / 100) : undefined,
      expiresAt: data.online ? new Date(Math.floor(Date.now() / 1000) * 1000 + 35 * 60_000) : undefined
    } })
    await tx.appointmentHistory.create({ data: { appointmentId: appointment.id, operation: 'CREATED', newStart: appointment.startsAt } })
    await scheduleReminder(tx, tenant, appointment)
    return appointment
  })
}

export async function scheduleReminder(tx: Prisma.TransactionClient, tenant: Tenant, appointment: { id: string; startsAt: Date; consent: boolean; status: string }) {
  if (!appointment.consent || appointment.status !== 'CONFIRMED' || !tenant.reminderMinutes) return
  const runAt = new Date(+appointment.startsAt - tenant.reminderMinutes * 60_000)
  if (runAt <= new Date()) return
  await tx.reminder.upsert({
    where: { appointmentId_runAt: { appointmentId: appointment.id, runAt } }, update: {},
    create: { appointmentId: appointment.id, runAt }
  })
}

async function lockProfessional(tx: Prisma.TransactionClient, tenantId: string, professionalId: string) {
  const records = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Professional" WHERE id = ${professionalId} AND "tenantId" = ${tenantId} FOR UPDATE`
  if (!records.length) throw new AgendaError('Profissional indisponível.')
}

export function localDateTime(value: string, zone: string) {
  const date = DateTime.fromISO(value, { zone })
  if (!date.isValid || date.toFormat("yyyy-LL-dd'T'HH:mm") !== value) throw new AgendaError('Informe uma data e um horário válidos.')
  return date.toJSDate()
}

export async function blockSchedule(tenantId: string, professionalId: string, startsAt: Date, endsAt: Date, reason: string) {
  if (startsAt >= endsAt || endsAt <= new Date()) throw new AgendaError('Informe um período válido para o bloqueio.')
  return db.$transaction(async tx => {
    await lockProfessional(tx, tenantId, professionalId)
    const busy = await tx.appointment.count({
      where: { tenantId, professionalId, status: { in: ['PENDING', 'CONFIRMED'] }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } }
    })
    if (busy) throw new AgendaError('Há atendimentos no período. Ajuste a agenda antes de bloquear.')
    return tx.scheduleBlock.create({ data: { tenantId, professionalId, startsAt, endsAt, reason } })
  })
}

export async function rescheduleAppointment(tenant: Tenant, id: string, startsAt: Date, actorId: string) {
  return db.$transaction(async tx => {
    const result = await tx.appointment.findFirst({
      where: { id, tenantId: tenant.id, status: 'CONFIRMED', startsAt: { gt: new Date() } }
    })
    if (!result) throw new AgendaError('Este atendimento não pode ser reagendado.')
    await lockProfessional(tx, tenant.id, result.professionalId)
    const day = DateTime.fromJSDate(startsAt, { zone: tenant.timezone }).toISODate()!
    const slots = await availability(tenant, result.serviceId, result.professionalId, day, tx, id)
    const slot = slots.find(item => item.start === startsAt.toISOString())
    if (!slot) throw new AgendaError('Esse horário não está disponível.')
    if (+startsAt === +result.startsAt) return result
    const endsAt = new Date(+startsAt + (+result.endsAt - +result.startsAt))
    if (endsAt.toISOString() !== slot.end) throw new AgendaError('A duração do serviço mudou. Crie uma nova reserva ou entre em contato com o suporte.')
    const updated = await tx.appointment.updateMany({
      where: { id, tenantId: tenant.id, status: 'CONFIRMED', startsAt: result.startsAt },
      data: { startsAt, endsAt }
    })
    if (!updated.count) throw new AgendaError('O atendimento já foi alterado. Atualize a página.')
    await tx.appointmentHistory.create({
      data: { appointmentId: id, actorId, operation: 'RESCHEDULED', previousStart: result.startsAt, newStart: startsAt }
    })
    await tx.reminder.deleteMany({ where: { appointmentId: id, sentAt: null, claimedAt: null } })
    const appointment = { ...result, startsAt, endsAt }
    await scheduleReminder(tx, tenant, appointment)
    return appointment
  })
}

export async function closeAppointment(tenantId: string, id: string, status: 'COMPLETED' | 'CANCELED' | 'NO_SHOW', actorId: string) {
  await db.$transaction(async tx => {
    const updated = await tx.appointment.updateMany({
      where: { id, tenantId, status: 'CONFIRMED', ...(status === 'CANCELED' ? { paidAt: null } : { startsAt: { lte: new Date() } }) },
      data: { status }
    })
    if (!updated.count) throw new AgendaError('Não foi possível atualizar esse atendimento.')
    await tx.appointmentHistory.create({ data: { appointmentId: id, actorId, operation: status } })
  })
}
