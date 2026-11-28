'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { membership, userSession } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { db } from '@/lib/db'

async function manager() {
  const user = await userSession()
  const member = user ? await membership(user.id) : null
  if (!member?.tenant.active || member.tenant.suspended || !can(member, 'whatsapp.manage')) redirect('/dashboard')
  return member
}

export async function configureMerchantNotice(form: FormData) {
  const { tenantId } = await manager()
  const raw = form.get('phone')
  const phone = typeof raw === 'string' ? raw.replace(/\D/g, '') : ''
  if (raw && !/^55\d{10,11}$/.test(phone)) redirect('/automacoes?estado=telefone')
  await db.tenant.update({ where: { id: tenantId }, data: { merchantNoticePhone: phone || null } })
  redirect('/automacoes?estado=configurado')
}

export async function queueManualReminder(form: FormData) {
  const { tenant, tenantId } = await manager()
  const id = z.string().min(1).max(100).safeParse(form.get('id'))
  if (!tenant.whatsappInstance || !id.success) redirect('/automacoes?estado=indisponivel')
  const appointment = await db.appointment.findFirst({
    where: { id: id.data, tenantId, status: 'CONFIRMED', startsAt: { gt: new Date() }, consent: true },
    select: { id: true, startsAt: true }
  })
  if (!appointment) redirect('/automacoes?estado=indisponivel')
  const dedupeKey = 'manual-reminder:' + appointment.id + ':' + appointment.startsAt.toISOString()
  await db.reminder.upsert({
    where: { dedupeKey }, update: {}, create: { appointmentId: appointment.id,
      kind: 'MANUAL_REMINDER', runAt: new Date(), scheduledStart: appointment.startsAt, dedupeKey }
  })
  redirect('/automacoes?estado=enfileirado')
}
