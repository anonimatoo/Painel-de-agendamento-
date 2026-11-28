import assert from 'node:assert/strict'
import { db } from '../lib/db'
import { saveMailConfiguration, sendEmail } from '../lib/mail'
import { sendAccountLink } from '../lib/account-security'

async function main() {
  const database = new URL(process.env.DATABASE_URL ?? '')
  assert.equal(database.hostname, '127.0.0.1')
  assert.equal(database.pathname, '/cs_v3_mail')
  assert.equal(await db.mailSetting.count(), 0)
  const user = await db.user.create({ data: { email: 'mail-fixture@example.test', password: 'fixture', platformAdmin: true } })
  const original = globalThis.fetch
  const calls: { from: string; to: string[]; text: string }[] = []
  globalThis.fetch = async (target, options) => {
    assert.equal(String(target), 'https://api.resend.com/emails')
    assert.equal(new Headers(options?.headers).get('Authorization'), 'Bearer re_local_fixture_test')
    calls.push(JSON.parse(String(options?.body)))
    return Response.json({ id: 'message-fixture' })
  }
  try {
    await saveMailConfiguration(user.id, 'fixture@example.test', 're_local_fixture_test')
    const saved = await db.mailSetting.findUniqueOrThrow({ where: { id: 1 } })
    assert.ok(!saved.encryptedKey.includes('re_local_fixture_test'))
    await sendAccountLink(user, 'PASSWORD_RESET')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].from, 'fixture@example.test')
    assert.deepEqual(calls[0].to, [user.email])
    assert.match(calls[0].text, /http:\/\/127\.0\.0\.1:\d+\/conta\?token=/)
    globalThis.fetch = async () => new Response('failure', { status: 503 })
    await assert.rejects(sendEmail({ to: user.email, subject: 'Teste', text: 'Teste' }))
    console.log('Resend simulado: configuração criptografada, solicitação de recuperação e resposta de falha verificadas.')
  } finally {
    globalThis.fetch = original
    await db.mailSetting.deleteMany({ where: { id: 1 } })
    await db.adminAudit.deleteMany({ where: { actorId: user.id } })
    await db.user.delete({ where: { id: user.id } })
  }
}
main().catch(error => { console.error(error instanceof Error ? error.name : 'Falha de teste'); process.exitCode = 1 }).finally(() => db.$disconnect())
