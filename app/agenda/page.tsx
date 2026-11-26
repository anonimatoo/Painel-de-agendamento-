import { can } from '@/lib/permissions'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { DateTime } from 'luxon'
import { membership, userSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { manage } from '../actions'
import { Brand, ErrorNote, Field } from '../ui'

const operations: Record<string, string> = {
  PAYMENT_CONFIRMED: 'Pagamento confirmado', CREATED: 'Reserva criada', RESCHEDULED: 'Reagendado', CANCELED: 'Cancelado', COMPLETED: 'Concluído', NO_SHOW: 'Falta registrada'
}

export default async function AgendaPage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const user = await userSession()
  if (!user) redirect('/login')
  const member = await membership(user.id)
  if (!member || (!can(member, 'agenda.read') || member.role === 'PROFESSIONAL') || !member.tenant.active || member.tenant.suspended) redirect('/dashboard')
  const tenantId = member.tenantId
  const manager = can(member, 'team.professionals') && can(member, 'agenda.edit')
  const zone = member.tenant.timezone
  const now = new Date()
  const create = can(member, 'agenda.create') && can(member, 'customer.read')
  const [appointments, professionals, blocks, waiting, history, customers, services] = await Promise.all([
    db.appointment.findMany({ where: { tenantId, startsAt: { gt: now }, status: 'CONFIRMED' }, orderBy: { startsAt: 'asc' }, take: 100, include: { service: true, professional: true, customer: true } }),
    manager || create ? db.professional.findMany({ where: { tenantId, active: true } }) : [],
    db.scheduleBlock.findMany({ where: { tenantId, endsAt: { gt: now } }, orderBy: { startsAt: 'asc' }, include: { professional: true } }),
    db.waitEntry.findMany({ where: { tenantId, closedAt: null }, orderBy: { day: 'asc' }, take: 100, include: { professional: true, service: true } }),
    db.appointmentHistory.findMany({ where: { appointment: { tenantId } }, orderBy: { createdAt: 'desc' }, take: 50, include: { appointment: { include: { service: true } } } }),
    create ? db.customer.findMany({ where: { tenantId }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 200 }) : [],
    create ? db.service.findMany({ where: { tenantId, active: true }, select: { id: true, name: true } }) : []
  ])
  const date = (value: Date) => DateTime.fromJSDate(value, { zone }).toFormat('dd/LL/yyyy HH:mm')
  return <div className="site"><header><Brand /><Link href="/dashboard">Voltar ao painel</Link></header><main className="content">
    <h1>Agenda</h1><ErrorNote error={(await searchParams).erro} />
    {create && <article><h2>Novo agendamento presencial</h2>
      {customers.length && services.length && professionals.length ? <form className="inline" action={manage.bind(null, 'booking')}>
        <label>Cliente<select name="customerId">{customers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Serviço<select name="serviceId">{services.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Profissional<select name="professionalId">{professionals.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <Field label="Data e horário" name="startsAt" type="datetime-local" /><button>Criar agendamento</button>
      </form> : <p>Cadastre primeiro o cliente, o serviço, o profissional e os horários de atendimento.</p>}
    </article>}
    <article><h2>Próximos atendimentos</h2>
      {!appointments.length && <p>Nenhum atendimento confirmado.</p>}
      {appointments.map(item => <details key={item.id}>
        <summary>{date(item.startsAt)} · {item.customer.name} · {item.service.name} · {item.professional.name}</summary>
        {can(member, 'agenda.edit') && <form className="inline" action={manage.bind(null, 'reschedule')}>
          <input type="hidden" name="id" value={item.id} /><Field label="Nova data e horário" name="startsAt" type="datetime-local" /><button>Reagendar</button>
        </form>}
      </details>)}
    </article>
    <article><h2>Bloqueios</h2>
      {manager && professionals.length > 0 && <form className="inline" action={manage.bind(null, 'block')}>
        <label>Profissional<select name="professionalId">{professionals.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <Field label="Início" name="startsAt" type="datetime-local" /><Field label="Fim" name="endsAt" type="datetime-local" />
        <Field label="Motivo, como férias ou feriado" name="reason" /><button>Bloquear horário</button>
      </form>}
      {blocks.length ? <ul>{blocks.map(item => <li key={item.id}>
        {date(item.startsAt)} a {date(item.endsAt)} · {item.professional.name} · {item.reason}
        {manager && <form action={manage.bind(null, 'unblock')}><input type="hidden" name="id" value={item.id} /><button className="outline">Remover bloqueio</button></form>}
      </li>)}</ul> : <p>Nenhum horário bloqueado.</p>}
    </article>
    <article><h2>Lista de espera</h2>
      {waiting.length ? <ul>{waiting.map(item => <li key={item.id}>
        {DateTime.fromISO(item.day, { zone }).toFormat('dd/LL/yyyy')} · {item.name} · {item.service.name} · {item.professional.name} {can(member, 'customer.read') && ' · +' + item.phone}
        {can(member, 'agenda.edit') && <form action={manage.bind(null, 'wait-close')}><input type="hidden" name="id" value={item.id} /><button className="outline">Encerrar solicitação</button></form>}
      </li>)}</ul> : <p>Nenhuma solicitação em aberto.</p>}
    </article>
    <article><h2>Histórico recente</h2>
      {history.length ? <ul>{history.map(item => <li key={item.id}>
        {date(item.createdAt)} · {operations[item.operation] ?? 'Atualizado'} · {item.appointment.service.name}{item.newStart && ' · ' + date(item.newStart)}
      </li>)}</ul> : <p>Nenhuma alteração registrada.</p>}
    </article>
  </main></div>
}
