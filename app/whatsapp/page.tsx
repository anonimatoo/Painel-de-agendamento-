import Link from 'next/link'
import { redirect } from 'next/navigation'
import { membership, userSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { instanceName } from '@/lib/whatsapp'
import { saveWhatsAppPreferences } from '../actions'
import { Brand, ErrorNote, Field } from '../ui'
import { WhatsAppControls } from '../whatsapp-controls'
import { ReminderEditor } from './template'

const labels: Record<string, string> = {
  QUEUED: 'Agendado', SENDING: 'Enviando', SENT: 'Aceito pelo WhatsApp',
  REVIEW: 'Envio em verificação', FAILED: 'Falha no envio', CANCELED: 'Cancelado'
}

export default async function WhatsApp({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const user = await userSession()
  if (!user) redirect('/login')
  const member = await membership(user.id)
  if (!member || member.role !== 'ADMIN' || !member.tenant.active || member.tenant.suspended) redirect('/dashboard')
  const tenant = member.tenant
  const history = await db.reminder.findMany({
    where: { appointment: { tenantId: tenant.id } },
    orderBy: { runAt: 'desc' }, take: 50, select: { id: true, runAt: true, deliveryState: true, deliveryAttempts: true }
  })
  const date = new Intl.DateTimeFormat('pt-BR', { timeZone: tenant.timezone, dateStyle: 'short', timeStyle: 'short' })
  return <div className="site"><header><Brand /><Link href="/dashboard">Voltar ao painel</Link></header><main className="content">
    <h1>WhatsApp</h1><ErrorNote error={(await searchParams).erro} />
    <article><h2>Conectar seu número</h2><p>Abra os dispositivos conectados no WhatsApp e escaneie o código exibido.</p>
      <WhatsAppControls canRemove={tenant.whatsappInstance === instanceName(tenant.id)} />
    </article>
    <article><h2>Lembretes e avisos</h2><form action={saveWhatsAppPreferences}>
      <Field label="Antecedência do lembrete em minutos. Use 0 para desativar." name="reminderMinutes" type="number" min={0} max={10080} value={tenant.reminderMinutes ?? 0} />
      <label className="check"><input type="checkbox" name="statusMessages" defaultChecked={tenant.statusMessages} /> Enviar avisos de confirmação, pagamento, reagendamento e cancelamento</label>
      <ReminderEditor initial={tenant.reminderTemplate ?? ''} /><button>Salvar preferências</button>
    </form></article>
    <article><h2>Histórico de envios</h2>
      {history.length ? <ul>{history.map(item => <li key={item.id}>{date.format(item.runAt)} · {labels[item.deliveryState]} · {item.deliveryAttempts} tentativa(s)</li>)}</ul> : <p>Nenhuma mensagem registrada.</p>}
      <p>Uma entrega em verificação aguarda confirmação antes de um novo envio.</p>
    </article>
  </main></div>
}
