'use client'

import { useActionState } from 'react'
import { whatsappControl } from './actions'

export function WhatsAppControls({ canRemove = false }: { canRemove?: boolean }) {
  const [state, action, pending] = useActionState(whatsappControl, {})
  return <>
    <form action={action} className="inline">
      <button name="operation" value="status" disabled={pending} className="outline">Consultar situação</button>
      <button name="operation" value="connect" disabled={pending} className="outline">Conectar meu WhatsApp ou atualizar QR</button>
      <button name="operation" value="logout" disabled={pending} className="outline">Desconectar</button>
      <label>Seu número para teste, com DDI<input type="tel" name="phone" /></label>
      <button name="operation" value="test" disabled={pending} className="outline">Enviar mensagem de teste</button>
    </form>
    {canRemove && <details><summary>Excluir conexão</summary><form action={action} className="inline">
      <label className="check"><input type="checkbox" name="confirm" /> Confirmo que quero apagar a conexão e cancelar os lembretes pendentes</label>
      <button name="operation" value="remove" disabled={pending} className="outline">Excluir conexão</button>
    </form></details>}
    {state.message && <p role="status">{state.message}</p>}
    {state.qr && <img width={240} height={240} src={state.qr} alt="QR Code para conectar seu WhatsApp" />}
  </>
}
