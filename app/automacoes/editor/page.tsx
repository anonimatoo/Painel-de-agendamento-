import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { membership, userSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { can } from '@/lib/permissions'
import { automationGraph, initialGraph } from '@/lib/automation-graph'
import { MerchantShell } from '../../merchant-shell'
import { FlowEditor } from './flow-editor'

const status: Record<string, string> = { QUEUED: 'Aguardando worker', RECORDED: 'Registrada', DISCARDED: 'Ignorada pelas regras', SCHEDULED: 'Programada' }
const delivery: Record<string, string> = { SENT: 'Aceita pelo provedor', FAILED: 'Falha de envio', REVIEW: 'Em verificação', CANCELED: 'Cancelada' }

export default async function AutomationEditorPage({ searchParams }: { searchParams: Promise<{ fluxo?: string }> }) {
  const user = await userSession()
  const member = user ? await membership(user.id) : null
  if (!member?.tenant.active || member.tenant.suspended || !can(member, 'whatsapp.manage')) redirect('/dashboard')
  const { fluxo } = await searchParams
  const { tenantId } = member
  const [rules, recent] = await Promise.all([
    db.automationRule.findMany({ where: { tenantId }, orderBy: { updatedAt: 'desc' } }),
    db.automationRun.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 60,
      select: { id: true, createdAt: true, state: true, rule: { select: { name: true } }, reminder: { select: { deliveryState: true } } } })
  ])
  const current = fluxo ? rules.find(rule => rule.id === fluxo) : undefined
  if (fluxo && !current) notFound()
  const graph = current ? automationGraph.parse(current.graph) : initialGraph
  const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: member.tenant.timezone })
  return <MerchantShell member={member} current="/automacoes">
    <div className="row"><div><Link href="/automacoes">← Central de automações</Link><h1>CS Automation Pro</h1></div>
      {current && <Link className="button outline" href="/automacoes/editor">Novo fluxo</Link>}</div>
    <div className="grid">
      <article><h2>{current ? 'Editar fluxo' : 'Novo fluxo'}</h2><FlowEditor key={current?.id ?? 'new'} initial={{
        id: current?.id, revision: current?.revision, name: current?.name ?? '', enabled: current?.enabled ?? false, graph
      }} /></article>
      <div><article><h2>Seus fluxos</h2>{rules.length ? <ul>{rules.map(rule => <li key={rule.id}>
        <Link href={'/automacoes/editor?fluxo=' + rule.id}>{rule.name}</Link> · {rule.enabled ? 'Ativo' : 'Rascunho'}
      </li>)}</ul> : <p>Nenhuma automação salva.</p>}</article>
      <article><h2>Execuções recentes</h2>{recent.length ? <ul>{recent.map(row => <li key={row.id}>
        <strong>{row.rule.name}</strong> · {date.format(row.createdAt)} · {(row.reminder && delivery[row.reminder.deliveryState]) || status[row.state]}
      </li>)}</ul> : <p>Nenhuma execução registrada.</p>}</article></div>
    </div>
  </MerchantShell>
}
