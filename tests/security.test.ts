import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, test } from 'node:test'
import { allowAttempt, consumeAccountToken, issueAccountToken } from '../lib/account-security'
import { hashPassword, verifyPassword } from '../lib/auth'
import { db } from '../lib/db'

after(() => db.$disconnect())

test('redefinição de senha consome o link uma vez e revoga sessões', async () => {
  const user = await db.user.create({
    data: {
      email: randomUUID() + '@example.test',
      password: await hashPassword('Senha-anterior'),
      sessions: { create: { tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 60_000) } }
    }
  })
  try {
    const token = await issueAccountToken(user.id, 'PASSWORD_RESET')
    assert.equal(await consumeAccountToken(token, 'EMAIL_VERIFY'), false)
    const results = await Promise.all([
      consumeAccountToken(token, 'PASSWORD_RESET', 'Senha-nova-teste'),
      consumeAccountToken(token, 'PASSWORD_RESET', 'Senha-nova-teste')
    ])
    assert.equal(results.filter(Boolean).length, 1)
    const updated = await db.user.findUniqueOrThrow({ where: { id: user.id }, include: { sessions: true } })
    assert.equal(await verifyPassword('Senha-nova-teste', updated.password), true)
    assert.equal(updated.sessions.length, 0)
    const verification = await issueAccountToken(user.id, 'EMAIL_VERIFY')
    assert.equal(await consumeAccountToken(verification, 'EMAIL_VERIFY'), true)
    assert.ok((await db.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt)
  } finally {
    await db.user.delete({ where: { id: user.id } })
  }
})

test('limite compartilhado aplica o máximo sob concorrência', async () => {
  const subject = randomUUID()
  const attempts = await Promise.all(Array.from({ length: 8 }, () => allowAttempt('test', subject, 3, 60)))
  assert.equal(attempts.filter(Boolean).length, 3)
})

test('Super Admin usa código de segundo fator apenas uma vez', async () => {
  const { randomBytes } = await import('node:crypto')
  const { Secret, TOTP } = await import('otpauth')
  const { seal } = await import('../lib/secrets')
  const { verifyMfa } = await import('../lib/mfa')
  const previousKey = process.env.CREDENTIAL_ENCRYPTION_KEY
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('hex')
  const user = await db.user.create({ data: { email: randomUUID() + '@example.test', password: 'fixture', platformAdmin: true } })
  try {
    const secret = new Secret({ size: 20 })
    const updated = await db.user.update({ where: { id: user.id }, data: { mfaSecret: seal(secret.base32, 'mfa:' + user.id) } })
    const now = Date.now()
    const code = new TOTP({ secret, algorithm: 'SHA1', digits: 6, period: 30 }).generate({ timestamp: now })
    const attempts = await Promise.all([verifyMfa(updated, code, now), verifyMfa(updated, code, now)])
    assert.equal(attempts.filter(Boolean).length, 1)
  } finally {
    await db.user.delete({ where: { id: user.id } })
    if (previousKey === undefined) delete process.env.CREDENTIAL_ENCRYPTION_KEY
    else process.env.CREDENTIAL_ENCRYPTION_KEY = previousKey
  }
})

test('convite de profissional limita o vínculo ao estabelecimento e encerramento revoga sessão', async () => {
  const { acceptInvite, inviteMember, manageTeamAccess } = await import('../lib/team')
  const { membership } = await import('../lib/auth')
  const first = await db.tenant.create({ data: { slug: randomUUID(), name: 'Equipe', active: true } })
  const second = await db.tenant.create({ data: { slug: randomUUID(), name: 'Outra equipe', active: true } })
  const email = randomUUID() + '@example.test'
  try {
    const professional = await db.professional.create({ data: { tenantId: first.id, name: 'Profissional' } })
    await assert.rejects(inviteMember(second.id, 'actor', email, 'PROFESSIONAL', professional.id))
    const token = await inviteMember(first.id, 'actor', email, 'PROFESSIONAL', professional.id)
    const users = await Promise.allSettled([acceptInvite(token, 'Senha-forte-local'), acceptInvite(token, 'Senha-forte-local')])
    const accepted = users.filter(result => result.status === 'fulfilled')
    assert.equal(accepted.length, 1)
    const user = accepted[0].value
    assert.equal((await membership(user.id))?.professionalId, professional.id)
    await db.session.create({ data: { tokenHash: randomUUID(), userId: user.id, expiresAt: new Date(Date.now() + 60_000) } })
    await assert.rejects(manageTeamAccess(second.id, 'actor', user.id, 'disable'))
    await manageTeamAccess(first.id, 'actor', user.id, 'disable')
    assert.equal(await membership(user.id), null)
    assert.equal(await db.session.count({ where: { userId: user.id } }), 0)
  } finally {
    await db.user.deleteMany({ where: { email } })
    await db.teamInvite.deleteMany({ where: { tenantId: first.id } })
    await db.professional.deleteMany({ where: { tenantId: first.id } })
    await db.tenant.deleteMany({ where: { id: { in: [first.id, second.id] } } })
  }
})

test('permissões individuais revogam sessões e bloqueiam escalada entre funcionários', async () => {
  const { can } = await import('../lib/permissions')
  const { updateTeamPermissions } = await import('../lib/team')
  const tenant = await db.tenant.create({ data: { name: 'Permissões', slug: randomUUID(), active: true } })
  const owner = await db.user.create({ data: { email: randomUUID() + '@example.test', password: 'fixture' } })
  const staff = await db.user.create({ data: { email: randomUUID() + '@example.test', password: 'fixture' } })
  try {
    const key = { tenantId: tenant.id, userId: staff.id }
    await db.member.createMany({ data: [{ ...key, role: 'RECEPTION' }, { tenantId: tenant.id, userId: owner.id, role: 'ADMIN' }] })
    await db.session.create({ data: { tokenHash: randomUUID(), userId: staff.id, expiresAt: new Date(Date.now() + 60_000) } })
    await assert.rejects(updateTeamPermissions(tenant.id, staff.id, owner.id, ['agenda.read']))
    await assert.rejects(updateTeamPermissions(tenant.id, staff.id, staff.id, ['finance.read']))
    await updateTeamPermissions(tenant.id, owner.id, staff.id, ['agenda.read'])
    const member = await db.member.findUniqueOrThrow({ where: { tenantId_userId: key } })
    assert.equal(can(member, 'agenda.read'), true)
    assert.equal(can(member, 'agenda.cancel'), false)
    assert.equal(can(member, 'finance.read'), false)
    assert.equal(await db.session.count({ where: { userId: staff.id } }), 0)
  } finally {
    await db.tenant.delete({ where: { id: tenant.id } })
    await db.user.deleteMany({ where: { id: { in: [owner.id, staff.id] } } })
  }
})

test('alteração do endereço Evolution se limita aos destinos configurados', async () => {
  const { authorizedEvolutionUrl } = await import('../lib/evolution-settings')
  const pinned = 'https://mensagens.example.test/api'
  assert.equal(authorizedEvolutionUrl(pinned + '/', pinned), pinned)
  assert.throws(() => authorizedEvolutionUrl('https://outro.example.test/api', pinned))
  assert.throws(() => authorizedEvolutionUrl(pinned + '?query=1', pinned))
  assert.throws(() => authorizedEvolutionUrl('ftp://mensagens.example.test/api', pinned))
})
