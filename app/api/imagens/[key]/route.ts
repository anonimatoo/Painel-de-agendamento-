import { db } from '@/lib/db'
import { readCover } from '@/lib/storage'

export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params
  if (!/^[\w-]{20,110}\.webp$/.test(key)) return new Response(null, { status: 404 })
  const tenant = await db.tenant.findFirst({ where: { coverKey: key, active: true, suspended: false }, select: { id: true } })
  if (!tenant) return new Response(null, { status: 404 })
  try {
    const stream = await readCover(key)
    return stream ? new Response(stream, { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' } }) : new Response(null, { status: 404 })
  } catch {
    return new Response(null, { status: 503 })
  }
}
