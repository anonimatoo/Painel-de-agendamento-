export function mailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM)
}

export async function sendEmail(data: { to: string; subject: string; text: string; key?: string }) {
  if (!mailConfigured()) throw new Error('E-mail transacional indisponível')
  const headers = new Headers({ Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' })
  if (data.key) headers.set('Idempotency-Key', data.key)
  const result = await fetch('https://api.resend.com/emails', {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000), headers,
    body: JSON.stringify({ from: process.env.MAIL_FROM, to: [data.to], subject: data.subject, text: data.text })
  })
  if (!result.ok) throw new Error('Falha no serviço de e-mail')
}
