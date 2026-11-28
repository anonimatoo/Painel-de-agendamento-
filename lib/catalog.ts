import { randomUUID } from 'node:crypto'
import { db } from './db'
import { AgendaError } from './agenda'

export function parseReais(input: string) {
  const text = input.trim().replace(/^R\$\s*/, '')
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(text)) {
    throw new AgendaError('Informe um valor em reais, como 49,90.')
  }
  const [reais, centavos = ''] = text.split(',')
  const value = Number(reais.replaceAll('.', '')) * 100 + Number(centavos.padEnd(2, '0'))
  if (!Number.isSafeInteger(value) || value > 100_000_000) throw new AgendaError('O valor excede o limite do catálogo.')
  return value
}

export type ProductDetails = {
  name: string; sku: string | null; barcode?: string | null; category: string; description: string; cents: number; costCents: number;
  promotionCents: number | null; minimumStock: number; published: boolean
}

export async function saveCatalogProduct(tenantId: string, details: ProductDetails, options: {
  id?: string; parentId?: string; stock?: number; expectedStock?: number
}) {
  if (details.promotionCents !== null && (details.promotionCents < 1 || details.promotionCents > details.cents)) {
    throw new AgendaError('O preço promocional deve ser positivo e menor ou igual ao preço normal.')
  }
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { active: true, suspended: true } })
    if (!tenant || tenant.suspended) throw new AgendaError('Estabelecimento indisponível.')
    const values = { ...details, published: tenant.active && details.published }
    const { id, parentId, stock, expectedStock } = options
    if (id) {
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`
      const existing = await tx.product.findUnique({ where: { tenantId_id: { tenantId, id } } })
      if (!existing) throw new AgendaError('Produto indisponível.')
      if (existing.archivedAt) throw new AgendaError('Restaure o produto antes de editar.')
      const delta = stock === undefined ? 0 : stock - (expectedStock ?? existing.stock)
      if (delta && existing.stock !== expectedStock) {
        throw new AgendaError('O estoque mudou enquanto você editava. Consulte o saldo atual antes de ajustar novamente.')
      }
      const saved = await tx.product.update({ where: { tenantId_id: { tenantId, id } }, data: {
        ...values, stock: delta ? { increment: delta } : undefined
      } })
      if (delta) await tx.stockMovement.create({
        data: { tenantId, productId: id, quantity: delta, kind: 'ADJUSTMENT', requestId: randomUUID() }
      })
      return saved
    }
    if (parentId) {
      const parent = await tx.product.findFirst({ where: { tenantId, id: parentId, archivedAt: null, variantOfId: null } })
      if (!parent) throw new AgendaError('O produto principal está indisponível.')
    }
    const created = await tx.product.create({ data: { ...values, tenantId, stock: stock ?? 0, variantOfId: parentId } })
    if (stock) await tx.stockMovement.create({
      data: { tenantId, productId: created.id, quantity: stock, kind: 'ADJUSTMENT', requestId: randomUUID() }
    })
    return created
  })
}

export async function renameCatalogCategory(tenantId: string, name: string, oldName?: string) {
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`
    if (oldName && oldName !== name) {
      const products = await tx.product.updateMany({ where: { tenantId, category: oldName }, data: { category: name } })
      const services = await tx.service.updateMany({ where: { tenantId, category: oldName }, data: { category: name } })
      const categories = await tx.catalogCategory.deleteMany({ where: { tenantId, name: oldName } })
      if (!products.count && !services.count && !categories.count) throw new AgendaError('Categoria indisponível.')
    }
    await tx.catalogCategory.upsert({ where: { tenantId_name: { tenantId, name } }, create: { tenantId, name }, update: {} })
  })
}
