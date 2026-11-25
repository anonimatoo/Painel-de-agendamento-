import { z } from 'zod'
import { AgendaError, availability } from '@/lib/agenda'
import { db } from '@/lib/db'

const input = z.object({ servico: z.string().max(100), profissional: z.string().max(100), dia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const query = input.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!query.success) return Response.json({ mensagem: 'Confira os dados informados.' }, { status: 400 })
  try {
    const tenant = await db.tenant.findFirst({ where: { slug, active: true, suspended: false } })
    if (!tenant) return Response.json({ mensagem: 'Estabelecimento indisponível.' }, { status: 404 })
    const { servico, profissional, dia } = query.data
    return Response.json({ horarios: await availability(tenant, servico, profissional, dia) })
  } catch (error) {
    return error instanceof AgendaError
      ? Response.json({ mensagem: error.message }, { status: 400 })
      : Response.json({ mensagem: 'Tente novamente em instantes.' }, { status: 503 })
  }
}
