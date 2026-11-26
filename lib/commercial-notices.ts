import type { Prisma } from '@prisma/client'
import { DateTime } from 'luxon'
import type Stripe from 'stripe'
import { existingCheckoutForNotice } from './billing'
import { db } from './db'
import { mailConfigured, sendEmail } from './mail'
import { commercialLabels, type CommercialKind } from './commercial-rules'

const zone = 'America/Sao_Paulo'
const requiresOpen = new Set(['DUE_7', 'DUE_3', 'DUE_1', 'DECLINED', 'OVERDUE'])
type Trigger = {
  tenantId: string; kind: CommercialKind; reference: string; dueAt?: Date; invoiceId?: string
  subscriptionId?: string; planName?: string; cents?: number; scheduled?: boolean
}

export async function enqueueCommercial(tx: Prisma.TransactionClient, input: Trigger, now = new Date()) {
  const rule = await tx.commercialRule.findUnique({ where: { kind: input.kind } })
  if (!rule?.enabled) return
  const referenceDate = DateTime.fromJSDate(input.scheduled && input.dueAt ? input.dueAt : now, { zone })
  let sendAt = referenceDate.startOf('day').set({ hour: rule.hour })
  if (input.scheduled) {
    sendAt = sendAt.minus({ days: rule.leadDays })
    if (+sendAt < +now - 24 * 60 * 60_000) return
  } else if (+sendAt < +now) sendAt = sendAt.plus({ days: 1 })
  const { scheduled: _scheduled, ...values } = input
  await tx.commercialNotice.createMany({ data: { ...values, sendAt: sendAt.toJSDate() }, skipDuplicates: true })
}

export async function enqueueInvoiceNotices(tx: Prisma.TransactionClient, tenantId: string, invoice: Stripe.Invoice, event?: string) {
  if (!invoice.id || invoice.currency !== 'brl') return
  const due = invoice.due_date ?? invoice.next_payment_attempt
  const base = {
    tenantId, invoiceId: invoice.id, reference: invoice.id, cents: invoice.amount_remaining,
    dueAt: due ? new Date(due * 1000) : undefined
  }
  if (invoice.status === 'paid') {
    await tx.commercialNotice.updateMany({
      where: { tenantId, invoiceId: invoice.id, state: 'QUEUED', kind: { in: [...requiresOpen] } }, data: { state: 'CANCELED' }
    })
    const paidAt = invoice.status_transitions?.paid_at
    if (paidAt && Date.now() - paidAt * 1000 < 48 * 60 * 60_000) {
      await enqueueCommercial(tx, { ...base, kind: 'PAID', cents: invoice.amount_paid })
    }
  }
  if (invoice.status !== 'open' || !invoice.amount_remaining) return
  if (event === 'invoice.payment_failed') await enqueueCommercial(tx, { ...base, kind: 'DECLINED' })
  if (!base.dueAt) return
  if (+base.dueAt <= Date.now()) await enqueueCommercial(tx, { ...base, kind: 'OVERDUE' })
  else for (const kind of ['DUE_7', 'DUE_3', 'DUE_1'] as const) {
    await enqueueCommercial(tx, { ...base, kind, scheduled: true })
  }
}

export async function enqueueSubscriptionNotices(tx: Prisma.TransactionClient, tenantId: string, subscription: Stripe.Subscription, planName: string) {
  const line = subscription.items.data[0]
  const cents = line?.price.currency === 'brl' ? line.price.unit_amount ?? undefined : undefined
  const base = { tenantId, subscriptionId: subscription.id, reference: subscription.id, planName, cents }
  if (['active', 'trialing'].includes(subscription.status) && Date.now() - subscription.created * 1000 < 48 * 60 * 60_000) await enqueueCommercial(tx, { ...base, kind: 'SUBSCRIBED' })
  if (['canceled', 'incomplete_expired'].includes(subscription.status) && subscription.ended_at && Date.now() - subscription.ended_at * 1000 < 48 * 60 * 60_000) await enqueueCommercial(tx, { ...base, kind: 'CANCELED' })
  if (subscription.status === 'trialing' && subscription.trial_end) await enqueueCommercial(tx, {
    ...base, kind: 'TRIAL_END', dueAt: new Date(subscription.trial_end * 1000), scheduled: true
  })
  if (subscription.status === 'active' && !subscription.cancel_at_period_end && line?.current_period_end) {
    await enqueueCommercial(tx, { ...base, kind: 'RENEWAL', reference: subscription.id + ':' + line.current_period_end,
      dueAt: new Date(line.current_period_end * 1000), scheduled: true })
    if (line.price.recurring?.interval === 'year') await enqueueCommercial(tx, {
      ...base, kind: 'ANNUAL', reference: subscription.id + ':' + line.current_period_end,
      dueAt: new Date(line.current_period_end * 1000), scheduled: true
    })
  }
}

export function hostedInvoiceLink(value?: string | null) {
  if (!value) return undefined
  const link = URL.parse(value)
  if (link?.protocol === 'https:' && link.hostname === 'invoice.stripe.com' && !link.username && !link.password && !link.port) return link.href
}

