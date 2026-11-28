'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { AgendaError, dayBounds } from '@/lib/agenda'
import { membership, userSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { can } from '@/lib/permissions'

export async function editHoliday(form: FormData) {
  const user = await userSession()
  const member = user ? await membership(user.id) : null
  if (!member?.tenant.active || member.tenant.suspended || !can(member, 'agenda.edit') || !can(member, 'team.professionals')) redirect('/dashboard')
  const { tenant, tenantId } = member
  let result = '/agenda?feriado=salvo'
  try {
    const date = z.iso.date().parse(form.get('date'))
    const { start, end } = dayBounds(date, tenant.timezone)
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`
      if (form.get('command') === 'remove') {
        await tx.storeHoliday.deleteMany({ where: { tenantId, date } })
        return
      }
      const name = z.string().trim().min(2).max(100).parse(form.get('name'))
      if (await tx.appointment.count({ where: { tenantId, status: { in: ['PENDING', 'CONFIRMED'] },
        startsAt: { lt: end.toJSDate() }, endsAt: { gt: start.toJSDate() } } })) {
        throw new AgendaError('Há reservas nesta data. Remarque ou cancele antes de bloquear o dia inteiro.')
      }
      await tx.storeHoliday.upsert({ where: { tenantId_date: { tenantId, date } }, create: { tenantId, date, name }, update: { name } })
    })
  } catch (error) { result = '/agenda?erro=' + encodeURIComponent(error instanceof AgendaError ? error.message : 'Confira a data e o nome.') }
  redirect(result)
}
