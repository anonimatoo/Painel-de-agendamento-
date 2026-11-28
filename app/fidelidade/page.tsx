import { redirect } from 'next/navigation'
import { membership, userSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { can } from '@/lib/permissions'
import { loyaltyThreshold } from '@/lib/loyalty'
import { MerchantShell } from '../merchant-shell'
import { updateLoyalty } from './actions'

export default async function Loyalty({ searchParams }: { searchParams: Promise<{ resultado?: string }> }) {
  const user = await userSession()
  const member = user ? await membership(user.id) : null
  if (!member?.tenant.active || member.tenant.suspended || !can(member, 'customer.edit')) redirect('/dashboard')
  const result = (await searchParams).resultado
  const customers = member.tenant.loyaltyEnabled ? await db.consumerProfile.findMany({
    where: { tenantId: member.tenantId }, orderBy: { name: 'asc' }, take: 100,
    select: { userId: true, name: true, _count: { select: { appointments: { where: { status: 'COMPLETED' } }, loyaltyRewards: true } } }
  }) : []
  return <MerchantShell member={member} current="/fidelidade">
    <h1>Fidelidade</h1>
    {result === 'salvo' && <p role="status" className="success">Fidelidade atualizada.</p>}
    {result === 'indisponivel' && <p role="alert" className="error">Resgate indisponível ou já registrado.</p>}
    <article><h2>Programa do estabelecimento</h2>
      <p>A cada {loyaltyThreshold} atendimentos concluídos pelo portal, o cliente pode combinar um benefício com o estabelecimento. Registre o resgate após entregar o benefício.</p>
      {member.role === 'ADMIN' && <form action={updateLoyalty}>
        <input type="hidden" name="enabled" value={String(!member.tenant.loyaltyEnabled)} />
        <button name="command" value="toggle">{member.tenant.loyaltyEnabled ? 'Desativar programa' : 'Ativar programa'}</button>
      </form>}
    </article>
    {member.tenant.loyaltyEnabled && <article><h2>Resgates</h2>{customers.length ? <ul>{customers.map(row => {
      const available = Math.max(0, Math.floor(row._count.appointments / loyaltyThreshold) - row._count.loyaltyRewards)
      return <li key={row.userId}>{row.name} · {row._count.appointments} concluídos · {available} resgates disponíveis
        {available > 0 && <form action={updateLoyalty}><input type="hidden" name="userId" value={row.userId} />
          <input type="hidden" name="sequence" value={row._count.loyaltyRewards + 1} /><button className="outline">Confirmar resgate entregue</button></form>}</li>
    })}</ul> : <p>Ainda não há clientes cadastrados no portal.</p>}</article>}
  </MerchantShell>
}
