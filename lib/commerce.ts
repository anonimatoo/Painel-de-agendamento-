import { DateTime } from 'luxon'
import { AgendaError } from './agenda'
import { db } from './db'

export async function changeStock(input: { tenantId: string; productId: string; quantity: number; requestId: string; sale: boolean }) {
  const { tenantId, productId, requestId, sale } = input
  const quantity = sale ? -Math.abs(input.quantity) : input.quantity
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${productId} AND "tenantId" = ${tenantId} FOR UPDATE`
    const prior = await tx.stockMovement.findUnique({ where: { tenantId_requestId: { tenantId, requestId } } })
    if (prior) {
      if (prior.productId !== productId || prior.quantity !== quantity || prior.kind !== (sale ? 'SALE' : 'ADJUSTMENT')) throw new AgendaError('Esta operação já foi utilizada.')
      return prior
    }
    const product = await tx.product.findUnique({ where: { tenantId_id: { tenantId, id: productId } } })
    if (!product) throw new AgendaError('Produto indisponível.')
    if (product.stock + quantity < 0 || product.stock + quantity > 1_000_000) throw new AgendaError('Quantidade incompatível com o estoque disponível.')
    await tx.product.update({ where: { tenantId_id: { tenantId, id: productId } }, data: { stock: { increment: quantity } } })
    return tx.stockMovement.create({ data: {
      tenantId, productId, requestId, quantity, kind: sale ? 'SALE' : 'ADJUSTMENT',
      unitCents: sale ? product.promotionCents ?? product.cents : 0,
      unitCostCents: sale ? product.costCents : 0
    } })
  })
}

export async function reverseSale(tenantId: string, id: string) {
  await db.$transaction(async tx => {
    const sale = await tx.stockMovement.findFirst({ where: { tenantId, id, kind: 'SALE' } })
    if (!sale) throw new AgendaError('Venda indisponível.')
    const changed = await tx.stockMovement.updateMany({ where: { tenantId, id, reversedAt: null }, data: { reversedAt: new Date() } })
    if (!changed.count) return
    const quantity = -sale.quantity
    await tx.product.update({ where: { tenantId_id: { tenantId, id: sale.productId } }, data: { stock: { increment: quantity } } })
    await tx.stockMovement.create({ data: {
      tenantId, productId: sale.productId, kind: 'REVERSAL', quantity,
      unitCents: sale.unitCents, unitCostCents: sale.unitCostCents, requestId: 'reversal:' + id
    } })
  })
}

export async function cashReport(tenantId: string, zone: string) {
  const start = DateTime.now().setZone(zone).startOf('month')
  const period = { gte: start.toJSDate(), lt: start.plus({ months: 1 }).toJSDate() }
  const [entries, movements, payments, refunds, orders, orderRefunds] = await Promise.all([
    db.financialEntry.findMany({ where: { tenantId, OR: [{ dueAt: period }, { paidAt: period }, { paidAt: null }] } }),
    db.stockMovement.findMany({ where: { tenantId, kind: { in: ['SALE', 'REVERSAL'] }, createdAt: period }, include: { product: { select: { name: true } } } }),
    db.appointment.findMany({ where: { tenantId, paidAt: period }, select: { paidAt: true, chargeCents: true, cents: true } }),
    db.appointment.findMany({ where: { tenantId, refundedAt: period }, select: { refundedAt: true, chargeCents: true, cents: true } }),
    db.shopOrder.findMany({ where: { tenantId, paidAt: period }, select: { paidAt: true, cents: true } }),
    db.shopOrder.findMany({ where: { tenantId, refundedAt: period }, select: { refundedAt: true, cents: true } })
  ])
  const rows = [
    ...entries.filter(entry => entry.paidAt && entry.paidAt >= period.gte && entry.paidAt < period.lt)
      .map(entry => ({ date: entry.paidAt!, title: entry.title, cents: entry.kind === 'INCOME' ? entry.cents : -entry.cents })),
    ...movements.map(movement => ({ date: movement.createdAt, title: (movement.kind === 'SALE' ? 'Venda presencial · ' : 'Estorno presencial · ') + movement.product.name, cents: -movement.quantity * movement.unitCents })),
    ...orderRefunds.map(order => ({ date: order.refundedAt!, title: 'Estorno de pedido online', cents: -order.cents })),
    ...orders.map(order => ({ date: order.paidAt!, title: 'Pedido online', cents: order.cents })),
    ...payments.map(payment => ({ date: payment.paidAt!, title: 'Pagamento de agendamento', cents: payment.chargeCents ?? payment.cents })),
    ...refunds.map(refund => ({ date: refund.refundedAt!, title: 'Estorno de agendamento', cents: -(refund.chargeCents ?? refund.cents) }))
  ].sort((first, second) => +second.date - +first.date)
  return { entries, rows }
}

export function exportCashCsv(rows: Awaited<ReturnType<typeof cashReport>>['rows'], zone: string) {
  const quote = (cell: string) => '"' + (/^[\s]*[=+@\-\t\r]/.test(cell) ? "'" : '') + cell.replace(/"/g, '""') + '"'
  return '\ufeffData;Descrição;Valor (R$)\r\n' + rows.map(row => [
    DateTime.fromJSDate(row.date, { zone }).toISODate(),
    quote(row.title),
    (row.cents / 100).toFixed(2).replace('.', ',')
  ].join(';')).join('\r\n')
}
