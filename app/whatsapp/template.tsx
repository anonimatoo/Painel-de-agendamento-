'use client'

import { useState } from 'react'

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
