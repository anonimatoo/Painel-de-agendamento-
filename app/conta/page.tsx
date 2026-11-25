import Link from 'next/link'
import { userSession } from '@/lib/auth'
import { accountLink } from '../actions'
import { Brand, ErrorNote, Field } from '../ui'

export default async function Account({ searchParams }: {
  searchParams: Promise<{ token?: string; verificar?: string; solicitado?: string; erro?: string }>
}) {
  const { token, verificar, solicitado, erro } = await searchParams
  const user = await userSession()
  const validToken = typeof token === 'string' && /^[\w-]{43}$/.test(token)
  return <div className="site"><header><Brand /></header><main className="center"><article>
    <h1>{validToken ? verificar ? 'Confirmar e-mail' : 'Redefinir senha' : user ? 'Sua conta' : 'Recuperar senha'}</h1>
    <ErrorNote error={erro} />
    {solicitado && <p role="status">Se houver uma conta elegível, você receberá um e-mail com as instruções.</p>}
    {validToken ? <form action={accountLink.bind(null, verificar ? 'verify' : 'reset')}>
      <input type="hidden" name="token" value={token} />
      {!verificar && <Field label="Nova senha (mínimo 12 caracteres)" name="password" type="password" />}
      <button>{verificar ? 'Confirmar e-mail' : 'Salvar nova senha'}</button>
    </form> : user ? <>
      <p>{user.emailVerifiedAt ? 'E-mail confirmado' : 'E-mail aguardando confirmação'}</p>
      {!user.emailVerifiedAt && <form action={accountLink.bind(null, 'resend')}><button>Enviar confirmação</button></form>}
      <form action={accountLink.bind(null, 'revoke')}><button className="outline">Sair em todos os dispositivos</button></form>
    </> : <form action={accountLink.bind(null, 'request')}>
      <Field label="E-mail" name="email" type="email" /><button>Solicitar recuperação</button>
    </form>}
    <Link href={user ? user.platformAdmin ? '/super-admin' : '/dashboard' : '/login'}>Voltar</Link>
  </article></main></div>
}
