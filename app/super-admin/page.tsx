import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { userSession } from '@/lib/auth'
import { admin, logout } from '../actions'
import { Brand, ErrorNote, Field, brl } from '../ui'

export default async function SuperAdmin({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  if (!(await userSession())?.platformAdmin) redirect('/login')
  const [tenants, plans] = await Promise.all([
    db.tenant.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { subscriptions: { include: { plan: true } } } }),
    db.plan.findMany({ orderBy: { monthlyCents: 'asc' } })
  ])
  return <div className="shell"><aside><Brand /><nav><Link href="/super-admin">Administração</Link><a href="#assinantes">Assinantes</a><a href="#planos">Planos</a></nav><form action={logout}><button className="subtle">Sair</button></form></aside>
    <main className="content"><h1>Administração da plataforma</h1><ErrorNote error={(await searchParams).erro} />
      <article id="assinantes"><h2>Assinantes</h2>{!tenants.length ? <p>Nenhum estabelecimento cadastrado.</p> : <div className="scroll"><table>
        <thead><tr><th>Estabelecimento</th><th>Acesso</th><th>Assinaturas</th><th>Ação</th><th>WhatsApp</th></tr></thead>
        <tbody>{tenants.map(t => <tr key={t.id}><td>{t.name}</td><td>{t.suspended ? 'Suspenso' : t.active ? 'Ativo' : 'Inativo'}</td>
          <td>{t.subscriptions.map(s => s.plan.name).join(', ') || 'Nenhuma'}</td>
          <td><form action={admin.bind(null, 'suspend')}><input type="hidden" name="tenantId" value={t.id} /><button name="suspended" value={String(!t.suspended)} className="outline">{t.suspended ? 'Remover suspensão' : 'Suspender'}</button></form></td>
          <td><form action={admin.bind(null, 'whatsapp')}><input type="hidden" name="tenantId" value={t.id} />
            <Field label="Instância do WhatsApp" name="instance" value={t.whatsappInstance ?? ''} required={false} /><button className="outline">Salvar vínculo</button>
          </form></td></tr>)}</tbody>
      </table></div>}</article>
      <article id="planos"><h2>Planos</h2><form className="inline" action={admin.bind(null, 'plan')}>
        <Field label="Nome" name="name" /><Field label="Descrição" name="description" /><Field label="Mensal em centavos" name="monthlyCents" type="number" min={100} />
        <Field label="Anual em centavos" name="annualCents" type="number" min={100} /><button>Criar plano</button></form>
        {plans.length > 0 && <ul>{plans.map(p => <li key={p.id}>{p.name} · {brl(p.monthlyCents)} por mês · {brl(p.annualCents)} por ano</li>)}</ul>}
      </article>
    </main></div>
}
