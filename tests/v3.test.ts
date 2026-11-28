import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, test } from 'node:test'
import { DateTime } from 'luxon'
import type Stripe from 'stripe'
import { availability, book, blockSchedule, closeAppointment, removeWorkHours, saveWorkHours } from '../lib/agenda'
import { updateSubscription } from '../lib/billing-sync'
import { db } from '../lib/db'
import { applyConnectedRefund, processAppointmentRefunds, requestConsumerRefund } from '../lib/connected-refunds'
import { changePlanAvailability, savePlan } from '../lib/plans'
import { applyEvent } from '../lib/stripe'
import { notifyWaitList } from '../lib/waitlist'

after(() => db.$disconnect())

test('versionar preço e desativar plano preserva faturamento e vínculo do assinante atual', async () => {
  const planId = randomUUID()
  const owner = await db.user.create({ data: { email: planId + '@example.test' } })
  const tenant = await db.tenant.create({ data: { slug: planId, name: 'Assinatura teste' } })
  const input = { name: 'Plano de teste', description: 'Fixture', monthlyCents: 6000, annualCents: 60000, trialDays: 0 }
  const calls: string[] = []
  const api = {
    products: { create: async () => ({ id: 'prod_' + planId }) },
    prices: {
      create: async (data: Stripe.PriceCreateParams, options: { idempotencyKey: string }) => {
        calls.push(options.idempotencyKey)
        return { id: 'price_' + planId + '_' + data.unit_amount }
      },
      retrieve: async () => ({ product: 'prod_' + planId })
    }
  } as unknown as Stripe
  try {
    await savePlan(owner.id, planId, input, false, async () => api)
    await savePlan(owner.id, planId, input, false, async () => api)
    const old = await db.plan.findUniqueOrThrow({ where: { id: planId } })
    await savePlan(owner.id, planId, { ...input, monthlyCents: 6500 }, true, async () => api)
    await changePlanAvailability(owner.id, planId, false)
    const current = await db.plan.findUniqueOrThrow({ where: { id: planId } })
    assert.equal(current.active, false)
    assert.equal(current.annualPriceId, old.annualPriceId)
    assert.notEqual(current.monthlyPriceId, old.monthlyPriceId)
    assert.equal(new Set(calls).size, 3)
    const snapshot = { id: 'sub_' + planId, status: 'active', items: { data: [{ quantity: 1,
      price: { id: old.monthlyPriceId, currency: 'brl', unit_amount: 6000, recurring: { interval: 'month', interval_count: 1 } } }] } } as unknown as Stripe.Subscription
    await db.$transaction(tx => updateSubscription(tx, tenant.id, snapshot))
    const billing = await db.subscription.findUniqueOrThrow({ where: { id: snapshot.id } })
    assert.equal(billing.planId, planId)
    assert.equal(billing.recurringCents, 6000)
    assert.equal(await db.adminAudit.count({ where: { actorId: owner.id } }), 3)
  } finally {
    await db.subscription.deleteMany({ where: { tenantId: tenant.id } })
    await db.commercialNotice.deleteMany({ where: { tenantId: tenant.id } })
    await db.planPriceHistory.deleteMany({ where: { planId } })
    await db.plan.deleteMany({ where: { id: planId } })
    await db.adminAudit.deleteMany({ where: { actorId: owner.id } })
    await db.tenant.delete({ where: { id: tenant.id } })
    await db.user.delete({ where: { id: owner.id } })
  }
})

async function scenario() {
  const reference = randomUUID()
  const tenant = await db.tenant.create({ data: {
    name: 'Estabelecimento fixture', slug: reference, active: true, stripeAccountId: 'acct_' + reference,
    automaticAppointmentRefunds: true, whatsappInstance: 'wa-' + reference, consumerNoticeHours: 1
  } })
  const user = await db.user.create({ data: {
    email: reference + '@example.test', consumerProfiles: { create: { tenantId: tenant.id, name: 'Cliente fixture', phone: '5511999991234' } }
  } })
  const service = await db.service.create({ data: { tenantId: tenant.id, name: 'Atendimento teste', duration: 45, cents: 8000 } })
  const professional = await db.professional.create({ data: { tenantId: tenant.id, name: 'Profissional teste' } })
  const day = DateTime.now().setZone(tenant.timezone).plus({ days: 2 })
  const scope = { tenantId: tenant.id, serviceId: service.id, professionalId: professional.id }
  await db.assignment.create({ data: scope })
  await db.workHours.create({ data: { tenantId: tenant.id, professionalId: professional.id, weekday: day.weekday, startMinute: 540, endMinute: 585 } })
  const slots = await availability(tenant, service.id, professional.id, day.toISODate()!)
  return {
    tenant, user, scope, day: day.toISODate()!, slot: slots[0].start,
    clean: async () => {
      const tenantId = tenant.id
      await db.$transaction([
        db.connectedRefund.deleteMany({ where: { appointment: { tenantId } } }),
        db.reminder.deleteMany({ where: { appointment: { tenantId } } }),
        db.appointment.deleteMany({ where: { tenantId } }),
        db.waitEntry.deleteMany({ where: { tenantId } }),
        db.customer.deleteMany({ where: { tenantId } }),
        db.assignment.deleteMany({ where: { tenantId } }),
        db.scheduleBlock.deleteMany({ where: { tenantId } }),
        db.workHours.deleteMany({ where: { tenantId } }),
        db.professional.deleteMany({ where: { tenantId } }),
        db.service.deleteMany({ where: { tenantId } }),
        db.consumerProfile.deleteMany({ where: { tenantId } }),
        db.tenant.delete({ where: { id: tenantId } }),
        db.user.delete({ where: { id: user.id } })
      ])
    }
  }
}

