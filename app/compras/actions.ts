'use server'

import { redirect } from 'next/navigation'
import { DateTime } from 'luxon'
import { z } from 'zod'
import { AgendaError } from '@/lib/agenda'
import { membership, userSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { can } from '@/lib/permissions'
import { parseReais } from '@/lib/catalog'
import { receivePurchase } from '@/lib/purchases'

export async function managePurchase(form: FormData) {
  const user = await userSession()
  const member = user ? await membership(user.id) : null
  if (!member?.tenant.active || member.tenant.suspended || !can(member, 'stock.manage') || !can(member, 'finance.write')) redirect('/dashboard')
  const { tenantId } = member
  let result = '/compras?resultado=ok'
  try {
    if (form.get('command') === 'supplier') {
      const supplier = z.object({ name: z.string().trim().min(2).max(100), contact: z.string().trim().max(160) }).parse(Object.fromEntries(form))
      await db.supplier.create({ data: { ...supplier, tenantId } })
    } else {
      const data = z.object({
        command: z.literal('purchase'), supplierId: z.string().min(1).max(100), productId: z.string().min(1).max(100),
        quantity: z.coerce.number().int().min(1).max(100000), cost: z.string(), reference: z.string().trim().max(100),
        requestId: z.uuid(), due: z.iso.date()
      }).parse(Object.fromEntries(form))
      const dueAt = DateTime.fromISO(data.due, { zone: member.tenant.timezone }).toJSDate()
      await receivePurchase({ ...data, tenantId, dueAt, unitCostCents: parseReais(data.cost) })
    }
  } catch (error) {
    result = '/compras?erro=' + encodeURIComponent(error instanceof AgendaError ? error.message : 'Revise os campos ou confira se o fornecedor já existe.')
  }
  redirect(result)
}
