import Link from 'next/link'
import { enabledSocialProviders } from '@/lib/social-auth'
import { db } from '@/lib/db'
import { SocialButtons } from '../social-buttons'
import { userSession } from '@/lib/auth'
import { MfaSetup } from './mfa-setup'
import { accountLink } from '../actions'
import { Brand, ErrorNote, Field } from '../ui'

export default async function Account({ searchParams }: {
  searchParams: Promise<{ token?: string; verificar?: string; solicitado?: string; erro?: string; social?: string }>
}) {
  const { token, verificar, solicitado, erro, social } = await searchParams
  const user = await userSession()
  const validToken = typeof token === 'string' && /^[\w-]{43}$/.test(token)
  const [providers, identities] = user && !user.platformAdmin && !validToken ? await Promise.all([
    enabledSocialProviders(), db.socialIdentity.findMany({ where: { userId: user.id }, select: { provider: true } })
  ]) : [[], []]
  const available = providers.filter(provider => !identities.some(identity => identity.provider === provider))
  return <div className="site"><header><Brand /></header><main className={user?.platformAdmin && !validToken ? "center mfa-account" : "center"}><article>
    <h1>{validToken ? verificar ? 'Confirmar e-mail' : 'Redefinir senha' : user ? 'Sua conta' : 'Recuperar senha'}</h1>
    <ErrorNote error={erro} />
    {solicitado && <p role="status">Se houver uma conta elegível, você receberá um e-mail com as instruções.</p>}
    {validToken ? <form action={accountLink.bind(null, verificar ? 'verify' : 'reset')}>
      <input type="hidden" name="token" value={token} />
      {!verificar && <Field label="Nova senha (mínimo 12 caracteres)" name="password" type="password" />}
      <button>{verificar ? 'Confirmar e-mail' : 'Salvar nova senha'}</button>
    </form> : user ? <>
      {user.platformAdmin && (!user.mfaSecret || user.adminMfaVerified) &&
        <MfaSetup email={user.email} enabled={Boolean(user.mfaSecret)} recoveryIssued={Boolean(user.mfaRecoveryIssuedAt)} />}
      {(available.length > 0 || identities.length > 0) && <section>
        <h2>Acesso com Google ou Apple</h2>
        {social === 'vinculado' && <p role="status" className="success">Provedor vinculado à sua conta.</p>}
        {social === 'confirmar' && <p role="alert" className="error">Confirme sua senha ou entre novamente pelo seu provedor atual antes de vincular outro.</p>}
        {identities.length > 0 && <p>Vinculados · {identities.map(item => item.provider === 'apple' ? 'Apple' : 'Google').join(', ')}</p>}
        {available.length > 0 && !user.password && <p>Para vincular outro provedor, confirme a operação até cinco minutos após entrar.</p>}
        <SocialButtons providers={available} linking password={Boolean(user.password)} />
      </section>}
      <p>{user.emailVerifiedAt ? 'E-mail confirmado' : 'E-mail aguardando confirmação'}</p>
      {!user.emailVerifiedAt && <form action={accountLink.bind(null, 'resend')}><button>Enviar confirmação</button></form>}
      <form action={accountLink.bind(null, 'revoke')}><button className="outline">Sair em todos os dispositivos</button></form>
    </> : <form action={accountLink.bind(null, 'request')}>
      <Field label="E-mail" name="email" type="email" /><button>Solicitar recuperação</button>
    </form>}
    <Link href={user ? user.platformAdmin ? user.adminMfaVerified ? '/super-admin' : '/login' : '/dashboard' : '/login'}>Voltar</Link>
  </article></main></div>
}
