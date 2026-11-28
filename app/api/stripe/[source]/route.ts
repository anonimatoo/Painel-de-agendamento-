import { readLimitedBody } from '@/lib/limited-body'
import { applyEvent } from '@/lib/stripe'
import { stripeClient, stripeConfiguration, verifyStripeEvent } from '@/lib/stripe-settings'

export async function POST(req: Request, context: { params: Promise<{ source: string }> }) {
  const { source } = await context.params
  const signature = req.headers.get('stripe-signature')
  if (!signature || (source !== 'billing' && source !== 'connect')) return new Response(null, { status: 400 })
  const body = await readLimitedBody(req, 1_048_576).catch(() => null)
  if (body === null) return new Response(null, { status: 413 })
  let settings
  try {
    settings = await stripeConfiguration()
  } catch {
    return new Response(null, { status: 503 })
  }
  const client = stripeClient(settings.secret)
  const event = verifyStripeEvent(client, body, signature, settings, source)
  if (event?.object !== 'event' || !event.data?.object) return new Response(null, { status: 400 })
  try {
    await applyEvent(event, client)
    return Response.json({ received: true })
  } catch (error) {
    console.error('stripe-event', event.id, error instanceof Error ? error.name : 'unknown')
    return new Response(null, { status: 500 })
  }
}