export async function dispatchCommercial(api: () => Promise<Stripe>, now = new Date()) {
  if (!mailConfigured()) return
  await db.commercialNotice.updateMany({
    where: { state: 'SENDING', claimedAt: { lt: new Date(+now - 5 * 60_000) } }, data: { state: 'REVIEW' }
  })
  const due = await db.commercialNotice.findMany({ where: { state: 'QUEUED', sendAt: { lte: now } }, take: 20, orderBy: { sendAt: 'asc' } })
  for (const notice of due) {
    const claim = await db.commercialNotice.updateMany({
      where: { id: notice.id, state: 'QUEUED' }, data: { state: 'SENDING', claimedAt: now, attempts: { increment: 1 } }
    })
    if (!claim.count) continue
    const where = { id: notice.id, state: 'SENDING' }
    let submitting = false
    try {
      const rule = await db.commercialRule.findUnique({ where: { kind: notice.kind } })
      const tenant = await db.tenant.findUnique({
        where: { id: notice.tenantId }, include: { members: {
          where: { role: 'ADMIN', disabledAt: null, user: { emailVerifiedAt: { not: null } } }, orderBy: { userId: 'asc' }, take: 1,
          include: { user: { select: { email: true } } }
        } }
      })
      let valid = Boolean(rule?.enabled && tenant?.members.length && +now - +notice.sendAt < 48 * 60 * 60_000)
      let cents = notice.cents
      let link: string | undefined
      let planName = notice.planName
      if (valid && notice.invoiceId) {
        const invoice = await (await api()).invoices.retrieve(notice.invoiceId)
        const customer = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id
        valid = customer === tenant?.stripeCustomerId && (requiresOpen.has(notice.kind)
          ? invoice.status === 'open' && invoice.amount_remaining > 0
          : invoice.status === 'paid')
        cents = notice.kind === 'PAID' ? invoice.amount_paid : invoice.amount_remaining
        if (requiresOpen.has(notice.kind)) link = hostedInvoiceLink(invoice.hosted_invoice_url)
        const subscription = invoice.parent?.subscription_details?.subscription
        const subscriptionId = typeof subscription === 'string' ? subscription : subscription?.id
        if (subscriptionId) {
          const record = await db.subscription.findFirst({ where: { id: subscriptionId, tenantId: notice.tenantId }, include: { plan: true } })
          planName = record?.plan.name ?? planName
        }
      }
      if (valid && notice.subscriptionId) {
        const subscription = await (await api()).subscriptions.retrieve(notice.subscriptionId)
        const customer = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id
        valid = customer === tenant?.stripeCustomerId && (
          notice.kind === 'CANCELED' ? ['canceled', 'incomplete_expired'].includes(subscription.status)
            : notice.kind === 'TRIAL_END' ? subscription.status === 'trialing'
              : notice.kind === 'SUBSCRIBED' ? ['active', 'trialing'].includes(subscription.status)
                : subscription.status === 'active' && !subscription.cancel_at_period_end &&
                  subscription.items.data[0]?.current_period_end === (notice.dueAt ? +notice.dueAt / 1000 : 0)
        )
      }
      if (valid && notice.kind === 'WELCOME' && tenant?.stripeCustomerId && !tenant.active && !tenant.suspended) {
        const checkout = await existingCheckoutForNotice(await api(), tenant.stripeCustomerId)
        if (checkout?.url) {
          link = checkout.url
          const attempt = await db.billingCheckout.findUnique({ where: { tenantId: notice.tenantId } })
          const plan = attempt ? await db.plan.findFirst({
            where: { OR: [{ monthlyPriceId: attempt.priceId }, { annualPriceId: attempt.priceId }] }
          }) : null
          planName = plan?.name ?? planName
          cents = checkout.amount_total ?? cents
        }
      }
      if (valid && notice.kind === 'SUSPENDED') valid = Boolean(tenant?.suspended)
      if (valid && notice.kind === 'REACTIVATED') valid = !tenant?.suspended
      if (!valid || !rule || !tenant) {
        await db.commercialNotice.updateMany({ where, data: { state: 'CANCELED' } })
        continue
      }
      const label = commercialLabels[notice.kind as CommercialKind]
      const details = [
        planName && 'Plano: ' + planName,
        cents === null ? null : 'Valor: ' + Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100),
        notice.dueAt && 'Data: ' + DateTime.fromJSDate(notice.dueAt, { zone }).toFormat('dd/LL/yyyy'),
        link && (notice.kind === 'WELCOME' ? 'Contratação Stripe: ' : 'Fatura Stripe: ') + link
      ].filter(Boolean).join('\n')
      const values: Record<string,string> = { evento: label, estabelecimento: tenant.name, detalhes: details }
      const text = rule.template.replace(/\{(evento|estabelecimento|detalhes)\}/g, (_, key) => values[key])
      submitting = true
      await sendEmail({ to: tenant.members[0].user.email, subject: label + ' · CS Agenda Pro', text, key: 'commercial/' + notice.id })
      await db.commercialNotice.updateMany({ where, data: { state: 'SENT' } })
    } catch {
      const retry = !submitting && notice.attempts < 3
      await db.commercialNotice.updateMany({ where, data: {
        state: submitting ? 'REVIEW' : retry ? 'QUEUED' : 'FAILED',
        sendAt: retry ? new Date(+now + 60_000 * 2 ** notice.attempts) : notice.sendAt
      } })
    }
  }
}
