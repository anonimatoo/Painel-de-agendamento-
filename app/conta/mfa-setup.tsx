'use client'

import { useActionState } from 'react'
import { activateMfa, setupMfa } from '../actions'
import { Field } from '../ui'

export function MfaSetup() {
  const [state, action, pending] = useActionState(setupMfa, {})
  return <>
    <h2>Autenticação em duas etapas</h2>
    <p>Configure um aplicativo autenticador para acessar a administração.</p>
    <form action={action}><Field label="Sua senha" name="password" type="password" /><button disabled={pending}>Gerar chave do autenticador</button></form>
    {state.message && <p role="alert">{state.message}</p>}
    {state.secret && <p>Adicione uma conta baseada em tempo no aplicativo e copie a chave <strong>{state.secret}</strong>.</p>}
    <form action={activateMfa}><Field label="Código de seis dígitos do aplicativo" name="code" /><button>Ativar autenticação</button></form>
  </>
}
