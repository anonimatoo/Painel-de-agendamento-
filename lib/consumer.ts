import { db } from './db'
import { userSession } from './auth'

export const consumerPath = (slug: string) => '/cliente/' + encodeURIComponent(slug)

export function activeStore(slug: string) {
  return db.tenant.findFirst({ where: { slug, active: true, suspended: false } })
}

export async function currentConsumer(tenantId: string) {
  const user = await userSession()
  if (!user || user.platformAdmin) return null
  return db.consumerProfile.findUnique({ where: { tenantId_userId: { tenantId, userId: user.id } } })
}

export function consumerDeadline(hours: number | null, now = Date.now()) {
  return hours === null ? null : new Date(now + hours * 3_600_000)
}
