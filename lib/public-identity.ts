import type { Prisma } from '@prisma/client'
import { db } from './db'
import { AgendaError } from './agenda'

export async function lockPublicAddress(tx: Prisma.TransactionClient, slug: string) {
  await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${'public-slug:' + slug}))) AS lock`
}

export async function changePublicAddress(tenantId: string, slug: string) {
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } })
    if (tenant.slug === slug) return
    await lockPublicAddress(tx, slug)
    const reserved = await tx.tenantAlias.findUnique({ where: { slug } })
    if (reserved && reserved.tenantId !== tenantId) throw new AgendaError('Este endereço público já está em uso.')
    if (await tx.tenant.count({ where: { slug, id: { not: tenantId } } })) throw new AgendaError('Este endereço público já está em uso.')
    if (reserved) await tx.tenantAlias.delete({ where: { slug } })
    await tx.tenantAlias.create({ data: { slug: tenant.slug, tenantId } })
    await tx.tenant.update({ where: { id: tenantId }, data: { slug } })
  })
}
