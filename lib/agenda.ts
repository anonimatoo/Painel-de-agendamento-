import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { Prisma, Tenant, type CheckoutMethod } from '@prisma/client'
import { scheduleReturn } from './whatsapp-followup'
import { calculateCommission, platformFee } from './commission'
import { pixCheckoutLeadMinutes } from './checkout-method'
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
    where: { tenantId: tenant.id, professionalId, serviceId, service: { active: true, archivedAt: null }, professional: { active: true } },
    select: { serviceId: true }
  })
  if (!assignment) return []
  // Prisma loads sibling relations concurrently on the transaction's single pg client.
  const service = await client.service.findUniqueOrThrow({
    where: { tenantId_id: { tenantId: tenant.id, id: serviceId } }, select: { duration: true }
  })
  const workHours = await client.workHours.findMany({
    where: { tenantId: tenant.id, professionalId, weekday: start.weekday }
  })
  const overlap = { startsAt: { lt: end.toJSDate() }, endsAt: { gt: start.toJSDate() } }
  const busy = await client.appointment.findMany({
    where: { tenantId: tenant.id, professionalId, status: { not: 'CANCELED' }, id: excludeAppointment ? { not: excludeAppointment } : undefined, ...overlap },
    select: { startsAt: true, endsAt: true }
  })
  const blocks = await client.scheduleBlock.findMany({
    where: { tenantId: tenant.id, professionalId, ...overlap },
    select: { startsAt: true, endsAt: true }
  })
  const occupied = [...busy, ...blocks]
  const slots = new Map<string, { start: string; end: string; label: string }>()
  for (const hours of workHours) {
    for (let minutes = hours.startMinute; minutes + service.duration <= hours.endMinute; minutes += 15) {
      const from = start.set({ hour: Math.floor(minutes / 60), minute: minutes % 60 })
      const to = from.plus({ minutes: service.duration })
      if (from.hour !== Math.floor(minutes / 60) || from.minute !== minutes % 60 || from <= now) continue
      if (occupied.some(row => row.startsAt < to.toJSDate() && row.endsAt > from.toJSDate())) continue
      const iso = from.toUTC().toISO()!
      slots.set(iso, { start: iso, end: to.toUTC().toISO()!, label: from.toFormat('HH:mm') })
    }
  }
  return [...slots.values()].sort((a, b) => a.start.localeCompare(b.start))
}

export async function book(tenant: Tenant, data: { serviceId: string; professionalId: string; startsAt: string; name: string; phone: string; consent: boolean; online: boolean; checkoutMethod?: CheckoutMethod; consumerUserId?: string; checkoutReturnUrl?: string }) {
  const day = DateTime.fromISO(data.startsAt, { zone: tenant.timezone }).toISODate()
  if (data.checkoutMethod === 'pix' && +new Date(data.startsAt) < Date.now() + pixCheckoutLeadMinutes * 60_000) throw new AgendaError('Escolha um horário com pelo menos 40 minutos de antecedência para pagar com Pix.')
  if (!day) throw new AgendaError('Selecione um horário válido.')
  return db.$transaction(async tx => {
    if (data.online) {
      const [current] = await tx.$queryRaw<{ stripeAccountId: string | null; connectPausedAt: Date | null; pixCheckoutEnabled: boolean }[]>`
        SELECT "stripeAccountId", "connectPausedAt", "pixCheckoutEnabled" FROM "Tenant" WHERE id = ${tenant.id} FOR UPDATE`
      if (!current || current.connectPausedAt || current.stripeAccountId !== tenant.stripeAccountId || (data.checkoutMethod === 'pix' && !current.pixCheckoutEnabled)) throw new AgendaError('Os pagamentos online estão indisponíveis.')
    }
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
    const chargeCents = data.online ? Math.ceil(service.cents * tenant.depositPercent / 100) : undefined
    const platformFeeCents = chargeCents ? await platformFee(tx, tenant.id, chargeCents) : 0
    const appointment = await tx.appointment.create({ data: {
      tenantId: tenant.id, customerId: customer.id, professionalId: data.professionalId, consumerUserId: data.consumerUserId,
      serviceId: data.serviceId, startsAt: slot.start, endsAt: slot.end, cents: service.cents,
      status: data.online ? 'PENDING' : 'CONFIRMED', consent: data.consent,
      checkoutReturnUrl: data.online ? data.checkoutReturnUrl : undefined,
      checkoutState: data.online ? 'CREATING' : undefined,
      checkoutAccountId: data.online ? tenant.stripeAccountId : undefined,
      paymentToken: data.online ? randomUUID() : undefined,
      chargeCents, platformFeeCents, checkoutMethod: data.checkoutMethod,
      expiresAt: data.online ? new Date(Math.floor(Date.now() / 1000) * 1000 + 35 * 60_000) : undefined
    } })
    await tx.appointmentHistory.create({ data: { appointmentId: appointment.id, operation: 'CREATED', newStart: appointment.startsAt } })
    await scheduleReminder(tx, tenant, appointment)
    await enqueueStatus(tx, tenant, appointment, data.online ? 'PAYMENT_PENDING' : 'CONFIRMED')
    if (!data.online) await enqueueMerchantConfirmation(tx, tenant, appointment)
    return appointment
  })
}

