import { can } from '@/lib/permissions'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { DateTime } from 'luxon'
import { connectStatus } from '@/lib/connect'
import { db } from '@/lib/db'
import { membership, userSession } from '@/lib/auth'
import { WhatsAppControls } from '../whatsapp-controls'
import { customerPreferences, manage } from '../actions'
import { updateConsumerNotice } from '../cliente/[slug]/actions'
import { ErrorNote, Field, brl } from '../ui'

import { MerchantShell } from '../merchant-shell'
import { Overview } from './overview'

const labels = { CONFIRMED: 'Confirmado', PENDING: 'Aguardando pagamento', CANCELED: 'Cancelado', NO_SHOW: 'Faltou', COMPLETED: 'Concluído' }
const weekdays = ['Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado', 'Domingo']

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ erro?: string; assinatura?: string; periodo?: string; secao?: string; politica?: string }> }) {
  const user = await userSession()
  if (!user) redirect('/login')
  const member = await membership(user.id)
  if (!member) redirect(user.platformAdmin ? '/super-admin' : '/')
  const { tenant, role } = member
  const shiftTime = (value: number) => String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0')
  const own = role === 'PROFESSIONAL' && can(member, 'agenda.read') ? member.professionalId : null
  const enabled = tenant.active && !tenant.suspended
  const desk = role !== 'PROFESSIONAL' && can(member, 'agenda.read')
  const tenantId = tenant.id
  const month = DateTime.now().setZone(tenant.timezone).startOf('month')
  const query = await searchParams
  const titles = { clientes: 'Clientes', profissionais: 'Profissionais', configuracoes: 'Configurações' }
  const section = query.secao && Object.hasOwn(titles, query.secao) ? query.secao as keyof typeof titles : null
  const scopes = {
    clientes: can(member, 'customer.create') || can(member, 'customer.read'),
    profissionais: can(member, 'team.professionals'),
    configuracoes: can(member, 'settings.manage')
  }
  if (section && (!enabled || !scopes[section])) redirect('/dashboard')
  const show = (name: keyof typeof titles) => enabled && (!section || section === name) && scopes[name]
  const [plans, services, professionals, customers, products, appointments, connect] = await Promise.all([
    role === 'ADMIN' && !enabled ? db.plan.findMany({ where: { active: true } }) : [],
    enabled && (!section || section === 'profissionais') && (can(member, 'service.read') || can(member, 'service.manage') || scopes.profissionais) ? db.service.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }) : [],
    show('profissionais') ? db.professional.findMany({ where: { tenantId }, orderBy: { name: 'asc' }, include: { hours: true, assignments: { include: { service: true } } } }) : [],
    show('clientes') && can(member, 'customer.read') ? db.customer.findMany({ where: { tenantId }, orderBy: { name: 'asc' }, take: 100 }) : [],
    enabled && !section && can(member, 'product.manage') ? db.product.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }) : [],
    enabled && !section && (desk || own) ? db.appointment.findMany({
      where: { tenantId, ...(own ? { professionalId: own } : {}), startsAt: { gte: month.toJSDate() } }, orderBy: { startsAt: 'asc' }, take: 100,
      include: { service: true, customer: true, professional: true }
    }) : [],
    show('configuracoes') && role === 'ADMIN' && tenant.stripeAccountId ? connectStatus(tenant.stripeAccountId).catch(() => null) : null
  ])
  return <MerchantShell member={member} current={section ? '/dashboard?secao=' + section : '/dashboard'}>
      <div className="row"><div><p className="eyebrow">Painel do comerciante</p><h1>{section ? titles[section] : tenant.name}</h1>{!section && <p>Resumo da agenda, dos recebimentos e das operações do seu estabelecimento.</p>}</div>
        {enabled && <Link className="button outline" href={'/estabelecimento/' + tenant.slug}>Ver página pública</Link>}</div>
      <ErrorNote error={query.erro} />
      {query.politica && <p className="success" role="status">Política salva.</p>}
      {query.assinatura && <p role="status">Aguardando a confirmação da assinatura.</p>}
      {!enabled && <article><h2>{tenant.suspended ? 'Acesso suspenso' : 'Assinatura necessária'}</h2>
        {tenant.suspended ? <p>Entre em contato com o suporte para retomar o acesso.</p> : <p>Selecione um plano para publicar sua página e abrir a agenda.</p>}
        {role === 'ADMIN' && !tenant.suspended && plans.map(plan => <form className="inline" key={plan.id} action={manage.bind(null, 'subscription')}>
          <input type="hidden" name="planId" value={plan.id} /><label>{plan.name}<select name="cycle"><option value="monthly">{brl(plan.monthlyCents)} por mês</option><option value="annual">{brl(plan.annualCents)} por ano</option></select></label><button>Assinar</button>
        </form>)}
      </article>}
      {enabled && !section && member.role !== 'PROFESSIONAL' && <Overview member={member} query={query.periodo} />}
      {enabled && own && <article id="minha-agenda"><h2>Meus atendimentos</h2>{appointments.length ? <ul>{appointments.map(item => <li key={item.id}>
        {DateTime.fromJSDate(item.startsAt, { zone: tenant.timezone }).toFormat('dd/LL/yyyy HH:mm')} · {item.customer.name} · {item.service.name} · {labels[item.status]}
      </li>)}</ul> : <p>Nenhum atendimento na sua agenda.</p>}</article>}
      {enabled && !section && desk && <details><summary>Atendimentos do mês</summary>
        <article id="agenda"><h2>Agenda</h2>
          {!appointments.length ? <p>Nenhum atendimento para exibir.</p> : <div className="scroll"><table><thead><tr><th>Horário</th><th>Cliente</th><th>Serviço</th><th>Profissional</th><th>Situação</th><th>Ações</th></tr></thead>
          <tbody>{appointments.map(item => <tr key={item.id}><td>{DateTime.fromJSDate(item.startsAt, { zone: tenant.timezone }).toFormat('dd/LL/yyyy HH:mm')}</td><td>{item.customer.name}</td><td>{item.service.name}</td><td>{item.professional.name}</td><td>{labels[item.status]}</td><td>
            {item.status === 'CONFIRMED' && <form className="inline" action={manage.bind(null, 'appointment')}><input type="hidden" name="id" value={item.id} />
            {can(member, 'agenda.edit') && item.startsAt <= new Date() && <button className="outline" name="status" value="COMPLETED">Concluir</button>}
            {can(member, 'agenda.edit') && item.startsAt <= new Date() && <button className="outline" name="status" value="NO_SHOW">Registrar falta</button>}
            {can(member, 'agenda.cancel') && !item.paidAt && <button className="outline" name="status" value="CANCELED">Cancelar</button>}</form>}
            {can(member, 'finance.refund') && item.status === 'CONFIRMED' && item.paidAt && <form action={manage.bind(null, 'refund')}>
              <input type="hidden" name="id" value={item.id} /><button className="outline">Estornar e cancelar</button>
            </form>}
          </td></tr>)}</tbody></table></div>}
        </article>
      </details>}
      {show('clientes') && <article id="clientes"><h2>Clientes</h2>
          {can(member, 'customer.create') && <form className="inline" action={manage.bind(null, 'customer')}><input type="hidden" name="dashboardSection" value={section ?? ''} /><Field label="Nome" name="name" /><Field label="Telefone com DDI" name="phone" type="tel" /><button>Adicionar cliente</button></form>}
          {can(member, 'customer.read') && customers.length === 0 && <p>Nenhum cliente cadastrado neste estabelecimento.</p>}
          {customers.length > 0 && <ul>{customers.map(c => <li key={c.id}>{c.name} · +{c.phone}
            {can(member, 'customer.edit') && <details><summary>Editar cadastro e preferências</summary>
              <form action={customerPreferences} className="inline"><input type="hidden" name="id" value={c.id} />
                <Field label="Nome" name="name" value={c.name} />
                <Field label="Aniversário (somente dia e mês serão guardados)" name="birthday" type="date" required={false} value={c.birthMonthDay ? '2000-' + c.birthMonthDay : ''} />
                <label className="check"><input name="followupConsent" type="checkbox" defaultChecked={Boolean(c.followupConsentAt)} /> Cliente autorizou WhatsApp de aniversário ou retorno</label>
                <button>Salvar preferências do cliente</button>
              </form>
            </details>}</li>)}</ul>}
        </article>}
      {enabled && !section && can(member, 'service.manage') && <details><summary>Cadastro rápido de serviços</summary><article><h2>Serviços</h2><form action={manage.bind(null, 'service')}>
          <Field label="Nome" name="name" /><Field label="Descrição" name="description" required={false} />
          <Field label="Preço em centavos" name="cents" type="number" min={0} /><Field label="Duração em minutos" name="duration" type="number" min={5} max={720} />
          <button>Adicionar serviço</button></form>
          {services.length > 0 && <ul>{services.map(s => <li key={s.id}>{s.name} · {brl(s.cents)} · {s.duration} min</li>)}</ul>}
        </article></details>}
        {show('profissionais') && <article id="profissionais"><h2>Profissionais</h2><form action={manage.bind(null, 'professional')}><input type="hidden" name="dashboardSection" value={section ?? ''} /><Field label="Nome" name="name" /><button>Adicionar profissional</button></form>
          {professionals.length > 0 && <ul>{professionals.map(p => <li key={p.id}><details><summary>{p.name} · {p.active ? 'Ativo' : 'Inativo'} · {p.assignments.map(a => a.service.name).join(', ') || 'Sem serviços'} · {p.hours.length} turnos</summary>
            <form className="inline" action={manage.bind(null, 'professional-edit')}>
              <input type="hidden" name="dashboardSection" value={section ?? ''} /><input type="hidden" name="id" value={p.id} />
              <Field label="Nome" name="name" value={p.name} /><label>Situação<select name="active" defaultValue={String(p.active)}><option value="true">Ativo</option><option value="false">Inativo</option></select></label><button>Salvar profissional</button>
            </form>
            {p.hours.map(shift => <details key={shift.id}><summary>{weekdays[shift.weekday - 1]} · {shiftTime(shift.startMinute)}–{shiftTime(shift.endMinute)}</summary>
              <form className="inline" action={manage.bind(null, 'hours-edit')}>
                <input type="hidden" name="dashboardSection" value={section ?? ''} /><input type="hidden" name="id" value={shift.id} /><input type="hidden" name="professionalId" value={p.id} />
                <label>Dia<select name="weekday" defaultValue={shift.weekday}>{weekdays.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</select></label>
                <Field label="Início" name="startMinute" type="time" value={shiftTime(shift.startMinute)} /><Field label="Fim" name="endMinute" type="time" value={shiftTime(shift.endMinute)} />
                <button>Salvar turno</button>
              </form>
              <form action={manage.bind(null, 'hours-remove')}><input type="hidden" name="dashboardSection" value={section ?? ''} /><input type="hidden" name="id" value={shift.id} /><input type="hidden" name="professionalId" value={p.id} /><button className="outline">Remover turno</button></form>
            </details>)}
          </details></li>)}</ul>}
          {!!(professionals.length && services.length) && <form action={manage.bind(null, 'assignment')}>
            <input type="hidden" name="dashboardSection" value={section ?? ''} />
            <label>Profissional<select name="professionalId">{professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label>Serviço<select name="serviceId">{services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <button>Vincular serviço</button></form>}
          {!!professionals.length && <form action={manage.bind(null, 'hours')}>
            <input type="hidden" name="dashboardSection" value={section ?? ''} />
            <label>Profissional<select name="professionalId">{professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label>Dia<select name="weekday">{weekdays.map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</select></label>
            <Field label="Início" name="startMinute" type="time" /><Field label="Fim" name="endMinute" type="time" /><button>Adicionar turno</button>
          </form>}
        </article>}
        {enabled && !section && can(member, 'product.manage') && <details><summary>Cadastro rápido de produtos</summary><article><h2>Produtos</h2><form action={manage.bind(null, 'product')}>
          <Field label="Nome" name="name" /><Field label="Preço em centavos" name="cents" type="number" min={0} />
          <Field label="Estoque inicial" name="stock" type="number" min={0} /><button>Adicionar produto</button>
        </form>{products.length > 0 && <ul>{products.map(p => <li key={p.id}>{p.name} · {brl(p.cents)} · {p.stock} em estoque</li>)}</ul>}</article></details>}
      {show('configuracoes') && role !== 'ADMIN' && can(member, 'settings.manage') && <article id="configuracoes"><h2>Configurações gerais</h2>
        <form action={manage.bind(null, 'settings')}>
        <input type="hidden" name="dashboardSection" value={section ?? ''} />
          <Field label="Nome" name="name" value={tenant.name} /><Field label="Descrição" name="description" value={tenant.description} required={false} />
          <Field label="Endereço" name="address" value={tenant.address} required={false} /><Field label="Cor da página" name="color" type="color" value={tenant.color} />
          <button>Salvar configurações gerais</button>
        </form>
      </article>}
      {show('configuracoes') && <article><h2>Alterações pelo cliente</h2><p>Defina a antecedência mínima para cancelamento ou reagendamento pelo portal. Deixe em branco para desativar.</p><form className="inline" action={updateConsumerNotice}><Field label="Antecedência em horas" name="hours" type="number" min={0} max={168} required={false} value={tenant.consumerNoticeHours ?? ''} />{role === 'ADMIN' && <label className="check"><input type="checkbox" name="automaticAppointmentRefunds" defaultChecked={tenant.automaticAppointmentRefunds} /> Cancelar e solicitar estorno integral automaticamente quando elegível</label>}<button className="outline">Salvar política</button></form></article>}
      {show('configuracoes') && role === 'ADMIN' && <article id="configuracoes"><h2>Configurações</h2><Link href="/recebimentos">Receber pagamentos</Link><Link href="/personalizacao">Personalizar página pública</Link>
        <form action={manage.bind(null, 'settings')}>
        <input type="hidden" name="dashboardSection" value={section ?? ''} />
          <Field label="Nome" name="name" value={tenant.name} /><Field label="Descrição" name="description" value={tenant.description} required={false} />
          <Field label="Endereço" name="address" value={tenant.address} required={false} /><Field label="Cor da página" name="color" type="color" value={tenant.color} />
          {tenant.whatsappInstance && <Field label="Enviar lembrete quantos minutos antes? (0 desativa)" name="reminderMinutes" type="number" min={0} value={tenant.reminderMinutes ?? 0} />}
          {tenant.whatsappInstance && <Field label="Mensagem do lembrete. Use {estabelecimento} e {horario} para preencher automaticamente." name="reminderTemplate" required={false} value={tenant.reminderTemplate ?? ''} />}
          {tenant.whatsappInstance && <label className="check"><input type="checkbox" name="statusMessages" defaultChecked={tenant.statusMessages} /> Enviar avisos de confirmação, pagamento, reagendamento e cancelamento</label>}
          {!tenant.whatsappInstance && <input type="hidden" name="reminderMinutes" value="0" />}
          {tenant.stripeAccountId && <label className="check"><input type="checkbox" name="onlinePayment" defaultChecked={tenant.onlinePayment} /> Exigir pagamento online</label>}
          {tenant.stripeAccountId && (connect?.pix || tenant.pixCheckoutEnabled) && <label className="check"><input type="checkbox" name="pixCheckoutEnabled" defaultChecked={tenant.pixCheckoutEnabled} /> Oferecer Pix pelo Stripe Checkout</label>}
          {tenant.stripeAccountId && <Field label="Percentual cobrado antecipadamente" name="depositPercent" type="number" min={1} max={100} value={tenant.depositPercent} />}
          <button>Salvar configurações</button>
        </form><form action={manage.bind(null, 'cover')}>
          <label>Imagem de capa<input type="file" name="cover" accept="image/jpeg,image/png,image/webp" required /></label>
          <button className="outline">Salvar imagem</button>
        </form>{tenant.stripeAccountId && <p>{connect ? (connect.payments ? 'Cobranças habilitadas' : connect.submitted ? 'Cadastro em análise' : 'Cadastro incompleto') + ' · ' + (connect.payouts ? 'Repasses habilitados' : 'Repasses indisponíveis') : 'Situação da conta de pagamentos indisponível.'}</p>}<form action={manage.bind(null, 'connect')}><button className="outline">{tenant.stripeAccountId ? 'Revisar configuração de pagamentos' : 'Configurar pagamentos online'}</button></form>
        {tenant.whatsappInstance && <><h3>WhatsApp</h3><WhatsAppControls /></>}
      </article>}
      {role === 'ADMIN' && tenant.stripeCustomerId && <article><h2>Cobrança</h2><Link href="/assinatura">Ver faturas da assinatura</Link><form action={manage.bind(null, 'portal')}><button className="outline">Gerenciar assinatura</button></form></article>}
  </MerchantShell>
}
