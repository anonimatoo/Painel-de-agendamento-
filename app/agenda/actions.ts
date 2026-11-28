'use server'

import { redirect, unstable_rethrow } from 'next/navigation'
import { z } from 'zod'
import { AgendaError, closeAppointment, localDateTime, rescheduleAppointment } from '@/lib/agenda'
import { allowAttempt } from '@/lib/account-security'
import { membership, userSession } from '@/lib/auth'
import { reconcileAppointment, refundAppointment } from '@/lib/connect'
import { db } from '@/lib/db'
import { can } from '@/lib/permissions'
import { stripe } from '@/lib/stripe'

export async function calendarAppointment(form: FormData) {
  const user = await userSession()
  if (!user) redirect('/login')
  const member = await membership(user.id)
  if (!member || !can(member, 'agenda.read') || !member.tenant.active || member.tenant.suspended) redirect('/dashboard')

  const query = new URLSearchParams(String(form.get('calendar') ?? '').slice(0, 512))
  const target = new URLSearchParams()
  for (const key of ['dia', 'visual', 'profissional', 'servico', 'situacao']) {
    const value = query.get(key)
    if (value) target.set(key, value)
  }

  try {
    const values = z.object({
      id: z.string().min(1).max(100),
      operation: z.enum(['RESCHEDULE', 'CANCELED', 'COMPLETED', 'NO_SHOW', 'REFUND', 'REVIEW']),
      startsAt: z.string().optional()
    }).parse(Object.fromEntries(form))
    const { tenantId } = member
    const capability = values.operation === 'CANCELED' ? 'agenda.cancel'
      : values.operation === 'REFUND' ? 'finance.refund'
        : values.operation === 'REVIEW' ? 'finance.read' : 'agenda.edit'
    if (!can(member, capability)) throw new AgendaError('Você não tem acesso a esta operação.')

    if (values.operation === 'REVIEW') {
      const appointment = await db.appointment.findFirst({ where: { id: values.id, tenantId, status: 'PENDING' } })
      const account = appointment?.checkoutAccountId ?? member.tenant.stripeAccountId
      if (!appointment || !account) throw new AgendaError('Este pagamento está indisponível para consulta.')
      if (!await allowAttempt('review-payment', tenantId, 30, 600)) throw new AgendaError('Aguarde antes de consultar novamente.')
      await reconcileAppointment(appointment, account, await stripe())
    } else if (values.operation === 'REFUND') {
      await refundAppointment(tenantId, values.id)
    } else if (values.operation === 'RESCHEDULE') {
      await rescheduleAppointment(member.tenant, values.id, localDateTime(values.startsAt ?? '', member.tenant.timezone), user.id)
    } else {
      await closeAppointment(tenantId, values.id, values.operation, user.id)
    }
    target.set('alterado', values.operation === 'REVIEW' ? 'consulta' : values.operation === 'REFUND' ? 'estorno' : '1')
  } catch (error) {
    unstable_rethrow(error)
    target.set('erro', error instanceof AgendaError ? error.message : 'Não foi possível atualizar a agenda. Confira os dados e tente novamente.')
  }
  redirect('/agenda?' + target)
}
