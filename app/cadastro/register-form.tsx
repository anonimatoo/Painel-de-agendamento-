'use client'

import { useActionState, useState } from 'react'
import { registerAccount } from '../auth-actions'

export function RegisterForm({ verifiedEmail }: { verifiedEmail?: string }) {
  const social = Boolean(verifiedEmail)
  const [state, action, pending] = useActionState(registerAccount.bind(null, social), {})
  const [showPassword, setShowPassword] = useState(false)
  const [passwordLength, setPasswordLength] = useState(0)

  return <form action={action} onSubmit={() => setPasswordLength(0)} noValidate aria-busy={pending}>
    <label>Nome do estabelecimento
      <input name="business" autoComplete="organization" maxLength={100} required defaultValue={state.business}
        aria-invalid={!!state.fields?.business} aria-describedby={state.fields?.business ? 'business-error' : undefined} />
    </label>
    {state.fields?.business && <p className="error" id="business-error" role="alert">{state.fields.business}</p>}
    {verifiedEmail ? <p>Conta confirmada pelo provedor · <strong>{verifiedEmail}</strong></p> : <>
      <label>E-mail
        <input name="email" type="email" autoComplete="email" maxLength={254} required defaultValue={state.email}
          aria-invalid={!!state.fields?.email} aria-describedby={state.fields?.email ? 'email-error' : undefined} />
      </label>
      {state.fields?.email && <p className="error" id="email-error" role="alert">{state.fields.email}</p>}
      <div>
        <label htmlFor="signup-password">Senha</label>
        <div className="stripe-credential">
          <input id="signup-password" name="password" type={showPassword ? 'text' : 'password'} required maxLength={128}
            autoComplete="new-password" onChange={event => setPasswordLength(event.target.value.length)}
            aria-invalid={!!state.fields?.password} aria-describedby="password-requirement password-error" />
          <button type="button" className="outline" onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Ocultar' : 'Mostrar'} senha</button>
        </div>
        <p id="password-requirement" className={passwordLength >= 12 ? 'success' : 'muted'}>Use de 12 a 128 caracteres.{passwordLength >= 12 && ' Requisito atendido.'}</p>
        <p id="password-error" className={state.fields?.password ? 'error' : undefined} role={state.fields?.password ? 'alert' : undefined}>{state.fields?.password}</p>
      </div>
    </>}
    {state.message && <p className="error" role="alert">{state.message}</p>}
    <button disabled={pending}>{pending ? 'Criando sua conta…' : social ? 'Concluir cadastro' : 'Criar conta'}</button>
  </form>
}
