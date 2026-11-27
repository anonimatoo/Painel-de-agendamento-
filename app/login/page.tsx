import Link from 'next/link'
import { enabledSocialProviders } from '@/lib/social-auth'
import { SocialButtons } from '../social-buttons'
import { account } from '../actions'
import { Brand, ErrorNote, Field } from '../ui'

export default async function Login({ searchParams }: { searchParams: Promise<{ erro?: string; conta?: string; social?: string }> }) {
  const [query, providers] = await Promise.all([searchParams, enabledSocialProviders()])
  return <div className="site"><header><Brand /></header><main className="center auth-center"><article>
    <h1>Entrar</h1><ErrorNote error={query.erro} />
    {query.conta === 'reset' && <p className="success" role="status">Senha atualizada. Entre com sua nova senha.</p>}
    {query.conta === 'verify' && <p className="success" role="status">E-mail confirmado.</p>}
    {query.social === 'erro' && <p className="error" role="alert">Não foi possível entrar pelo provedor. Se você já tem conta, use seu acesso habitual e faça a vinculação em Sua conta.</p>}
    <SocialButtons providers={providers} />
    {providers.length > 0 && <p className="auth-divider">ou entre com e-mail</p>}
    <form action={account}>
      <Field label="E-mail" name="email" type="email" /><Field label="Senha" name="password" type="password" /><details><summary>Acesso de Super Admin</summary><label>Código do autenticador ou de recuperação<input name="code" autoComplete="one-time-code" maxLength={27} spellCheck={false} /></label></details><button>Entrar</button>
    </form><p><Link href="/conta">Esqueci minha senha</Link></p><p><Link href="/cadastro">Criar conta</Link></p>
  </article></main></div>
}
