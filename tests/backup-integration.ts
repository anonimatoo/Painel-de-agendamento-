import assert from 'node:assert/strict'
import { db } from '../lib/db'
import { credentialKey, seal, unseal } from '../lib/secrets'
import { rotateCredentials } from '../lib/rotate-credentials'

const original = credentialKey('b'.repeat(64))
const replacement = credentialKey('c'.repeat(64))
const tenantId = 'backup-fixture'
const userId = 'backup-user'
const context = 'stripe:acct_backup:test'
const action = process.argv[2]

async function main() {
  const target = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid')
  assert.equal(target.hostname, '127.0.0.1')
  const restore = ['/cs_v3_restore', '/cs_v3_restore_reflight'].includes(target.pathname)
  assert.ok(target.pathname === '/cs_v3_backup' || restore)
  if (action === 'seed') {
    assert.equal(target.pathname, '/cs_v3_backup')
    assert.equal(await db.tenant.count(), 0)
    const tenant = await db.tenant.create({ data: { id: tenantId, slug: 'backup-fixture', name: 'Fixture de backup' } })
    await db.user.create({ data: { id: userId, email: 'backup-fixture@example.test', platformAdmin: true,
      mfaSecret: seal('fixture-secret', 'mfa:' + userId, original), mfaRecoveryHashes: ['fixture-recovery-hash'],
      memberships: { create: { role: 'ADMIN', tenantId } } } })
    await db.plan.create({ data: { id: 'backup-plan', name: 'Plano fixture', description: 'Teste',
      monthlyCents: 1000, annualCents: 10000, monthlyPriceId: 'price_month_fixture', annualPriceId: 'price_year_fixture' } })
    await db.subscription.create({ data: { id: 'sub_backup', tenantId, planId: 'backup-plan', status: 'active' } })
    const service = await db.service.create({ data: { tenantId, name: 'Teste', duration: 45, cents: 5000 } })
    const professional = await db.professional.create({ data: { tenantId, name: 'Profissional fixture' } })
    const customer = await db.customer.create({ data: { tenantId, name: 'Cliente fixture', phone: '5511999991234' } })
    await db.appointment.create({ data: { tenantId, serviceId: service.id, professionalId: professional.id, customerId: customer.id,
      startsAt: new Date('2026-11-20T14:00:00Z'), endsAt: new Date('2026-11-20T14:45:00Z'), status: 'COMPLETED', cents: 5000 } })
    await db.product.create({ data: { tenantId, name: 'Produto fixture', cents: 7500, stock: 8 } })
    await db.financialEntry.create({ data: { tenantId, kind: 'INCOME', title: 'Movimento fixture', cents: 5000, dueAt: tenant.createdAt, paidAt: tenant.createdAt } })
    await db.stripeSettings.create({ data: { id: 1, accountId: 'acct_backup', mode: 'test', publishableKey: 'pk_test_backup',
      encrypted: seal('fixture-stripe-credential', context, original) } })
    await db.mailSetting.create({ data: { id: 1, sender: 'teste@example.test', encryptedKey: seal('fixture-email-key', 'resend:1', original) } })
    return
  }

  assert.ok(restore)
  const targetDatabase = target.pathname.slice(1)
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } })
  assert.equal(await db.subscription.count({ where: { tenantId, status: 'active' } }), 1)
  assert.equal(await db.appointment.count({ where: { tenantId, status: 'COMPLETED' } }), 1)
  assert.equal(await db.product.count({ where: { tenantId, stock: 8 } }), 1)
  assert.equal(await db.financialEntry.count({ where: { tenantId, cents: 5000 } }), 1)
  const readStripe = () => db.stripeSettings.findUniqueOrThrow({ where: { id: 1 } })
  const initial = await readStripe()
  assert.equal(unseal(initial.encrypted, context, original), 'fixture-stripe-credential')
  assert.equal(unseal(user.mfaSecret!, 'mfa:' + userId, original), 'fixture-secret')
  assert.deepEqual(user.mfaRecoveryHashes, ['fixture-recovery-hash'])
  assert.equal((await rotateCredentials(targetDatabase, original, replacement, false)).resend, 1)
  assert.equal((await readStripe()).encrypted, initial.encrypted)

  await db.user.update({ where: { id: userId }, data: { mfaSecret: 'intencionalmente-invalido' } })
  await assert.rejects(rotateCredentials(targetDatabase, original, replacement, true))
  assert.equal((await readStripe()).encrypted, initial.encrypted)
  await db.user.update({ where: { id: userId }, data: { mfaSecret: user.mfaSecret } })
  const result = await rotateCredentials(targetDatabase, original, replacement, true)
  assert.equal(result.authenticators, 1)
  assert.equal(unseal((await readStripe()).encrypted, context, replacement), 'fixture-stripe-credential')
  const after = await db.user.findUniqueOrThrow({ where: { id: userId } })
  assert.equal(unseal(after.mfaSecret!, 'mfa:' + userId, replacement), 'fixture-secret')
  assert.deepEqual(after.mfaRecoveryHashes, user.mfaRecoveryHashes)
  assert.throws(() => unseal(after.mfaSecret!, 'mfa:' + userId, original))
  console.log('Backup restaurado, entidades preservadas e rotação criptográfica verificada com rollback integral em fixture.')
}

main().catch(error => { console.error(error instanceof Error ? error.name : 'Falha de teste'); process.exitCode = 1 }).finally(() => db.$disconnect())
