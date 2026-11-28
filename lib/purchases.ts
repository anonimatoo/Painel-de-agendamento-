import { AgendaError } from './agenda'
import { db } from './db'

export async function receivePurchase(input: {
  tenantId: string; supplierId: string; productId: string; quantity: number; unitCostCents: number; reference: string; requestId: string; dueAt: Date
}) {
  const { tenantId, supplierId, productId, quantity, unitCostCents, reference, requestId, dueAt } = input
  const total = quantity * unitCostCents
  if (!Number.isInteger(quantity) || quantity < 1 || !Number.isInteger(unitCostCents) || unitCostCents < 1 || total > 100_000_000) {
    throw new AgendaError('Confira a quantidade e o custo da compra.')
  }
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`
    if (!await tx.tenant.count({ where: { id: tenantId, active: true, suspended: false } })) throw new AgendaError('Estabelecimento indisponível.')
    const previous = await tx.purchase.findUnique({ where: { tenantId_requestId: { tenantId, requestId } }, include: { expense: true } })
    if (previous) {
      if (previous.supplierId !== supplierId || previous.productId !== productId ||
          previous.quantity !== quantity || previous.unitCostCents !== unitCostCents ||
          previous.reference !== reference || +previous.expense.dueAt !== +dueAt) {
        throw new AgendaError('Esta solicitação já foi utilizada.')
      }
      return previous
    }
    const supplier = await tx.supplier.findUnique({ where: { tenantId_id: { tenantId, id: supplierId } } })
    if (!supplier) throw new AgendaError('Fornecedor indisponível.')
    await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${productId} AND "tenantId" = ${tenantId} FOR UPDATE`
    const product = await tx.product.findFirst({ where: { id: productId, tenantId, archivedAt: null } })
    if (!product || product.stock + quantity > 1_000_000) throw new AgendaError('Confira o produto e o saldo de estoque.')
    const costCents = Math.round((product.costCents * product.stock + total) / (product.stock + quantity))
    const expense = await tx.financialEntry.create({
      data: { tenantId, kind: 'EXPENSE', title: 'Compra de estoque · ' + supplier.name, cents: total, dueAt }
    })
    const purchase = await tx.purchase.create({
      data: { tenantId, supplierId, productId, quantity, unitCostCents, reference, requestId, expenseId: expense.id }, include: { expense: true }
    })
    await tx.product.update({ where: { tenantId_id: { tenantId, id: productId } }, data: { stock: { increment: quantity }, costCents } })
    await tx.stockMovement.create({ data: { tenantId, productId, kind: 'ADJUSTMENT', quantity, unitCostCents, requestId: 'purchase:' + purchase.id } })
    return purchase
  })
}
