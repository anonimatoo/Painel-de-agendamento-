'use client'

import { useActionState } from 'react'
import { manageResend } from './resend-actions'

export function ResendForm({ sender }: { sender?: string }) {
  const [state, action, pending] = useActionState(manageResend, {})
  return <details><summary>Configurar ou testar e-mail</summary>
    <form className="inline" action={action}>
      <label>Remetente<input name="sender" type="email" defaultValue={sender} /></label>
      <label>Chave Resend<input name="apiKey" type="password" autoComplete="off" /></label>
      <label>Sua senha<input name="password" type="password" autoComplete="current-password" required /></label>
      <button name="command" value="save" disabled={pending}>Salvar configuração</button>
      <button className="outline" name="command" value="test" disabled={pending}>Enviar teste para meu e-mail</button>
    </form>
    {pending && <p role="status">Aguarde…</p>}
    {state.message && <p className={state.success ? 'success' : 'error'} role={state.success ? 'status' : 'alert'}>{state.message}</p>}
  </details>
}
