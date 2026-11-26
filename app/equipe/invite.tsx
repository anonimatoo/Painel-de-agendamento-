'use client'

import { useActionState } from 'react'
import { createTeamInvite } from '../actions'
import { Field } from '../ui'

export function InviteForm({ professionals }: { professionals: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createTeamInvite, {})
  return <>
    <form action={action}>
      <Field label="E-mail da pessoa convidada" name="email" type="email" />
      <label>Função<select name="role"><option value="MANAGER">Gerência</option><option value="RECEPTION">Recepção</option><option value="PROFESSIONAL">Profissional</option><option value="FINANCE">Financeiro</option><option value="READONLY">Consulta</option></select></label>
      <label>Vínculo para função de profissional<select name="professionalId"><option value="">Selecione</option>
        {professionals.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
      </select></label>
      <button disabled={pending}>Criar convite</button>
    </form>
    {state.message && <p role="alert">{state.message}</p>}
    {state.link && <label>Compartilhe este convite por um canal privado. Válido por 24 horas.<input value={state.link} readOnly /></label>}
  </>
}
