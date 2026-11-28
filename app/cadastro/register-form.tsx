'use client'

import { useActionState, useState } from 'react'
import { Eye, EyeOff, Link2, LockKeyhole, Mail, Store } from 'lucide-react'
import { publicSlugBase } from '@/lib/public-slug'
import { registerAccount } from '../auth-actions'
import styles from '../public-experience.module.css'

export function RegisterForm({ verifiedEmail }: { verifiedEmail?: string }) {
  const social = Boolean(verifiedEmail)
  const [state, action, pending] = useActionState(registerAccount.bind(null, social), {})
  const [name, setName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [passwordLength, setPasswordLength] = useState(0)
  const slug = name.trim() ? publicSlugBase(name) : 'seu-estabelecimento'
  const progress = Math.min(4, Math.floor(passwordLength / 3))

  return <form action={action} onSubmit={() => setPasswordLength(0)} noValidate aria-busy={pending} className={styles.authForm}>
    <label htmlFor="signup-business">Nome do estabelecimento</label>
    <div className={styles.input}>
      <Store size={19} aria-hidden />
      <input id="signup-business" name="business" autoComplete="organization" maxLength={100} required defaultValue={state.business}
        onChange={event => setName(event.target.value)}
        aria-invalid={!!state.fields?.business} aria-describedby={state.fields?.business ? 'business-error' : undefined} />
    </div>
    {state.fields?.business && <p className={styles.fieldError} id="business-error" role="alert">{state.fields.business}</p>}
    {verifiedEmail ? <p className={styles.verifiedEmail}>Conta confirmada pelo provedor · <strong>{verifiedEmail}</strong></p> : <>
      <label htmlFor="signup-email">E-mail</label>
      <div className={styles.input}>
        <Mail size={19} aria-hidden />
        <input id="signup-email" name="email" type="email" autoComplete="email" maxLength={254} required defaultValue={state.email}
          aria-invalid={!!state.fields?.email} aria-describedby={state.fields?.email ? 'email-error' : undefined} />
      </div>
      {state.fields?.email && <p className={styles.fieldError} id="email-error" role="alert">{state.fields.email}</p>}
      <label htmlFor="signup-password">Senha</label>
      <div className={styles.input}>
        <LockKeyhole size={19} aria-hidden />
        <input id="signup-password" name="password" type={showPassword ? 'text' : 'password'} required maxLength={128}
          autoComplete="new-password" onChange={event => setPasswordLength(event.target.value.length)}
          aria-invalid={!!state.fields?.password} aria-describedby="password-requirement password-error" />
        <button type="button" className={styles.passwordToggle} aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setShowPassword(!showPassword)}>
          {showPassword ? <EyeOff size={19} aria-hidden /> : <Eye size={19} aria-hidden />}
        </button>
      </div>
      <div className={styles.passwordProgress} aria-hidden>
        {[1, 2, 3, 4].map(step => <span key={step} data-filled={step <= progress} />)}
      </div>
      <p id="password-requirement" className={styles.fieldHint}>Use de 12 a 128 caracteres.{progress === 4 && ' Requisito atendido.'}</p>
      {state.fields?.password && <p id="password-error" className={styles.fieldError} role="alert">{state.fields.password}</p>}
    </>}
    <div className={styles.slugPreview}>
      <Link2 size={18} aria-hidden />
      <div><strong>Prévia do endereço público</strong><span>/estabelecimento/{slug}</span><small>O endereço é gerado ao concluir o cadastro.</small></div>
    </div>
    {state.message && <p className="error" role="alert">{state.message}</p>}
    <button className={styles.authSubmit} disabled={pending}>{pending ? 'Criando sua conta…' : social ? 'Concluir cadastro' : 'Criar conta'}</button>
  </form>
}
