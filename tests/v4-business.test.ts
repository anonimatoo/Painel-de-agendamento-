import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, test } from 'node:test'
import { db } from '../lib/db'
import { saveCatalogProduct } from '../lib/catalog'
import { addProductPhoto, deleteMedia, orderProductPhotos, productPhotos } from '../lib/storage'
import { productPhotoLimit } from '../lib/business-plan'
import { automationGraph, initialGraph } from '../lib/automation-graph'
import { processAutomationRuns, queueAutomation } from '../lib/automation'
import { receivePurchase } from '../lib/purchases'
import { cancelOrder, reserveOrder, settleOrder } from '../lib/orders'
import { cashPeriod } from '../lib/commerce'
import { operatingResult, professionalResult } from '../lib/business-finance'
import { availability } from '../lib/agenda'
import { loyaltyBalance, redeemLoyalty } from '../lib/loyalty'
import { applyConnectedRefund } from '../lib/connected-refunds'
import type Stripe from 'stripe'
import { sendCampaignDelivery } from '../lib/campaigns'
import sharp from 'sharp'
import { DateTime } from 'luxon'

after(() => db.$disconnect())
const makeTenant = (active = true) => db.tenant.create({ data: { name: 'Fixture Business', slug: randomUUID(), active } })

test('limites de fotos distinguem contrato ativo, preferência e downgrade', () => {
  assert.equal(productPhotoLimit({ active: false, draftBillingCycle: 'annual' }), 30)
  assert.equal(productPhotoLimit({ active: true, draftBillingCycle: 'annual' }, 'month'), 10)
  assert.equal(productPhotoLimit({ active: true, draftBillingCycle: 'monthly' }, 'year'), 30)
  assert.equal(productPhotoLimit({ active: true, draftBillingCycle: 'annual' }), 10)
})

