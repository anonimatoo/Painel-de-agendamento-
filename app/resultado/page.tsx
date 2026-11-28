import Link from 'next/link'
import { redirect } from 'next/navigation'
import { membership, userSession } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { cashPeriod } from '@/lib/commerce'
import { operatingResult, professionalResult } from '@/lib/business-finance'
import { MerchantShell } from '../merchant-shell'
import { brl, Field } from '../ui'

export default async function Profit({ searchParams }: { searchParams: Promise<{ inicio?: string; fim?: string; regime?: string }> }) {
  const user = await userSession()
  const member = user ? await membership(user.id) : null
  if (!member?.tenant.active || member.tenant.suspended || !can(member, 'finance.read')) redirect('/dashboard')
  const { inicio, fim, regime } = await searchParams
  const accrue = regime !== 'caixa'
  const period = cashPeriod(member.tenant.timezone, inicio, fim)
  const report = period ? await professionalResult(member.tenant, period, accrue) : null
  const formatDate = (value: string) => value.split('-').reverse().join('/')
  return <MerchantShell member={member} current="/resultado">
    <div className="row"><div><h1>{accrue ? 'DRE gerencial' : 'Resultado de caixa'}</h1><p>Consulte o resultado do período e a evolução por dia.</p></div>
      <Link className="button outline" href="/relatorios">Relatórios e exportação</Link></div>
    <article><form className="inline">
      <Field name="inicio" label="Início" type="date" value={inicio} required={false} />
      <Field name="fim" label="Fim" type="date" value={fim} required={false} />
      <label>Regime<select name="regime" defaultValue={accrue ? 'competencia' : 'caixa'}><option value="competencia">Competência</option><option value="caixa">Caixa</option></select></label>
      <button>Consultar</button>
    </form></article>
    {report ? <>
      <article><h2>Resultado do período</h2>
        <dl className="grid">{[
          ['Receitas registradas', report.totals.revenue], ['Estornos e devoluções', report.totals.refunds],
          [accrue ? 'Custos de mercadoria registrados' : 'Compras de estoque pagas', accrue ? report.totals.cost : report.totals.purchases],
          ['Comissões', report.totals.commissions], ['Impostos informados', report.totals.taxes], ['Despesas registradas', report.totals.expenses],
          ['Taxas Stripe conciliadas nas cobranças', report.totals.fees], ['Resultado dos registros disponíveis', operatingResult(report.totals)]
        ].map(([label, amount]) => <div key={label}><dt>{label}</dt><dd><strong>{brl(Number(amount))}</strong></dd></div>)}</dl>
        {(report.totals.missingCosts > 0 || report.totals.missingFees > 0 || report.totals.unclassifiedOrders > 0) && <p role="status">
          Dados parciais. {report.totals.missingCosts} registros de venda sem custo confiável e {report.totals.missingFees} cobranças sem taxa conciliada e {report.totals.unclassifiedOrders} pedidos históricos sem classificação de competência.
        </p>}
        <p>{accrue ? 'Competência usa conclusão do atendimento e vencimento dos lançamentos manuais. Mercadoria entra pelo custo registrado na venda.' : 'Caixa inclui entradas e baixas registradas, com compras de estoque no dia do pagamento.'}</p>
      </article>
      <article><h2>Resultado diário</h2>{report.days.length ? <div className="scroll"><table><thead><tr>
        <th>Data</th><th>Receitas</th><th>Devoluções</th><th>Resultado registrado</th>
      </tr></thead><tbody>{report.days.map(([day, values]) => <tr key={day}><td>{formatDate(day)}</td><td>{brl(values.revenue)}</td>
        <td>{brl(values.refunds)}</td><td>{brl(operatingResult(values))}</td></tr>)}</tbody></table></div> : <p>Nenhuma movimentação no período.</p>}</article>
    </> : <p role="alert">Selecione um período válido de até 93 dias.</p>}
  </MerchantShell>
}
