import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Bell, CalendarCheck, Clock, Zap } from 'lucide-react'
import { db } from '@/lib/db'
import { can } from '@/lib/permissions'
import { membership, userSession } from '@/lib/auth'
import { messageLabels } from '@/lib/whatsapp-template'
import { MerchantShell } from '../merchant-shell'
import { Field } from '../ui'
import { configureMerchantNotice, queueManualReminder } from './actions'

const historyLabels: Record<string, string> = {
  CREATED: 'Reserva criada', PAYMENT_STARTED: 'Pagamento iniciado', PAYMENT_LATE: 'Pagamento tardio · em conciliação', PAYMENT_CONFIRMED: 'Pagamento e agendamento confirmados',
  CANCELED: 'Cancelamento confirmado · vaga liberada', PAYMENT_EXPIRED: 'Pagamento expirado · vaga liberada',
  RESCHEDULED: 'Agendamento alterado', COMPLETED: 'Atendimento concluído', NO_SHOW: 'Falta registrada',
  REFUND_REQUESTED: 'Estorno solicitado', REFUNDED: 'Estorno confirmado · vaga liberada'
}
const deliveryLabels: Record<string, string> = {
  QUEUED: 'Programado', SENDING: 'Em processamento', FAILED: 'Falhou', REVIEW: 'Em verificação', CANCELED: 'Cancelado'
}
const messages: Record<string, string> = {
  telefone: 'Informe o número com DDI 55 e DDD.', configurado: 'Preferências salvas.',
  indisponivel: 'Lembrete indisponível. Verifique a conexão e o consentimento do consumidor.',
  enfileirado: 'Lembrete registrado na fila.'
}

export default async function Automations({ searchParams }: { searchParams: Promise<{ atendimento?: string; estado?: string }> }) {
  const user = await userSession()
  const member = user ? await membership(user.id) : null
  if (!member?.tenant.active || member.tenant.suspended || !(can(member, 'agenda.edit') || can(member, 'whatsapp.manage'))) redirect('/dashboard')
  const { tenantId, tenant } = member
  const { atendimento, estado } = await searchParams
  const filter = typeof atendimento === 'string' ? atendimento.slice(0, 100) : undefined
  const scope = { tenantId, id: filter }
  const send = can(member, 'whatsapp.manage')
  const [history, reminders, choices] = await Promise.all([
    db.appointmentHistory.findMany({ where: { appointment: scope }, orderBy: { createdAt: 'desc' }, take: 70, include: { appointment: { select: { service: { select: { name: true } } } } } }),
    db.reminder.findMany({ where: { appointment: scope }, orderBy: { runAt: 'desc' }, take: 70,
      select: { id: true, appointmentId: true, kind: true, runAt: true, sentAt: true, deliveryState: true, providerMessageId: true, appointment: { select: { service: { select: { name: true } } } } } }),
    send ? db.appointment.findMany({ where: { tenantId, status: 'CONFIRMED', startsAt: { gt: new Date() }, consent: true }, orderBy: { startsAt: 'asc' }, take: 60, include: { service: { select: { name: true } } } }) : []
  ])
  const events = [
    ...history.map(row => ({
      id: row.id, appointment: row.appointmentId, date: row.createdAt, title: historyLabels[row.operation] ?? row.operation,
      service: row.appointment.service.name, state: ['REFUND_REQUESTED', 'PAYMENT_LATE'].includes(row.operation) ? 'Pendente' : 'Concluído', tone: ['REFUND_REQUESTED', 'PAYMENT_LATE'].includes(row.operation) ? 'PENDING' : 'COMPLETED', message: false
    })),
    ...reminders.map(row => ({
      id: row.id, appointment: row.appointmentId, date: row.sentAt ?? row.runAt,
      title: row.kind === 'MERCHANT_CONFIRMED' ? 'WhatsApp do comerciante' : 'WhatsApp do consumidor · ' + (row.kind === 'CS_AUTOMATION' ? 'Lembrete do CS Automation Pro' : row.kind === 'MANUAL_REMINDER' ? 'Lembrete manual' : messageLabels[row.kind as keyof typeof messageLabels] ?? row.kind),
      service: row.appointment.service.name, state: row.deliveryState === 'SENT' ? (row.providerMessageId ? 'Aceito pelo provedor' : 'Sem confirmação do provedor') : deliveryLabels[row.deliveryState] ?? 'Em verificação', tone: row.deliveryState === 'SENT' && !row.providerMessageId ? 'REVIEW' : row.deliveryState, message: true
    }))
  ].sort((a, b) => +b.date - +a.date).slice(0, 100)
  const date = (value: Date) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: tenant.timezone }).format(value)
  return <MerchantShell member={member} current="/automacoes">
    <section className="workspace-heading"><div><h1><Zap aria-hidden /> Central de automações</h1><p>Acompanhe reservas, pagamentos e mensagens do estabelecimento.</p></div>{send && <Link className="button" href="/automacoes/editor">CS Automation Pro</Link>}{can(member, 'finance.read') && <Link className="button outline" href="/recebimentos">Conciliar pagamentos</Link>}</section>
    {estado && messages[estado] && <p role="status" className={estado === 'telefone' || estado === 'indisponivel' ? 'error' : 'success'}>{messages[estado]}</p>}
    <div className="consumer-panels">
      <article className="commercial-panel"><h2><Clock aria-hidden /> Linha do tempo</h2>
        {filter && <p><Link href="/automacoes">Ver todos os atendimentos</Link></p>}
        {events.length === 0 ? <p className="surface-empty">Os eventos aparecerão aqui quando houver reservas ou mensagens agendadas.</p> : <ol className="automation-timeline">{events.map(event => <li key={event.id}>
          <span className="automation-icon">{event.message ? <Bell size={18} aria-hidden /> : <CalendarCheck size={18} aria-hidden />}</span>
          <div><Link href={'/automacoes?atendimento=' + encodeURIComponent(event.appointment)}>{event.title}</Link><small>{event.service} · {date(event.date)}</small></div><span className="state-pill" data-state={event.tone}>{event.state}</span>
        </li>)}</ol>}
      </article>
      {send && <div>
        <article id="enviar-lembrete"><h2>Enviar lembrete</h2>
          {!tenant.whatsappInstance ? <p>Conecte o WhatsApp para enviar lembretes. <Link href="/whatsapp">Configurar WhatsApp</Link></p> : choices.length ? <form action={queueManualReminder}>
            <label>Atendimento<select name="id" required>{choices.map(row => <option key={row.id} value={row.id}>{date(row.startsAt)} · {row.service.name}</option>)}</select></label><button>Programar envio</button>
          </form> : <p>Nenhum atendimento futuro com autorização para receber mensagens.</p>}
        </article>
        <article><h2>Confirmações para o comerciante</h2><p>Informe um número do estabelecimento autorizado a receber notificações de novas reservas. Apague o número para desativar.</p>
          <form action={configureMerchantNotice}><Field label="WhatsApp do comerciante com DDI" name="phone" type="tel" required={false} value={tenant.merchantNoticePhone ?? ''} /><button>Salvar preferências</button></form>
        </article>
      </div>}
    </div>
  </MerchantShell>
}
