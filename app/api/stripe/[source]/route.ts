import { applyEvent } from '@/lib/stripe'
import { stripeClient, stripeConfiguration } from '@/lib/stripe-settings'

export async function POST(req: Request, context: { params: Promise<{ source: string }> }) {
  const { source } = await context.params
  const signature = req.headers.get('stripe-signature')
  if (!signature || !['billing', 'connect'].includes(source)) return new Response(null, { status: 400 })
  let settings
  try {
    settings = await stripeConfiguration()
  } catch {
    return new Response(null, { status: 503 })
  }
  const secret = source === 'billing' ? settings.billingWebhook : settings.connectWebhook
  if (!secret) return new Response(null, { status: 503 })
  const client = stripeClient(settings.secret)
  let event
  try {
    event = client.webhooks.constructEvent(await req.text(), signature, secret)
    if (!!event.account !== (source === 'connect') || event.livemode !== (settings.mode === 'live')) return new Response(null, { status: 400 })
  } catch {
    return new Response(null, { status: 400 })
  }
  try {
    await applyEvent(event, client)
    return Response.json({ received: true })
  } catch (error) {
    console.error('stripe-event', event.id, error instanceof Error ? error.name : 'unknown')
    return new Response(null, { status: 500 })
  }
}
