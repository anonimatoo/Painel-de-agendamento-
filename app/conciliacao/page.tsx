import { can } from '@/lib/permissions'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { DateTime } from 'luxon'
import { membership, userSession } from '@/lib/auth'
import { stripeLedger } from '@/lib/stripe-ledger'
import { Brand, Field } from '../ui'

const groups: Record<string, string> = {
  charge: 'Cobrança', payment: 'Pagamento', refund: 'Estorno', payment_refund: 'Estorno',
  payout: 'Repasse', dispute: 'Contestação', dispute_reversal: 'Reversão de contestação',
  fee: 'Tarifa', application_fee: 'Comissão', application_fee_refund: 'Devolução da comissão', adjustment: 'Ajuste'
}

export default async function Reconciliation({ searchParams }: { searchParams: Promise<{ inicio?: string; fim?: string; categoria?: string }> }) {
  const user = await userSession()
  if (!user) redirect('/login')
  const platform = user.platformAdmin
  if (platform && !user.adminMfaVerified) redirect('/login')
  const member = platform ? null : await membership(user.id)
  if (!platform && (!member || !can(member, 'finance.read'))) redirect('/dashboard')
  const account = member?.tenant.stripeAccountId
  const zone = member?.tenant.timezone ?? 'America/Sao_Paulo'
  const today = DateTime.now().setZone(zone)
  const query = await searchParams
  const start = DateTime.fromISO(typeof query.inicio === 'string' ? query.inicio : today.startOf('month').toISODate()!, { zone }).startOf('day')
  const end = DateTime.fromISO(typeof query.fim === 'string' ? query.fim : today.toISODate()!, { zone }).startOf('day')
  const valid = start.isValid && end.isValid && start <= end && end.diff(start, 'days').days <= 92
  const data = valid && (platform || account) ? await stripeLedger(account ?? undefined, start.toSeconds(), end.plus({ days: 1 }).toSeconds()).catch(() => null) : null
  const category = typeof query.categoria === 'string' ? query.categoria : ''
  const items = data?.transactions.data.filter(item => !category || item.reporting_category === category) ?? []
  const money = (value: number, currency: string) => Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency.toUpperCase() }).format(value / 100)
  const date = (value: number) => DateTime.fromSeconds(value, { zone }).toFormat('dd/LL/yyyy')
  return <div className="site"><header><Brand /><Link href={platform ? '/super-admin' : '/recebimentos'}>Voltar ao painel</Link></header><main className="content">
    <h1>Movimentações Stripe</h1>
    <article><form method="get" className="inline">
      <Field label="Data inicial" name="inicio" type="date" value={start.toISODate() ?? ''} />
      <Field label="Data final" name="fim" type="date" value={end.toISODate() ?? ''} />
      <label>Categoria<select name="categoria" defaultValue={category}><option value="">Todas</option>
        {Object.entries(groups).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
      </select></label><button>Consultar</button>
    </form>
    {!valid ? <p role="alert">Informe um período válido de até 93 dias.</p> : !data ? <p role="status">Não foi possível consultar os dados da Stripe. Verifique se a conta está conectada.</p> : null}
    </article>
    {data && <>
      <section className="grid"><article><h2>Disponível</h2>{data.balance.available.map(value => <p key={value.currency}>{money(value.amount, value.currency)}</p>)}</article>
        <article><h2>Pendente de liberação</h2>{data.balance.pending.map(value => <p key={value.currency}>{money(value.amount, value.currency)}</p>)}</article>
      </section>
      <article><h2>Transações no período</h2>
        {data.transactions.has_more && <p>Há mais de 100 movimentos. Reduza o período para consultar os demais.</p>}
        {items.length ? <div className="scroll"><table><thead><tr><th>Data</th><th>Categoria</th><th>Bruto</th><th>Taxa</th><th>Líquido</th></tr></thead>
          <tbody>{items.map(item => <tr key={item.id}><td>{date(item.created)}</td><td>{groups[item.reporting_category] ?? 'Outra movimentação'}</td>
            <td>{money(item.amount, item.currency)}</td><td>{money(item.fee, item.currency)}</td><td>{money(item.net, item.currency)}</td></tr>)}</tbody>
        </table></div> : <p>Nenhuma transação para este filtro.</p>}
      </article>
      <article><h2>Repasses recentes do período</h2>{data.payouts.data.length ? <ul>{data.payouts.data.map(item => <li key={item.id}>
        {date(item.created)} · {money(item.amount, item.currency)} · {({ paid: 'Pago', pending: 'Pendente', in_transit: 'Em trânsito', canceled: 'Cancelado', failed: 'Falhou' } as Record<string,string>)[item.status] ?? 'Em análise'}
      </li>)}</ul> : <p>Nenhum repasse registrado.</p>}</article>
      <article><h2>Contestações recentes do período</h2>{data.disputes.data.length ? <ul>{data.disputes.data.map(item => <li key={item.id}>
        {date(item.created)} · {money(item.amount, item.currency)} · {({ won: 'Ganha', lost: 'Perdida', needs_response: 'Aguardando resposta', under_review: 'Em análise' } as Record<string,string>)[item.status] ?? 'Em acompanhamento'}
      </li>)}</ul> : <p>Nenhuma contestação registrada.</p>}</article>
    </>}
  </main></div>
}
