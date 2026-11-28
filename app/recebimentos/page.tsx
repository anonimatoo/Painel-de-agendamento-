import { can } from '@/lib/permissions'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { membership, userSession } from '@/lib/auth'
import { connectObligations, connectStatus } from '@/lib/connect'
import { db } from '@/lib/db'
import { manage, manageConnectAvailability, reviewPayment } from '../actions'
import { MerchantShell } from '../merchant-shell'
import { brl, ErrorNote } from '../ui'

export default async function Receipts({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const user = await userSession()
  if (!user) redirect('/login')
  const member = await membership(user.id)
  if (!member || !can(member, 'finance.read')) redirect('/dashboard')
  const tenant = member.tenant
  const [status, bookings, obligations] = await Promise.all([
    tenant.stripeAccountId ? connectStatus(tenant.stripeAccountId).catch(() => null) : null,
    db.appointment.findMany({
      where: { tenantId: tenant.id, OR: [{ status: 'PENDING' }, { checkoutState: 'REVIEW' }, { paidAt: { not: null } }] },
      include: { customer: { select: { name: true } }, history: { where: { operation: 'REFUND_REQUESTED' }, select: { id: true }, take: 1 } }, orderBy: { createdAt: 'desc' }, take: 100
    }),
    connectObligations(tenant.id)
  ])
  return <MerchantShell member={member} current="/recebimentos">
    <h1>Receber pagamentos</h1><ErrorNote error={(await searchParams).erro} />
    <article><h2>Conta de recebimentos</h2>
      <p>{!tenant.stripeAccountId ? 'Nenhuma conta conectada.' : !status ? 'Situação indisponível no momento.' :
        (status.submitted ? 'Cadastro enviado' : 'Cadastro incompleto') + ' · ' + (status.payments ? 'Recebimentos habilitados' : 'Recebimentos indisponíveis') + ' · ' + (status.payouts ? 'Repasses habilitados' : 'Repasses indisponíveis')}</p>
      {(status?.requirements === 'currently_due' || status?.requirements === 'past_due') && <p>Há informações cadastrais pendentes na Stripe.</p>}
      {member.role === 'ADMIN' && tenant.active && !tenant.suspended && <form action={manage.bind(null, 'connect')}>
        <button>{tenant.stripeAccountId ? 'Continuar ou atualizar cadastro' : 'Conectar minha conta Stripe'}</button>
      </form>}
      {tenant.stripeAccountId && <>
        <p>{tenant.connectPausedAt ? 'Novos recebimentos pausados neste estabelecimento.' : 'Novos recebimentos permitidos nas preferências deste estabelecimento.'}</p>
        <p>Em acompanhamento · {obligations.appointments} agendamento(s) e {obligations.orders} pedido(s).</p>
        {member.role === 'ADMIN' && tenant.active && !tenant.suspended && <form action={manageConnectAvailability}>
          <button className="outline" name="operation" value={tenant.connectPausedAt ? 'resume' : 'pause'}>{tenant.connectPausedAt ? 'Reconectar recebimentos' : 'Desativar novos recebimentos'}</button>
        </form>}
        <p>O histórico e os estornos continuam acessíveis. Para pedir o encerramento da conta Express, procure o suporte após concluir as obrigações pendentes.</p>
      </>}
      <Link href="/dashboard#configuracoes">Configurar forma de pagamento e sinal</Link>
    </article>
    <article><h2>Pagamentos de atendimentos</h2>
      {bookings.length ? <ul>{bookings.map(item => <li key={item.id}>
        {item.customer.name} · {brl(item.chargeCents ?? item.cents)} ·
        {' '}{item.checkoutState === 'REVIEW' ? 'Em verificação' : item.refundedAt ? 'Estornado' : item.paidAt ? 'Pago' : 'Aguardando pagamento'}
        {!item.refundedAt && item.history.length > 0 && <><span className="state-pill">Estorno solicitado</span>
          {can(member, 'finance.refund') && tenant.active && !tenant.suspended && <form action={manage.bind(null, 'refund')}><input hidden readOnly name="id" value={item.id} /><button className="outline">Estornar pagamento</button></form>}</>}
        {item.status === 'PENDING' && <form action={reviewPayment}>
          <input name="id" type="hidden" value={item.id} /><button className="outline">Consultar pagamento na Stripe</button>
        </form>}
      </li>)}</ul> : <p>Nenhum pagamento registrado.</p>}
      <Link href="/comercial">Consultar vendas e pedidos</Link> · <Link href="/conciliacao">Ver movimentações da Stripe</Link>
    </article>
  </MerchantShell>
}