test('pagamento tardio contabiliza recebimento sem retomar horário e estornos parciais não são duplicados', async () => {
  const f = await scenario()
  const account = f.tenant.stripeAccountId!
  const eventId = 'evt_fixture_' + f.tenant.id
  try {
    const row = await book(f.tenant, { ...f.scope, startsAt: f.slot, name: 'Cliente', phone: '5511999991234',
      online: true, consent: false, checkoutReturnUrl: 'http://127.0.0.1:3000' })
    const intent = 'pi_' + row.id
    await db.appointment.update({ where: { id: row.id }, data: { status: 'CANCELED', checkoutState: 'EXPIRED' } })
    const session = { id: 'cs_' + row.id, currency: 'brl', amount_total: 8000, payment_status: 'paid', payment_intent: intent, metadata: { appointmentId: row.id } }
    await applyEvent({ id: eventId, type: 'checkout.session.completed', account, data: { object: session } } as unknown as Stripe.Event)
    const late = await db.appointment.findUniqueOrThrow({ where: { id: row.id } })
    assert.equal(late.status, 'CANCELED')
    assert.equal(late.checkoutState, 'REVIEW')
    assert.ok(late.paidAt)
    assert.equal((await availability(f.tenant, f.scope.serviceId, f.scope.professionalId, f.day)).length, 1)

    const partial = { id: 're_partial_' + row.id, currency: 'brl', amount: 3000, status: 'pending', payment_intent: intent } as Stripe.Refund
    const settle = (refund: Stripe.Refund, externalAccount = account) => db.$transaction(tx => applyConnectedRefund(tx, externalAccount, refund))
    await settle(partial, 'acct_unrelated')
    await settle(partial)
    assert.equal(await db.connectedRefund.count({ where: { appointmentId: row.id } }), 1)
    await settle({ ...partial, status: 'succeeded' })
    await settle(partial)
    assert.equal((await db.connectedRefund.findFirstOrThrow({ where: { appointmentId: row.id } })).state, 'succeeded')
    assert.equal((await db.appointment.findUniqueOrThrow({ where: { id: row.id } })).refundedAt, null)
    await settle({ ...partial, id: 're_final_' + row.id, status: 'succeeded', amount: 5000 })
    assert.ok((await db.appointment.findUniqueOrThrow({ where: { id: row.id } })).refundedAt)
    assert.equal(await db.appointmentHistory.count({ where: { appointmentId: row.id, operation: 'REFUNDED' } }), 1)
  } finally {
    await db.webhookEvent.deleteMany({ where: { id: eventId } })
    await f.clean()
  }
})

