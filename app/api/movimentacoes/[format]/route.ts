import { DateTime } from 'luxon'
import writeXlsx from 'write-excel-file/node'
import { membership, userSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { can } from '@/lib/permissions'
import { ledgerScope, recordedMovements } from '@/lib/stripe-ledger'

export async function GET(request: Request, { params }: { params: Promise<{ format: string }> }) {
  const { format } = await params
  if (!['csv', 'xlsx'].includes(format)) return new Response(null, { status: 404 })
  const user = await userSession()
  if (!user) return new Response(null, { status: 401 })
  const platform = user.platformAdmin && user.adminMfaVerified
  const member = platform ? null : await membership(user.id)
  if (!platform && (!member || !can(member, 'finance.read') || !can(member, 'report.export') || member.tenant.suspended)) return new Response(null, { status: 403 })
  const query = new URL(request.url).searchParams
  const company = query.get('empresa')
  const companyAccount = platform && company ? await db.tenant.findUnique({
    where: { id: company }, select: { stripeAccountId: true }
  }) : null
  if (platform && company && !companyAccount?.stripeAccountId) return new Response(null, { status: 404 })
  const scope = await ledgerScope(platform && !company, companyAccount?.stripeAccountId ?? member?.tenant.stripeAccountId).catch(() => null)
  if (!scope) return new Response(null, { status: 404 })
  const zone = member?.tenant.timezone ?? 'America/Sao_Paulo'
  const start = DateTime.fromISO(query.get('inicio') ?? '', { zone }).startOf('day')
  const end = DateTime.fromISO(query.get('fim') ?? '', { zone }).startOf('day')
  if (!start.isValid || !end.isValid || start > end || end.diff(start, 'days').days > 92) return new Response(null, { status: 400 })
  const rows = await recordedMovements(scope, start.toJSDate(), end.plus({ days: 1 }).toJSDate(), {
    category: query.get('categoria')?.slice(0, 80), status: query.get('situacao')?.slice(0, 40),
    ref: query.get('transacao')?.slice(0, 140), customer: query.get('cliente')?.slice(0, 140)
  })
  const records = [
    ['Data', 'Referência', 'Categoria', 'Situação', 'Moeda', 'Bruto (unid. mínima)', 'Taxa (unid. mínima)', 'Líquido (unid. mínima)'],
    ...rows.map(row => [DateTime.fromJSDate(row.occurredAt, { zone }).toISODate() ?? '', row.stripeId, row.category, row.status, row.currency, row.gross, row.fee, row.net])
  ]
  const headers = {
    'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="movimentacoes-stripe.' + format + '"',
    'Cache-Control': 'private, no-store'
  }
  if (format === 'csv') {
    const quote = (value: string | number) => typeof value === 'number' ? String(value) : '"' + (/^[\s]*[=+@\-\t\r]/.test(value) ? "'" : '') + value.replace(/"/g, '""') + '"'
    return new Response('\uFEFF' + records.map(row => row.map(quote).join(';')).join('\r\n'), { headers })
  }
  return new Response(new Uint8Array(await writeXlsx(records).toBuffer()), { headers })
}
