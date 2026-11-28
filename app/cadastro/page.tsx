import Link from 'next/link'
import { enabledSocialProviders } from '@/lib/social-auth'
import { AuthShell } from '../auth-shell'
import { SocialButtons } from '../social-buttons'
import { ErrorNote } from '../ui'
import { RegisterForm } from './register-form'
import styles from '../public-experience.module.css'

export default async function Register({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const [query, providers] = await Promise.all([searchParams, enabledSocialProviders()])
  return <AuthShell mode="register">
    <h1>Criar conta</h1>
    <p>Prepare a agenda do seu estabelecimento em poucos passos.</p>
    <ErrorNote error={query.erro} />
    <RegisterForm />
    {providers.length > 0 && <div className={styles.authSocial}>
      <p className={styles.divider}>ou cadastre-se com</p><SocialButtons providers={providers} />
    </div>}
    {providers.length < 2 && <p>Se Google ou Apple não aparecer, continue com seu e-mail.</p>}
    <div className={styles.authBottom}>
      <p>Já tem conta? <Link href="/login">Entrar</Link></p>
      <Link href="/ajuda#clientes">Quero agendar como cliente</Link>
    </div>
  </AuthShell>
}
