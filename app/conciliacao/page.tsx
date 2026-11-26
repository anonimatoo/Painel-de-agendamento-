import { can } from '@/lib/permissions'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { DateTime } from 'luxon'
import { membership, userSession } from '@/lib/auth'
import { ledgerScope, movementDifferences, recordedMovements, storeMovements, stripeLedger } from '@/lib/stripe-ledger'
import { db } from '@/lib/db'
import { stripeClient, stripeConfiguration } from '@/lib/stripe-settings'
import { Brand, Field } from '../ui'

const groups: Record<string, string> = {
  charge: 'Cobrança', payment: 'Pagamento', refund: 'Estorno', payment_refund: 'Estorno',
  payout: 'Repasse', dispute: 'Contestação', dispute_reversal: 'Reversão de contestação',
  fee: 'Tarifa', application_fee: 'Comissão', application_fee_refund: 'Devolução da comissão', adjustment: 'Ajuste'
}

export default async function Reconciliation({ searchParams }: { searchParams: Promise<{ inicio?: string; fim?: string; categoria?: string; empresa?: string; cliente?: string; transacao?: string; situacao?: string }> }) {
  const user = await userSession()
  if (!user) redirect('/login')
  const platform = user.platformAdmin
  if (platform && !user.adminMfaVerified) redirect('/login')
  const member = platform ? null : await membership(user.id)
  if (!platform && (!member || !can(member, 'finance.read'))) redirect('/dashboard')
  const query = await searchParams
  const tenants = platform ? await db.tenant.findMany({ where: { stripeAccountId: { not: null } }, orderBy: { name: 'asc' }, select: { id: true, name: true, stripeAccountId: true }, take: 200 }) : []
  const selected = tenants.find(tenant => tenant.id === query.empresa)
  const account = member?.tenant.stripeAccountId ?? selected?.stripeAccountId
  const tenantId = member?.tenantId ?? selected?.id
  const zone = member?.tenant.timezone ?? 'America/Sao_Paulo'
  const today = DateTime.now().setZone(zone)
  const start = DateTime.fromISO(typeof query.inicio === 'string' ? query.inicio : today.startOf('month').toISODate()!, { zone }).startOf('day')
  const end = DateTime.fromISO(typeof query.fim === 'string' ? query.fim : today.toISODate()!, { zone }).startOf('day')
  const valid = start.isValid && end.isValid && start <= end && end.diff(start, 'days').days <= 92
  const category = typeof query.categoria === 'string' ? query.categoria : ''
  const status = typeof query.situacao === 'string' ? query.situacao : ''
  const ref = typeof query.transacao === 'string' ? query.transacao.trim().slice(0, 140) : ''
  const customer = typeof query.cliente === 'string' ? query.cliente.trim().slice(0, 140) : ''
  let scope: string | null = null
  const endExclusive = end.plus({ days: 1 })
  const data = valid && (platform || account) ? await (async () => {
    const config = await stripeConfiguration()
    const api = stripeClient(config.secret)
    scope = await ledgerScope(platform && !selected, account, { api, mode: config.mode })
    const result = await stripeLedger(account ?? undefined, start.toSeconds(), endExclusive.toSeconds(), api)
    if (scope) await storeMovements(scope, result.transactions.data)
    return result
  })().catch(() => null) : null
  const items = valid && scope ? await recordedMovements(scope, start.toJSDate(), endExclusive.toJSDate(), { category, status, ref, customer }) : []
  const differences = tenantId ? await movementDifferences(tenantId, items) : []
  const exportQuery = new URLSearchParams({ inicio: start.toISODate() ?? '', fim: end.toISODate() ?? '', categoria: category, situacao: status, transacao: ref, cliente: customer, empresa: selected?.id ?? '' }).toString()
  const money = (value: number, currency: string) => Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency.toUpperCase() }).format(value / 100)
  const date = (value: number) => DateTime.fromSeconds(value, { zone }).toFormat('dd/LL/yyyy')
  return <div className="site"><header><Brand /><Link href={platform ? '/super-admin' : '/recebimentos'}>Voltar ao painel</Link></header><main className="content">
    <h1>Movimentações Stripe</h1>
    <article><form method="get" className="inline">
      <Field label="Data inicial" name="inicio" type="date" value={start.toISODate() ?? ''} />
      <Field label="Data final" name="fim" type="date" value={end.toISODate() ?? ''} />
      <label>Categoria<select name="categoria" defaultValue={category}><option value="">Todas</option>
        {Object.entries(groups).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
      </select></label>
      {platform && <label>Conta<select name="empresa" defaultValue={selected?.id ?? ''}><option value="">Plataforma</option>{tenants.map(tenant => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label>}
      <label>Situação<select name="situacao" defaultValue={status}><option value="">Todas</option><option value="available">Disponível</option><option value="pending">Pendente</option></select></label>
      <Field label="Referência da transação" name="transacao" value={ref} required={false} />
      <Field label="Referência do cliente na Stripe" name="cliente" value={customer} required={false} />
      <button>Atualizar movimentações</button>
    </form>
    {!valid ? <p role="alert">Informe um período válido de até 93 dias.</p> : !data ? <p role="status">Não foi possível consultar os dados da Stripe. Verifique se a conta está conectada.</p> : null}
    </article>
    {data && <>
      <section className="grid"><article><h2>Disponível</h2>{data.balance.available.map(value => <p key={value.currency}>{money(value.amount, value.currency)}</p>)}</article>
        <article><h2>Pendente de liberação</h2>{data.balance.pending.map(value => <p key={value.currency}>{money(value.amount, value.currency)}</p>)}</article>
      </section>
      <article><h2>Repasses recentes do período</h2>{data.payouts.data.length ? <ul>{data.payouts.data.map(item => <li key={item.id}>
        {date(item.created)} · {money(item.amount, item.currency)} · {({ paid: 'Pago', pending: 'Pendente', in_transit: 'Em trânsito', canceled: 'Cancelado', failed: 'Falhou' } as Record<string,string>)[item.status] ?? 'Em análise'}
      </li>)}</ul> : <p>Nenhum repasse registrado.</p>}</article>
      <article><h2>Contestações recentes do período</h2>{data.disputes.data.length ? <ul>{data.disputes.data.map(item => <li key={item.id}>
        {date(item.created)} · {money(item.amount, item.currency)} · {({ won: 'Ganha', lost: 'Perdida', needs_response: 'Aguardando resposta', under_review: 'Em análise' } as Record<string,string>)[item.status] ?? 'Em acompanhamento'}
      </li>)}</ul> : <p>Nenhuma contestação registrada.</p>}</article>
    </>}
    {valid && scope && <article><h2>Livro de movimentações no período</h2>
      {data?.transactions.has_more && <p>Há mais movimentos na Stripe. Reduza o período para atualizar os demais.</p>}
      {(platform || can(member, 'report.export')) && <div className="inline"><a className="button outline" href={'/api/movimentacoes/csv?' + exportQuery}>Baixar CSV</a><a className="button outline" href={'/api/movimentacoes/xlsx?' + exportQuery}>Baixar XLSX</a></div>}
      {items.length ? <div className="scroll"><table><thead><tr><th>Data</th><th>Referência</th><th>Categoria</th><th>Situação</th><th>Bruto</th><th>Taxa</th><th>Líquido</th></tr></thead>
        <tbody>{items.map(item => <tr key={item.id}><td>{date(+item.occurredAt / 1000)}</td><td>{item.stripeId}</td>
          <td>{groups[item.category] ?? 'Outra movimentação'}</td><td>{item.status === 'available' ? 'Disponível' : 'Pendente'}</td>
          <td>{money(item.gross, item.currency)}</td><td>{money(item.fee, item.currency)}</td><td>{money(item.net, item.currency)}</td>
        </tr>)}</tbody>
      </table></div> : <p>Nenhuma transação registrada para este filtro.</p>}
      <h3>Divergências de valor nos pagamentos vinculados</h3>
      {differences.length ? <ul>{differences.map(item => <li key={item.id}>{item.stripeId} · {money(item.gross, item.currency)}</li>)}</ul> : <p>Nenhuma diferença de valor encontrada nos registros vinculados consultados.</p>}
    </article>}
  </main></div>
}
