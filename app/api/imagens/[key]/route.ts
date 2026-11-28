import { membership, userSession } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { db } from '@/lib/db'
import { readCover } from '@/lib/storage'

export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  if (!/^[\w-]{20,110}\.webp$/.test(key)) return new Response(null, { status: 404 })
  const tenant = await db.tenant.findFirst({ where: { suspended: false, OR: [{ coverKey: key }, { media: { some: { key } } }] }, select: { id: true, active: true, media: { where: { key }, select: { kind: true, target: true } } } })
  if (!tenant) return new Response(null, { status: 404 })
  const media = tenant.media[0]
  const productId = media?.kind === 'PRODUCT' ? media.target.split(':')[0] : undefined
  const product = productId ? await db.product.findFirst({ where: { id: productId, tenantId: tenant.id, archivedAt: null }, select: { published: true } }) : null
  const service = media?.kind === 'SERVICE' ? await db.service.findFirst({ where: { tenantId: tenant.id, id: media.target, archivedAt: null }, select: { active: true } }) : null
  const publicImage = tenant.active && (media?.kind !== 'PRODUCT' || product?.published) && (media?.kind !== 'SERVICE' || service?.active)
  if (!publicImage) {
    const user = await userSession()
    const member = user ? await membership(user.id) : null
    if (member?.tenantId !== tenant.id || !(can(member, 'brand.manage') || (media?.kind === 'PRODUCT' && can(member, 'product.manage')) || (media?.kind === 'SERVICE' && can(member, 'service.manage')))) return new Response(null, { status: 404 })
  }
  try {
    const stream = await readCover(key)
    return stream ? new Response(stream, { headers: { 'Content-Type': 'image/webp', 'Cache-Control': publicImage && media?.kind !== 'PRODUCT' && media?.kind !== 'SERVICE' ? 'public, max-age=300' : 'private, no-store', 'X-Content-Type-Options': 'nosniff' } }) : new Response(null, { status: 404 })
  } catch {
    return new Response(null, { status: 503 })
  }
}
