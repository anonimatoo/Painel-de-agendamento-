import { randomUUID } from 'node:crypto'
import { redirect } from 'next/navigation'
import { DateTime } from 'luxon'
import Link from 'next/link'
import { membership, userSession } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { db } from '@/lib/db'
import { MerchantShell } from '../merchant-shell'
import { brl, ErrorNote, Field } from '../ui'
import { managePurchase } from './actions'

export default async function Purchases({ searchParams }: { searchParams: Promise<{ erro?: string; resultado?: string }> }) {
  const user = await userSession()
  const member = user ? await membership(user.id) : null
  if (!member?.tenant.active || member.tenant.suspended || !can(member, 'stock.manage') || !can(member, 'finance.write')) redirect('/dashboard')
  const where = { tenantId: member.tenantId }
  const [suppliers, products, purchases, query] = await Promise.all([
    db.supplier.findMany({ where, orderBy: { name: 'asc' } }),
    db.product.findMany({ where: { ...where, archivedAt: null }, orderBy: { name: 'asc' } }),
    db.purchase.findMany({ where, take: 100, orderBy: { receivedAt: 'desc' }, include: { supplier: true, expense: true, product: true } }),
    searchParams
  ])
  const lowStock = products.filter(item => item.stock <= item.minimumStock)
  return <MerchantShell member={member} current="/compras">
    <div className="row"><div><h1>Compras e fornecedores</h1><p>Registre compras recebidas, atualize o estoque e acompanhe os vencimentos.</p></div>
      <Link className="button outline" href="/comercial">Contas a pagar</Link></div>
    <ErrorNote error={query.erro} />{query.resultado === 'ok' && <p role="status" className="success">Registro salvo.</p>}
    <div className="grid">
      <article><h2>Fornecedores</h2><form action={managePurchase}><Field name="name" label="Nome do fornecedor" />
        <Field name="contact" label="Contato" required={false} /><button name="command" value="supplier">Cadastrar fornecedor</button></form>
        {suppliers.length > 0 && <ul>{suppliers.map(row => <li key={row.id}>{row.name}{row.contact && ' · ' + row.contact}</li>)}</ul>}
      </article>
      <article><h2>Registrar recebimento</h2>{suppliers.length && products.length ? <form action={managePurchase}>
        <input type="hidden" name="requestId" value={randomUUID()} />
        <label>Fornecedor<select name="supplierId" required>{suppliers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>Produto<select name="productId" required>{products.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <Field name="quantity" label="Quantidade recebida" type="number" min={1} max={100000} />
        <Field name="cost" label="Custo por unidade (R$)" /><Field name="reference" label="Referência da nota" required={false} />
        <Field name="due" label="Vencimento da conta" type="date" value={DateTime.now().setZone(member.tenant.timezone).toISODate()!} />
        <button name="command" value="purchase">Registrar compra</button>
      </form> : <p>Cadastre ao menos um fornecedor e um produto para registrar compras.</p>}</article>
    </div>
    <article><h2>Histórico de compras</h2>{purchases.length ? <div className="scroll"><table><thead><tr>
      <th>Fornecedor</th><th>Produto</th><th>Quantidade</th><th>Total</th><th>Pagamento</th>
    </tr></thead><tbody>{purchases.map(row => <tr key={row.id}>
      <td>{row.supplier.name}</td><td>{row.product.name}</td><td>{row.quantity}</td><td>{brl(row.expense.cents)}</td>
      <td>{row.expense.paidAt ? 'Pago' : 'A pagar'}</td></tr>)}</tbody></table></div> : <p>Nenhuma compra registrada.</p>}</article>
    <article><h2>Reposição de estoque</h2>{lowStock.length ? <ul>{lowStock.map(item => <li key={item.id}>
      <Link href={'/catalogo/produto/' + item.id}>{item.name}</Link> · {item.stock} em estoque · mínimo de {item.minimumStock}
    </li>)}</ul> : <p>Nenhum produto no limite de reposição.</p>}</article>
  </MerchantShell>
}
