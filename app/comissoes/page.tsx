import { redirect } from 'next/navigation'
import { membership, userSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { professionalCommission } from '../actions'
import { MerchantShell } from '../merchant-shell'
import { brl, ErrorNote, Field } from '../ui'

export default async function Commissions({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const user = await userSession()
  if (!user) redirect('/login')
  const member = await membership(user.id)
  if (!member || member.role !== 'ADMIN' || !member.tenant.active || member.tenant.suspended) redirect('/dashboard')
  const tenantId = member.tenantId
  const [people, history, unpaid, settled] = await Promise.all([
    db.professional.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }),
    db.professionalCommission.findMany({ where: { appointment: { tenantId } }, include: {
      appointment: { include: { professional: true, service: true } }
    }, take: 100, orderBy: { createdAt: 'desc' } }),
    db.professionalCommission.aggregate({ where: { appointment: { tenantId }, paidAt: null }, _sum: { cents: true } }),
    db.professionalCommission.aggregate({ where: { appointment: { tenantId }, paidAt: { not: null } }, _sum: { cents: true } })
  ])
  return <MerchantShell member={member} current="/comissoes">
    <h1>Comissões profissionais</h1><ErrorNote error={(await searchParams).erro} />
    <article><h2>Comissão por profissional</h2><p>Os valores são registrados ao concluir um atendimento. A baixa registra o pagamento realizado pela empresa.</p>
      {people.length ? people.map(person => <details key={person.id}><summary>{person.name}</summary>
        <form action={professionalCommission} className="inline">
          <input type="hidden" name="id" value={person.id} />
          <label>Percentual<input type="number" name="percent" min={0} max={100} step="0.01" defaultValue={person.commissionBps / 100} /></label>
          <Field label="Valor fixo em centavos" name="fixed" type="number" min={0} value={person.commissionFixed} />
          <button name="operation" value="save">Salvar comissão</button>
        </form></details>) : <p>Nenhum profissional cadastrado.</p>}
    </article>
    <article><h2>Contas a pagar aos profissionais</h2>
      <p><strong>{brl(unpaid._sum.cents ?? 0)}</strong> a pagar · <strong>{brl(settled._sum.cents ?? 0)}</strong> já baixados no histórico.</p>
      <h3>Apuração recente</h3>{history.length ? <ul>{history.map(item => <li key={item.appointmentId}>
      {item.appointment.professional.name} · {item.appointment.service.name} · {brl(item.cents)} · {item.paidAt ? 'Pago em ' + new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeZone: member.tenant.timezone }).format(item.paidAt) : 'Pendente'}
      {item.paymentReference && ' · Referência: ' + item.paymentReference}
      {!item.paidAt && <form action={professionalCommission}><input name="id" type="hidden" value={item.appointmentId} />
        <Field name="reference" label="Referência do pagamento" required={false} /><button className="outline" name="operation" value="paid">Registrar pagamento</button></form>}
    </li>)}</ul> : <p>Nenhuma comissão calculada.</p>}</article>
  </MerchantShell>
}
