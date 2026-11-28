import { type Status } from '@prisma/client'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { DateTime } from 'luxon'
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, Clock3, Filter, History, LockKeyhole, UsersRound } from 'lucide-react'
import { availability } from '@/lib/agenda'
import { membership, userSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { can } from '@/lib/permissions'
import { manage } from '../actions'
import { MerchantShell } from '../merchant-shell'
import { ErrorNote, Field, brl } from '../ui'
import { calendarAppointment } from './actions'
import styles from './calendar.module.css'

const statuses = {
  PENDING: 'Aguardando pagamento', CONFIRMED: 'Confirmado', COMPLETED: 'Concluído',
  CANCELED: 'Cancelado', NO_SHOW: 'Falta registrada'
} satisfies Record<Status, string>

const operations: Record<string, string> = {
  PAYMENT_CONFIRMED: 'Pagamento confirmado', CREATED: 'Reserva criada', RESCHEDULED: 'Reagendado',
  CANCELED: 'Cancelado', COMPLETED: 'Concluído', NO_SHOW: 'Falta registrada', REFUNDED: 'Estornado'
}

type CalendarQuery = {
  erro?: string; alterado?: string; dia?: string; visual?: string; profissional?: string; servico?: string; situacao?: string; horario?: string
}

export default async function AgendaPage({ searchParams }: { searchParams: Promise<CalendarQuery> }) {
  const user = await userSession()
  if (!user) return redirect('/login')
  const member = await membership(user.id)
  if (!member || !can(member, 'agenda.read') || !member.tenant.active || member.tenant.suspended) return redirect('/dashboard')
  const { tenantId, tenant, role } = member
  const professionalOnly = role === 'PROFESSIONAL'
  if (professionalOnly && !member.professionalId) return redirect('/dashboard')

  const query = await searchParams
  const manager = can(member, 'team.professionals') && can(member, 'agenda.edit')
  const customerVisible = can(member, 'customer.read')
  const create = can(member, 'agenda.create') && customerVisible
  const zone = tenant.timezone
  const now = DateTime.now().setZone(zone).setLocale('pt-BR')
  const requestedDay = typeof query.dia === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.dia) ? DateTime.fromISO(query.dia, { zone }) : null
  const day = requestedDay?.isValid ? requestedDay.startOf('day') : now.startOf('day')
  const view = query.visual === 'mes' || query.visual === 'semana' ? query.visual : 'dia'
  const start = view === 'semana' ? day.startOf('week') : view === 'mes' ? day.startOf('month').startOf('week') : day
  const end = view === 'semana' ? start.plus({ weeks: 1 })
    : view === 'mes' ? day.endOf('month').endOf('week').plus({ milliseconds: 1 }) : day.plus({ days: 1 })
  const period = { startsAt: { lt: end.toJSDate() }, endsAt: { gt: start.toJSDate() } }
  const professionalId = professionalOnly ? member.professionalId! : typeof query.profissional === 'string' ? query.profissional : undefined
  const serviceId = typeof query.servico === 'string' && query.servico ? query.servico : undefined
  const status = typeof query.situacao === 'string' && Object.hasOwn(statuses, query.situacao) ? query.situacao as Status : undefined
  const filters = new URLSearchParams({ dia: day.toISODate()!, visual: view })
  if (professionalId && !professionalOnly) filters.set('profissional', professionalId)
  if (serviceId) filters.set('servico', serviceId)
  if (status) filters.set('situacao', status)
  function calendarLink(visible: string, date: DateTime, slot?: string) {
    const params = new URLSearchParams(filters)
    params.set('dia', date.toISODate()!)
    params.set('visual', visible)
    if (slot) params.set('horario', slot)
    return '/agenda?' + params + (slot ? '#novo-agendamento' : '')
  }

  const [appointments, professionals, blocks, waiting, history, customers, services] = await Promise.all([
    db.appointment.findMany({
      where: { tenantId, professionalId: professionalId || undefined, serviceId, status, ...period }, orderBy: { startsAt: 'asc' },
      select: {
        id: true, startsAt: true, endsAt: true, status: true, paidAt: true, cents: true, chargeCents: true, refundedAt: true,
        service: { select: { name: true } }, professional: { select: { name: true } },
        customer: customerVisible ? { select: { name: true } } : false
      }
    }),
    db.professional.findMany({ where: { tenantId, ...(professionalOnly ? { id: professionalId } : {}) }, orderBy: { name: 'asc' } }),
    db.scheduleBlock.findMany({ where: { tenantId, professionalId: professionalId || undefined, ...period }, orderBy: { startsAt: 'asc' }, include: { professional: true } }),
    professionalOnly ? [] : db.waitEntry.findMany({ where: { tenantId, closedAt: null }, orderBy: { day: 'asc' }, take: 100, include: { professional: true, service: true } }),
    db.appointmentHistory.findMany({
      where: { appointment: { tenantId, ...(professionalOnly ? { professionalId } : {}) } }, orderBy: { createdAt: 'desc' }, take: 35,
      include: { appointment: { include: { service: true } } }
    }),
    create ? db.customer.findMany({ where: { tenantId }, select: { id: true, name: true }, orderBy: { name: 'asc' }, take: 200 }) : [],
    db.service.findMany({ where: { tenantId }, select: { id: true, name: true, active: true }, orderBy: { name: 'asc' } })
  ])

  const days = Array.from({ length: Math.round(end.diff(start, 'days').days) }, (_, index) => start.plus({ days: index }))
  const free = view !== 'mes' && serviceId && professionalId
    ? await Promise.all(days.map(date => availability(tenant, serviceId, professionalId, date.toISODate()!)))
    : []
  const date = (value: Date) => DateTime.fromJSDate(value, { zone })
  const formatted = (value: Date) => date(value).toFormat('dd/LL/yyyy HH:mm')
  const overlapping = (from: Date, to: Date, date: DateTime) => +from < +date.plus({ days: 1 }) && +to > +date
  const interval = view === 'dia' ? day.toFormat('cccc, dd LLLL yyyy') : view === 'semana'
    ? start.toFormat('dd LLL') + ' – ' + end.minus({ days: 1 }).toFormat('dd LLL yyyy') : day.toFormat('LLLL yyyy')
  const step = view === 'dia' ? { days: 1 } : view === 'semana' ? { weeks: 1 } : { months: 1 }
  const activeProfessionals = professionals.filter(item => item.active)
  const activeServices = services.filter(item => item.active)
  const bookingSelection = /^\d{2}:\d{2}$/.test(query.horario ?? '') ? day.toISODate() + 'T' + query.horario : undefined

  function appointmentDetails(item: typeof appointments[number]) {
    const paid = Boolean(item.paidAt)
    const future = +item.startsAt > +now
    const confirmed = item.status === 'CONFIRMED'
    const appointmentClass = item.refundedAt ? styles.refunded : styles[item.status.toLowerCase()]
    return <details key={item.id} className={styles.event}>
      <summary>
        <time>{date(item.startsAt).toFormat('HH:mm')}</time>
        <span><strong>{item.service.name}</strong><small>{item.customer?.name ? item.customer.name + ' · ' : ''}{item.professional.name}</small></span>
        <span className={styles.status + ' ' + appointmentClass}>{item.refundedAt ? 'Estornado' : statuses[item.status]}</span>
      </summary>
      <div className={styles.eventDetails}>
        <p><Clock3 size={15} aria-hidden /> {formatted(item.startsAt)} – {date(item.endsAt).toFormat('HH:mm')}</p>
        {can(member, 'finance.read') && <p>{paid ? 'Pagamento registrado de ' + brl(item.chargeCents ?? item.cents) : 'Valor do atendimento ' + brl(item.cents)}</p>}
        {confirmed && future && can(member, 'agenda.edit') && <form className="inline" action={calendarAppointment}>
          <input type="hidden" name="id" value={item.id} /><input type="hidden" name="calendar" value={filters.toString()} />
          <Field label="Nova data e horário" name="startsAt" type="datetime-local" /><button name="operation" value="RESCHEDULE">Reagendar</button>
        </form>}
        <form className="inline" action={calendarAppointment}>
          <input type="hidden" name="id" value={item.id} /><input type="hidden" name="calendar" value={filters.toString()} />
          {confirmed && !future && can(member, 'agenda.edit') && <>
            <button className="outline" name="operation" value="COMPLETED">Concluir</button>
            <button className="outline" name="operation" value="NO_SHOW">Registrar falta</button>
          </>}
          {confirmed && !paid && can(member, 'agenda.cancel') && <button className="outline" name="operation" value="CANCELED">Cancelar</button>}
          {confirmed && paid && !item.refundedAt && can(member, 'finance.refund') && <button className="outline" name="operation" value="REFUND">Estornar e cancelar</button>}
          {item.status === 'PENDING' && can(member, 'finance.read') && <button className="outline" name="operation" value="REVIEW">Consultar pagamento e confirmar</button>}
        </form>
      </div>
    </details>
  }

  return <MerchantShell member={member} current="/agenda">
    <div className={styles.calendarPage}>
      <div className={styles.heading}><div><h1><CalendarDays aria-hidden /> Agenda</h1><p>Acompanhe horários, atendimentos e reservas do estabelecimento.</p></div>
        {create && <a className="button" href="#novo-agendamento"><CalendarPlus aria-hidden size={18} /> Novo agendamento</a>}
      </div>
      <ErrorNote error={query.erro} />
      {query.alterado && <p className="success" role="status">{query.alterado === 'consulta' ? 'Consulta concluída. Veja a situação atual da reserva.' : query.alterado === 'estorno' ? 'Solicitação executada. Consulte o andamento em Recebimentos.' : 'Agenda atualizada.'}</p>}
      <article className={styles.calendar}>
        <div className={styles.toolbar}>
          <div className={styles.dateControls}>
            <Link href={calendarLink(view, day.minus(step))} aria-label="Período anterior"><ChevronLeft size={20} /></Link>
            <h2>{interval}</h2>
            <Link href={calendarLink(view, day.plus(step))} aria-label="Próximo período"><ChevronRight size={20} /></Link>
            <Link className={styles.today} href={calendarLink(view, now)}>Hoje</Link>
          </div>
          <nav aria-label="Visualização da agenda" className={styles.tabs}>
            {[['dia', 'Dia'], ['semana', 'Semana'], ['mes', 'Mês']].map(([item, name]) => <Link aria-current={view === item ? 'page' : undefined} key={item} href={calendarLink(item, day)}>{name}</Link>)}
          </nav>
        </div>
        <form className={styles.filters}>
          <input type="hidden" name="visual" value={view} />
          <Field label="Data de referência" name="dia" type="date" value={day.toISODate()!} required={false} />
          {!professionalOnly && <label>Profissional<select name="profissional" defaultValue={professionalId || ''}><option value="">Todos</option>{professionals.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          <label>Serviço<select name="servico" defaultValue={serviceId ?? ''}><option value="">Todos</option>{services.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Situação<select name="situacao" defaultValue={status ?? ''}><option value="">Todas</option>{Object.entries(statuses).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label>
          <button type="submit" className="outline"><Filter size={16} aria-hidden /> Filtrar</button>
        </form>
        {view === 'mes' ? <>
          <div className={styles.weekdays} aria-hidden>{['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map(item => <span key={item}>{item}</span>)}</div>
          <div className={styles.month}>
            {days.map(dayOfMonth => {
              const events = appointments.filter(item => overlapping(item.startsAt, item.endsAt, dayOfMonth))
              const blocked = blocks.filter(item => overlapping(item.startsAt, item.endsAt, dayOfMonth)).length
              return <Link aria-label={dayOfMonth.toFormat('dd LLLL') + ', ' + events.length + ' atendimentos e ' + blocked + ' bloqueios'}
                data-outside={dayOfMonth.month !== day.month} key={dayOfMonth.toISODate()} href={calendarLink('dia', dayOfMonth)}>
                <span className={styles.dateNumber} data-today={dayOfMonth.hasSame(now, 'day')}>{dayOfMonth.day}</span>
                {events.length > 0 && <span className={styles.monthEvents}>{events.length} <span>atend.</span></span>}
                {blocked > 0 && <span className={styles.monthBlocks}>{blocked} <LockKeyhole size={12} aria-hidden /></span>}
              </Link>
            })}
          </div>
        </> : <div className={view === 'semana' ? styles.week : styles.singleDay}>
          {days.map((dateOfWeek, index) => {
            const events = appointments.filter(item => overlapping(item.startsAt, item.endsAt, dateOfWeek))
            const interruptions = blocks.filter(item => overlapping(item.startsAt, item.endsAt, dateOfWeek))
            const slots = free[index]
            return <section key={dateOfWeek.toISODate()} className={styles.day}>
              {view === 'semana' && <h3><Link href={calendarLink('dia', dateOfWeek)}>{dateOfWeek.toFormat('ccc dd')}</Link></h3>}
              {!events.length && !interruptions.length && <p className={styles.dayEmpty}>Sem compromissos neste dia.</p>}
              {events.map(appointmentDetails)}
              {interruptions.map(item => <div className={styles.block} key={item.id}>
                <LockKeyhole size={15} aria-hidden /><div><strong>Horário bloqueado</strong><small>{date(item.startsAt).toFormat('dd/LL HH:mm')} – {date(item.endsAt).toFormat('dd/LL HH:mm')} · {item.professional.name}</small><span>{item.reason}</span></div>
                {manager && <form action={manage.bind(null, 'unblock')}><input type="hidden" name="destination" value="agenda" /><input type="hidden" name="id" value={item.id} /><button className="outline">Remover bloqueio</button></form>}
              </div>)}
              {slots && <div className={styles.availability}>
                <h4>Horários disponíveis <small>{slots.length}</small></h4>
                {slots.length === 0 && <p>Nenhum horário disponível para a seleção.</p>}
                {slots.length > 0 && <div>{slots.map(slot => create
                  ? <Link key={slot.start} href={calendarLink('dia', dateOfWeek, slot.label)}>{slot.label}</Link>
                  : <span key={slot.start}>{slot.label}</span>)}</div>}
              </div>}
            </section>
          })}
        </div>}
        <footer className={styles.legend}>
          {Object.entries(statuses).map(([item, label]) => <span key={item} className={styles.status + ' ' + styles[item.toLowerCase()]}>{label}</span>)}
          <span className={styles.status + ' ' + styles.blocked}>Bloqueado</span>
          <span className={styles.status + ' ' + styles.available}>Disponível</span>
        </footer>
        {view !== 'mes' && !free.length && <p className={styles.hint}>Selecione um profissional e um serviço para calcular os horários disponíveis.</p>}
      </article>
      <div className={styles.tools}>
        {create && <article id="novo-agendamento"><h2><CalendarPlus aria-hidden /> Novo agendamento presencial</h2>
          {customers.length > 0 && activeServices.length > 0 && activeProfessionals.length > 0 ? <form className={styles.formGrid} action={manage.bind(null, 'booking')}><input type="hidden" name="destination" value="agenda" />
            <label>Cliente<select name="customerId" required><option value="">Selecione</option>{customers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>Serviço<select name="serviceId" defaultValue={serviceId ?? ''} required><option value="">Selecione</option>{activeServices.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>Profissional<select name="professionalId" defaultValue={professionalId ?? ''} required><option value="">Selecione</option>{activeProfessionals.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <Field label="Data e horário" name="startsAt" type="datetime-local" value={bookingSelection} /><button>Criar agendamento</button>
          </form> : <p>Cadastre o <Link href="/dashboard?secao=clientes">cliente</Link>, o <Link href="/catalogo">serviço</Link>, o <Link href="/dashboard?secao=profissionais">profissional e os horários</Link> para criar um atendimento.</p>}
        </article>}
        {manager && activeProfessionals.length > 0 && <article><h2><LockKeyhole aria-hidden /> Bloquear horários</h2><form className={styles.formGrid} action={manage.bind(null, 'block')}><input type="hidden" name="destination" value="agenda" />
          <label>Profissional<select name="professionalId"><option value="all">Todos os profissionais ativos</option>{activeProfessionals.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <Field label="Início" name="startsAt" type="datetime-local" /><Field label="Fim" name="endsAt" type="datetime-local" />
          <Field label="Motivo, como férias ou feriado" name="reason" /><button>Bloquear horário</button>
        </form></article>}
        {!professionalOnly && <article><h2><UsersRound aria-hidden /> Lista de espera</h2>
          {waiting.length ? <ul className={styles.list}>{waiting.map(item => <li key={item.id}>
            <strong>{customerVisible ? item.name : 'Solicitação de atendimento'}</strong>
            <span>{DateTime.fromISO(item.day, { zone }).toFormat('dd/LL/yyyy')} · {item.service.name} · {item.professional.name}{customerVisible ? ' · +' + item.phone : ''}</span>
            {item.notificationConsentAt && <span className="state-pill">{({ QUEUED: 'Aguardando vaga', SENDING: 'Em processamento', ACCEPTED: 'Aceito pelo provedor', REVIEW: 'Envio em análise', FAILED: 'Envio recusado' } as Record<string,string>)[item.notificationState]}</span>}
            {can(member, 'agenda.edit') && <form action={manage.bind(null, 'wait-close')}><input type="hidden" name="destination" value="agenda" /><input type="hidden" name="id" value={item.id} /><button className="outline">Encerrar solicitação</button></form>}
          </li>)}</ul> : <p>Nenhuma solicitação em aberto.</p>}
        </article>}
        <article><h2><History aria-hidden /> Histórico recente</h2>
          {history.length ? <ul className={styles.list}>{history.map(item => <li key={item.id}>
            <strong>{operations[item.operation] ?? 'Atualizado'} · {item.appointment.service.name}</strong>
            <span>{formatted(item.createdAt)}{item.newStart && ' · Novo horário ' + formatted(item.newStart)}</span>
          </li>)}</ul> : <p>Nenhuma alteração registrada.</p>}
        </article>
      </div>
    </div>
  </MerchantShell>
}
