import Link from 'next/link'
import { redirect } from 'next/navigation'
import { pendingSocialSignup } from '@/lib/social-auth'
import { AuthShell } from '../../auth-shell'
import { RegisterForm } from '../register-form'
import styles from '../../public-experience.module.css'

export default async function SocialRegister() {
  const pending = await pendingSocialSignup()
  if (!pending || pending.consumerSlug) redirect('/login?social=erro')
  return <AuthShell mode="register">
    <h1>Seu estabelecimento</h1>
    <p>Informe o nome do seu negócio para preparar a agenda.</p>
    <RegisterForm verifiedEmail={pending.email} />
    <Link className={styles.authReset} href="/login">Voltar para entrar</Link>
  </AuthShell>
}
