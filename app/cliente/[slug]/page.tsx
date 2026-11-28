import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { CalendarDays, CalendarPlus, History, ShoppingBag, UserRound, Wallet } from 'lucide-react'
import { DateTime } from 'luxon'
import { availability } from '@/lib/agenda'
import { userSession } from '@/lib/auth'
import { activeStore, consumerDeadline, consumerPath, currentConsumer } from '@/lib/consumer'
import { db } from '@/lib/db'
import { enabledSocialProviders, pendingSocialSignup } from '@/lib/social-auth'
import { FormSubmit } from '../../form-submit'
import { AuthShell } from '../../auth-shell'
import { PublicBrand } from '../../public-brand'
import { ProviderButton } from '../../social-buttons'
import { brl, ErrorNote, Field } from '../../ui'
import { changeConsumerAppointment, consumerAccess, consumerLogout, consumerSocial } from './actions'

const appointmentLabels = { CANCELED: 'Cancelado', PENDING: 'Pagamento pendente', CONFIRMED: 'Confirmado', COMPLETED: 'Concluído', NO_SHOW: 'Falta registrada' }
const refundStatus: Record<string, string> = { QUEUED: 'Estorno programado', SUBMITTED: 'Estorno em processamento', REVIEW: 'Estorno em análise' }
const orderLabels: Record<string, string> = { PAID: 'Pago', PENDING: 'Pagamento pendente', CANCELED: 'Cancelado', REFUNDED: 'Estornado' }

