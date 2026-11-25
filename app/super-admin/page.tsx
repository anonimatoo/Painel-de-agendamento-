import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { userSession } from '@/lib/auth'
import { PlatformFeeForm } from './platform-fee'
import { admin, logout } from '../actions'
import { Brand, ErrorNote, Field, brl } from '../ui'

export default async function SuperAdmin({ searchParams }: { searchParams: Promise<{ erro?: string; stripe?: string }> }) {
  const user = await userSession()
  if (!user?.platformAdmin) redirect('/login')
  if (!user.adminMfaVerified) redirect(user.mfaSecret ? '/login' : '/conta')
  const query = await searchParams
  const date = (value: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(value)
  const [tenants, plans, stripeSettings, billingEvent, connectEvent, changes] = await Promise.all([
    db.tenant.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { subscriptions: { include: { plan: true } } } }),
    db.plan.findMany({ orderBy: { monthlyCents: 'asc' } }),
    db.stripeSettings.findUnique({ where: { id: 1 }, select: { mode: true, paused: true, checkedAt: true, checkSucceeded: true, paymentsEnabled: true, payoutsEnabled: true } }),
    db.webhookEvent.findFirst({ where: { source: 'billing' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    db.webhookEvent.findFirst({ where: { source: 'connect' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    db.adminAudit.findMany({ where: { action: { startsWith: 'STRIPE_' } }, orderBy: { createdAt: 'desc' }, take: 15, select: { action: true, createdAt: true } })
  ])
  return <div className="shell"><aside><Brand /><nav><Link href="/super-admin">Administração</Link><a href="#assinantes">Assinantes</a><a href="#planos">Planos</a><Link href="/conciliacao">Movimentações Stripe</Link><Link href="/conta">Minha conta</Link></nav><form action={logout}><button className="subtle">Sair</button></form></aside>
    <main className="content"><h1>Administração da plataforma</h1><ErrorNote error={query.erro} />
      {query.stripe === 'conectada' && <p role="status" className="success">Conexão com a Stripe confirmada.</p>}
      <article><h2>Configuração da Stripe</h2>
        {stripeSettings && <p>Ambiente configurado · {stripeSettings.mode === 'live' ? 'Produção' : 'Teste'}</p>}
        {stripeSettings && <p>{stripeSettings.paused ? 'Novas cobranças desconectadas' : 'Novas cobranças habilitadas nas preferências'}</p>}
        {stripeSettings?.checkedAt && <p>Última verificação · {date(stripeSettings.checkedAt)} · {stripeSettings.checkSucceeded ? 'Conexão confirmada' : 'Conexão indisponível'}</p>}
        {stripeSettings?.checkSucceeded && <p>{stripeSettings.paymentsEnabled ? 'Recebimentos habilitados' : 'Recebimentos indisponíveis'} · {stripeSettings.payoutsEnabled ? 'Repasses habilitados' : 'Repasses indisponíveis'}</p>}
        <p>Última notificação de assinatura · {billingEvent ? date(billingEvent.createdAt) : 'Nenhuma recebida'}</p>
        <p>Última notificação de pagamento · {connectEvent ? date(connectEvent.createdAt) : 'Nenhuma recebida'}</p>
        <details><summary>Atualizar credenciais</summary>
          <form action={admin.bind(null, 'stripe-config')}>
            <label>Ambiente<select name="mode" defaultValue={stripeSettings?.mode ?? 'test'}><option value="test">Teste</option><option value="live">Produção</option></select></label>
            <Field label="Chave pública" name="publishableKey" />
            <Field label="Chave secreta" name="secret" type="password" />
            <Field label="Segredo de cobrança da assinatura" name="billingWebhook" type="password" />
            <Field label="Segredo de pagamentos dos estabelecimentos" name="connectWebhook" type="password" />
            <Field label="Sua senha" name="password" type="password" /><button>Salvar configuração</button>
          </form>
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
      <article id="assinantes"><h2>Assinantes</h2>{!tenants.length ? <p>Nenhum estabelecimento cadastrado.</p> : <div className="scroll"><table>
        <thead><tr><th>Estabelecimento</th><th>Acesso</th><th>Assinaturas</th><th>Ação</th><th>WhatsApp</th></tr></thead>
        <tbody>{tenants.map(t => <tr key={t.id}><td>{t.name}</td><td>{t.suspended ? 'Suspenso' : t.active ? 'Ativo' : 'Inativo'}</td>
          <td>{t.subscriptions.map(s => s.plan.name).join(', ') || 'Nenhuma'}</td>
          <td><form action={admin.bind(null, 'suspend')}><input type="hidden" name="tenantId" value={t.id} /><button name="suspended" value={String(!t.suspended)} className="outline">{t.suspended ? 'Remover suspensão' : 'Suspender'}</button></form><PlatformFeeForm scope="tenant" id={t.id} bps={t.platformFeeBps} fixed={t.platformFeeFixed} /></td>
          <td><form action={admin.bind(null, 'whatsapp')}><input type="hidden" name="tenantId" value={t.id} />
            <Field label="Instância do WhatsApp" name="instance" value={t.whatsappInstance ?? ''} required={false} /><button className="outline">Salvar vínculo</button>
          </form></td></tr>)}</tbody>
      </table></div>}</article>
      <article id="planos"><h2>Planos</h2><form className="inline" action={admin.bind(null, 'plan')}>
        <Field label="Nome" name="name" /><Field label="Descrição" name="description" /><Field label="Mensal em centavos" name="monthlyCents" type="number" min={100} />
        <Field label="Anual em centavos" name="annualCents" type="number" min={100} /><Field label="Dias de avaliação" name="trialDays" type="number" min={0} max={90} value={0} /><button>Criar plano</button></form>
        {plans.length > 0 && <ul>{plans.map(p => <li key={p.id}>{p.name} · {brl(p.monthlyCents)} por mês · {brl(p.annualCents)} por ano<PlatformFeeForm scope="plan" id={p.id} bps={p.platformFeeBps} fixed={p.platformFeeFixed} /></li>)}</ul>}
      </article>
    </main></div>
}
