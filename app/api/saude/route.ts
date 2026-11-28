import { db } from '@/lib/db'

export async function GET() {
  const headers = { 'Cache-Control': 'no-store' }
  try {
    await db.$queryRaw`SELECT 1`
    return new Response(null, { status: 204, headers })
  } catch {
    return new Response(null, { status: 503, headers })
  }
}
