'use client'

import { useState, type FormEvent } from 'react'
import { useFormStatus } from 'react-dom'
import { Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from 'lucide-react'
import { account } from '../actions'
import styles from '../public-experience.module.css'

export function LoginForm({ admin }: { admin: boolean }) {
  const [visible, setVisible] = useState(false)
  const [fields, setFields] = useState<{ email?: string; password?: string; code?: string }>({})

  function validate(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget)
    const email = String(data.get('email') ?? '').trim()
    const password = String(data.get('password') ?? '')
    const next: typeof fields = {}
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = 'Informe um e-mail válido.'
    if (password.length < 12 || password.length > 128) next.password = 'Use uma senha de 12 a 128 caracteres.'
    setFields(next)
    if (Object.keys(next).length) event.preventDefault()
  }

  return <form action={account} className={styles.authForm} noValidate onSubmit={validate}>
    {admin && <input type="hidden" name="access" value="admin" />}
    <label htmlFor="login-email">E-mail</label>
    <div className={styles.input}>
      <Mail size={19} aria-hidden />
      <input id="login-email" name="email" type="email" required autoComplete="username" maxLength={254}
        aria-invalid={!!fields.email} aria-describedby={fields.email ? 'login-email-error' : undefined} />
    </div>
    {fields.email && <p id="login-email-error" className={styles.fieldError} role="alert">{fields.email}</p>}
    <label htmlFor="login-password">Senha</label>
    <div className={styles.input}>
      <LockKeyhole size={19} aria-hidden />
      <input id="login-password" name="password" type={visible ? 'text' : 'password'} required maxLength={128} autoComplete="current-password"
        aria-invalid={!!fields.password} aria-describedby={fields.password ? 'login-password-error' : undefined} />
      <button type="button" className={styles.passwordToggle} aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setVisible(!visible)}>
        {visible ? <EyeOff size={19} aria-hidden /> : <Eye size={19} aria-hidden />}
      </button>
    </div>
    {fields.password && <p id="login-password-error" className={styles.fieldError} role="alert">{fields.password}</p>}
    <details className={styles.adminDetails} open={admin || undefined}>
      <summary><ShieldCheck size={16} aria-hidden /> Acesso de Super Admin</summary>
      <label htmlFor="login-code">Código do autenticador ou de recuperação</label>
      <input id="login-code" name="code" autoComplete="one-time-code" maxLength={27} spellCheck={false}
        aria-invalid={!!fields.code} aria-describedby={fields.code ? 'login-code-error' : undefined} />
      {fields.code && <p id="login-code-error" className={styles.fieldError} role="alert">{fields.code}</p>}
    </details>
    <Submit />
  </form>
}

function Submit() {
  const { pending } = useFormStatus()
  return <button className={styles.authSubmit} disabled={pending}>{pending ? 'Entrando…' : 'Entrar'}</button>
}
