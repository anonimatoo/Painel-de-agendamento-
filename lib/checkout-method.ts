import type { CheckoutMethod } from '@prisma/client'
import type Stripe from 'stripe'

export const pixMinimumCents = 50
export const pixCheckoutLeadMinutes = 40

export function checkoutMethods(method: CheckoutMethod): Pick<Stripe.Checkout.SessionCreateParams, 'payment_method_types' | 'payment_method_options'> {
  return method === 'pix'
    ? { payment_method_types: ['pix'], payment_method_options: { pix: { expires_after_seconds: 240 } } }
    : { payment_method_types: ['card'] }
}

export async function failedCheckout(session: Stripe.Checkout.Session, method: CheckoutMethod, api: Stripe, account: string) {
  if (session.payment_status === 'paid') return false
  if (session.status === 'expired') return true
  if (method !== 'pix' || session.status !== 'complete') return false
  const intentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
  if (!intentId) return false
  const intent = await api.paymentIntents.retrieve(intentId, { stripeAccount: account })
  return intent.id === intentId && (intent.status === 'requires_payment_method' || intent.status === 'canceled')
}
