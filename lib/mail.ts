import { db } from './db'
import { seal, unseal } from './secrets'

export async function mailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM) || Boolean(await db.mailSetting.count({ where: { id: 1 } }))
}

export async function mailConfiguration() {
  const saved = await db.mailSetting.findUnique({ where: { id: 1 } })
  if (saved) return { sender: saved.sender, apiKey: unseal(saved.encryptedKey, 'resend:1') }
  return process.env.RESEND_API_KEY && process.env.MAIL_FROM ? { sender: process.env.MAIL_FROM, apiKey: process.env.RESEND_API_KEY } : null
}

export async function saveMailConfiguration(actorId: string, sender: string, apiKey: string) {
  const data = { sender, encryptedKey: seal(apiKey, 'resend:1') }
  await db.$transaction([
    db.mailSetting.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data }),
    db.adminAudit.create({ data: { actorId, action: 'RESEND_UPDATED', targetId: 'platform' } })
  ])
}

export async function sendEmail(data: { to: string; subject: string; text: string; key?: string }) {
  const config = await mailConfiguration()
  if (!config) throw new Error('E-mail transacional indisponível')
  const headers = new Headers({ Authorization: 'Bearer ' + config.apiKey, 'Content-Type': 'application/json' })
  if (data.key) headers.set('Idempotency-Key', data.key)
  const result = await fetch('https://api.resend.com/emails', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000), headers,
    body: JSON.stringify({ from: config.sender, to: [data.to], subject: data.subject, text: data.text })
  })
  if (!result.ok) throw new Error('Falha no serviço de e-mail')
}
