'use client'

import { useState } from 'react'
import { commercialRule } from '../actions'

export function RuleEditor({ label, kind, initial, hour, leadDays, enabled }: {
  label: string; kind: string; initial: string; hour: number; leadDays: number; enabled: boolean
}) {
  const [text, setText] = useState(initial)
  return <details><summary>{label} · {enabled ? 'Ativa' : 'Desativada'}</summary>
    <form action={commercialRule}>
      <input type="hidden" name="kind" value={kind} />
      <p>Canal · E-mail do responsável confirmado</p>
      <label className="check"><input type="checkbox" name="enabled" defaultChecked={enabled} /> Ativar automação</label>
      <label>Hora de envio (Brasília)<input name="hour" type="number" min={0} max={23} defaultValue={hour} required /></label>
      <label>Dias de antecedência para avisos programados<input name="leadDays" type="number" min={0} max={60} defaultValue={leadDays} required /></label>
      <label>Mensagem<textarea name="template" value={text} onChange={event => setText(event.target.value)} minLength={10} maxLength={1500} required /></label>
      <div className="inline">{[['{evento}', 'Evento'], ['{estabelecimento}', 'Estabelecimento'], ['{detalhes}', 'Detalhes da cobrança']].map(([key, textLabel]) =>
        <button key={key} type="button" className="outline" onClick={() => setText(current => (current + ' ' + key).slice(0, 1500))}>{textLabel}</button>
      )}</div>
      <p className="preserve-lines">{text.replaceAll('{evento}', label).replaceAll('{estabelecimento}', 'Seu estabelecimento').replaceAll('{detalhes}', 'Prévia dos dados financeiros.')}</p>
      <div className="inline"><button name="operation" value="save">Salvar automação</button><button name="operation" value="test" className="outline">Enviar teste para meu e-mail</button></div>
    </form>
  </details>
}
