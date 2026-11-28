import { DateTime } from 'luxon'
import { db } from './db'
import { ledgerScope } from './stripe-ledger'

type Period = { gte: Date; lt: Date }
type Component = 'revenue' | 'refunds' | 'cost' | 'commissions' | 'taxes' | 'expenses' | 'fees' | 'purchases' | 'missingCosts' | 'missingFees' | 'unclassifiedOrders'
type Totals = Record<Component, number>
const within = (date: Date | null, period: Period) => date && date >= period.gte && date < period.lt
const empty = (): Totals => ({ revenue: 0, refunds: 0, cost: 0, commissions: 0, taxes: 0, expenses: 0, fees: 0, purchases: 0, missingCosts: 0, missingFees: 0, unclassifiedOrders: 0 })

export async function professionalResult(tenant: { id: string; timezone: string; stripeAccountId: string | null }, period: Period, accrual: boolean) {
  const { id: tenantId, timezone } = tenant
  const [entries, localSales, orders, booked, commissions, refunds, oldOrders, oldAppointments, restoredStock, scope] = await Promise.all([
    db.financialEntry.findMany({ where: { tenantId, ...(accrual ? { dueAt: period } : { paidAt: period }) }, include: { purchase: { select: { id: true } } } }),
    db.stockMovement.findMany({ where: { tenantId, kind: { in: ['SALE', 'REVERSAL'] }, createdAt: period } }),
    db.shopOrder.findMany({ where: { tenantId, paidAt: period }, include: { items: true } }),
    db.appointment.findMany({ where: { tenantId, OR: [{ paidAt: period }, { endsAt: period, status: 'COMPLETED' }] } }),
    db.professionalCommission.findMany({ where: {
      appointment: { tenantId, ...(accrual ? { endsAt: period } : {}) }, ...(accrual ? {} : { paidAt: period })
    }, include: { appointment: { select: { endsAt: true } } } }),
    db.connectedRefund.findMany({ where: { succeededAt: period, state: 'succeeded', OR: [{ appointment: { tenantId } }, { order: { tenantId } }] },
      include: { appointment: { select: { status: true } }, order: { select: { recognizedSale: true } } }
    }),
    db.shopOrder.findMany({ where: { tenantId, refundedAt: period, connectedRefunds: { none: { state: 'succeeded' } } } }),
    db.appointment.findMany({ where: { tenantId, refundedAt: period, connectedRefunds: { none: { state: 'succeeded' } } } }),
    accrual ? db.shopOrder.findMany({ where: { tenantId, stockReturnedAt: period }, include: { items: true } }) : [],
    ledgerScope(false, tenant.stripeAccountId).catch(() => null)
  ])
  const totals = empty()
  const days = new Map<string, Totals>()
  function add(date: Date | null, component: Component, value: number) {
    if (!date || !value || !within(date, period)) return
    const key = DateTime.fromJSDate(date, { zone: timezone }).toISODate()!
    const daily = days.get(key) ?? empty()
    daily[component] += value
    totals[component] += value
    days.set(key, daily)
  }
  for (const entry of entries) {
    const date = accrual ? entry.dueAt : entry.paidAt
    if (entry.purchase) {
      if (!accrual) add(date, 'purchases', entry.cents)
    } else {
      const bucket = entry.kind === 'INCOME' ? 'revenue' : entry.classification === 'TAX' ? 'taxes' : 'expenses'
      add(date, bucket, entry.cents)
    }
  }
  for (const sale of localSales) {
    add(sale.createdAt, sale.kind === 'REVERSAL' ? 'refunds' : 'revenue', Math.abs(sale.quantity) * sale.unitCents)
    if (accrual) {
      if (sale.unitCostCents) add(sale.createdAt, 'cost', -sale.quantity * sale.unitCostCents)
      else add(sale.createdAt, 'missingCosts', 1)
    }
  }
  for (const order of orders) {
    if (accrual && order.recognizedSale !== true) {
      if (order.recognizedSale === null) add(order.paidAt, 'unclassifiedOrders', 1)
      continue
    }
    add(order.paidAt, 'revenue', order.cents)
    if (accrual) for (const item of order.items) {
      if (item.unitCostCents) add(order.paidAt, 'cost', item.unitCostCents * item.quantity)
      else add(order.paidAt, 'missingCosts', 1)
    }
  }
  for (const order of restoredStock) for (const item of order.items) {
    if (item.unitCostCents) add(order.stockReturnedAt, 'cost', -item.unitCostCents * item.quantity)
    else add(order.stockReturnedAt, 'missingCosts', 1)
  }
  for (const booking of booked) {
    if (accrual && booking.status === 'COMPLETED') add(booking.endsAt, 'revenue', booking.cents)
    else if (!accrual && booking.paidAt) add(booking.paidAt, 'revenue', booking.chargeCents ?? booking.cents)
  }
  for (const refund of refunds) if (!accrual || refund.appointment?.status === 'COMPLETED' || refund.order?.recognizedSale === true) {
    add(refund.succeededAt, 'refunds', refund.amount)
  }
  for (const order of oldOrders) if (!accrual || order.recognizedSale === true) add(order.refundedAt, 'refunds', order.cents)
  for (const item of oldAppointments) if (!accrual || item.status === 'COMPLETED') add(item.refundedAt, 'refunds', item.chargeCents ?? item.cents)
  for (const item of commissions) add(accrual ? item.appointment.endsAt : item.paidAt, 'commissions', item.cents)

  const payments = [...orders, ...booked].filter(item => item.paymentIntentId && within(item.paidAt, period))
  const recorded = scope && payments.length ? await db.stripeMovement.findMany({
    where: { scope, currency: 'brl', category: { in: ['charge', 'payment'] }, intentId: { in: payments.map(row => row.paymentIntentId!) } },
    orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }], distinct: ['stripeId']
  }) : []
  for (const payment of payments) {
    const matching = recorded.filter(item => item.intentId === payment.paymentIntentId)
    if (!matching.length) add(payment.paidAt, 'missingFees', 1)
    else add(payment.paidAt, 'fees', matching.reduce((sum, row) => sum + row.fee, 0))
  }
  return { totals, days: [...days.entries()].sort(([a], [b]) => b.localeCompare(a)) }
}

export function operatingResult(totals: Totals) {
  return totals.revenue - totals.refunds - totals.cost - totals.commissions - totals.taxes - totals.expenses - totals.fees - totals.purchases
}
