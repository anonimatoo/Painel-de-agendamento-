'use client'

import { useActionState } from 'react'
import { manageSocialProvider } from '../auth-actions'
import type { SocialProvider } from '@/lib/social-oidc'

export function SocialProviderForm({ provider, callback, configured, enabled }: {
  provider: SocialProvider; callback: string; configured: boolean; enabled: boolean
}) {
  const [state, action, pending] = useActionState(manageSocialProvider.bind(null, provider), {})
  const apple = provider === 'apple'
  return <section className="provider-settings">
    <h3>{apple ? 'Apple' : 'Google'}</h3>
    <p>{enabled ? 'Ativo' : configured ? 'Configurado · Desativado' : 'Sem configuração'}</p>
    <label>URL de callback<input readOnly value={callback} /></label>
    <form action={action} aria-busy={pending}>
      <details><summary>{configured ? 'Substituir credenciais' : 'Inserir credenciais'}</summary>
        <label>{apple ? 'Services ID' : 'Client ID'}<input name="clientId" autoComplete="off" /></label>
        {apple ? <>
          <label>Team ID<input name="teamId" autoComplete="off" /></label>
          <label>Key ID<input name="keyId" autoComplete="off" /></label>
          <label>Chave privada<textarea name="secret" autoComplete="off" spellCheck={false} rows={4} /></label>
        </> : <label>Client Secret<input name="secret" type="password" autoComplete="off" /></label>}
      </details>
      <label>Sua senha<input name="password" type="password" autoComplete="current-password" required /></label>
      <div className="row">
        <button name="operation" value="save" disabled={pending}>Salvar credenciais</button>
        {configured && <>
          <button className="outline" name="operation" value="test" disabled={pending}>Testar configuração</button>
          <button className="outline" name="operation" value={enabled ? 'disable' : 'enable'} disabled={pending}>{enabled ? 'Desativar' : 'Ativar'}</button>
        </>}
      </div>
      {pending && <p role="status">Processando configuração…</p>}
      {state.message && <p role={state.success ? 'status' : 'alert'} className={state.success ? 'success' : 'error'}>{state.message}</p>}
    </form>
  </section>
}
