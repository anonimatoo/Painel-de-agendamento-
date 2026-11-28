import { can } from '@/lib/permissions'
import { redirect } from 'next/navigation'
import { membership, userSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { instanceName } from '@/lib/whatsapp'
import { messageTemplates, messageLabels } from '@/lib/whatsapp-template'
import { saveWhatsAppPreferences } from '../actions'
import { MerchantShell } from '../merchant-shell'
import { ErrorNote, Field } from '../ui'
import { WhatsAppControls } from '../whatsapp-controls'
import { MessageEditor, ReminderEditor } from './reminder-editor'

const labels: Record<string, string> = {
  QUEUED: 'Agendado', SENDING: 'Enviando', SENT: 'Aceito pelo WhatsApp',
  REVIEW: 'Envio em verificação', FAILED: 'Falha no envio', CANCELED: 'Cancelado'
}

export default async function WhatsApp({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const user = await userSession()
  if (!user) redirect('/login')
  const member = await membership(user.id)
  if (!member || !can(member, 'whatsapp.manage') || !member.tenant.active || member.tenant.suspended) redirect('/dashboard')
  const tenant = member.tenant
  const history = await db.reminder.findMany({
    where: { appointment: { tenantId: tenant.id } },
    orderBy: { runAt: 'desc' }, take: 50, select: { id: true, runAt: true, deliveryState: true, deliveryAttempts: true, providerMessageId: true }
  })
  const date = new Intl.DateTimeFormat('pt-BR', { timeZone: tenant.timezone, dateStyle: 'short', timeStyle: 'short' })
  return <MerchantShell member={member} current="/whatsapp">
    <h1>WhatsApp</h1><ErrorNote error={(await searchParams).erro} />
    <article><h2>Conectar seu número</h2><p>Abra os dispositivos conectados no WhatsApp e escaneie o código exibido.</p>
      <WhatsAppControls canRemove={tenant.whatsappInstance === instanceName(tenant.id)} />
    </article>
    <article id="preferencias"><h2>Lembretes e avisos</h2><form action={saveWhatsAppPreferences}>
      <Field label="Antecedência do lembrete em minutos. Use 0 para desativar." name="reminderMinutes" type="number" min={0} max={10080} value={tenant.reminderMinutes ?? 0} />
      <label className="check"><input type="checkbox" name="statusMessages" defaultChecked={tenant.statusMessages} /> Enviar avisos de confirmação, pagamento, reagendamento e cancelamento</label>
      {[['2880', '48 horas'], ['1440', '24 horas'], ['120', '2 horas']].map(([value, label]) => <label key={value} className="check">
        <input type="checkbox" name="presets" value={value} defaultChecked={tenant.reminderPresets.includes(Number(value))} /> Lembrar {label} antes
      </label>)}
      <label className="check"><input type="checkbox" name="completionMessages" defaultChecked={tenant.completionMessages} /> Agradecer após o atendimento e solicitar avaliação se houver um link</label>
      <Field label="Link para avaliação" name="reviewUrl" type="url" required={false} value={tenant.reviewUrl ?? ''} />
      <label className="check"><input type="checkbox" name="birthdayMessages" defaultChecked={tenant.birthdayMessages} /> Enviar felicitações a clientes que autorizaram</label>
      <Field label="Dias até lembrar do retorno (0 desativa)" name="returnAfterDays" type="number" min={0} max={365} value={tenant.returnAfterDays ?? 0} />
      <ReminderEditor initial={tenant.reminderTemplate ?? ''} /><button>Salvar preferências</button>
    </form></article>
    <article><h2>Modelos por tipo de mensagem</h2>{Object.entries(messageTemplates).map(([kind, fallback]) =>
      <MessageEditor key={kind} kind={kind} label={messageLabels[kind as keyof typeof messageLabels]} fallback={fallback}
        initial={(tenant.whatsappTemplates as Record<string,string> | null)?.[kind] ?? ''} />
    )}</article>
    <article><h2>Histórico de envios</h2>
      {history.length ? <ul>{history.map(item => <li key={item.id}>{date.format(item.runAt)} · {item.deliveryState === 'SENT' && !item.providerMessageId ? 'Envio sem confirmação do provedor' : labels[item.deliveryState]} · {item.deliveryAttempts} tentativa(s)</li>)}</ul> : <p>Nenhuma mensagem registrada.</p>}
      <p>Uma entrega em verificação aguarda confirmação antes de um novo envio.</p>
    </article>
  </MerchantShell>
}
