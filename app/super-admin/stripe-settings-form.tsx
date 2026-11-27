'use client'

import { useActionState, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { saveStripeSettings } from '../actions'
import type { StripeSettingsFormState } from '@/lib/stripe-settings-form'

const credentialFields = {
  publishableKey: 'Chave pública',
  secret: 'Chave secreta',
  billingWebhook: 'Segredo de cobrança da assinatura',
  connectWebhook: 'Segredo de pagamentos dos estabelecimentos'
}
const empty = { publishableKey: '', secret: '', billingWebhook: '', connectWebhook: '' }

export function StripeSettingsForm({ mode }: { mode: string }) {
  const [values, setValues] = useState(empty)
  const [visible, setVisible] = useState<Partial<Record<keyof typeof empty, boolean>>>({})
  const [state, submit, pending] = useActionState(async (_: StripeSettingsFormState, form: FormData) => {
    const result = await saveStripeSettings(form)
    if (result.status === 'saved') {
      setValues(empty)
      setVisible({})
    }
    return result
  }, {})

  return <form action={submit} noValidate aria-busy={pending} className="stripe-settings-form">
    <label>Ambiente
      <select name="mode" defaultValue={mode} aria-invalid={!!state.fields?.mode} aria-describedby={state.fields?.mode ? 'stripe-mode-error' : undefined}>
        <option value="test">Teste</option><option value="live">Produção</option>
      </select>
    </label>
    {state.fields?.mode && <p className="error" id="stripe-mode-error">{state.fields.mode}</p>}
    {(Object.keys(credentialFields) as (keyof typeof empty)[]).map(field => {
      const label = credentialFields[field]
      const error = state.fields?.[field]
      return <div key={field}>
        <label htmlFor={'stripe-' + field}>{label}</label>
        <div className="stripe-credential">
          <input id={'stripe-' + field} name={field} type={visible[field] ? 'text' : 'password'}
            value={values[field]} onChange={event => setValues({ ...values, [field]: event.target.value })}
            autoComplete="off" spellCheck={false} autoCapitalize="none" required
            aria-invalid={!!error} aria-describedby={error ? 'stripe-' + field + '-error' : undefined} />
          <button type="button" className="outline" aria-label={(visible[field] ? 'Ocultar ' : 'Visualizar ') + label.toLowerCase()}
            onClick={() => setVisible({ ...visible, [field]: !visible[field] })}>
            {visible[field] ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
          </button>
        </div>
        {error && <p className="error" id={'stripe-' + field + '-error'}>{error}</p>}
      </div>
    })}
    <label>Sua senha<input name="password" type="password" autoComplete="current-password" required
      aria-invalid={!!state.fields?.password} aria-describedby={state.fields?.password ? 'stripe-password-error' : undefined} /></label>
    {state.fields?.password && <p className="error" id="stripe-password-error">{state.fields.password}</p>}
    {pending ? <p role="status">Conectando à Stripe e verificando a gravação…</p> : state.message &&
      <p className={state.status === 'saved' ? 'success' : 'error'} role={state.status === 'saved' ? 'status' : 'alert'}>{state.message}</p>}
    <button disabled={pending}>{pending ? 'Conectando…' : 'Salvar configuração'}</button>
  </form>
}
