import { DeliveryRejected } from './delivery'
import { z } from 'zod'

async function evolution(path: string, method: 'GET' | 'POST' | 'DELETE', body?: object) {
  const origin = process.env.EVOLUTION_URL
  const key = process.env.EVOLUTION_API_KEY
  if (!origin || !key) throw new Error('Evolution configuration missing')
  const base = new URL(origin.replace(/\/$/, '') + '/')
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new Error('Evolution configuration invalid')
  }
  const endpoint = new URL(path, base)
  const result = await fetch(endpoint, {
    method, headers: { apikey: key, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(12_000)
  })
  if (!result.ok && path.startsWith('message/') && (result.status === 429 || [400, 401, 403, 404, 422].includes(result.status))) {
    throw new DeliveryRejected(result.status === 429)
  }
  if (!result.ok) throw new Error('Evolution rejected request (' + result.status + ')')
  return result
}

function instancePath(operation: string, instance: string) {
  return 'instance/' + operation + '/' + encodeURIComponent(instance)
}

const connectionState = z.object({ instance: z.object({ state: z.enum(['open', 'connecting', 'close']) }) })

export async function whatsAppStatus(instance: string) {
  const response = await evolution(instancePath('connectionState', instance), 'GET')
  return connectionState.parse(await response.json()).instance.state
}

export async function connectWhatsApp(instance: string) {
  const response = await evolution(instancePath('connect', instance), 'GET')
  const data: unknown = await response.json()
  const parsed = connectionState.safeParse(data)
  if (parsed.success && parsed.data.instance.state === 'open') return { connected: true }
  const qr = z.object({
    base64: z.string().max(500_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/)
  }).safeParse(data)
  return { connected: false, qr: qr.success ? qr.data.base64 : undefined }
}

export async function logoutWhatsApp(instance: string) {
  await evolution(instancePath('logout', instance), 'DELETE')
}

export async function sendWhatsApp(instance: string, phone: string, text: string) {
  const response = await evolution('message/sendText/' + encodeURIComponent(instance), 'POST', { number: phone, text })
  const data = z.object({ key: z.object({ id: z.string().max(256) }) }).safeParse(await response.json().catch(() => null))
  return data.success ? data.data.key.id : undefined
}

export function reminderMessage(template: string | null, business: string, time: string) {
  const message = template || 'Olá! Seu atendimento em {estabelecimento} está marcado para {horario}.'
  return message.replace(/\{(?:estabelecimento|horario)\}/g, token => token === '{estabelecimento}' ? business : time)
}

export async function createWhatsAppInstance(instance: string) {
  await evolution('instance/create', 'POST', { instanceName: instance, integration: 'WHATSAPP-BAILEYS', qrcode: false })
}

export async function deleteWhatsAppInstance(instance: string) {
  await evolution(instancePath('delete', instance), 'DELETE')
}
