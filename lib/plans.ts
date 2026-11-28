import type Stripe from 'stripe'
import { db } from './db'
import { AgendaError } from './agenda'

type PlanInput = { name: string; description: string; monthlyCents: number; annualCents: number; trialDays: number }

async function versionPrice(api: Stripe, product: string, amount: number, interval: 'month' | 'year', key: string) {
  const price = await api.prices.create({ product, unit_amount: amount, currency: 'brl', recurring: { interval } }, { idempotencyKey: key })
  return price.id
}

export async function savePlan(
  actorId: string, planId: string, data: PlanInput, edit: boolean, getApi: () => Promise<Stripe>
) {
  const current = await db.plan.findUnique({ where: { id: planId } })
  if (edit && !current) throw new AgendaError('Plano indisponível.')
  if (!edit && current) {
    if (Object.entries(data).every(([key, value]) => current[key as keyof PlanInput] === value)) return
    throw new AgendaError('Atualize o formulário antes de criar outro plano.')
  }

  const monthlyChanged = current?.monthlyCents !== data.monthlyCents
  const annualChanged = current?.annualCents !== data.annualCents
  let monthly = current?.monthlyPriceId
  let annual = current?.annualPriceId
  if (monthlyChanged || annualChanged) {
    const api = await getApi()
    const product = current
      ? await api.prices.retrieve(current.monthlyPriceId).then(price => typeof price.product === 'string' ? price.product : price.product.id)
      : await api.products.create({ name: data.name, description: data.description }, { idempotencyKey: 'plan-product:' + planId }).then(item => item.id)
    if (monthlyChanged) monthly = await versionPrice(api, product, data.monthlyCents, 'month', ['plan', planId, monthly ?? 'new', data.monthlyCents].join(':'))
    if (annualChanged) annual = await versionPrice(api, product, data.annualCents, 'year', ['plan', planId, annual ?? 'new', data.annualCents].join(':'))
  }
  if (!monthly || !annual) throw new Error('Preços não retornados')
  await db.$transaction(async tx => {
    if (current) {
      const changed = await tx.plan.updateMany({
        where: { id: planId, monthlyPriceId: current.monthlyPriceId, annualPriceId: current.annualPriceId,
          name: current.name, description: current.description, trialDays: current.trialDays },
        data: { ...data, monthlyPriceId: monthly, annualPriceId: annual }
      })
      if (!changed.count) throw new AgendaError('O plano foi alterado. Atualize a página.')
      const replaced = [monthlyChanged ? current.monthlyPriceId : null, annualChanged ? current.annualPriceId : null]
        .flatMap(priceId => priceId ? [{ priceId, planId }] : [])
      if (replaced.length) await tx.planPriceHistory.createMany({ data: replaced, skipDuplicates: true })
    } else {
      await tx.plan.create({ data: { id: planId, ...data, monthlyPriceId: monthly!, annualPriceId: annual! } })
    }
    await tx.adminAudit.create({ data: { actorId, targetId: planId, action: current ? 'PLAN_UPDATED' : 'PLAN_CREATED' } })
  })
}

export async function changePlanAvailability(actorId: string, id: string, active: boolean) {
  await db.$transaction(async tx => {
    const changed = await tx.plan.updateMany({ where: { id, active: !active }, data: { active } })
    if (changed.count) await tx.adminAudit.create({ data: { actorId, targetId: id, action: active ? 'PLAN_ACTIVATED' : 'PLAN_DEACTIVATED' } })
  })
}