export function reminderOffsets(tenant: Pick<Tenant, 'reminderPresets' | 'reminderMinutes'>) {
  return [...new Set([...tenant.reminderPresets, ...(tenant.reminderMinutes ? [tenant.reminderMinutes] : [])])]
}

export async function scheduleReminder(tx: Prisma.TransactionClient, tenant: Tenant, appointment: { id: string; startsAt: Date; consent: boolean; status: string }) {
  if (!appointment.consent || appointment.status !== 'CONFIRMED') return
  const now = new Date()
  for (const offset of reminderOffsets(tenant)) {
    const runAt = new Date(+appointment.startsAt - offset * 60_000)
    if (runAt <= now) continue
    const values = { appointmentId: appointment.id, runAt, kind: 'REMINDER' }
    await tx.reminder.upsert({
      where: { appointmentId_runAt_kind: values }, update: {}, create: values
    })
    await tx.reminder.updateMany({
      where: { ...values, deliveryState: 'CANCELED', deliveryAttempts: 0 }, data: { deliveryState: 'QUEUED' }
    })
  }
}

export async function enqueueMerchantConfirmation(
  tx: Prisma.TransactionClient, tenant: Pick<Tenant, 'merchantNoticePhone'>, appointment: { id: string; startsAt: Date }
) {
  if (!tenant.merchantNoticePhone) return
  const dedupeKey = 'merchant-confirmed:' + appointment.id
  await tx.reminder.upsert({ where: { dedupeKey }, update: {}, create: {
    appointmentId: appointment.id, kind: 'MERCHANT_CONFIRMED', runAt: new Date(),
    scheduledStart: appointment.startsAt, dedupeKey, recipientPhone: tenant.merchantNoticePhone
  } })
}

export async function enqueueStatus(
  tx: Prisma.TransactionClient,
  tenant: Pick<Tenant, 'statusMessages' | 'completionMessages' | 'reviewUrl'>,
  appointment: { id: string; startsAt: Date; consent: boolean },
  kind: 'CONFIRMED' | 'PAID' | 'CANCELED' | 'RESCHEDULED' | 'PAYMENT_PENDING' | 'COMPLETED' | 'FEEDBACK'
) {
  const completion = kind === 'COMPLETED' || kind === 'FEEDBACK'
  if (!appointment.consent || (completion ? !tenant.completionMessages : !tenant.statusMessages) || (kind === 'FEEDBACK' && !tenant.reviewUrl)) return
  const runAt = new Date(Date.now() + (kind === 'FEEDBACK' ? 2 * 60 * 60_000 : 0))
  await tx.reminder.create({ data: { appointmentId: appointment.id, runAt, kind, scheduledStart: appointment.startsAt } })
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

export async function saveWorkHours(tenantId: string, professionalId: string, data: { weekday: number; startMinute: number; endMinute: number }, id?: string) {
  if (data.startMinute >= data.endMinute) throw new AgendaError('O horário final deve ser após o início.')
  return db.$transaction(async tx => {
    await lockProfessional(tx, tenantId, professionalId)
    const overlap = await tx.workHours.count({ where: {
      tenantId, professionalId, weekday: data.weekday, id: id ? { not: id } : undefined,
      startMinute: { lt: data.endMinute }, endMinute: { gt: data.startMinute }
    } })
    if (overlap) throw new AgendaError('O turno se sobrepõe a um horário já configurado.')
    if (!id) return tx.workHours.create({ data: { tenantId, professionalId, ...data } })
    const changed = await tx.workHours.updateMany({ where: { tenantId, professionalId, id }, data })
    if (!changed.count) throw new AgendaError('Turno indisponível.')
  })
}

export async function removeWorkHours(tenantId: string, professionalId: string, id: string) {
  await db.$transaction(async tx => {
    await lockProfessional(tx, tenantId, professionalId)
    await tx.workHours.deleteMany({ where: { tenantId, professionalId, id } })
  })
}

export async function blockSchedule(tenantId: string, professionalId: string, startsAt: Date, endsAt: Date, reason: string) {
  if (startsAt >= endsAt || endsAt <= new Date()) throw new AgendaError('Informe um período válido para o bloqueio.')
  return db.$transaction(async tx => {
    const ids = professionalId === 'all'
      ? (await tx.professional.findMany({ where: { tenantId, active: true }, select: { id: true }, orderBy: { id: 'asc' } })).map(row => row.id)
      : [professionalId]
    if (!ids.length) throw new AgendaError('Nenhum profissional ativo para bloquear.')
    for (const id of ids) await lockProfessional(tx, tenantId, id)
    const busy = await tx.appointment.count({
      where: { tenantId, professionalId: { in: ids }, status: { in: ['PENDING', 'CONFIRMED'] }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } }
    })
    if (busy) throw new AgendaError('O período contém atendimentos. Reagende ou cancele os atendimentos afetados antes de bloquear.')
    return tx.scheduleBlock.createMany({ data: ids.map(id => ({ tenantId, professionalId: id, startsAt, endsAt, reason })) })
  })
}

