import Link from 'next/link'
import { redirect } from 'next/navigation'
import { membership, userSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { connectStatus } from '@/lib/connect'
import { whatsAppStatus } from '@/lib/evolution'
import { MerchantShell } from '../merchant-shell'

export default async function FirstAccess({ searchParams }: { searchParams: Promise<{ novo?: string }> }) {
  const user = await userSession()
  if (!user) redirect('/login')
  const member = await membership(user.id)
  if (member?.role !== 'ADMIN') redirect('/dashboard')
  const tenant = member.tenant
  const tenantId = tenant.id
  const available = tenant.active && !tenant.suspended
  const [images, services, professionals, hours, whatsapp, stripe] = await Promise.all([
    db.mediaAsset.count({ where: { tenantId, kind: { in: ['LOGO', 'COVER', 'BANNER'] } } }),
    db.service.count({ where: { tenantId, active: true } }),
    db.professional.count({ where: { tenantId, active: true } }),
    db.workHours.count({ where: { tenantId, professional: { active: true, assignments: { some: { service: { active: true } } } } } }),
    tenant.whatsappInstance ? whatsAppStatus(tenant.whatsappInstance).catch(() => null) : null,
    tenant.stripeAccountId ? connectStatus(tenant.stripeAccountId).catch(() => null) : null
  ])
  const steps = [
    ['Informações do estabelecimento', Boolean(tenant.name && tenant.description && tenant.address), '/dashboard#configuracoes', false],
    ['Identidade visual', Boolean(images || tenant.coverKey), '/personalizacao', true],
    ['Serviços', services > 0, '/dashboard#equipe', false],
    ['Profissionais', professionals > 0, '/dashboard#equipe', false],
    ['Horários e vínculos da equipe', hours > 0, '/dashboard#equipe', false],
    ['WhatsApp', whatsapp === 'open', '/whatsapp', true],
    ['Recebimentos online', Boolean(stripe?.payments), '/recebimentos', true],
    ['Página de agendamento', available && hours > 0, '/estabelecimento/' + tenant.slug, false]
  ] as const
  return <MerchantShell member={member} current="/primeiro-acesso">
    <h1>Primeiro acesso</h1>
    {(await searchParams).novo === '1' && <article>
      <h2>Agenda criada para {tenant.name}</h2>
      <p role="status">Seu endereço público é <strong>/estabelecimento/{tenant.slug}</strong>.</p>
      <p>Escolha seu plano e, em seguida, cadastre os serviços e horários para começar a receber agendamentos.</p>
      <Link className="button" href="/dashboard">Abrir meu painel</Link>
    </article>}
    {!available && <article><p>Prepare sua página agora e ative a assinatura para receber reservas.</p><div className="inline"><Link href="/personalizacao">Personalizar página</Link><Link href="/dashboard">Ver assinatura</Link></div></article>}
    <article><h2>Preparar a agenda</h2>
      <p>O progresso acompanha as configurações salvas. Você pode voltar a qualquer momento.</p>
      <ol>{steps.map(([label, done, href, optional]) => <li key={label}>
        {available && (href !== '/estabelecimento/' + tenant.slug || done) ? <Link href={href}>{label}</Link> : label}
        {' · '}{done ? 'Concluído' : optional ? 'Opcional' : 'Pendente'}
      </li>)}</ol>
    </article>
  </MerchantShell>
}
