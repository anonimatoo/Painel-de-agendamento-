import { activeStore, currentConsumer } from '@/lib/consumer'
import { db } from '@/lib/db'
import { stripe } from '@/lib/stripe'

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const query = new URL(request.url).searchParams
  const id = query.get('id')
  const kind = query.get('tipo')
  const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' }
  const unavailable = () => new Response('Comprovante indisponível.', { status: 404, headers })
  if (!id || id.length > 100 || (kind !== 'agendamento' && kind !== 'pedido')) return unavailable()
  const tenant = await activeStore(slug)
  const profile = tenant ? await currentConsumer(tenant.id) : null
  if (!tenant || !profile) return unavailable()
  const where = { id, tenantId: tenant.id, consumerUserId: profile.userId, paidAt: { not: null } }
  const appointment = kind === 'agendamento' ? await db.appointment.findFirst({
    where, select: { paymentIntentId: true, checkoutAccountId: true, chargeCents: true, cents: true }
  }) : null
  const order = kind === 'pedido' ? await db.shopOrder.findFirst({
    where, select: { paymentIntentId: true, cents: true }
  }) : null
  const account = appointment?.checkoutAccountId ?? tenant.stripeAccountId
  const intentId = appointment?.paymentIntentId ?? order?.paymentIntentId
  const amount = appointment?.chargeCents ?? appointment?.cents ?? order?.cents
  if (!account || !intentId || amount === undefined) return unavailable()
  try {
    const payment = await (await stripe()).paymentIntents.retrieve(intentId, { expand: ['latest_charge'] }, { stripeAccount: account })
    const charge = payment.latest_charge
    if (payment.id !== intentId || payment.currency !== 'brl' || payment.amount_received !== amount ||
        !charge || typeof charge === 'string' || !charge.paid || !charge.receipt_url) return unavailable()
    const location = new URL(charge.receipt_url)
    if (location.protocol !== 'https:' || !(location.hostname === 'stripe.com' || location.hostname.endsWith('.stripe.com')) ||
        location.username || location.password) return unavailable()
    return new Response(null, { status: 303, headers: { ...headers, Location: location.href } })
  } catch {
    return unavailable()
  }
}
