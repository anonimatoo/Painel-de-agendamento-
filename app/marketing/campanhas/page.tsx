import { randomUUID } from 'node:crypto'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { membership, userSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { can } from '@/lib/permissions'
import { mailConfigured } from '@/lib/mail'
import { MerchantShell } from '../../merchant-shell'
import { ErrorNote, Field } from '../../ui'
import { queueCampaign } from './actions'

export default async function Campaigns({ searchParams }: { searchParams: Promise<{ erro?: string; resultado?: string }> }) {
  const user = await userSession()
  const member = user ? await membership(user.id) : null
  if (!member?.tenant.active || member.tenant.suspended || !can(member, 'whatsapp.manage')) redirect('/dashboard')
  const { tenantId } = member
  const [campaigns, email, query] = await Promise.all([
    db.campaign.findMany({ where: { tenantId }, take: 40, orderBy: { createdAt: 'desc' } }), mailConfigured(), searchParams
  ])
  const status = campaigns.length ? await db.campaignDelivery.groupBy({
    by: ['campaignId', 'state'], where: { tenantId, campaignId: { in: campaigns.map(row => row.id) } }, _count: true
  }) : []
  const whatsapp = Boolean(member.tenant.whatsappInstance)
  const labels: Record<string, string> = { QUEUED: 'na fila', SENDING: 'enviando', ACCEPTED: 'aceitos pelo provedor', REVIEW: 'em verificação', FAILED: 'recusados', CANCELED: 'cancelados' }
  return <MerchantShell member={member} current="/marketing/campanhas">
    <h1>Campanhas com autorização</h1><ErrorNote error={query.erro} />
    {query.resultado === 'salvo' && <p className="success" role="status">Campanha colocada na fila.</p>}
    <article><h2>Nova campanha</h2><p>O envio é limitado aos clientes que autorizaram este canal no portal. Cancelamentos de autorização são respeitados até o início do envio.</p>
      {(email || whatsapp) ? <form action={queueCampaign}>
        <input name="id" type="hidden" value={randomUUID()} />
        <label>Canal<select name="channel">{email && <option value="EMAIL">E-mail</option>}{whatsapp && <option value="WHATSAPP">WhatsApp</option>}</select></label>
        <Field name="title" label="Assunto" />
        <label>Mensagem<textarea name="body" required maxLength={1000} rows={5} /></label>
        <label className="check"><input name="confirm" value="yes" type="checkbox" required /> Confirmo o envio aos clientes autorizados</label>
        <button>Colocar na fila</button>
      </form> : <p>Nenhum canal disponível para campanha. <Link href="/whatsapp">Configurar WhatsApp</Link></p>}
    </article>
    <article><h2>Histórico de campanhas</h2>{campaigns.length ? <ul>{campaigns.map(row => <li key={row.id}>
      <strong>{row.title}</strong> · {row.channel === 'EMAIL' ? 'E-mail' : 'WhatsApp'} · {status.filter(item => item.campaignId === row.id).map(item => item._count + ' ' + labels[item.state]).join(', ')}
    </li>)}</ul> : <p>Nenhuma campanha registrada.</p>}</article>
  </MerchantShell>
}
