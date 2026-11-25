import { createHash, randomBytes } from 'node:crypto'
import { db } from './db'
import { AgendaError } from './agenda'
import { hashPassword } from './auth'

const hash = (token: string) => createHash('sha256').update(token).digest('hex')
type TeamRole = 'MANAGER' | 'RECEPTION' | 'PROFESSIONAL'

export async function inviteMember(tenantId: string, actorId: string, email: string, role: TeamRole, professionalId?: string) {
  const token = randomBytes(32).toString('base64url')
  return db.$transaction(async tx => {
    if (await tx.user.count({ where: { email } })) throw new AgendaError('Este e-mail já possui uma conta. Informe outro e-mail.')
    if (role === 'PROFESSIONAL' && (!professionalId || !await tx.professional.count({ where: { tenantId, id: professionalId, active: true } }))) {
      throw new AgendaError('Selecione um profissional deste estabelecimento.')
    }
    const data = { tokenHash: hash(token), role, professionalId: role === 'PROFESSIONAL' ? professionalId : null, expiresAt: new Date(Date.now() + 24 * 60 * 60_000) }
    await tx.teamInvite.upsert({ where: { tenantId_email: { tenantId, email } }, create: { tenantId, email, ...data }, update: data })
    await tx.teamEvent.create({ data: { tenantId, actorId, subject: email, action: 'INVITED' } })
    return token
  })
}

export async function acceptInvite(token: string, password: string) {
  const tokenHash = hash(token)
  const passwordHash = await hashPassword(password)
  return db.$transaction(async tx => {
    const invite = await tx.teamInvite.findUnique({
      where: { tokenHash }, include: { tenant: { select: { active: true, suspended: true } } }
    })
    if (!invite || invite.expiresAt <= new Date() || !invite.tenant.active || invite.tenant.suspended) {
      throw new AgendaError('Este convite expirou ou está indisponível.')
    }
    const removed = await tx.teamInvite.deleteMany({ where: { tokenHash, expiresAt: { gt: new Date() } } })
    if (!removed.count) throw new AgendaError('Este convite já foi utilizado.')
    const user = await tx.user.create({ data: {
      email: invite.email, password: passwordHash,
      memberships: { create: { tenantId: invite.tenantId, role: invite.role, professionalId: invite.professionalId } }
    } })
    await tx.teamEvent.create({ data: { tenantId: invite.tenantId, actorId: user.id, subject: invite.email, action: 'JOINED' } })
    return user
  })
}

export async function manageTeamAccess(tenantId: string, actorId: string, userId: string, state: 'disable' | 'enable' | 'revoke') {
  await db.$transaction(async tx => {
    const member = await tx.member.findFirst({
      where: { tenantId, userId, role: { not: 'ADMIN' } }, include: { user: { select: { email: true } } }
    })
    if (!member || userId === actorId) throw new AgendaError('Pessoa indisponível para alteração.')
    if (state !== 'revoke') await tx.member.update({
      where: { tenantId_userId: { tenantId, userId } }, data: { disabledAt: state === 'disable' ? new Date() : null }
    })
    if (state !== 'enable') await tx.session.deleteMany({ where: { userId } })
    await tx.teamEvent.create({
      data: { tenantId, actorId, subject: member.user.email, action: state === 'disable' ? 'DISABLED' : state === 'enable' ? 'ENABLED' : 'SESSIONS_REVOKED' }
    })
  })
}
