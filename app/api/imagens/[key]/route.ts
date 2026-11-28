import { membership, userSession } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { db } from '@/lib/db'
import { readCover } from '@/lib/storage'

export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  if (!/^[\w-]{20,110}\.webp$/.test(key)) return new Response(null, { status: 404 })
  const tenant = await db.tenant.findFirst({ where: { suspended: false, OR: [{ coverKey: key }, { media: { some: { key } } }] }, select: { id: true, active: true } })
  if (!tenant) return new Response(null, { status: 404 })
  if (!tenant.active) {
    const user = await userSession()
    const member = user ? await membership(user.id) : null
    if (member?.tenantId !== tenant.id || !can(member, 'brand.manage')) return new Response(null, { status: 404 })
  }
  try {
    const stream = await readCover(key)
    return stream ? new Response(stream, { headers: { 'Content-Type': 'image/webp', 'Cache-Control': tenant.active ? 'public, max-age=300' : 'private, no-store', 'X-Content-Type-Options': 'nosniff' } }) : new Response(null, { status: 404 })
  } catch {
    return new Response(null, { status: 503 })
  }
}
