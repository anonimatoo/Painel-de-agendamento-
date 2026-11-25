import Link from 'next/link'
import { redirect } from 'next/navigation'
import { CalendarDays, ClipboardList, Settings, UsersRound, Wallet } from 'lucide-react'
import { DateTime } from 'luxon'
import { connectStatus } from '@/lib/connect'
import { db } from '@/lib/db'
import { membership, userSession } from '@/lib/auth'
import { WhatsAppControls } from '../whatsapp-controls'
import { logout, manage } from '../actions'
import { Brand, ErrorNote, Field, brl } from '../ui'

const labels = { CONFIRMED: 'Confirmado', PENDING: 'Aguardando pagamento', CANCELED: 'Cancelado', NO_SHOW: 'Faltou', COMPLETED: 'Concluído' }
const weekdays = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo']

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ erro?: string; assinatura?: string }> }) {
  const user = await userSession()
  if (!user) redirect('/login')
  const member = await membership(user.id)
  if (!member) redirect(user.platformAdmin ? '/super-admin' : '/')
  const { tenant, role } = member
  const own = role === 'PROFESSIONAL' ? member.professionalId : null
  const enabled = tenant.active && !tenant.suspended
  const manager = role === 'ADMIN' || role === 'MANAGER'
  const desk = manager || role === 'RECEPTION'
  const tenantId = tenant.id
  const month = DateTime.now().setZone(tenant.timezone).startOf('month')
  const query = await searchParams
  const [plans, services, professionals, customers, products, appointments, monthlyCount, paid, connect] = await Promise.all([
    role === 'ADMIN' && !enabled ? db.plan.findMany({ where: { active: true } }) : [],
    enabled && manager ? db.service.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }) : [],
    enabled && manager ? db.professional.findMany({ where: { tenantId }, orderBy: { name: 'asc' }, include: { hours: true, assignments: { include: { service: true } } } }) : [],
    enabled && desk ? db.customer.findMany({ where: { tenantId }, orderBy: { name: 'asc' }, take: 100 }) : [],
    enabled && manager ? db.product.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }) : [],
    enabled && (desk || own) ? db.appointment.findMany({
      where: { tenantId, ...(own ? { professionalId: own } : {}), startsAt: { gte: month.toJSDate() } }, orderBy: { startsAt: 'asc' }, take: 100,
      include: { service: true, customer: true, professional: true }
    }) : [],
    enabled && desk ? db.appointment.count({ where: { tenantId, status: { in: ['CONFIRMED','COMPLETED'] }, startsAt: { gte: month.toJSDate(), lt: month.plus({ months: 1 }).toJSDate() } } }) : 0,
    enabled && manager ? db.appointment.findMany({ where: { tenantId, refundedAt: null, paidAt: { gte: month.toJSDate(), lt: month.plus({ months: 1 }).toJSDate() } }, select: { cents: true, chargeCents: true } }) : [],
    enabled && role === 'ADMIN' && tenant.stripeAccountId ? connectStatus(tenant.stripeAccountId).catch(() => null) : null
  ])
  return <div className="shell">
    <aside><Brand /><nav>
      <Link href="/dashboard"><ClipboardList /> Visão geral</Link>
      {enabled && desk && <Link href="/agenda"><CalendarDays /> Agenda</Link>}
      {enabled && manager && <Link href="/comercial"><Wallet /> Estoque e financeiro</Link>}
      {enabled && manager && <a href="#equipe"><UsersRound /> Equipe e catálogo</a>}
      {enabled && role === 'ADMIN' && <a href="#configuracoes"><Settings /> Configurações</a>}
    {enabled && role === 'ADMIN' && <Link href="/equipe">Equipe e permissões</Link>}{enabled && role === 'ADMIN' && <Link href="/whatsapp">WhatsApp</Link>}<Link href="/conta">Minha conta</Link></nav><form action={logout}><button className="subtle">Sair</button></form></aside>
    <main className="content">
      <div className="row"><div><p className="eyebrow">Estabelecimento</p><h1>{tenant.name}</h1></div>
        {enabled && <Link className="button outline" href={'/estabelecimento/' + tenant.slug}>Ver página pública</Link>}</div>
      <ErrorNote error={query.erro} />
      {query.assinatura && <p role="status">Aguardando a confirmação da assinatura.</p>}
      {!enabled && <article><h2>{tenant.suspended ? 'Acesso suspenso' : 'Assinatura necessária'}</h2>
        {tenant.suspended ? <p>Entre em contato com o suporte para retomar o acesso.</p> : <p>Selecione um plano para publicar sua página e abrir a agenda.</p>}
        {role === 'ADMIN' && !tenant.suspended && plans.map(plan => <form className="inline" key={plan.id} action={manage.bind(null, 'subscription')}>
          <input type="hidden" name="planId" value={plan.id} /><label>{plan.name}<select name="cycle"><option value="monthly">{brl(plan.monthlyCents)} por mês</option><option value="annual">{brl(plan.annualCents)} por ano</option></select></label><button>Assinar</button>
        </form>)}
      </article>}
      {enabled && own && <article><h2>Meus atendimentos</h2>{appointments.length ? <ul>{appointments.map(item => <li key={item.id}>
        {DateTime.fromJSDate(item.startsAt, { zone: tenant.timezone }).toFormat('dd/LL/yyyy HH:mm')} · {item.customer.name} · {item.service.name} · {labels[item.status]}
      </li>)}</ul> : <p>Nenhum atendimento na sua agenda.</p>}</article>}
      {enabled && desk && <>
        <section className="grid metrics">
          <article><CalendarDays /><p>Atendimentos no mês</p><strong>{monthlyCount}</strong></article>
          {manager && <article><Wallet /><p>Recebido online no mês</p><strong>{brl(paid.reduce((sum, row) => sum + (row.chargeCents ?? row.cents), 0))}</strong></article>}
        </section>
        <article id="agenda"><h2>Agenda</h2>
          {!appointments.length ? <p>Nenhum atendimento para exibir.</p> : <div className="scroll"><table><thead><tr><th>Horário</th><th>Cliente</th><th>Serviço</th><th>Profissional</th><th>Situação</th><th>Ações</th></tr></thead>
          <tbody>{appointments.map(item => <tr key={item.id}><td>{DateTime.fromJSDate(item.startsAt, { zone: tenant.timezone }).toFormat('dd/LL/yyyy HH:mm')}</td><td>{item.customer.name}</td><td>{item.service.name}</td><td>{item.professional.name}</td><td>{labels[item.status]}</td><td>
            {item.status === 'CONFIRMED' && <form className="inline" action={manage.bind(null, 'appointment')}><input type="hidden" name="id" value={item.id} />
            {item.startsAt <= new Date() && <button className="outline" name="status" value="COMPLETED">Concluir</button>}
            {item.startsAt <= new Date() && <button className="outline" name="status" value="NO_SHOW">Registrar falta</button>}
            {!item.paidAt && <button className="outline" name="status" value="CANCELED">Cancelar</button>}</form>}
            {role === 'ADMIN' && item.status === 'CONFIRMED' && item.paidAt && <form action={manage.bind(null, 'refund')}>
              <input type="hidden" name="id" value={item.id} /><button className="outline">Estornar e cancelar</button>
            </form>}
          </td></tr>)}</tbody></table></div>}
        </article>
        <article><h2>Clientes</h2>
          <form className="inline" action={manage.bind(null, 'customer')}><Field label="Nome" name="name" /><Field label="Telefone com DDI" name="phone" type="tel" /><button>Adicionar cliente</button></form>
          {customers.length > 0 && <ul>{customers.map(c => <li key={c.id}>{c.name} · +{c.phone}</li>)}</ul>}
        </article>
      </>}
      {enabled && manager && <section className="grid" id="equipe">
        <article><h2>Serviços</h2><form action={manage.bind(null, 'service')}>
          <Field label="Nome" name="name" /><Field label="Descrição" name="description" required={false} />
          <Field label="Preço em centavos" name="cents" type="number" min={0} /><Field label="Duração em minutos" name="duration" type="number" min={5} max={720} />
          <button>Adicionar serviço</button></form>
          {services.length > 0 && <ul>{services.map(s => <li key={s.id}>{s.name} · {brl(s.cents)} · {s.duration} min</li>)}</ul>}
        </article>
        <article><h2>Profissionais</h2><form action={manage.bind(null, 'professional')}><Field label="Nome" name="name" /><button>Adicionar profissional</button></form>
          {professionals.length > 0 && <ul>{professionals.map(p => <li key={p.id}>{p.name} · {p.assignments.map(a => a.service.name).join(', ') || 'Sem serviços'} · {p.hours.length} turnos</li>)}</ul>}
          {!!(professionals.length && services.length) && <form action={manage.bind(null, 'assignment')}>
            <label>Profissional<select name="professionalId">{professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label>Serviço<select name="serviceId">{services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <button>Vincular serviço</button></form>}
          {!!professionals.length && <form action={manage.bind(null, 'hours')}>
            <label>Profissional<select name="professionalId">{professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label>Dia<select name="weekday">{weekdays.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</select></label>
            <Field label="Início" name="startMinute" type="time" /><Field label="Fim" name="endMinute" type="time" /><button>Adicionar turno</button>
          </form>}
        </article>
        <article><h2>Produtos</h2><form action={manage.bind(null, 'product')}>
          <Field label="Nome" name="name" /><Field label="Preço em centavos" name="cents" type="number" min={0} />
          <Field label="Estoque inicial" name="stock" type="number" min={0} /><button>Adicionar produto</button>
        </form>{products.length > 0 && <ul>{products.map(p => <li key={p.id}>{p.name} · {brl(p.cents)} · {p.stock} em estoque</li>)}</ul>}</article>
      </section>}
      {enabled && role === 'ADMIN' && <article id="configuracoes"><h2>Configurações</h2><Link href="/recebimentos">Receber pagamentos</Link><Link href="/personalizacao">Personalizar página pública</Link>
        <form action={manage.bind(null, 'settings')}>
          <Field label="Nome" name="name" value={tenant.name} /><Field label="Descrição" name="description" value={tenant.description} required={false} />
          <Field label="Endereço" name="address" value={tenant.address} required={false} /><Field label="Cor da página" name="color" type="color" value={tenant.color} />
          {tenant.whatsappInstance && <Field label="Enviar lembrete quantos minutos antes? (0 desativa)" name="reminderMinutes" type="number" min={0} value={tenant.reminderMinutes ?? 0} />}
          {tenant.whatsappInstance && <Field label="Mensagem do lembrete. Use {estabelecimento} e {horario} para preencher automaticamente." name="reminderTemplate" required={false} value={tenant.reminderTemplate ?? ''} />}
          {tenant.whatsappInstance && <label className="check"><input type="checkbox" name="statusMessages" defaultChecked={tenant.statusMessages} /> Enviar avisos de confirmação, pagamento, reagendamento e cancelamento</label>}
          {!tenant.whatsappInstance && <input type="hidden" name="reminderMinutes" value="0" />}
          {tenant.stripeAccountId && <label className="check"><input type="checkbox" name="onlinePayment" defaultChecked={tenant.onlinePayment} /> Exigir pagamento online</label>}
          {tenant.stripeAccountId && <Field label="Percentual cobrado antecipadamente" name="depositPercent" type="number" min={1} max={100} value={tenant.depositPercent} />}
          <button>Salvar configurações</button>
        </form><form action={manage.bind(null, 'cover')}>
          <label>Imagem de capa<input type="file" name="cover" accept="image/jpeg,image/png,image/webp" required /></label>
          <button className="outline">Salvar imagem</button>
        </form>{tenant.stripeAccountId && <p>{connect ? (connect.payments ? 'Cobranças habilitadas' : connect.submitted ? 'Cadastro em análise' : 'Cadastro incompleto') + ' · ' + (connect.payouts ? 'Repasses habilitados' : 'Repasses indisponíveis') : 'Situação da conta de pagamentos indisponível.'}</p>}<form action={manage.bind(null, 'connect')}><button className="outline">{tenant.stripeAccountId ? 'Revisar configuração de pagamentos' : 'Configurar pagamentos online'}</button></form>
        {tenant.whatsappInstance && <><h3>WhatsApp</h3><WhatsAppControls /></>}
      </article>}
      {role === 'ADMIN' && tenant.stripeCustomerId && <article><h2>Cobrança</h2><Link href="/assinatura">Ver faturas da assinatura</Link><form action={manage.bind(null, 'portal')}><button className="outline">Gerenciar assinatura</button></form></article>}
    </main></div>
}
