import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft, CalendarCheck2, CreditCard, MessageCircle, ShieldCheck } from 'lucide-react'
import { PublicBrand } from './public-brand'
import styles from './public-experience.module.css'

export function AuthShell({ children, mode }: { children: ReactNode; mode: 'register' | 'login' | 'admin' }) {
  const registering = mode === 'register'
  const admin = mode === 'admin'
  return <div className={styles.authPage}>
    <header className={styles.authHeader}>
      <PublicBrand />
      <Link href={registering ? '/login' : '/cadastro'}>{registering ? 'Já tenho conta' : 'Criar conta'}</Link>
    </header>
    <main className={styles.authLayout}>
      <div className={styles.authIntro}>
        <Link href="/" className={styles.back}><ArrowLeft size={16} aria-hidden /> Início</Link>
        <div className={styles.authIllustration} aria-hidden>
          <span className={styles.authCalendar}>{admin ? <ShieldCheck /> : <CalendarCheck2 />}</span>
          <span className={styles.authMiniIcon}><CreditCard /></span>
          <span className={styles.authMiniIcon}><MessageCircle /></span>
        </div>
        <h2>{admin ? 'Administração da plataforma' : 'Sua agenda profissional, em um só lugar.'}</h2>
        <p>{admin
          ? 'Use sua senha e seu segundo fator para acessar o Super Admin.'
          : 'Organize horários, receba pagamentos e compartilhe sua página de agendamento com seus clientes.'}</p>
      </div>
      <article className={styles.authCard}>{children}</article>
    </main>
    <footer className={styles.authFooter}>
      <Link href="/ajuda">Ajuda e suporte</Link>
      <Link href="/termos">Termos de uso</Link>
      <Link href="/privacidade">Privacidade</Link>
    </footer>
  </div>
}
