'use client'

import { useState } from 'react'
import { messageVariables, renderMessage } from '@/lib/whatsapp-template'
import { saveMessageTemplate } from '../actions'

export function ReminderEditor({ initial }: { initial: string }) {
  const [text, setText] = useState(initial)
  const preview = (text || 'Olá! Seu atendimento em {estabelecimento} está marcado para {horario}.')
    .replaceAll('{estabelecimento}', 'Seu estabelecimento').replaceAll('{horario}', '15/12 às 14:00')
  return <>
    <label>Mensagem do lembrete<textarea name="reminderTemplate" maxLength={500} value={text} onChange={event => setText(event.target.value)} /></label>
    <div className="inline">
      <button type="button" className="outline" onClick={() => setText(value => (value + ' {estabelecimento}').slice(0, 500))}>Inserir nome do estabelecimento</button>
      <button type="button" className="outline" onClick={() => setText(value => (value + ' {horario}').slice(0, 500))}>Inserir data e horário</button>
    </div>
    <p>Prévia · {preview}</p>
  </>
}

export function MessageEditor({ initial, fallback, kind, label }: { initial: string; fallback: string; kind: string; label: string }) {
  const [text, setText] = useState(initial)
  const preview = renderMessage(text || fallback, {
    cliente: 'Cliente', estabelecimento: 'Seu estabelecimento', servico: 'Atendimento', profissional: 'Profissional',
    data: '14/12/2026', hora: '14:00', valor: 'R$ 60,00', pagamento: 'Link do pagamento',
    avaliacao: 'Link de avaliação', agendamento: 'Link de agendamento'
  })
  return <details><summary>{label}</summary><form action={saveMessageTemplate}>
    <input type="hidden" name="kind" value={kind} />
    <label>Modelo<textarea name="template" maxLength={500} value={text} onChange={event => setText(event.target.value)} placeholder={fallback} /></label>
    <div className="inline">{Object.entries(messageVariables).map(([key, label]) =>
      <button key={key} type="button" className="outline" onClick={() => setText(current => (current + ' {' + key + '}').slice(0, 500))}>{label}</button>
    )}</div>
    <p className="preserve-lines">{preview}</p><button>Salvar modelo</button>
  </form></details>
}
