import { businessSuitePlan, businessSuitePlanId } from '@/lib/plans'
import Link from 'next/link'
import { randomUUID } from 'node:crypto'
import { Activity, CreditCard, Store, UsersRound } from 'lucide-react'
import { DateTime } from 'luxon'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { userSession } from '@/lib/auth'
import { callbackUrl, socialProviders } from '@/lib/social-oidc'
import { ResendForm } from './resend-form'
import { SocialProviderForm } from './social-provider-form'
import { PlatformFeeForm } from './platform-fee'
import { StripeSettingsForm } from './stripe-settings-form'
import { admin, logout } from '../actions'
import { Brand, ErrorNote, Field, brl } from '../ui'

export default async function SuperAdmin({ searchParams }: { searchParams: Promise<{ erro?: string; stripe?: string }> }) {
  const user = await userSession()
  if (!user?.platformAdmin) redirect('/login')
  if (!user.adminMfaVerified) redirect(user.mfaSecret ? '/login' : '/conta')
  const query = await searchParams
  const date = (value: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(value)
  const month = DateTime.now().setZone('America/Sao_Paulo').startOf('month').toJSDate()
  const [establishments, active, delinquent, canceled, newTenants, billed, recurring, approvedAppointments, approvedOrders, refundedAppointments, refundedOrders] = await Promise.all([
    db.tenant.count(),
    db.tenant.count({ where: { suspended: false, subscriptions: { some: { status: { in: ['active', 'trialing'] } } } } }),
    db.tenant.count({ where: { subscriptions: { some: { status: { in: ['past_due', 'unpaid'] } } } } }),
    db.subscription.count({ where: { status: 'canceled' } }),
    db.tenant.count({ where: { createdAt: { gte: month } } }),
    db.billingInvoice.aggregate({ where: { status: 'paid', currency: 'brl', issuedAt: { gte: month } }, _sum: { amountPaid: true } }),
    db.subscription.groupBy({ by: ['recurringInterval'], where: { status: 'active' }, _sum: { recurringCents: true }, _count: true }),
    db.appointment.aggregate({ where: { paidAt: { gte: month } }, _sum: { platformFeeCents: true }, _count: true }),
    db.shopOrder.aggregate({ where: { paidAt: { gte: month } }, _sum: { platformFeeCents: true }, _count: true }),
    db.appointment.aggregate({ where: { refundedAt: { gte: month } }, _sum: { platformFeeCents: true }, _count: true }),
    db.shopOrder.aggregate({ where: { refundedAt: { gte: month } }, _sum: { platformFeeCents: true }, _count: true })

  ])
  const [tenants, plans, stripeSettings, billingEvent, connectEvent, changes, providerSettings] = await Promise.all([
    db.tenant.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { subscriptions: { include: { plan: true } } } }),
    db.plan.findMany({ orderBy: { monthlyCents: 'asc' } }),
    db.stripeSettings.findUnique({ where: { id: 1 }, select: { mode: true, paused: true, checkedAt: true, checkSucceeded: true, paymentsEnabled: true, payoutsEnabled: true } }),
    db.webhookEvent.findFirst({ where: { source: 'billing' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    db.webhookEvent.findFirst({ where: { source: 'connect' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    db.adminAudit.findMany({ where: { action: { startsWith: 'STRIPE_' } }, orderBy: { createdAt: 'desc' }, take: 15, select: { action: true, createdAt: true } }),
    db.socialProviderSettings.findMany({ select: { provider: true, enabled: true } })
  ])
  const monthly = recurring.find(row => row.recurringInterval === 'month')?._sum.recurringCents ?? 0
  const annual = recurring.find(row => row.recurringInterval === 'year')?._sum.recurringCents ?? 0
  const unsynced = recurring.find(row => row.recurringInterval === null)?._count ?? 0
  const fees = [approvedAppointments, approvedOrders, refundedAppointments, refundedOrders].map(row => row._sum.platformFeeCents ?? 0)
  const [mail, audit] = await Promise.all([
    db.mailSetting.findUnique({ where: { id: 1 }, select: { sender: true, updatedAt: true } }),
    db.adminAudit.findMany({ select: { id: true, action: true, createdAt: true }, take: 25, orderBy: { createdAt: 'desc' } })
  ])
  return <div className="shell"><aside><Brand /><nav><Link href="/super-admin">Administração</Link><a href="#assinantes">Assinantes</a><a href="#planos">Planos</a><a href="#auditoria">Auditoria</a><Link href="/conciliacao">Movimentações Stripe</Link><Link href="/comunicacao">Comunicação</Link><Link href="/diagnostico">Diagnóstico</Link><Link href="/conta">Minha conta</Link></nav><form action={logout}><button className="subtle">Sair</button></form></aside>
    <main className="content platform-console"><section className="workspace-heading"><div><h1>Administração da plataforma</h1><p>Acompanhe assinantes, planos e integrações.</p></div><Link className="button outline" href="/diagnostico"><Activity size={19} aria-hidden /> Diagnóstico</Link></section>
      <section className="commercial-kpis">
        <article><Store aria-hidden /><p>Estabelecimentos</p><strong>{establishments}</strong><small>{newTenants} cadastrados neste mês</small></article>
        <article><UsersRound aria-hidden /><p>Assinantes ativos ou em teste</p><strong>{active}</strong><small>{delinquent} com inadimplência</small></article>
        <article><Activity aria-hidden /><p>Assinaturas canceladas</p><strong>{canceled}</strong></article>
        <article><CreditCard aria-hidden /><p>Faturas pagas emitidas no mês</p><strong>{brl(billed._sum.amountPaid ?? 0)}</strong><small>Stripe Billing da plataforma</small></article>
      </section><ErrorNote error={query.erro} />
      <section className="commercial-kpis">
        <article><CreditCard aria-hidden /><p>Receita recorrente contratada</p><strong>{brl(Math.round(monthly + annual / 12))} / mês</strong><small>{brl(monthly * 12 + annual)} anualizados em assinaturas ativas sincronizadas{unsynced ? ' · ' + unsynced + ' aguardando dados do plano' : ''}</small></article>
        <article><Activity aria-hidden /><p>Comissões registradas no mês</p><strong>{brl(fees[0] + fees[1] - fees[2] - fees[3])}</strong><small>{approvedAppointments._count + approvedOrders._count} pagamentos e {refundedAppointments._count + refundedOrders._count} estornos · confira o saldo em Movimentações Stripe</small></article>
      </section>
      {query.stripe === 'conectada' && <p role="status" className="success">Conexão com a Stripe confirmada.</p>}
      <article><h2>Configuração da Stripe</h2>
        {stripeSettings && <p>Ambiente configurado · {stripeSettings.mode === 'live' ? 'Produção' : 'Teste'}</p>}
        {stripeSettings && <p>{stripeSettings.paused ? 'Novas cobranças desconectadas' : 'Novas cobranças habilitadas nas preferências'}</p>}
        {stripeSettings?.checkedAt && <p>Última verificação · {date(stripeSettings.checkedAt)} · {stripeSettings.checkSucceeded ? 'Conexão confirmada' : 'Conexão indisponível'}</p>}
        {stripeSettings?.checkSucceeded && <p>{stripeSettings.paymentsEnabled ? 'Recebimentos habilitados' : 'Recebimentos indisponíveis'} · {stripeSettings.payoutsEnabled ? 'Repasses habilitados' : 'Repasses indisponíveis'}</p>}
        <p>Última notificação de assinatura · {billingEvent ? date(billingEvent.createdAt) : 'Nenhuma recebida'}</p>
        <p>Última notificação de pagamento · {connectEvent ? date(connectEvent.createdAt) : 'Nenhuma recebida'}</p>
        <details><summary>{stripeSettings ? 'Atualizar credenciais' : 'Configurar credenciais'}</summary>
          <StripeSettingsForm mode={stripeSettings?.mode ?? 'test'} />
        </details>
        <details><summary>Verificar conexão</summary><form action={admin.bind(null, 'stripe-test')}>
          <Field label="Sua senha" name="password" type="password" /><button>Testar conexão</button>
        </form></details>
        {stripeSettings && <details><summary>{stripeSettings.paused ? 'Reconectar novos pagamentos' : 'Desconectar novos pagamentos'}</summary>
          <p>Cobranças existentes continuam sendo acompanhadas.</p>
          <form action={admin.bind(null, 'stripe-pause')}>
            <input type="hidden" name="paused" value={String(!stripeSettings.paused)} />
            <Field label="Sua senha" name="password" type="password" /><button>{stripeSettings.paused ? 'Reconectar' : 'Desconectar'}</button>
          </form>
        </details>}
        {changes.length > 0 && <details><summary>Histórico da configuração</summary><ul>{changes.map((change, index) => <li key={index}>
          {date(change.createdAt)} · {({ STRIPE_CONFIG_UPDATED: 'Credenciais atualizadas', STRIPE_CHECK_OK: 'Conexão verificada', STRIPE_CHECK_FAILED: 'Falha na verificação', STRIPE_PAUSED: 'Novas cobranças desconectadas', STRIPE_RESUMED: 'Novas cobranças reconectadas' } as Record<string,string>)[change.action] ?? 'Alteração registrada'}
        </li>)}</ul></details>}
      </article>
      <article><h2>Provedores de autenticação</h2>
        <div className="social-settings-grid">{socialProviders.map(provider => {
          const config = providerSettings.find(item => item.provider === provider)
          return <SocialProviderForm key={provider} provider={provider} callback={callbackUrl(provider)} configured={Boolean(config)} enabled={Boolean(config?.enabled)} />
        })}</div>
      </article>
      <article><h2>Resend</h2><p>{mail ? 'Remetente salvo · ' + date(mail.updatedAt) : 'Configure o remetente para e-mails transacionais.'}</p><ResendForm sender={mail?.sender} /></article>
      <article id="assinantes"><h2>Assinantes</h2>{!tenants.length ? <p>Nenhum estabelecimento cadastrado.</p> : <div className="scroll"><table>
        <thead><tr><th>Estabelecimento</th><th>Acesso</th><th>Assinaturas</th><th>Ação</th><th>WhatsApp</th></tr></thead>
        <tbody>{tenants.map(t => <tr key={t.id}><td>{t.name}</td><td>{t.suspended ? 'Suspenso' : t.active ? 'Ativo' : 'Inativo'}</td>
          <td>{t.subscriptions.map(s => s.plan.name).join(', ') || 'Nenhuma'}</td>
          <td><form action={admin.bind(null, 'suspend')}><input type="hidden" name="tenantId" value={t.id} /><button name="suspended" value={String(!t.suspended)} className="outline">{t.suspended ? 'Remover suspensão' : 'Suspender'}</button></form><PlatformFeeForm scope="tenant" id={t.id} bps={t.platformFeeBps} fixed={t.platformFeeFixed} /></td>
          <td><form action={admin.bind(null, 'whatsapp')}><input type="hidden" name="tenantId" value={t.id} />
            <Field label="Instância do WhatsApp" name="instance" value={t.whatsappInstance ?? ''} required={false} /><button className="outline">Salvar vínculo</button>
          </form></td></tr>)}</tbody>
      </table></div>}</article>
      <article id="planos"><h2>Planos</h2>
        {!plans.some(plan => plan.id === businessSuitePlanId) && <form action={admin.bind(null, 'business-plan')}>
          <p>Business Suite · {brl(businessSuitePlan.monthlyCents)} ao mês ou {brl(businessSuitePlan.annualCents)} ao ano.</p>
          <button className="outline">Cadastrar oferta Business Suite na Stripe</button>
        </form>}
        <form className="inline" action={admin.bind(null, 'plan')}>
        <input name="requestId" type="hidden" value={randomUUID()} />
        <Field label="Nome" name="name" /><Field label="Descrição" name="description" /><Field label="Mensal em centavos" name="monthlyCents" type="number" min={100} />
        <Field label="Anual em centavos" name="annualCents" type="number" min={100} /><Field label="Dias de avaliação" name="trialDays" type="number" min={0} max={90} value={0} /><button>Criar plano</button></form>
        {plans.length > 0 && <ul>{plans.map(p => <li key={p.id}>{p.name} · {brl(p.monthlyCents)} por mês · {brl(p.annualCents)} por ano · {p.active ? 'Disponível' : 'Desativado'}
          <details><summary>Editar {p.name}</summary><form className="inline" action={admin.bind(null, 'plan-edit')}>
            <input name="id" type="hidden" value={p.id} />
            <Field label="Nome" name="name" value={p.name} /><Field label="Descrição" name="description" value={p.description} />
            <Field label="Mensal em centavos" name="monthlyCents" type="number" min={100} value={p.monthlyCents} />
            <Field label="Anual em centavos" name="annualCents" type="number" min={100} value={p.annualCents} />
            <Field label="Dias de avaliação" name="trialDays" type="number" min={0} max={90} value={p.trialDays} /><button>Salvar plano</button>
          </form></details>
          <form action={admin.bind(null, 'plan-active')}><input name="id" type="hidden" value={p.id} /><button className="outline" name="active" value={String(!p.active)}>{p.active ? 'Desativar plano' : 'Reativar plano'}</button></form>
          <PlatformFeeForm scope="plan" id={p.id} bps={p.platformFeeBps} fixed={p.platformFeeFixed} /></li>)}</ul>}
      </article>
      <article id="auditoria"><h2>Auditoria administrativa</h2>{audit.length ? <ul>{audit.map(row => <li key={row.id}>{date(row.createdAt)} · {row.action.toLowerCase().replaceAll('_', ' ')}</li>)}</ul> : <p>Nenhuma alteração administrativa registrada.</p>}</article>
    </main></div>
}
