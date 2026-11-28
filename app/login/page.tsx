import Link from 'next/link'
import { enabledSocialProviders } from '@/lib/social-auth'
import { SocialButtons } from '../social-buttons'
import { AuthShell } from '../auth-shell'
import { ErrorNote } from '../ui'
import { LoginForm } from './login-form'
import styles from '../public-experience.module.css'

export default async function Login({ searchParams }: {
  searchParams: Promise<{ erro?: string; conta?: string; social?: string; acesso?: string }>
}) {
  const query = await searchParams
  const admin = query.acesso === 'admin'
  const providers = admin ? [] : await enabledSocialProviders()
  return <AuthShell mode={admin ? 'admin' : 'login'}>
    <h1>{admin ? 'Entrar como Super Admin' : 'Entrar'}</h1>
    <p>{admin ? 'Entre com as credenciais administrativas.' : 'Acesse a agenda e gerencie seu estabelecimento.'}</p>
    <ErrorNote error={query.erro} />
    {query.conta === 'reset' && <p className="success" role="status">Senha atualizada. Entre com sua nova senha.</p>}
    {query.conta === 'verify' && <p className="success" role="status">E-mail confirmado.</p>}
    {query.social === 'erro' && <p className="error" role="alert">Não foi possível entrar pelo provedor. Se você já tem conta, use seu acesso habitual e faça a vinculação em Sua conta.</p>}
    <LoginForm admin={admin} />
    <Link href="/conta" className={styles.authReset}>Esqueci minha senha</Link>
    {providers.length > 0 && <div className={styles.authSocial}>
      <p className={styles.divider}>ou entre com</p><SocialButtons providers={providers} />
    </div>}
    <div className={styles.authBottom}>
      {admin ? <Link href="/login">Acesso do comerciante</Link> : <>
        <p>Não tem conta? <Link href="/cadastro">Criar conta</Link></p>
        <Link href="/ajuda#clientes">Quero agendar como cliente</Link>
        <Link href="/login?acesso=admin">Painel Super Admin</Link>
      </>}
    </div>
  </AuthShell>
}
