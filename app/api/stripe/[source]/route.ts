import { applyEvent, stripe } from '@/lib/stripe'

export async function POST(req: Request, context: { params: Promise<{ source: string }> }) {
  const { source } = await context.params
  const secret = source === 'billing' ? process.env.STRIPE_WEBHOOK_SECRET
    : source === 'connect' ? process.env.STRIPE_CONNECT_WEBHOOK_SECRET : undefined
  const signature = req.headers.get('stripe-signature')
  if (!secret || !signature) return new Response(null, { status: 400 })
  let event
  try {
    event = stripe().webhooks.constructEvent(await req.text(), signature, secret)
    if (!!event.account !== (source === 'connect')) return new Response(null, { status: 400 })
  } catch {
    return new Response(null, { status: 400 })
  }
  try {
    await applyEvent(event)
    return Response.json({ received: true })
  } catch (error) {
    console.error('stripe-event', event.id, error instanceof Error ? error.name : 'unknown')
    return new Response(null, { status: 500 })
  }
}
