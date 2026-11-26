import Link from 'next/link'
import { redirect } from 'next/navigation'
import { membership, userSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { defaultPermissions, permissionKeys, permissionLabels } from '@/lib/permissions'
import { teamAccess, teamPermissions } from '../actions'
import { Brand, ErrorNote } from '../ui'
import { InviteForm } from './invite'

const roles: Record<string, string> = { ADMIN: 'Administrador', MANAGER: 'Gerência', RECEPTION: 'Recepção', PROFESSIONAL: 'Profissional', FINANCE: 'Financeiro', READONLY: 'Consulta' }
const actions: Record<string, string> = { INVITED: 'Convite criado', JOINED: 'Convite aceito', DISABLED: 'Acesso desativado', ENABLED: 'Acesso reativado', SESSIONS_REVOKED: 'Sessões encerradas', CONNECT_PAUSED: 'Recebimentos pausados', CONNECT_RESUMED: 'Recebimentos retomados', PERMISSIONS_UPDATED: 'Permissões atualizadas' }

export default async function Team({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const user = await userSession()
  if (!user) redirect('/login')
  const member = await membership(user.id)
  if (!member || member.role !== 'ADMIN' || !member.tenant.active || member.tenant.suspended) redirect('/dashboard')
  const where = { tenantId: member.tenantId }
  const [members, professionals, changes] = await Promise.all([
    db.member.findMany({ where, include: { user: { select: { email: true } } } }),
    db.professional.findMany({ where: { ...where, active: true }, select: { id: true, name: true } }),
    db.teamEvent.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50 })
  ])
  const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: member.tenant.timezone })
  return <div className="site"><header><Brand /><Link href="/dashboard">Voltar ao painel</Link></header><main className="content">
    <h1>Equipe e permissões</h1><ErrorNote error={(await searchParams).erro} />
    <article><h2>Convidar pessoa</h2><InviteForm professionals={professionals} /></article>
    <article><h2>Acessos</h2><ul>{members.map(person => <li key={person.userId}>
      {person.user.email} · {roles[person.role]} · {person.disabledAt ? 'Inativo' : 'Ativo'}
      {person.role !== 'ADMIN' && <form action={teamAccess} className="inline">
        <input name="userId" type="hidden" value={person.userId} />
        <button className="outline" name="state" value={person.disabledAt ? 'enable' : 'disable'}>{person.disabledAt ? 'Reativar' : 'Desativar'}</button>
        {!person.disabledAt && <button className="outline" name="state" value="revoke">Encerrar sessões</button>}
      </form>}
      {person.role !== 'ADMIN' && <details><summary>Permissões individuais</summary><form action={teamPermissions}>
        <input type="hidden" name="userId" value={person.userId} />
        {permissionKeys.filter(key => person.role !== 'PROFESSIONAL' || key === 'agenda.read').map(key => <label className="check" key={key}>
          <input name="permissions" type="checkbox" value={key} defaultChecked={(person.permissionsCustomized ? person.permissions : defaultPermissions(person.role)).includes(key)} />
          {permissionLabels[key]}
        </label>)}
        <div className="inline"><button name="operation" value="custom">Salvar permissões</button><button name="operation" value="default" className="outline">Restaurar perfil padrão</button></div>
      </form></details>}
    </li>)}</ul></article>
    <article><h2>Atividade recente</h2>{changes.length ? <ul>{changes.map(event => <li key={event.id}>
      {date.format(event.createdAt)} · {actions[event.action]} · {event.subject}
    </li>)}</ul> : <p>Nenhuma atividade registrada.</p>}</article>
  </main></div>
}