test('limite transacional e ordem de fotos preservam a galeria existente e separam estabelecimentos', async () => {
  const [tenant, alien] = await Promise.all([makeTenant(false), makeTenant(false)])
  const received = new Set<string>()
  const server = createServer(async (req, res) => {
    for await (const chunk of req) void chunk
    const path = new URL(req.url!, 'http://127.0.0.1').pathname
    if (req.method === 'PUT') received.add(path)
    if (req.method === 'DELETE') received.delete(path)
    res.writeHead(200, { ETag: '"fixture"' }).end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  Object.assign(process.env, {
    S3_BUCKET: 'v4-photos', S3_ENDPOINT: 'http://127.0.0.1:' + (server.address() as AddressInfo).port,
    S3_ACCESS_KEY_ID: 'local-fixture', S3_SECRET_ACCESS_KEY: 'local-fixture'
  })
  try {
    const values = { name: 'Produto', sku: null, category: '', description: '', cents: 1000, costCents: 100,
      promotionCents: null, minimumStock: 0, published: true }
    const item = await saveCatalogProduct(tenant.id, values, {})
    assert.equal(item.published, false)
    const photo = await sharp({ create: { width: 24, height: 24, channels: 3, background: '#a245bf' } }).png().toBuffer()
    const send = (id = tenant.id) => addProductPhoto(id, item.id, new File([new Uint8Array(photo)], 'fixture.png', { type: 'image/png' }))
    async function addExisting(start: number, end: number) {
      await db.mediaAsset.createMany({ data: Array.from({ length: end - start }, (_, index) => ({
        tenantId: tenant.id, target: item.id + ':fixture-' + (start + index), key: randomUUID() + '.webp', bytes: 10, kind: 'PRODUCT' as const
      })) })
    }
    await addExisting(0, 9)
    const monthly = await Promise.allSettled([send(), send()])
    assert.equal(monthly.filter(row => row.status === 'fulfilled').length, 1)
    assert.equal(received.size, 1)
    await db.tenant.update({ where: { id: tenant.id }, data: { draftBillingCycle: 'annual' } })
    await addExisting(9, 28)
    const annual = await Promise.allSettled([send(), send()])
    assert.equal(annual.filter(row => row.status === 'fulfilled').length, 1)
    assert.equal(received.size, 2)
    const stored = await productPhotos(tenant.id, item.id)
    assert.equal(stored.length, 30)
    const reversed = [...stored].reverse().map(row => row.id)
    await orderProductPhotos(tenant.id, item.id, reversed)
    assert.deepEqual((await productPhotos(tenant.id, item.id)).map(row => row.id), reversed)
    await assert.rejects(orderProductPhotos(alien.id, item.id, reversed), /galeria mudou/)
    await assert.rejects(send(alien.id), /não está disponível/)
    await db.tenant.update({ where: { id: tenant.id }, data: { draftBillingCycle: 'monthly' } })
    await assert.rejects(send(), /10 fotos/)
    assert.equal((await productPhotos(tenant.id, item.id)).length, 30)
    const uploaded = annual.find(row => row.status === 'fulfilled')?.value.id
    assert.ok(uploaded)
    await deleteMedia(tenant.id, uploaded)
    assert.equal(received.size, 1)
  } finally {
    await db.product.deleteMany({ where: { tenantId: tenant.id } })
    await db.tenant.deleteMany({ where: { id: { in: [tenant.id, alien.id] } } })
    server.close()
  }
})

test('compras concorrentes são idempotentes, isoladas e entram no caixa uma vez', async () => {
  const [tenant, alien] = await Promise.all([makeTenant(), makeTenant()])
  try {
    const [supplier, outsider, item] = await Promise.all([
      db.supplier.create({ data: { tenantId: tenant.id, name: 'Fornecedor sintético' } }),
      db.supplier.create({ data: { tenantId: alien.id, name: 'Outro fornecedor' } }),
      db.product.create({ data: { tenantId: tenant.id, name: 'Produto sintético', cents: 1500, costCents: 100, stock: 2 } })
    ])
    const args = { tenantId: tenant.id, supplierId: supplier.id, productId: item.id, quantity: 2,
      unitCostCents: 300, reference: 'TESTE', requestId: randomUUID(), dueAt: new Date() }
    await assert.rejects(receivePurchase({ ...args, supplierId: outsider.id }), /Fornecedor indisponível/)
    const [first, same] = await Promise.all([receivePurchase(args), receivePurchase(args)])
    assert.equal(first.id, same.id)
    assert.equal((await db.product.findUniqueOrThrow({ where: { id: item.id } })).costCents, 200)
    assert.equal((await db.product.findUniqueOrThrow({ where: { id: item.id } })).stock, 4)
    await db.financialEntry.update({ where: { id: first.expenseId }, data: { paidAt: new Date() } })
    const report = await professionalResult(tenant, cashPeriod(tenant.timezone)!, false)
    assert.equal(report.totals.purchases, 600)
    assert.equal(operatingResult(report.totals), -600)
    const accrual = await professionalResult(tenant, cashPeriod(tenant.timezone)!, true)
    assert.equal(accrual.totals.expenses, 0)
    assert.equal(operatingResult(accrual.totals), 0)
  } finally {
    await db.purchase.deleteMany({ where: { tenantId: tenant.id } })
    await db.financialEntry.deleteMany({ where: { tenantId: tenant.id } })
    await db.stockMovement.deleteMany({ where: { tenantId: tenant.id } })
    await db.product.deleteMany({ where: { tenantId: tenant.id } })
    await db.supplier.deleteMany({ where: { tenantId: { in: [tenant.id, alien.id] } } })
    await db.tenant.deleteMany({ where: { id: { in: [tenant.id, alien.id] } } })
  }
})

test('checkout calcula promoção, cupom e combo no servidor e rejeita outro estabelecimento', async () => {
  const [tenant, alien] = await Promise.all([makeTenant(), makeTenant()])
  try {
    const now = Date.now()
    const range = { startsAt: new Date(now - 60_000), endsAt: new Date(now + 60_000), enabled: true }
    const [first, second] = await Promise.all(['Um', 'Dois'].map(name => db.product.create({
      data: { tenantId: tenant.id, name, cents: 1000, costCents: 100, stock: 9 }
    })))
    const combo = await db.commercialOffer.create({ data: { ...range, tenantId: tenant.id, kind: 'COMBO', bps: 1000, name: 'Combo',
      items: [{ productId: first.id, quantity: 1 }, { productId: second.id, quantity: 2 }] } })
    await db.commercialOffer.createMany({ data: [
      { ...range, tenantId: tenant.id, kind: 'PROMOTION', bps: 2000, name: 'Promo', productId: first.id },
      { ...range, tenantId: tenant.id, kind: 'COUPON', bps: 1000, name: 'Cupom', code: 'LOCAL' },
      { ...range, tenantId: alien.id, kind: 'COUPON', bps: 9500, name: 'Outro', code: 'OUTRO' }
    ] })
    const input = { tenantId: tenant.id, requestId: randomUUID(), name: 'Cliente sintético', phone: '5511000000011' }
    const cart = [{ productId: first.id, quantity: 1 }]
    await assert.rejects(reserveOrder({ ...input, cart, offer: { kind: 'COUPON', value: 'OUTRO' } }), /Oferta indisponível/)
    await assert.rejects(reserveOrder({ ...input, cart, requireActive: true }), /Compras online indisponíveis/)
    const cupon = await reserveOrder({ ...input, cart, offer: { kind: 'COUPON', value: 'LOCAL' } })
    assert.equal(cupon.cents, 720)
    assert.equal(cupon.items[0].unitCostCents, 100)
    const kit = await reserveOrder({ ...input, requestId: randomUUID(), cart: [], offer: { kind: 'COMBO', value: combo.id } })
    assert.equal(kit.cents, 2520)
    await db.$transaction(tx => cancelOrder(tx, tenant.id, kit.id))
    assert.equal((await db.product.findUniqueOrThrow({ where: { id: second.id } })).stock, 9)
  } finally {
    await db.shopOrder.deleteMany({ where: { tenantId: tenant.id } })
    await db.commercialOffer.deleteMany({ where: { tenantId: { in: [tenant.id, alien.id] } } })
    await db.product.deleteMany({ where: { tenantId: tenant.id } })
    await db.tenant.deleteMany({ where: { id: { in: [tenant.id, alien.id] } } })
  }
})

test('resultado reconhece a venda paga e devolve o custo apenas quando repõe estoque', async () => {
  const tenant = await makeTenant()
  const account = 'acct_fixture_' + randomUUID()
  const paymentIntent = 'pi_fixture_' + randomUUID()
  try {
    await db.tenant.update({ where: { id: tenant.id }, data: { stripeAccountId: account } })
    const product = await db.product.create({ data: { tenantId: tenant.id, name: 'Produto', cents: 1000, costCents: 300, stock: 5 } })
    const order = await reserveOrder({ tenantId: tenant.id, requestId: randomUUID(), name: 'Teste', phone: '5511000000001',
      cart: [{ productId: product.id, quantity: 2 }] })
    await db.$transaction(tx => settleOrder(tx, account, {
      id: 'cs_fixture', payment_intent: paymentIntent, payment_status: 'paid', currency: 'brl',
      amount_total: 2000, metadata: { orderId: order.id }
    } as unknown as Stripe.Checkout.Session, false))
    const period = cashPeriod(tenant.timezone)!
    const before = await professionalResult(tenant, period, true)
    assert.equal(before.totals.cost, 600)
    assert.equal(before.totals.revenue, 2000)
    const apply = () => db.$transaction(tx => applyConnectedRefund(tx, account, {
      id: 're_fixture', payment_intent: paymentIntent, status: 'succeeded', amount: 2000, currency: 'brl'
    } as Stripe.Refund))
    await apply()
    await apply()
    const after = await professionalResult(tenant, period, true)
    assert.equal(after.totals.cost, 0)
    assert.equal(after.totals.refunds, 2000)
    assert.equal(operatingResult(after.totals), 0)
    assert.equal((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 5)
  } finally {
    await db.connectedRefund.deleteMany({ where: { accountId: account } })
    await db.shopOrder.deleteMany({ where: { tenantId: tenant.id } })
    await db.product.deleteMany({ where: { tenantId: tenant.id } })
    await db.tenant.delete({ where: { id: tenant.id } })
  }
})

test('automação grava uma execução por evento e usa a revisão vigente', async () => {
  assert.equal(automationGraph.safeParse({ ...initialGraph, edges: [{ id: 'event-task', source: 'task', target: 'event' }] }).success, false)
  const tenant = await makeTenant()
  try {
    const service = await db.service.create({ data: { tenantId: tenant.id, name: 'Serviço', cents: 500, duration: 30 } })
    const pro = await db.professional.create({ data: { tenantId: tenant.id, name: 'Profissional' } })
    const client = await db.customer.create({ data: { tenantId: tenant.id, name: 'Teste', phone: '5511000000012' } })
    const appointment = await db.appointment.create({ data: { tenantId: tenant.id, serviceId: service.id, professionalId: pro.id,
      customerId: client.id, status: 'CONFIRMED', cents: 500, startsAt: new Date(Date.now() + 14_400_000), endsAt: new Date(Date.now() + 16_200_000) } })
    const rule = await db.automationRule.create({ data: { tenantId: tenant.id, enabled: true, name: 'Auditoria', graph: initialGraph, trigger: 'CONFIRMED' } })
    const emit = () => db.$transaction(tx => queueAutomation(tx, appointment, 'CONFIRMED'))
    await Promise.all([emit(), emit()])
    await Promise.all([processAutomationRuns(), processAutomationRuns()])
    assert.equal(await db.automationRun.count({ where: { tenantId: tenant.id, state: 'RECORDED' } }), 1)
    await db.automationRule.update({ where: { id: rule.id }, data: { revision: 2 } })
    await emit()
    await db.automationRule.update({ where: { id: rule.id }, data: { enabled: false } })
    await processAutomationRuns()
    assert.equal(await db.automationRun.count({ where: { tenantId: tenant.id, state: 'DISCARDED' } }), 1)
  } finally {
    await db.automationRun.deleteMany({ where: { tenantId: tenant.id } })
    await db.appointment.deleteMany({ where: { tenantId: tenant.id } })
    await db.customer.deleteMany({ where: { tenantId: tenant.id } })
    await db.professional.deleteMany({ where: { tenantId: tenant.id } })
    await db.service.deleteMany({ where: { tenantId: tenant.id } })
    await db.tenant.delete({ where: { id: tenant.id } })
  }
})

test('feriado bloqueia vagas e resgate tem uso único com isolamento', async () => {
  const [tenant, alien] = await Promise.all([makeTenant(), makeTenant()])
  const user = await db.user.create({ data: { email: randomUUID() + '@example.test' } })
  try {
    await db.tenant.update({ where: { id: tenant.id }, data: { loyaltyEnabled: true } })
    await db.consumerProfile.create({ data: { tenantId: tenant.id, userId: user.id, name: 'Cliente', phone: '5511000000015' } })
    const service = await db.service.create({ data: { tenantId: tenant.id, name: 'Serviço', cents: 500, duration: 30 } })
    const pro = await db.professional.create({ data: { tenantId: tenant.id, name: 'Profissional' } })
    const client = await db.customer.create({ data: { tenantId: tenant.id, name: 'Teste', phone: '5511000000015' } })
    const day = DateTime.now().setZone(tenant.timezone).plus({ days: 2 })
    await db.assignment.create({ data: { tenantId: tenant.id, professionalId: pro.id, serviceId: service.id } })
    await db.workHours.create({ data: { tenantId: tenant.id, professionalId: pro.id, weekday: day.weekday, startMinute: 540, endMinute: 660 } })
    assert.ok((await availability(tenant, service.id, pro.id, day.toISODate()!)).length)
    await db.storeHoliday.create({ data: { tenantId: tenant.id, date: day.toISODate()!, name: 'Feriado' } })
    assert.deepEqual(await availability(tenant, service.id, pro.id, day.toISODate()!), [])
    await db.appointment.createMany({ data: Array.from({ length: 5 }, (_, index) => ({
      tenantId: tenant.id, serviceId: service.id, professionalId: pro.id, customerId: client.id, consumerUserId: user.id,
      status: 'COMPLETED', cents: 500, startsAt: new Date(+day.minus({ days: index + 3 })), endsAt: new Date(+day.minus({ days: index + 3 }) + 1_800_000)
    })) })
    assert.equal((await loyaltyBalance(tenant.id, user.id)).available, 1)
    await assert.rejects(redeemLoyalty(alien.id, user.id, 1), /indisponível/)
    const results = await Promise.allSettled([redeemLoyalty(tenant.id, user.id, 1), redeemLoyalty(tenant.id, user.id, 1)])
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal((await loyaltyBalance(tenant.id, user.id)).available, 0)
  } finally {
    await db.appointment.deleteMany({ where: { tenantId: tenant.id } })
    await db.assignment.deleteMany({ where: { tenantId: tenant.id } })
    await db.workHours.deleteMany({ where: { tenantId: tenant.id } })
    await db.professional.deleteMany({ where: { tenantId: tenant.id } })
    await db.customer.deleteMany({ where: { tenantId: tenant.id } })
    await db.service.deleteMany({ where: { tenantId: tenant.id } })
    await db.tenant.deleteMany({ where: { id: { in: [tenant.id, alien.id] } } })
    await db.user.delete({ where: { id: user.id } })
  }
})

test('campanha não envia após retirada de autorização e suporta novo processamento', async () => {
  const tenant = await makeTenant()
  const user = await db.user.create({ data: { email: randomUUID() + '@example.test', emailVerifiedAt: new Date() } })
  try {
    await db.consumerProfile.create({ data: { tenantId: tenant.id, userId: user.id, name: 'Cliente', phone: '5511000000019' } })
    const campaign = await db.campaign.create({ data: { tenantId: tenant.id, channel: 'EMAIL', title: 'Campanha', body: 'Mensagem sintética' } })
    const delivery = await db.campaignDelivery.create({ data: { tenantId: tenant.id, campaignId: campaign.id, userId: user.id } })
    await Promise.all([sendCampaignDelivery(delivery.id), sendCampaignDelivery(delivery.id)])
    assert.equal((await db.campaignDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).state, 'CANCELED')
  } finally {
    await db.tenant.delete({ where: { id: tenant.id } })
    await db.user.delete({ where: { id: user.id } })
  }
})