test('cancelamento automático libera a vaga e preserva obrigação após falha ou reinício', async () => {
  const f = await scenario()
  const eventId = 'evt_fixture_' + f.tenant.id
  try {
    const row = await book(f.tenant, { ...f.scope, startsAt: f.slot, name: 'Cliente', phone: '5511999991234', consumerUserId: f.user.id,
      online: true, consent: false, checkoutReturnUrl: 'http://127.0.0.1:3000' })
    const intent = 'pi_' + row.id
    const session = { id: 'cs_' + row.id, currency: 'brl', amount_total: 8000, payment_status: 'paid', payment_intent: intent, metadata: { appointmentId: row.id } }
    await applyEvent({ id: eventId, type: 'checkout.session.completed', account: f.tenant.stripeAccountId, data: { object: session } } as unknown as Stripe.Event)
    await assert.rejects(requestConsumerRefund(f.tenant.id, row.id, 'outro-usuario', new Date()))
    assert.equal(await requestConsumerRefund(f.tenant.id, row.id, f.user.id, new Date()), true)
    assert.equal((await availability(f.tenant, f.scope.serviceId, f.scope.professionalId, f.day)).length, 1)
    const refund = { id: 're_fixture_' + row.id, status: 'pending', amount: 8000, currency: 'brl', payment_intent: intent,
      metadata: { appointmentId: row.id, automatic: 'yes' } } as unknown as Stripe.Refund
    const keys: string[] = []
    const started = Date.now()
    const api = { refunds: {
      create: async (_body: unknown, options: { idempotencyKey: string; stripeAccount: string }) => {
        assert.equal(options.stripeAccount, f.tenant.stripeAccountId)
        keys.push(options.idempotencyKey)
        if (keys.length === 1) throw new Error('Conexão interrompida')
        return refund
      },
      retrieve: async () => ({ ...refund, status: 'succeeded' })
    } } as unknown as Stripe
    await processAppointmentRefunds(async () => api, new Date(started + 10_000))
    assert.equal((await db.appointmentRefundRequest.findUniqueOrThrow({ where: { appointmentId: row.id } })).state, 'QUEUED')
    await processAppointmentRefunds(async () => api, new Date(started + 360_000))
    assert.equal((await db.appointmentRefundRequest.findUniqueOrThrow({ where: { appointmentId: row.id } })).state, 'SUBMITTED')
    await processAppointmentRefunds(async () => api, new Date(started + 720_000))
    assert.equal((await db.appointmentRefundRequest.findUniqueOrThrow({ where: { appointmentId: row.id } })).state, 'SUCCEEDED')
    assert.equal(keys.length, 2)
    assert.equal(keys[0], keys[1])
  } finally {
    await db.webhookEvent.deleteMany({ where: { id: eventId } })
    await f.clean()
  }
})

test('lista de espera avisa uma única vez após a liberação, e somente com consentimento', async () => {
  const f = await scenario()
  try {
    const row = await book(f.tenant, { ...f.scope, startsAt: f.slot, name: 'Cliente', phone: '5511999991234', online: false, consent: false })
    const now = Date.now()
    await db.waitEntry.createMany({ data: [
      { ...f.scope, day: f.day, name: 'Cliente sem consentimento', phone: '5511999991235' },
      { ...f.scope, day: f.day, name: 'Cliente com consentimento', phone: '5511999991236', notificationConsentAt: new Date(now) }
    ] })
    const numbers: string[] = []
    const send = async (_instance: string, phone: string) => { numbers.push(phone); return 'ref-fixture' }
    await notifyWaitList(send, new Date(now))
    assert.deepEqual(numbers, [])
    await closeAppointment(f.tenant.id, row.id, 'CANCELED', 'fixture')
    await Promise.all([notifyWaitList(send, new Date(now + 65_000)), notifyWaitList(send, new Date(now + 65_000))])
    assert.deepEqual(numbers, ['5511999991236'])
    assert.equal(await db.waitEntry.count({ where: { tenantId: f.tenant.id, notificationState: 'ACCEPTED', notificationReference: 'ref-fixture' } }), 1)
  } finally { await f.clean() }
})

test('edição de jornada rejeita sobreposição e feriado fecha toda a equipe ativa', async () => {
  const f = await scenario()
  try {
    const weekday = DateTime.fromISO(f.day, { zone: f.tenant.timezone }).weekday
    const other = await db.professional.create({ data: { tenantId: f.tenant.id, name: 'Segundo profissional da fixture' } })
    const shift = await db.workHours.findFirstOrThrow({ where: { professionalId: f.scope.professionalId } })
    await assert.rejects(saveWorkHours(f.tenant.id, f.scope.professionalId, { weekday, startMinute: 560, endMinute: 620 }), /sobrepõe/)
    await saveWorkHours(f.tenant.id, f.scope.professionalId, { weekday, startMinute: 540, endMinute: 630 }, shift.id)
    await saveWorkHours(f.tenant.id, other.id, { weekday, startMinute: 540, endMinute: 630 })
    await db.assignment.create({ data: { ...f.scope, professionalId: other.id } })
    const day = DateTime.fromISO(f.day, { zone: f.tenant.timezone })
    await blockSchedule(f.tenant.id, 'all', day.startOf('day').toJSDate(), day.plus({ days: 1 }).startOf('day').toJSDate(), 'Feriado fixture')
    assert.equal(await db.scheduleBlock.count({ where: { tenantId: f.tenant.id } }), 2)
    assert.deepEqual(await availability(f.tenant, f.scope.serviceId, other.id, f.day), [])
    await removeWorkHours(f.tenant.id, f.scope.professionalId, shift.id)
    assert.equal(await db.workHours.count({ where: { id: shift.id } }), 0)
  } finally { await f.clean() }
})