export default async function ConsumerPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams: Promise<{ erro?: string; criar?: string; social?: string; perfil?: string; alteracao?: string; atendimento?: string; dia?: string }>
}) {
  const { slug } = await params
  const store = await activeStore(slug)
  if (!store) {
    const alias = await db.tenantAlias.findUnique({ where: { slug }, select: { tenant: { select: { slug: true, active: true, suspended: true } } } })
    if (!alias?.tenant.active || alias.tenant.suspended) notFound()
    redirect(consumerPath(alias.tenant.slug))
  }
  const query = await searchParams
  const path = consumerPath(slug)
  const publicPath = '/estabelecimento/' + encodeURIComponent(slug)
  const user = await userSession()
  const existing = user && !user.platformAdmin
  const profile = existing ? await currentConsumer(store.id) : null
  const pending = existing ? null : await pendingSocialSignup()
  const social = pending?.consumerSlug === slug
  const create = !existing && (query.criar === '1' || social)
  if (!profile) {
    const providers = !existing && !social ? await enabledSocialProviders() : []
    return <AuthShell mode={create ? 'register' : 'login'}>
      <Link href={publicPath}>{store.name}</Link>
      <h1>{existing || social ? 'Complete seu perfil' : create ? 'Criar conta de cliente' : 'Entrar como cliente'}</h1>
      <p>Acompanhe seus agendamentos e pedidos neste estabelecimento.</p>
      <ErrorNote error={query.erro} />
      {query.social && <p role="alert" className="error">Não foi possível entrar pelo provedor. Tente seu método habitual.</p>}
      <form action={consumerAccess.bind(null, slug, existing ? 'profile' : social ? 'social' : create ? 'register' : 'login')}>
        {(existing || create) && <Field label="Nome completo" name="name" />}
        {!existing && !social && <><Field label="E-mail" name="email" type="email" /><Field label={create ? 'Senha (pelo menos 12 caracteres)' : 'Senha'} name="password" type="password" /></>}
        {(existing || create) && <Field label="WhatsApp ou telefone com DDI (55)" name="phone" type="tel" />}
        <FormSubmit>{existing || social ? 'Salvar perfil' : create ? 'Criar conta' : 'Entrar'}</FormSubmit>
      </form>
      {providers.length > 0 && <div className="social-options">{providers.map(provider =>
        <form key={provider} action={consumerSocial.bind(null, slug, provider)}><ProviderButton provider={provider} /></form>
      )}</div>}
      {!existing && <p><Link href={create ? path : path + '?criar=1'}>{create ? 'Já tenho conta' : 'Criar conta'}</Link> · <Link href="/conta">Esqueci minha senha</Link></p>}
      {existing && <form action={consumerLogout.bind(null, slug)}><button className="subtle">Sair</button></form>}
    </AuthShell>
  }
  const [appointments, orders] = await Promise.all([
    db.appointment.findMany({ where: { tenantId: store.id, consumerUserId: profile.userId }, orderBy: { startsAt: 'desc' }, take: 100,
      include: { service: { select: { name: true } }, professional: { select: { name: true } }, refundRequest: { select: { state: true } }, connectedRefunds: { where: { state: 'succeeded' }, select: { amount: true } }, history: { where: { operation: { in: ['RESCHEDULED', 'REFUND_REQUESTED'] } }, orderBy: { createdAt: 'desc' } } } }),
    db.shopOrder.findMany({ where: { tenantId: store.id, consumerUserId: profile.userId }, orderBy: { createdAt: 'desc' }, take: 100, include: { items: true, connectedRefunds: { where: { state: 'succeeded' }, select: { amount: true } } } })
  ])
  const deadline = consumerDeadline(store.consumerNoticeHours)
  const selected = deadline ? appointments.find(row => row.id === query.atendimento && row.status === 'CONFIRMED' && row.startsAt > deadline) : undefined
  const localDay = DateTime.now().setZone(store.timezone).toISODate()!
  const searchDay = typeof query.dia === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.dia) && DateTime.fromISO(query.dia).isValid ? query.dia : localDay
  const slots = selected ? await availability(store, selected.serviceId, selected.professionalId, searchDay, db, selected.id) : []
  const date = (value: Date) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: store.timezone }).format(value)
  const upcoming = appointments.filter(row => row.startsAt > new Date() && ['CONFIRMED', 'PENDING'].includes(row.status))
  const summaries = [
    { title: 'Agendar', href: publicPath + '#agendar', icon: CalendarPlus },
    { title: 'Comprar produtos', href: publicPath + '#produtos', icon: ShoppingBag },
    { title: 'Meus agendamentos', href: '#agendamentos', icon: CalendarDays },
    { title: 'Meus pedidos', href: '#pedidos', icon: ShoppingBag },
    { title: 'Pagamentos e estornos', href: '#pagamentos', icon: Wallet },
    { title: 'Histórico', href: '#historico', icon: History },
    { title: 'Meus dados', href: '#meus-dados', icon: UserRound }
  ]
  return <div className="consumer-site">
    <header className="consumer-header"><PublicBrand /><Link href={publicPath}>{store.name}</Link><form action={consumerLogout.bind(null, slug)}><button className="outline">Sair</button></form></header>
    <main className="content">
      <section className="workspace-heading"><div><h1>Olá, {profile.name.split(/\s+/)[0]}!</h1><p>Acompanhe suas reservas e compras em {store.name}.</p></div></section>
      <nav className="consumer-nav" aria-label="Minha conta">{summaries.map(({ title, href, icon: Icon }) => <Link href={href} key={title}><Icon aria-hidden size={18} />{title}</Link>)}</nav>
      <ErrorNote error={query.erro} />
      {query.perfil && <p className="success" role="status">Seus dados foram salvos.</p>}
      {query.alteracao && <p className="success" role="status">{query.alteracao === 'solicitada' ? 'Solicitação de estorno registrada. Você pode acompanhar o andamento nesta página.' : query.alteracao === 'cancelada' ? 'Atendimento cancelado. O estorno foi programado.' : 'Atendimento atualizado.'}</p>}
      <div className="consumer-panels">
        <article id="agendamentos"><h2>Meus agendamentos</h2>
          {upcoming.length === 0 && <p>Você ainda não tem agendamentos futuros. <Link href={publicPath + '#agendar'}>Escolher um horário</Link></p>}
          {upcoming.map(row => <div className="consumer-item" key={row.id}>
            <div><strong>{row.service.name}</strong><p>{date(row.startsAt)} · {row.professional.name}</p></div><span className="status-pill" data-tone={row.status === 'CONFIRMED' ? 'green' : 'amber'}>{appointmentLabels[row.status]}</span>
            {row.status === 'PENDING' && row.paymentToken && <Link href={publicPath + '?pagamento=' + encodeURIComponent(row.paymentToken)}>Acompanhar pagamento</Link>}
            {row.status === 'CONFIRMED' && deadline && row.startsAt > deadline && (row.history.some(item => item.operation === 'REFUND_REQUESTED') ? <p>Estorno solicitado</p>
              : <div className="inline"><Link href={path + '?atendimento=' + row.id + '#reagendar'}>Reagendar</Link><form action={changeConsumerAppointment.bind(null, slug, row.id, 'cancel')}><button className="outline">{row.paidAt ? 'Solicitar estorno' : 'Cancelar agendamento'}</button></form></div>)}
          </div>)}
          {selected && <section id="reagendar"><h3>Reagendar {selected.service.name}</h3>
            <form className="inline" action={path}><input hidden readOnly name="atendimento" value={selected.id} /><label>Nova data<input name="dia" type="date" min={localDay} defaultValue={searchDay} required /></label><button className="outline">Consultar horários</button></form>
            {slots.length ? <form action={changeConsumerAppointment.bind(null, slug, selected.id, 'reschedule')}><label>Novo horário<select name="startsAt" required>{slots.map(slot => <option value={slot.start} key={slot.start}>{slot.label}</option>)}</select></label><button>Confirmar reagendamento</button></form> : <p>Sem horários disponíveis neste dia.</p>}
          </section>}
          {store.policies && <details><summary>Política de atendimento</summary><p className="preserve-lines">{store.policies}</p></details>}
        </article>
        <article id="pedidos"><h2>Meus pedidos</h2>
          {orders.length === 0 && <p>Seus pedidos aparecerão aqui. <Link href={publicPath + '#produtos'}>Ver produtos</Link></p>}
          {orders.map(row => <div className="consumer-item" key={row.id}><div><strong>{row.items.map(item => item.name + ' × ' + item.quantity).join(', ')}</strong><p>{date(row.createdAt)} · {brl(row.cents)}</p></div><span>{row.paymentReview ? 'Em verificação' : orderLabels[row.status] ?? row.status}</span></div>)}
        </article>
        <article id="pagamentos"><h2>Pagamentos e estornos</h2>
          {appointments.filter(row => row.paidAt).map(row => <div className="consumer-item" key={row.id}><strong>{row.service.name} · {brl(row.chargeCents ?? row.cents)}</strong><span>{row.refundedAt ? 'Estornado em ' + date(row.refundedAt) : 'Pago em ' + date(row.paidAt!)}{row.checkoutState === 'REVIEW' && ' · Em conciliação'}{row.refundRequest && refundStatus[row.refundRequest.state] && ' · ' + refundStatus[row.refundRequest.state]}{row.connectedRefunds.length > 0 && !row.refundedAt && ' · Estorno parcial de ' + brl(row.connectedRefunds.reduce((sum, item) => sum + item.amount, 0))}</span>{row.paymentIntentId && <Link href={path + '/comprovante?tipo=agendamento&id=' + row.id}>Comprovante Stripe</Link>}</div>)}
          {orders.filter(row => row.paidAt).map(row => <div className="consumer-item" key={row.id}><strong>Pedido · {brl(row.cents)}</strong><span>{row.refundedAt ? 'Estornado em ' + date(row.refundedAt) : 'Pago em ' + date(row.paidAt!)}{row.paymentReview && ' · Em conciliação'}{row.connectedRefunds.length > 0 && !row.refundedAt && ' · Estorno parcial de ' + brl(row.connectedRefunds.reduce((sum, item) => sum + item.amount, 0))}</span>{row.paymentIntentId && <Link href={path + '/comprovante?tipo=pedido&id=' + row.id}>Comprovante Stripe</Link>}</div>)}
          {!appointments.some(row => row.paidAt) && !orders.some(row => row.paidAt) && <p>Nenhum pagamento confirmado.</p>}
        </article>
        <article id="historico"><h2>Histórico de atendimentos</h2>
          {appointments.map(row => <div className="consumer-item" key={row.id}><div><strong>{row.service.name}</strong><p>{date(row.startsAt)} · {row.professional.name}</p></div><span>{appointmentLabels[row.status]}</span></div>)}
          {!appointments.length && <p>Nenhum atendimento registrado nesta conta.</p>}
        </article>
        <article id="meus-dados"><h2>Meus dados</h2>
          <p>{user?.email}</p><form action={consumerAccess.bind(null, slug, 'profile')}>
            <Field label="Nome completo" name="name" value={profile.name} /><Field label="Telefone com DDI" name="phone" type="tel" value={profile.phone} /><button>Salvar dados</button>
          </form><Link href="/conta">Segurança e acesso da conta</Link>
        </article>
      </div>
    </main>
  </div>
}
