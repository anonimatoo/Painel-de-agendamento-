export async function sendWhatsApp(instance: string, phone: string, text: string) {
  const origin = process.env.EVOLUTION_URL
  const key = process.env.EVOLUTION_API_KEY
  if (!origin || !key) throw new Error('Evolution configuration missing')
  const endpoint = new URL('message/sendText/' + encodeURIComponent(instance), origin.replace(/\/$/, '') + '/')
  const result = await fetch(endpoint, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ number: phone, text }),
    redirect: 'error',
    signal: AbortSignal.timeout(12_000)
  })
  if (!result.ok) throw new Error('Evolution rejected delivery (' + result.status + ')')
}
