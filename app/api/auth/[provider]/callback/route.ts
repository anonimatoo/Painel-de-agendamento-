import { consumerPath } from '@/lib/consumer'
import { readLimitedBody } from '@/lib/limited-body'
import { startSession } from '@/lib/auth'
import { finishSocial } from '@/lib/social-auth'
import { isSocialProvider, socialOrigin } from '@/lib/social-oidc'

type Context = { params: Promise<{ provider: string }> }

async function callback(req: Request, { params }: Context) {
  const { provider } = await params
  const origin = socialOrigin()
  let next = '/login?social=erro'
  try {
    if (isSocialProvider(provider) && req.method === (provider === 'apple' ? 'POST' : 'GET')) {
      const body = provider === 'apple' && req.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')
        ? await readLimitedBody(req, 32_768) : null
      const data = provider === 'apple' ? body === null ? null : new URLSearchParams(body) : new URL(req.url).searchParams
      const state = data?.get('state')
      const code = data?.get('code')
      if (typeof state === 'string' && typeof code === 'string' && !data?.has('error')) {
        const result = await finishSocial(provider, state, code)
        if (result?.kind === 'login') {
          await startSession(result.userId, false, true)
          next = result.consumerSlug ? consumerPath(result.consumerSlug) : '/dashboard'
        } else if (result?.kind === 'link') next = '/conta?social=vinculado'
        else if (result?.kind === 'signup') next = result.consumerSlug ? consumerPath(result.consumerSlug) : '/cadastro/social'
      }
    }
  } catch {
    // Provider responses and authorization data are deliberately omitted.
  }
  return new Response(null, { status: 303, headers: { Location: new URL(next, origin).href, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
}
export const GET = callback
export const POST = callback
