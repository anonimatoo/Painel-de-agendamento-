'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { membership, userSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { can } from '@/lib/permissions'
import { redeemLoyalty } from '@/lib/loyalty'

export async function updateLoyalty(form: FormData) {
  const user = await userSession()
  const member = user ? await membership(user.id) : null
  if (!member?.tenant.active || member.tenant.suspended || !can(member, 'customer.edit')) redirect('/dashboard')
  let state = 'salvo'
  try {
    if (form.get('command') === 'toggle' && member.role === 'ADMIN') {
      await db.tenant.update({ where: { id: member.tenantId }, data: { loyaltyEnabled: form.get('enabled') === 'true' } })
    } else {
      const id = z.string().min(1).max(100).parse(form.get('userId'))
      const sequence = z.coerce.number().int().min(1).parse(form.get('sequence'))
      await redeemLoyalty(member.tenantId, id, sequence)
    }
  } catch { state = 'indisponivel' }
  redirect('/fidelidade?resultado=' + state)
}
