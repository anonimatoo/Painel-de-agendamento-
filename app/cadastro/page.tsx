import Link from 'next/link'
import { enabledSocialProviders } from '@/lib/social-auth'
import { SocialButtons } from '../social-buttons'
import { Brand, ErrorNote } from '../ui'
import { RegisterForm } from './register-form'

export default async function Register({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const [query, providers] = await Promise.all([searchParams, enabledSocialProviders()])
  return <div className="site"><header><Brand /></header><main className="center auth-center"><article>
    <h1>Criar conta</h1>
    <p>Crie a agenda do seu estabelecimento. O endereço da sua página é gerado automaticamente.</p>
    <ErrorNote error={query.erro} />
    <SocialButtons providers={providers} />
    {providers.length > 0 && <p className="auth-divider">ou cadastre-se com e-mail</p>}
    <RegisterForm />
    <p><Link href="/login">Já tenho conta</Link></p>
  </article></main></div>
}
