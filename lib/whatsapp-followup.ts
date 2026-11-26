import { DateTime } from 'luxon'
import type { Prisma } from '@prisma/client'
import { db } from './db'

export async function scheduleReturn(tx: Prisma.TransactionClient, appointment: {
  id: string; endsAt: Date; tenant: { returnAfterDays: number | null; timezone: string }; customer: { followupConsentAt: Date | null }
}) {
  const days = appointment.tenant.returnAfterDays
  if (!days || !appointment.customer.followupConsentAt) return
  const runAt = DateTime.fromJSDate(appointment.endsAt, { zone: appointment.tenant.timezone })
    .plus({ days }).startOf('day').set({ hour: 10 }).toJSDate()
  await tx.reminder.createMany({ data: {
    appointmentId: appointment.id, kind: 'RETURN', runAt, dedupeKey: 'return:' + appointment.id
  }, skipDuplicates: true })
}

export async function scheduleBirthdays(now = new Date()) {
  const utc = DateTime.fromJSDate(now, { zone: 'UTC' })
  const dates = [utc.minus({ day: 1 }), utc, utc.plus({ day: 1 })].map(date => date.toFormat('LL-dd'))
  const customers = await db.customer.findMany({
    where: { birthMonthDay: { in: dates }, followupConsentAt: { not: null },
      tenant: { active: true, suspended: false, birthdayMessages: true, whatsappInstance: { not: null } },
      appointments: { some: { status: 'COMPLETED' } } },
    include: { tenant: { select: { timezone: true } },
      appointments: { where: { status: 'COMPLETED' }, take: 1, orderBy: { endsAt: 'desc' }, select: { id: true } } }
  })
  for (const customer of customers) {
    const local = utc.setZone(customer.tenant.timezone)
    if (local.toFormat('LL-dd') !== customer.birthMonthDay || !customer.appointments[0]) continue
    await db.reminder.createMany({ data: {
      appointmentId: customer.appointments[0].id, kind: 'BIRTHDAY',
      runAt: local.startOf('day').set({ hour: 10 }).toJSDate(), dedupeKey: 'birthday:' + customer.id + ':' + local.year
    }, skipDuplicates: true })
  }
}
