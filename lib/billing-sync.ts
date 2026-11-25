import type Stripe from 'stripe'
import type { Prisma } from '@prisma/client'
import { db } from './db'

export async function updateInvoice(tx: Prisma.TransactionClient, tenantId: string, invoice: Stripe.Invoice) {
  if (!invoice.id) return
  const data = {
    tenantId, status: invoice.status ?? 'draft', currency: invoice.currency,
    amountDue: invoice.amount_due, amountPaid: invoice.amount_paid,
    hostedUrl: invoice.hosted_invoice_url ?? null, issuedAt: new Date(invoice.created * 1000)
  }
  await tx.billingInvoice.upsert({ where: { id: invoice.id }, update: data, create: { id: invoice.id, ...data } })
}

export async function updateSubscription(tx: Prisma.TransactionClient, tenantId: string, subscription: Stripe.Subscription) {
  const prices = subscription.items.data.map(item => item.price.id)
  const plan = await tx.plan.findFirst({ where: { OR: [{ monthlyPriceId: { in: prices } }, { annualPriceId: { in: prices } }] } })
  if (plan) {
    await tx.subscription.upsert({
      where: { id: subscription.id }, update: { status: subscription.status, planId: plan.id },
      create: { id: subscription.id, status: subscription.status, planId: plan.id, tenantId }
    })
  } else {
    await tx.subscription.updateMany({ where: { id: subscription.id, tenantId }, data: { status: 'unmapped_plan' } })
  }
}

export async function refreshAccess(tx: Prisma.TransactionClient, tenantId: string) {
  const active = await tx.subscription.count({ where: { tenantId, status: { in: ['active', 'trialing'] } } })
  await tx.tenant.update({ where: { id: tenantId }, data: { active: active > 0 } })
}

export async function reconcileBilling(api: Stripe) {
  const due = new Date(Date.now() - 60 * 60_000)
  const tenants = await db.tenant.findMany({
    where: { stripeCustomerId: { not: null }, OR: [{ billingSyncAt: null }, { billingSyncAt: { lt: due } }] },
    take: 5, orderBy: [{ billingSyncAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }]
  })
  for (const tenant of tenants) {
    const customer = tenant.stripeCustomerId!
    try {
      await db.$transaction(async tx => {
        const claimed = await tx.tenant.updateMany({
          where: { id: tenant.id, stripeCustomerId: customer, billingSyncAt: tenant.billingSyncAt },
          data: { billingSyncAt: new Date() }
        })
        if (!claimed.count) return
        const observed = []
        for await (const subscription of api.subscriptions.list({ customer, status: 'all', limit: 100 })) {
          observed.push(subscription.id)
          await updateSubscription(tx, tenant.id, subscription)
        }
        await tx.subscription.updateMany({ where: { tenantId: tenant.id, id: { notIn: observed } }, data: { status: 'missing' } })
        const invoices = await api.invoices.list({ customer, limit: 24 })
        for (const invoice of invoices.data) await updateInvoice(tx, tenant.id, invoice)
        await refreshAccess(tx, tenant.id)
      }, { timeout: 40_000 })
    } catch {
      // Move a failing tenant behind healthy candidates while preserving existing financial state.
      await db.tenant.updateMany({
        where: { id: tenant.id, stripeCustomerId: customer, billingSyncAt: tenant.billingSyncAt },
        data: { billingSyncAt: new Date(+due + 5 * 60_000) }
      })
      console.error('billing-reconciliation', tenant.id)
    }
  }
}
