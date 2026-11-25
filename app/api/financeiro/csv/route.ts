import { membership, userSession } from '@/lib/auth'
import { cashReport, exportCashCsv } from '@/lib/commerce'

export async function GET() {
  const user = await userSession()
  if (!user) return new Response(null, { status: 401 })
  const member = await membership(user.id)
  if (!member || !['ADMIN', 'MANAGER'].includes(member.role) || !member.tenant.active || member.tenant.suspended) return new Response(null, { status: 403 })
  const report = await cashReport(member.tenantId, member.tenant.timezone)
  return new Response(exportCashCsv(report.rows, member.tenant.timezone), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="fluxo-de-caixa.csv"', 'Cache-Control': 'private, no-store' }
  })
}
