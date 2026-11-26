import { membership, userSession } from '@/lib/auth'
import { createConnectOnboardingLink } from '@/lib/connect-accounts'
import { stripeForNewPayments } from '@/lib/stripe-settings'

export async function GET(request: Request) {
  const origin = new URL(process.env.APP_URL ?? 'http://localhost:3000').origin
  const user = await userSession()
  if (!user) return Response.redirect(new URL('/login', origin), 303)
  const member = await membership(user.id)
  const tenantId = new URL(request.url).searchParams.get('estabelecimento')
  if (!member || member.tenantId !== tenantId || member.role !== 'ADMIN' ||
      !member.tenant.active || member.tenant.suspended || !member.tenant.stripeAccountId) {
    return new Response(null, { status: 403, headers: { 'Cache-Control': 'no-store' } })
  }

  try {
    const url = await createConnectOnboardingLink(
      await stripeForNewPayments(), member.tenant.stripeAccountId, member.tenantId, origin
    )
    return new Response(null, { status: 303, headers: { Location: url, 'Cache-Control': 'no-store' } })
  } catch {
    const fallback = new URL('/recebimentos', origin)
    fallback.searchParams.set('erro', 'Não foi possível renovar o link. Tente continuar o cadastro novamente.')
    return Response.redirect(fallback, 303)
  }
}
