import Link from 'next/link'
import { db } from '@/lib/db'
import { Brand, brl } from '../ui'

export const dynamic = 'force-dynamic'

export default async function Plans() {
  const plans = await db.plan.findMany({ where: { active: true }, orderBy: { monthlyCents: 'asc' } })
  return <div className="site"><header><Brand /><Link href="/login">Entrar</Link></header><main className="content">
    <h1>Planos</h1>
    {plans.length ? <section className="grid">{plans.map(plan => <article key={plan.id}>
      <h2>{plan.name}</h2><p>{plan.description}</p><p><strong>{brl(plan.monthlyCents)}</strong> por mês</p><p>{brl(plan.annualCents)} por ano</p>
      <Link href="/cadastro" className="button">Criar conta</Link>
    </article>)}</section> : <p>As assinaturas ainda não estão disponíveis.</p>}
  </main></div>
}
