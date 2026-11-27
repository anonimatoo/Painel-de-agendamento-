'use client'

import { useFormStatus } from 'react-dom'
import { socialSignIn } from './auth-actions'
import type { SocialProvider } from '@/lib/social-oidc'

function ProviderButton({ provider }: { provider: SocialProvider }) {
  const { pending } = useFormStatus()
  return <button className={'social-button social-' + provider} disabled={pending} aria-busy={pending}
    aria-label={provider === 'google' ? 'Continuar com Google' : 'Continuar com Apple'}>
    {provider === 'google' ? <><img src="/auth/google-g.png" width={18} height={18} alt="" />Continuar com Google</> :
      <img src="/auth/apple.png" width={256} height={48} alt="" />}
    {pending && <span className="social-loading">Aguarde…</span>}
  </button>
}

export function SocialButtons({ providers, linking = false, password = false }: {
  providers: SocialProvider[]; linking?: boolean; password?: boolean
}) {
  if (!providers.length) return null
  return <div className="social-options">
    {providers.map(provider => <form key={provider} action={socialSignIn.bind(null, provider, linking)}>
      {password && <label>Senha para vincular {provider === 'google' ? 'Google' : 'Apple'}
        <input name="password" type="password" autoComplete="current-password" required />
      </label>}
      <ProviderButton provider={provider} />
    </form>)}
  </div>
}
