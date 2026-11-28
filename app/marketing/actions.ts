'use server'

import { redirect } from 'next/navigation'
import { DateTime } from 'luxon'
import { z } from 'zod'
import { AgendaError } from '@/lib/agenda'
import { membership, userSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { comboItems } from '@/lib/offers'
import { can } from '@/lib/permissions'

export async function manageOffer(form: FormData) {
  const user = await userSession()
  const member = user ? await membership(user.id) : null
  if (!member?.tenant.active || member.tenant.suspended || !can(member, 'product.manage')) redirect('/dashboard')
  const { tenantId } = member
  let result = '/marketing?resultado=ok'
  try {
    if (form.get('command') === 'toggle') {
      const id = z.string().min(1).max(100).parse(form.get('id'))
      const active = form.get('active') === 'true'
      const changed = await db.commercialOffer.updateMany({ where: { tenantId, id }, data: { enabled: active } })
      if (!changed.count) throw new AgendaError('Oferta indisponível.')
    } else {
      const input = z.object({
        kind: z.enum(['COUPON','PROMOTION','COMBO']), name: z.string().trim().min(2).max(100),
        percent: z.coerce.number().min(0.01).max(99), starts: z.string().max(25), ends: z.string().max(25)
      }).parse(Object.fromEntries(form))
      const local = (value: string) => DateTime.fromISO(value, { zone: member.tenant.timezone })
      const starts = local(input.starts)
      const ends = local(input.ends)
      if (!starts.isValid || !ends.isValid || starts >= ends) throw new AgendaError('Confira o início e o fim da oferta.')
      const productId = input.kind === 'PROMOTION' ? z.string().min(1).max(100).parse(form.get('product')) : null
      const items = input.kind === 'COMBO' ? comboItems.parse([1,2,3].flatMap(index => {
        const id = form.get('product' + index)
        return id ? [{ productId: id, quantity: Number(form.get('units' + index)) }] : []
      })) : undefined
      const referenced = productId ? [productId] : items?.map(item => item.productId) ?? []
      if (referenced.length && await db.product.count({ where: { tenantId, archivedAt: null, id: { in: referenced } } }) !== referenced.length) {
        throw new AgendaError('Selecione produtos diferentes e disponíveis no seu catálogo.')
      }
      const code = input.kind === 'COUPON' ? z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,24}$/).parse(form.get('code')) : null
      await db.commercialOffer.create({ data: { tenantId, productId, items, code, kind: input.kind, name: input.name,
        bps: Math.round(input.percent * 100), startsAt: starts.toJSDate(), endsAt: ends.toJSDate() } })
    }
  } catch (error) {
    result = '/marketing?erro=' + encodeURIComponent(error instanceof AgendaError ? error.message : 'Confira os campos e use um código de cupom único.')
  }
  redirect(result)
}
