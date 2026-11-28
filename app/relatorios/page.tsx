import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BarChart3, CircleDollarSign, RotateCcw, Wallet } from 'lucide-react'
import { DateTime } from 'luxon'
import { membership, userSession } from '@/lib/auth'
import { cashPeriod, cashReport } from '@/lib/commerce'
import { can } from '@/lib/permissions'
import { db } from '@/lib/db'
import { MerchantShell } from '../merchant-shell'
import { RevenueChart } from '../revenue-chart'
import { Field, brl } from '../ui'

export default async function Reports({ searchParams }: { searchParams: Promise<{ inicio?: string; fim?: string }> }) {
  const user = await userSession()
  const member = user ? await membership(user.id) : null
  if (!member?.tenant.active || member.tenant.suspended || !can(member, 'finance.read')) redirect('/dashboard')
  const query = await searchParams
  const { tenantId, tenant: { timezone: zone } } = member
  const today = DateTime.now().setZone(zone)
  const start = typeof query.inicio === 'string' ? query.inicio : today.startOf('month').toISODate()!
  const end = typeof query.fim === 'string' ? query.fim : today.toISODate()!
  const period = cashPeriod(zone, start, end)
  const [report, requests] = period ? await Promise.all([
    cashReport(tenantId, zone, period),
    db.appointmentHistory.count({ where: { operation: 'REFUND_REQUESTED', createdAt: period, appointment: { tenantId, refundedAt: null } } })
  ]) : [null, 0]
  const rows = report?.rows ?? []
  const gross = rows.filter(row => row.cents > 0).reduce((sum, row) => sum + row.cents, 0)
  const out = rows.filter(row => row.cents < 0).reduce((sum, row) => sum - row.cents, 0)
  const refunds = rows.filter(row => row.title.startsWith('Estorno')).reduce((sum, row) => sum - row.cents, 0)
  const received = (method: 'card' | 'pix') => rows.reduce((total, row) => total + ('method' in row && row.method === method ? row.cents : 0), 0)
  const date = (value: Date) => DateTime.fromJSDate(value, { zone }).toFormat('dd/LL/yyyy')
  const exportQuery = new URLSearchParams({ inicio: start, fim: end })
  const chart = [...new Set(rows.map(row => date(row.date)))].slice(0, 31).reverse()
    .map(day => ({ day, incoming: rows.filter(row => date(row.date) === day && row.cents > 0).reduce((sum, row) => sum + row.cents, 0) }))
  return <MerchantShell member={member} current="/relatorios">
    <section className="workspace-heading"><div><h1><BarChart3 aria-hidden /> Relatórios financeiros</h1><p>Movimentações registradas neste estabelecimento.</p></div><Link className="button outline" href="/conciliacao">Saldo, taxas e repasses Stripe</Link></section>
    <article><form method="get" className="inline">
      <Field type="date" name="inicio" label="Data inicial" value={start} />
      <Field type="date" name="fim" label="Data final" value={end} /><button>Aplicar período</button>
    </form></article>
    {!period ? <p className="error" role="alert">Informe um período válido de até 93 dias.</p> : <>
      <section className="commercial-kpis">
        <article><CircleDollarSign aria-hidden /><p>Entradas brutas registradas</p><strong>{brl(gross)}</strong></article>
        <article><Wallet aria-hidden /><p>Resultado do fluxo de caixa</p><strong>{brl(gross - out)}</strong><small>Entradas menos saídas registradas</small></article>
        <article><CircleDollarSign aria-hidden /><p>Pagamentos online aprovados</p><strong>{brl(received('card') + received('pix'))}</strong><small>Cartão {brl(received('card'))} · Pix {brl(received('pix'))}</small></article>
        <article><RotateCcw aria-hidden /><p>Estornos concluídos</p><strong>{brl(refunds)}</strong><small>{requests} solicitação(ões) pendente(s) no período</small></article>
      </section>
      <article className="commercial-panel"><h2>Entradas por dia de movimentação</h2>
        {chart.length ? <RevenueChart points={chart.map(row => ({ label: row.day.slice(0, 5), value: row.incoming }))} />
          : <p className="surface-empty">Nenhuma movimentação liquidada neste período.</p>}
      </article>
      <article className="commercial-panel"><h2>Movimentações recentes</h2>
        {can(member, 'report.export') && <div className="inline"><a className="button outline" href={'/api/financeiro/csv?' + exportQuery}>Baixar CSV</a><a className="button outline" href={'/api/financeiro/xlsx?' + exportQuery}>Baixar XLSX</a></div>}
        {rows.length > 0 && <div className="scroll"><table><thead><tr><th>Data</th><th>Movimentação</th><th>Valor</th></tr></thead>
          <tbody>{rows.slice(0, 60).map((row, index) => <tr key={index}><td>{date(row.date)}</td><td>{row.title}</td><td>{brl(row.cents)}</td></tr>)}</tbody>
        </table></div>}
        <p><Link href="/recebimentos">Recebimentos e pagamentos pendentes</Link> · <Link href="/comercial">Vendas e lançamentos</Link></p>
      </article>
    </>}
  </MerchantShell>
}
