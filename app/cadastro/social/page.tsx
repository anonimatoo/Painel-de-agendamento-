import Link from 'next/link'
import { redirect } from 'next/navigation'
import { pendingSocialSignup } from '@/lib/social-auth'
import { Brand } from '../../ui'
import { RegisterForm } from '../register-form'

export default async function SocialRegister() {
  const pending = await pendingSocialSignup()
  if (!pending) redirect('/login?social=erro')
  return <div className="site"><header><Brand /></header><main className="center auth-center"><article>
    <h1>Seu estabelecimento</h1>
    <p>Informe o nome do seu negócio para preparar a agenda.</p>
    <RegisterForm verifiedEmail={pending.email} />
    <p><Link href="/login">Voltar para entrar</Link></p>
  </article></main></div>
}
