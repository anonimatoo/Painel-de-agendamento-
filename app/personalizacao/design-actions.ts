'use server'

import { redirect } from 'next/navigation'
import { Prisma } from '@prisma/client'
import { membership, userSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { can } from '@/lib/permissions'
import { publicDesignSchema, readPublicDesign } from '@/lib/public-design'

const path = '/personalizacao'

export async function updatePublicDesign(form: FormData) {
  const user = await userSession()
  const member = user ? await membership(user.id) : null
  if (!member || member.tenant.suspended || !can(member, 'brand.manage')) redirect('/dashboard')
  const { tenantId } = member
  if (form.get('command') === 'publish') {
    if (!member.tenant.active) redirect(path)
    const published = await db.$transaction(async tx => {
      const [current] = await tx.$queryRaw<{ publicDesignDraft: Prisma.JsonValue | null }[]>`
        SELECT "publicDesignDraft" FROM "Tenant" WHERE id = ${tenantId} AND active AND NOT suspended FOR UPDATE`
      if (!current?.publicDesignDraft) return false
      await tx.tenant.update({ where: { id: tenantId }, data: {
        publicDesign: readPublicDesign(current.publicDesignDraft), publicDesignDraft: Prisma.DbNull
      } })
      return true
    })
    redirect(path + (published ? '?design=publicado' : '?design=sem-rascunho'))
  }
  const parsed = publicDesignSchema.safeParse({
    secondaryColor: form.get('secondaryColor'), buttonStyle: form.get('buttonStyle'), layout: form.get('layout'),
    productIds: [...new Set(form.getAll('productIds'))], serviceIds: [...new Set(form.getAll('serviceIds'))]
  })
  if (!parsed.success) redirect(path + '?design=dados')
  const design = parsed.data
  const [products, services] = await Promise.all([
    db.product.count({ where: { tenantId, id: { in: design.productIds }, published: true, archivedAt: null } }),
    db.service.count({ where: { tenantId, id: { in: design.serviceIds }, active: true, archivedAt: null } })
  ])
  if (products !== design.productIds.length || services !== design.serviceIds.length) redirect(path + '?design=dados')
  await db.tenant.update({ where: { id: tenantId }, data: { publicDesignDraft: design } })
  redirect(path + '?design=rascunho')
}
