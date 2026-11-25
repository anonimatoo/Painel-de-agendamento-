import Link from 'next/link'
import { redirect } from 'next/navigation'
import type Stripe from 'stripe'
import { membership, userSession } from '@/lib/auth'
import { stripe } from '@/lib/stripe'
import { manage } from '../actions'
import { Brand, brl } from '../ui'

const invoiceStatus: Record<string, string> = {
  paid: 'Paga', open: 'Em aberto', draft: 'Em preparação', uncollectible: 'Não recebida', void: 'Cancelada'
}

export default async function BillingPage() {
  const user = await userSession()
  if (!user) redirect('/login')
  const member = await membership(user.id)
  if (member?.role !== 'ADMIN') redirect('/dashboard')
  const customer = member.tenant.stripeCustomerId
  let invoices: Stripe.Invoice[] = []
  let unavailable = false
  if (customer) {
    try {
      invoices = (await stripe().invoices.list({ customer, limit: 24 })).data
    } catch {
      unavailable = true
    }
  }
  return <div className="site"><header><Brand /><Link href="/dashboard">Voltar ao painel</Link></header>
    <main className="content"><article>
      <h1>Faturas da assinatura</h1>
      {unavailable ? <p role="alert">Não foi possível consultar as faturas agora.</p>
        : invoices.length ? <div className="scroll"><table>
          <thead><tr><th>Data</th><th>Situação</th><th>Valor</th><th>Fatura</th></tr></thead>
          <tbody>{invoices.map(invoice => <tr key={invoice.id}>
            <td>{new Intl.DateTimeFormat('pt-BR', { timeZone: member.tenant.timezone }).format(invoice.created * 1000)}</td>
            <td>{invoiceStatus[invoice.status ?? ''] ?? 'Indisponível'}</td>
            <td>{invoice.currency === 'brl' ? brl(invoice.total) : invoice.currency.toUpperCase()}</td>
            <td>{invoice.hosted_invoice_url && <a href={invoice.hosted_invoice_url} rel="noreferrer">Abrir fatura</a>}</td>
          </tr>)}</tbody>
        </table></div> : <p>Nenhuma fatura disponível.</p>}
      {customer && <form action={manage.bind(null, 'portal')}><button>Gerenciar assinatura</button></form>}
    </article></main>
  </div>
}
