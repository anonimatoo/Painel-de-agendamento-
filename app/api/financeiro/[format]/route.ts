import { can } from '@/lib/permissions'
import { DateTime } from 'luxon'
import writeXlsx from 'write-excel-file/node'
import { membership, userSession } from '@/lib/auth'
import { cashPeriod, cashReport, exportCashCsv } from '@/lib/commerce'

export async function GET(request: Request, { params }: { params: Promise<{ format: string }> }) {
  const { format } = await params
  if (!['csv', 'xlsx'].includes(format)) return new Response(null, { status: 404 })
  const user = await userSession()
  if (!user) return new Response(null, { status: 401 })
  const member = await membership(user.id)
  if (!member || (!can(member, 'finance.read') || !can(member, 'report.export')) || !member.tenant.active || member.tenant.suspended) return new Response(null, { status: 403 })
  const zone = member.tenant.timezone
  const { searchParams } = new URL(request.url)
  const period = cashPeriod(zone, searchParams.get('inicio') ?? undefined, searchParams.get('fim') ?? undefined)
  if (!period) return new Response(null, { status: 400 })
  const report = await cashReport(member.tenantId, zone, period)
  const headers = {
    'Content-Type': format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': 'attachment; filename="fluxo-de-caixa.' + format + '"',
    'Cache-Control': 'private, no-store'
  }
  if (format === 'csv') return new Response(exportCashCsv(report.rows, zone), { headers })
  const buffer = await writeXlsx([
    ['Data', 'Descrição', 'Valor (R$)'],
    ...report.rows.map(row => [DateTime.fromJSDate(row.date, { zone }).toISODate(), row.title, { value: row.cents / 100, format: '0.00' }])
  ]).toBuffer()
  return new Response(new Uint8Array(buffer), { headers })
}
