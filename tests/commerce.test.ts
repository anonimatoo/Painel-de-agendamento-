import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, test } from 'node:test'
import { cashReport, changeStock, reverseSale } from '../lib/commerce'
import { db } from '../lib/db'

after(() => db.$disconnect())

test('vendas concorrentes respeitam o estoque e cancelamento devolve unidades uma vez', async () => {
  const tenant = await db.tenant.create({ data: { name: 'Estoque de teste', slug: randomUUID() } })
  const other = await db.tenant.create({ data: { name: 'Outro estabelecimento', slug: randomUUID() } })
  try {
    const product = await db.product.create({ data: { tenantId: tenant.id, name: 'Produto', cents: 900, promotionCents: 800, stock: 3 } })
    const request = { tenantId: tenant.id, productId: product.id, quantity: 2, requestId: randomUUID(), sale: true }
    await assert.rejects(changeStock({ ...request, tenantId: other.id }))
    const results = await Promise.allSettled([changeStock(request), changeStock({ ...request, requestId: randomUUID() })])
    const fulfilled = results.filter(result => result.status === 'fulfilled')
    assert.equal(fulfilled.length, 1)
    const sale = fulfilled[0].value
    assert.equal(sale.unitCents, 800)
    const duplicate = await changeStock({ ...request, requestId: sale.requestId })
    assert.equal(duplicate.id, sale.id)
    assert.equal((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 1)
    assert.equal((await cashReport(tenant.id, tenant.timezone)).rows[0].cents, 1600)
    assert.deepEqual((await cashReport(other.id, other.timezone)).rows, [])
    await Promise.all([reverseSale(tenant.id, sale.id), reverseSale(tenant.id, sale.id)])
    assert.equal((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 3)
    assert.equal(await db.stockMovement.count({ where: { tenantId: tenant.id } }), 2)
  } finally {
    await db.stockMovement.deleteMany({ where: { tenantId: tenant.id } })
    await db.product.deleteMany({ where: { tenantId: tenant.id } })
    await db.tenant.deleteMany({ where: { id: { in: [tenant.id, other.id] } } })
  }
})

test('reservas de carrinho concorrem por estoque e expiração libera uma vez', async () => {
  const { reserveOrder, cancelOrder } = await import('../lib/orders')
  const tenant = await db.tenant.create({ data: { name: 'Loja', slug: randomUUID(), platformFeeBps: 250 } })
  try {
    const product = await db.product.create({ data: { tenantId: tenant.id, name: 'Kit', cents: 2500, stock: 3 } })
    const request = { tenantId: tenant.id, name: 'Cliente', phone: '5511999999999', cart: [{ productId: product.id, quantity: 2 }] }
    const results = await Promise.allSettled([reserveOrder({ ...request, requestId: randomUUID() }), reserveOrder({ ...request, requestId: randomUUID() })])
    const paid = results.filter(result => result.status === 'fulfilled')
    assert.equal(paid.length, 1)
    const order = paid[0].value
    assert.equal(order.cents, 5000)
    assert.equal(order.platformFeeCents, 125)
    assert.equal((await reserveOrder({ ...request, requestId: order.requestId })).id, order.id)
    await Promise.all([db.$transaction(tx => cancelOrder(tx, tenant.id, order.id)), db.$transaction(tx => cancelOrder(tx, tenant.id, order.id))])
    assert.equal((await db.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 3)
  } finally {
    await db.shopOrder.deleteMany({ where: { tenantId: tenant.id } })
    await db.product.deleteMany({ where: { tenantId: tenant.id } })
    await db.tenant.delete({ where: { id: tenant.id } })
  }
})

test('pausa Connect isola novos pedidos e preserva a conta para conciliação', async () => {
  const { changeConnectAvailability } = await import('../lib/connect')
  const { reserveOrder } = await import('../lib/orders')
  const tenants = await Promise.all(['Primeiro', 'Segundo'].map(name => db.tenant.create({
    data: { name, slug: randomUUID(), stripeAccountId: 'acct_' + randomUUID() }
  })))
  const ids = tenants.map(tenant => tenant.id)
  try {
    const products = await Promise.all(tenants.map(tenant => db.product.create({
      data: { tenantId: tenant.id, name: 'Produto', cents: 1500, stock: 2 }
    })))
    const reserve = (index: number) => reserveOrder({
      tenantId: tenants[index].id, requestId: randomUUID(), name: 'Cliente', phone: '5511999999999',
      cart: [{ productId: products[index].id, quantity: 1 }]
    })
    const prior = await reserve(0)
    await changeConnectAvailability(ids[0], 'admin', true)
    await assert.rejects(reserve(0), /indisponíveis/)
    await reserve(1)
    assert.equal((await db.shopOrder.findUniqueOrThrow({ where: { id: prior.id } })).status, 'PENDING')
    assert.equal((await db.tenant.findUniqueOrThrow({ where: { id: ids[0] } })).stripeAccountId, tenants[0].stripeAccountId)
    await changeConnectAvailability(ids[0], 'admin', false)
    await reserve(0)
  } finally {
    await db.shopOrder.deleteMany({ where: { tenantId: { in: ids } } })
    await db.product.deleteMany({ where: { tenantId: { in: ids } } })
    await db.tenant.deleteMany({ where: { id: { in: ids } } })
  }
})