export async function rescheduleAppointment(tenant: Tenant, id: string, startsAt: Date, actorId: string, consumer?: { userId: string; after: Date }) {
  return db.$transaction(async tx => {
    const result = await tx.appointment.findFirst({
      where: { id, tenantId: tenant.id, consumerUserId: consumer?.userId, status: 'CONFIRMED', startsAt: { gt: consumer?.after ?? new Date() } }
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
      where: { id, tenantId: tenant.id, status: 'CONFIRMED', startsAt: { equals: result.startsAt, gt: consumer?.after }, consumerUserId: consumer?.userId },
      data: { startsAt, endsAt }
    })
    if (!updated.count) throw new AgendaError('O atendimento já foi alterado. Atualize a página.')
    await tx.appointmentHistory.create({
      data: { appointmentId: id, actorId, operation: 'RESCHEDULED', previousStart: result.startsAt, newStart: startsAt }
    })
    await tx.reminder.deleteMany({ where: { appointmentId: id, kind: 'REMINDER', deliveryState: 'QUEUED', sentAt: null, claimedAt: null } })
    const appointment = { ...result, startsAt, endsAt }
    await scheduleReminder(tx, tenant, appointment)
    await enqueueStatus(tx, tenant, appointment, 'RESCHEDULED')
    return appointment
  })
}

export async function closeAppointment(tenantId: string, id: string, status: 'COMPLETED' | 'CANCELED' | 'NO_SHOW', actorId: string, consumer?: { userId: string; after: Date }) {
  await db.$transaction(async tx => {
    const updated = await tx.appointment.updateMany({
      where: { id, tenantId, status: 'CONFIRMED', consumerUserId: consumer?.userId, ...(status === 'CANCELED' ? { paidAt: null, startsAt: consumer ? { gt: consumer.after } : undefined } : { startsAt: { lte: new Date() } }) },
      data: { status }
    })
    if (!updated.count) throw new AgendaError('Não foi possível atualizar esse atendimento.')
    await tx.appointmentHistory.create({ data: { appointmentId: id, actorId, operation: status } })
    if (status === 'COMPLETED') {
      const appointment = await tx.appointment.findUniqueOrThrow({ where: { id } })
      const professional = await tx.professional.findUniqueOrThrow({ where: { tenantId_id: { tenantId, id: appointment.professionalId } } })
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } })
      const customer = await tx.customer.findUniqueOrThrow({ where: { tenantId_id: { tenantId, id: appointment.customerId } } })
      const cents = calculateCommission(appointment.cents, professional.commissionBps, professional.commissionFixed)
      if (cents) await tx.professionalCommission.create({ data: { appointmentId: id, cents } })
      await enqueueStatus(tx, tenant, appointment, 'COMPLETED')
      await enqueueStatus(tx, tenant, appointment, 'FEEDBACK')
      await scheduleReturn(tx, { ...appointment, tenant, customer })
    }
    if (status === 'CANCELED') {
      const appointment = await tx.appointment.findUniqueOrThrow({ where: { id }, include: { tenant: true } })
      await enqueueStatus(tx, appointment.tenant, appointment, 'CANCELED')
    }
  })
}
