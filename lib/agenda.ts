import { DateTime } from 'luxon'
import { Prisma, Tenant } from '@prisma/client'
import { db } from './db'

export function dayBounds(day: string, zone: string) {
  const start = DateTime.fromISO(day, { zone }).startOf('day')
  if (!start.isValid || start.toISODate() !== day) throw new AgendaError('Selecione uma data válida.')
  return { start, end: start.plus({ days: 1 }) }
}

export class AgendaError extends Error {}

export async function availability(tenant: Tenant, serviceId: string, professionalId: string, day: string, client: Prisma.TransactionClient = db) {
  const { start, end } = dayBounds(day, tenant.timezone)
  const now = DateTime.now()
  if (end <= now || start > now.plus({ days: 90 })) return []
  const assignment = await client.assignment.findFirst({
    where: { tenantId: tenant.id, professionalId, serviceId, service: { active: true }, professional: { active: true } },
    include: { service: true, professional: { include: { hours: { where: { weekday: start.weekday } } } } }
  })
  if (!assignment) return []
  const busy = await client.appointment.findMany({
    where: { tenantId: tenant.id, professionalId, status: { not: 'CANCELED' }, startsAt: { lt: end.toJSDate() }, endsAt: { gt: start.toJSDate() } },
    select: { startsAt: true, endsAt: true }
  })
  const slots = new Map<string, { start: string; end: string; label: string }>()
  for (const hours of assignment.professional.hours) {
    for (let minutes = hours.startMinute; minutes + assignment.service.duration <= hours.endMinute; minutes += 15) {
      const from = start.set({ hour: Math.floor(minutes / 60), minute: minutes % 60 })
      const to = from.plus({ minutes: assignment.service.duration })
      if (from.hour !== Math.floor(minutes / 60) || from.minute !== minutes % 60 || from <= now) continue
      if (busy.some(row => row.startsAt < to.toJSDate() && row.endsAt > from.toJSDate())) continue
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
