import type { CheckoutMethod, Prisma, ShopOrder } from '@prisma/client'
import type Stripe from 'stripe'
import { failedCheckout, pixMinimumCents } from './checkout-method'
import { AgendaError } from './agenda'
import { platformFee } from './commission'
import { db } from './db'

export async function reserveOrder(input: { tenantId: string; requestId: string; checkoutMethod?: CheckoutMethod; consumerUserId?: string; name: string; phone: string; cart: { productId: string; quantity: number }[] }) {
  const { tenantId, requestId, checkoutMethod = 'card', consumerUserId, name, phone, cart } = input
  const requested = new Map(cart.map(item => [item.productId, item.quantity]))
  if (!cart.length || requested.size !== cart.length || cart.length > 30 || cart.some(item => !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100)) {
    throw new AgendaError('Confira as quantidades do carrinho.')
  }
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`
    const existing = await tx.shopOrder.findUnique({ where: { tenantId_requestId: { tenantId, requestId } }, include: { items: true } })
    if (existing) {
      if (existing.checkoutMethod !== checkoutMethod || existing.consumerUserId !== (consumerUserId ?? null) || existing.phone !== phone || existing.customerName !== name || existing.items.length !== requested.size ||
        existing.items.some(item => requested.get(item.productId) !== item.quantity)) throw new AgendaError('Atualize a página antes de iniciar um novo pedido.')
      return existing
    }
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { connectPausedAt: true, pixCheckoutEnabled: true } })
    if (tenant.connectPausedAt || (checkoutMethod === 'pix' && !tenant.pixCheckoutEnabled)) throw new AgendaError('Os pagamentos online estão indisponíveis.')
    const items = []
    for (const line of [...cart].sort((first, second) => first.productId.localeCompare(second.productId))) {
      const { productId, quantity } = line
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ${productId} AND "tenantId" = ${tenantId} FOR UPDATE`
      const product = await tx.product.findUnique({ where: { tenantId_id: { tenantId, id: productId } } })
      if (!product || !product.published || product.archivedAt || product.stock < quantity || (product.promotionCents ?? product.cents) < 1) {
        throw new AgendaError('Um item do carrinho ficou indisponível. Atualize a página e confira as quantidades.')
      }
      await tx.product.update({ where: { tenantId_id: { tenantId, id: productId } }, data: { stock: { decrement: quantity } } })
      items.push({ tenantId, productId, quantity, name: product.name, unitCents: product.promotionCents ?? product.cents })
    }
    const cents = items.reduce((sum, item) => sum + item.quantity * item.unitCents, 0)
    if (checkoutMethod === 'pix' && cents < pixMinimumCents) throw new AgendaError('O total para Pix deve ser de pelo menos R$ 0,50.')
    if (cents > 9_999_999) throw new AgendaError('O total excede o limite de um pedido.')
    return tx.shopOrder.create({
      data: {
        tenantId, requestId, checkoutMethod, consumerUserId, cents, platformFeeCents: await platformFee(tx, tenantId, cents), customerName: name, phone,
        expiresAt: new Date(Math.floor(Date.now() / 1000) * 1000 + 35 * 60_000),
        items: { createMany: { data: items.map(({ tenantId: _tenantId, ...item }) => item) } }
      }, include: { items: true }
    })
  })
}

export async function cancelOrder(tx: Prisma.TransactionClient, tenantId: string, id: string) {
  const changed = await tx.shopOrder.updateMany({ where: { tenantId, id, status: 'PENDING' }, data: { status: 'CANCELED', paymentReview: false } })
  if (!changed.count) return
  const items = await tx.shopOrderItem.findMany({ where: { tenantId, orderId: id }, orderBy: { productId: 'asc' } })
  for (const item of items) {
    await tx.product.update({ where: { tenantId_id: { tenantId, id: item.productId } }, data: { stock: { increment: item.quantity } } })
  }
}

export async function settleOrder(tx: Prisma.TransactionClient, account: string, session: Stripe.Checkout.Session, expired: boolean) {
  const orderId = session.metadata?.orderId
  if (!orderId) return
  const order = await tx.shopOrder.findFirst({ where: { id: orderId, status: { in: ['PENDING', 'CANCELED'] }, tenant: { stripeAccountId: account } } })
  if (!order || order.checkoutId && order.checkoutId !== session.id) return
  const paymentIntentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
  const approved = session.payment_status === 'paid' && session.currency === 'brl' && session.amount_total === order.cents && Boolean(paymentIntentId)
  if (order.status === 'CANCELED') {
    if (approved) await tx.shopOrder.updateMany({
      where: { id: order.id, status: 'CANCELED', paidAt: null },
      data: { paymentReview: true, checkoutId: session.id, paymentIntentId, paidAt: new Date() }
    })
    return
  }
  if (approved) {
    await tx.shopOrder.updateMany({
      where: { id: order.id, status: 'PENDING' },
      data: { status: 'PAID', paymentReview: false, paidAt: new Date(), paymentIntentId, checkoutId: session.id }
    })
  } else if (expired && session.payment_status !== 'paid') {
    await cancelOrder(tx, order.tenantId, order.id)
  }
}

export async function reconcileOrder(order: ShopOrder, account: string, api: Stripe) {
  let session: Stripe.Checkout.Session | undefined = order.checkoutId ? await api.checkout.sessions.retrieve(order.checkoutId, { stripeAccount: account }) : undefined
  if (!session) {
    for await (const candidate of api.checkout.sessions.list({
      created: { gte: Math.floor(+order.createdAt / 1000) - 10 }, limit: 100
    }, { stripeAccount: account })) {
      if (candidate.metadata?.orderId === order.id) { session = candidate; break }
    }
  }
  const failed = session ? await failedCheckout(session, order.checkoutMethod, api, account) : false
  if (session && (session.payment_status === 'paid' || failed)) {
    const evidence = session
    await db.$transaction(tx => settleOrder(tx, account, evidence, failed))
  } else if (!(session?.status === 'complete' && order.checkoutMethod === 'pix' && Date.now() < +order.expiresAt + 300_000) && Date.now() >= +order.expiresAt) {
    await db.shopOrder.updateMany({ where: { id: order.id, status: 'PENDING' }, data: { paymentReview: true } })
  }
}

export async function reconcileOrders(api: Stripe) {
  const due = await db.shopOrder.findMany({
    where: { status: 'PENDING', paymentReview: false, expiresAt: { lte: new Date() } },
    include: { tenant: { select: { stripeAccountId: true } } }, take: 25, orderBy: { expiresAt: 'asc' }
  })
  for (const order of due) {
    const account = order.tenant.stripeAccountId
    if (!account) continue
    try {
      await reconcileOrder(order, account, api)
    } catch {
      console.error('order-reconciliation', order.id)
    }
  }
}
