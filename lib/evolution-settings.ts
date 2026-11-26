import { db } from './db'
import { seal, unseal } from './secrets'

export function normalizeEvolutionUrl(value: string) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('URL inválida')
  return url.href.replace(/\/$/, '')
}

export function authorizedEvolutionUrl(value: string, allowlist: string) {
  const endpoint = normalizeEvolutionUrl(value)
  if (!allowlist.split(',').map(item => item.trim()).filter(Boolean).some(item => normalizeEvolutionUrl(item) === endpoint)) {
    throw new Error('Endereço não habilitado para integração')
  }
  return endpoint
}

export async function evolutionConfiguration() {
  const saved = await db.evolutionSetting.findUnique({ where: { id: 1 } })
  if (saved) {
    const endpoint = authorizedEvolutionUrl(saved.endpoint, process.env.EVOLUTION_ALLOWED_URLS ?? process.env.EVOLUTION_URL ?? '')
    return { origin: endpoint, key: unseal(saved.encryptedKey, 'evolution:' + endpoint), qrEnabled: saved.qrEnabled }
  }
  return { origin: process.env.EVOLUTION_URL, key: process.env.EVOLUTION_API_KEY, qrEnabled: process.env.EVOLUTION_QR_PROVISIONING === 'true' }
}

export async function probeEvolution(origin: string, key: string) {
  const endpoint = normalizeEvolutionUrl(origin)
  const response = await fetch(endpoint + '/instance/fetchInstances', {
    headers: { apikey: key }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(6000)
  })
  if (!response.ok) throw new Error('Conexão não confirmada')
  const instances: unknown = await response.json()
  if (!Array.isArray(instances)) throw new Error('Resposta inesperada')
  return instances.length
}

export async function saveEvolution(actorId: string, origin: string, key: string, qrEnabled: boolean) {
  const endpoint = authorizedEvolutionUrl(origin, process.env.EVOLUTION_ALLOWED_URLS ?? process.env.EVOLUTION_URL ?? '')
  await probeEvolution(endpoint, key)
  const data = { endpoint, encryptedKey: seal(key, 'evolution:' + endpoint), qrEnabled, checkedAt: new Date() }
  await db.$transaction([
    db.evolutionSetting.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data }),
    db.adminAudit.create({ data: { actorId, action: 'EVOLUTION_UPDATED', targetId: 'platform' } })
  ])
}
