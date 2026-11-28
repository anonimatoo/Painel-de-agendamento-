import { DateTime } from 'luxon'
import { db } from './db'
import { availability } from './agenda'
import { DeliveryRejected } from './delivery'
import { sendWhatsApp } from './evolution'

export async function notifyWaitList(send = sendWhatsApp, now = new Date()) {
  const stale = new Date(+now - 120_000)
  await db.waitEntry.updateMany({
    where: { notificationState: 'SENDING', notificationCheckedAt: { lt: stale } },
    data: { notificationState: 'REVIEW' }
  })
  const due = await db.waitEntry.findMany({
    where: { day: { gte: DateTime.fromJSDate(now).toUTC().minus({ days: 1 }).toISODate()! },
      closedAt: null, notificationConsentAt: { not: null }, notificationState: 'QUEUED',
      OR: [{ notificationCheckedAt: null }, { notificationCheckedAt: { lte: new Date(+now - 60_000) } }],
      professional: { tenant: { active: true, suspended: false, whatsappInstance: { not: null } } } },
    include: { professional: { include: { tenant: true } } }, orderBy: [{ notificationCheckedAt: { sort: 'asc', nulls: 'first' } }, { day: 'asc' }, { createdAt: 'asc' }], take: 40
  })
  for (const row of due) {
    const tenant = row.professional.tenant
    const scope = { id: row.id, tenantId: row.tenantId, notificationConsentAt: row.notificationConsentAt,
      notificationCheckedAt: row.notificationCheckedAt, notificationState: 'QUEUED', closedAt: null }
    if (row.day < DateTime.fromJSDate(now, { zone: tenant.timezone }).toISODate()!) {
      await db.waitEntry.updateMany({ where: scope, data: { closedAt: now } })
      continue
    }
    const slots = await availability(tenant, row.serviceId, row.professionalId, row.day)
    if (!slots.length) {
      await db.waitEntry.updateMany({ where: scope, data: { notificationCheckedAt: now } })
      continue
    }
    const claim = await db.waitEntry.updateMany({
      where: { ...scope, professional: { tenant: { active: true, suspended: false, whatsappInstance: tenant.whatsappInstance } } },
      data: { notificationState: 'SENDING', notificationCheckedAt: now }
    })
    if (!claim.count) continue
    const path = new URL('/estabelecimento/' + encodeURIComponent(tenant.slug), process.env.APP_URL ?? 'http://localhost:3000')
    path.search = new URLSearchParams({ servico: row.serviceId, profissional: row.professionalId, dia: row.day }).toString()
    let notificationState = 'REVIEW'
    let notificationReference: string | undefined
    try {
      notificationReference = await send(tenant.whatsappInstance!, row.phone, 'Surgiu um horário em ' + tenant.name +
        '. Consulte a disponibilidade atual em ' + path.href)
      if (notificationReference) notificationState = 'ACCEPTED'
    } catch (error) {
      if (error instanceof DeliveryRejected) notificationState = 'FAILED'
    }
    await db.waitEntry.updateMany({
      where: { id: row.id, notificationState: 'SENDING', notificationCheckedAt: now },
      data: { notificationState, notificationReference }
    })
  }
}
