import Link from 'next/link'
import { CalendarDays, CircleDollarSign, UsersRound, MessageCircle, BarChart3, CalendarPlus, UserPlus, Boxes, Scissors, Palette, ShoppingBag } from 'lucide-react'
import { DateTime } from 'luxon'
import { db } from '@/lib/db'
import { cashReport } from '@/lib/commerce'
import { can } from '@/lib/permissions'
import { RevenueChart } from '../revenue-chart'
import { brl } from '../ui'
import type { MerchantMember } from '../merchant-shell'

export async function Overview({ member, query }: { member: MerchantMember; query?: string }) {
  const tenantId = member.tenantId
  const today = DateTime.now().setZone(member.tenant.timezone).startOf('day')
  const days = query === '30' ? 30 : 7
  const finance = can(member, 'finance.read')
  const calendar = can(member, 'agenda.read') && member.role !== 'PROFESSIONAL'
  const customers = can(member, 'customer.read')
  const notifications = can(member, 'whatsapp.manage')
  const range = (from: DateTime, until: DateTime) => ({ gte: from.toJSDate(), lt: until.toJSDate() })
  const day = range(today, today.plus({ days: 1 }))
  const week = range(today.startOf('week'), today.startOf('week').plus({ weeks: 1 }))
  const month = range(today.startOf('month'), today.startOf('month').plus({ months: 1 }))
  const chartStart = today.minus({ days: days - 1 })
  const period = { gte: new Date(Math.min(+month.gte, +week.gte, +chartStart)), lt: month.lt }
  const [todayRows, upcoming, weekCount, monthStates, clientGroups, report, sent, low, financeStates, recentEvents] = await Promise.all([
    calendar ? db.appointment.findMany({ where: { tenantId, startsAt: day }, include: { customer: true, service: true }, orderBy: { startsAt: 'asc' } }) : [],
    calendar ? db.appointment.findMany({ where: { tenantId, startsAt: { gte: day.lt }, status: { in: ['PENDING','CONFIRMED'] } }, include: { customer: true, service: true }, orderBy: { startsAt: 'asc' }, take: 5 }) : [],
    calendar ? db.appointment.count({ where: { tenantId, startsAt: week } }) : 0,
    calendar ? db.appointment.groupBy({ by: ['status'], where: { tenantId, startsAt: month }, _count: true }) : [],
    customers ? db.appointment.groupBy({ by: ['customerId'], where: { tenantId, status: { in: ['CONFIRMED','COMPLETED'] } }, _min: { startsAt: true }, _count: true }) : [],
    finance ? cashReport(tenantId, member.tenant.timezone, period) : null,
    notifications ? db.reminder.count({ where: { appointment: { tenantId }, deliveryState: 'SENT', providerMessageId: { not: null }, sentAt: day } }) : 0,
    can(member,'stock.manage') ? db.product.count({ where: { tenantId, archivedAt: null, stock: { lte: db.product.fields.minimumStock } } }) : 0,
    finance ? Promise.all([
      db.appointment.count({ where: { tenantId, paidAt: month } }),
      db.appointment.count({ where: { tenantId, status: 'PENDING' } }),
      db.appointment.count({ where: { tenantId, refundedAt: month } }),
      db.shopOrder.count({ where: { tenantId, paidAt: month } }),
      db.shopOrder.count({ where: { tenantId, status: 'PENDING' } }),
      db.shopOrder.count({ where: { tenantId, refundedAt: month } })
    ]) : null,
    notifications ? db.reminder.findMany({ where: { appointment: { tenantId }, deliveryState: { in: ['SENT', 'REVIEW', 'FAILED'] } },
      select: { id: true, kind: true, deliveryState: true, sentAt: true, runAt: true, providerMessageId: true },
      orderBy: { runAt: 'desc' }, take: 3 }) : []

  ])
  const total = (start: Date, end: Date) => report?.rows.filter(row => row.date >= start && row.date < end && row.cents > 0).reduce((sum,row) => sum + row.cents, 0) ?? 0
  const chart = Array.from({ length: days }, (_, index) => {
    const date = today.minus({ days: days - index - 1 })
    return { label: date.toFormat('dd/LL'), value: total(date.toJSDate(), date.plus({ days: 1 }).toJSDate()) }
  })
  const labels = { CONFIRMED: 'Confirmado', PENDING: 'Pendente', CANCELED: 'Cancelado', NO_SHOW: 'Falta', COMPLETED: 'Concluído' }
  const actions = [
    ['agenda.create','Novo agendamento','/agenda#novo-agendamento',CalendarPlus],
    ['customer.create','Cadastrar cliente','/dashboard?secao=clientes',UserPlus],
    ['product.manage','Adicionar produto','/catalogo?novo=produto',Boxes],
    ['service.manage','Adicionar serviço','/catalogo?secao=servicos&novo=servico',Scissors],
    ['sale.create','Nova venda','/comercial#vendas',ShoppingBag],
    ['whatsapp.manage','Enviar lembrete','/automacoes#enviar-lembrete',MessageCircle],
    ['finance.read','Ver relatórios','/relatorios',BarChart3],
    ['brand.manage','Personalizar página','/personalizacao',Palette]
  ] as const
  const appointments = (rows: typeof todayRows) => rows.length ? <ul className="surface-list">{rows.map(row => <li key={row.id}>
    <time>{DateTime.fromJSDate(row.startsAt, { zone: member.tenant.timezone }).toFormat('dd/LL HH:mm')}</time>
    <div><strong>{row.customer.name}</strong><small>{row.service.name}</small></div><span className="state-pill" data-state={row.status}>{labels[row.status]}</span>
  </li>)}</ul> : <p className="surface-empty">Ainda não há atendimentos neste período.</p>
  return <>
    <section className="commercial-kpis">
      {calendar && <article><CalendarDays aria-hidden /><p>Agendamentos hoje</p><strong>{todayRows.length}</strong><small>{weekCount} na semana · {monthStates.reduce((sum,row) => sum + row._count,0)} no mês</small></article>}
      {finance && <article><CircleDollarSign aria-hidden /><p>Entradas hoje</p><strong>{brl(total(day.gte,day.lt))}</strong><small>{brl(total(week.gte,week.lt))} nesta semana · {brl(total(month.gte,month.lt))} no mês</small></article>}
      {customers && <article><UsersRound aria-hidden /><p>Novos clientes no mês</p><strong>{clientGroups.filter(row => row._min.startsAt && row._min.startsAt >= month.gte && row._min.startsAt < month.lt).length}</strong><small>{clientGroups.filter(row => row._count > 1).length} com mais de um atendimento</small></article>}
      {notifications && <article><MessageCircle aria-hidden /><p>Envios aceitos hoje</p><strong>{sent}</strong><small>WhatsApp · com referência do provedor</small></article>}
    </section>
    <section className="commercial-panels">
      {calendar && <article className="commercial-panel"><h2>Agenda de hoje</h2>{appointments(todayRows)}<Link href="/agenda">Ver agenda completa</Link></article>}
      {finance && <article className="commercial-panel"><h2>Entradas dos últimos {days} dias</h2>
        <div className="inline"><Link aria-current={days === 7 ? 'page' : undefined} href="/dashboard?periodo=7">7 dias</Link><Link aria-current={days === 30 ? 'page' : undefined} href="/dashboard?periodo=30">30 dias</Link></div>
        <RevenueChart key={days} points={chart} />
        {financeStates && <p className="status-summary">{financeStates[0] + financeStates[3]} aprovado(s) e {financeStates[2] + financeStates[5]} estornado(s) no mês · {financeStates[1] + financeStates[4]} pendente(s)</p>}
      </article>}
      {calendar && <article className="commercial-panel"><h2>Próximos agendamentos</h2>{appointments(upcoming)}<p className="status-summary">{monthStates.map(row => labels[row.status] + ': ' + row._count).join(' · ')}</p></article>}
    </section>
    <article><h2>Ações rápidas</h2><div className="quick-actions">{actions.filter(([scope]) => can(member,scope)).map(([,label,href,Icon]) => <Link key={label} href={href}><Icon aria-hidden />{label}</Link>)}</div>
      {recentEvents.length > 0 && <p><Link href="/automacoes">{recentEvents.length} notificações recentes</Link> · {recentEvents.filter(item => item.deliveryState === 'SENT' && item.providerMessageId).length} aceita(s) pelo provedor</p>}
      {low > 0 && <p><Link href="/catalogo?situacao=baixo">{low} produto(s) com estoque baixo</Link></p>}
    </article>
  </>
}
