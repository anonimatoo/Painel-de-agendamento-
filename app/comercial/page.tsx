import { can } from '@/lib/permissions'
import { randomUUID } from 'node:crypto'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { DateTime } from 'luxon'
import { userSession, membership } from '@/lib/auth'
import { cashReport } from '@/lib/commerce'
import { db } from '@/lib/db'
import { MerchantShell } from '../merchant-shell'
import { commerce } from '../actions'
import { brl, ErrorNote, Field } from '../ui'

export default async function CommercePage({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const user = await userSession()
  if (!user) redirect('/login')
  const member = await membership(user.id)
  const finance = can(member, 'finance.read')
  const stock = can(member, 'product.manage') || can(member, 'stock.manage') || can(member, 'sale.create')
  if (!member || (!finance && !stock) || !member.tenant.active || member.tenant.suspended) redirect('/dashboard')
  const tenantId = member.tenantId
  const zone = member.tenant.timezone
  const [products, history, { entries, rows }, orders, query] = await Promise.all([
    stock ? db.product.findMany({ where: { tenantId }, orderBy: { name: 'asc' } }) : [],
    stock ? db.stockMovement.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 60, include: { product: true } }) : [],
    finance ? cashReport(tenantId, zone) : { entries: [], rows: [] },
    finance ? db.shopOrder.findMany({ where: { tenantId }, take: 60, orderBy: { createdAt: 'desc' }, include: { items: true } }) : [],
    searchParams
  ])
  const positive = rows.reduce((sum, row) => sum + Math.max(0, row.cents), 0)
  const negative = rows.reduce((sum, row) => sum - Math.min(0, row.cents), 0)
  const outstanding = entries.filter(entry => !entry.paidAt)
  const date = (value: Date) => DateTime.fromJSDate(value, { zone }).toFormat('dd/LL/yyyy')
  return <MerchantShell member={member} current="/comercial">
    <h1>Estoque e financeiro</h1>{member.role === 'ADMIN' && <Link href="/comissoes">Comissões profissionais</Link>}<ErrorNote error={query.erro} />
    {finance && <><section className="grid metrics">
      <article><p>Entradas no mês</p><strong>{brl(positive)}</strong></article>
      <article><p>Saídas no mês</p><strong>{brl(negative)}</strong></article>
      <article><p>Saldo de caixa no mês</p><strong>{brl(positive - negative)}</strong></article>
    </section>
    <article><h2>Comparativo do mês</h2>
      <label>Entradas · {brl(positive)}<meter value={positive} max={Math.max(positive, negative, 1)} /></label>
      <label>Saídas · {brl(negative)}<meter value={negative} max={Math.max(positive, negative, 1)} /></label>
    </article>
    <article><h2>Contas a pagar e a receber</h2>
      {can(member, 'finance.write') && <form className="inline" action={commerce.bind(null, 'entry')}>
        <Field label="Descrição" name="title" />
        <label>Tipo<select name="kind"><option value="INCOME">Receita</option><option value="EXPENSE">Despesa</option></select></label>
        <Field label="Valor em centavos" name="cents" type="number" min={1} /><Field label="Vencimento" name="dueAt" type="date" />
        <label className="check"><input name="paid" type="checkbox" /> Já liquidado</label><button>Registrar lançamento</button>
      </form>}
      {outstanding.length ? <ul>{outstanding.map(entry => <li key={entry.id}>
        {entry.kind === 'INCOME' ? 'A receber' : 'A pagar'} · {entry.title} · {brl(entry.cents)} · {date(entry.dueAt)}
        {can(member, 'finance.write') && <form action={commerce.bind(null, 'settle')}><input type="hidden" name="id" value={entry.id} /><button className="outline">Dar baixa</button></form>}
      </li>)}</ul> : <p>Nenhuma conta em aberto.</p>}
    </article>
    <article><h2>Fluxo de caixa do mês</h2>{can(member, 'report.export') && <div className="inline"><a href="/api/financeiro/csv" className="button outline">Baixar CSV</a><a href="/api/financeiro/xlsx" className="button outline">Baixar XLSX</a></div>}
      {rows.length ? <ul>{rows.map((row, index) => <li key={index}>{date(row.date)} · {row.title} · {brl(row.cents)}</li>)}</ul> : <p>Nenhuma movimentação liquidada neste mês.</p>}
    </article>
    </>}{stock && <article id="estoque"><h2>Produtos e estoque</h2><div id="vendas" />
      {!products.length && <p>Cadastre os produtos na seção Equipe e catálogo do painel.</p>}
      {products.map(product => <details key={product.id}>
        <summary>{product.name} · {product.stock} em estoque{product.stock <= product.minimumStock ? ' · Estoque baixo' : ''}</summary>
        {can(member, 'product.manage') && <form className="inline" action={commerce.bind(null, 'product')}>
          <input type="hidden" name="id" value={product.id} />
          <Field label="Nome" name="name" value={product.name} /><Field label="Categoria" name="category" required={false} value={product.category} />
          <Field label="Preço de venda em centavos" name="cents" type="number" min={0} value={product.cents} />
          <Field label="Preço de custo em centavos" name="costCents" type="number" min={0} value={product.costCents} />
          <Field label="Preço promocional em centavos" name="promotionCents" type="number" min={1} required={false} value={product.promotionCents ?? ''} />
          <Field label="Estoque mínimo" name="minimumStock" type="number" min={0} value={product.minimumStock} /><button>Salvar produto</button>
        </form>}
        {can(member, 'stock.manage') && <form className="inline" action={commerce.bind(null, 'stock')}>
          <input type="hidden" name="productId" value={product.id} /><input type="hidden" name="requestId" value={randomUUID()} />
          <Field label="Ajuste de unidades (positivo ou negativo)" name="quantity" type="number" /><button className="outline">Ajustar estoque</button>
        </form>}
        {can(member, 'sale.create') && product.stock > 0 && <form className="inline" action={commerce.bind(null, 'sale')}>
          <input type="hidden" name="productId" value={product.id} /><input type="hidden" name="requestId" value={randomUUID()} />
          <Field label="Unidades vendidas" name="quantity" type="number" min={1} max={product.stock} /><button>Registrar venda presencial</button>
        </form>}
      </details>)}
    </article>
    }{finance && <article id="pedidos"><h2>Pedidos para retirada</h2>{orders.length ? <ul>{orders.map(order => <li key={order.id}>
      {date(order.createdAt)} · {order.customerName} · +{order.phone} · {brl(order.cents)} ·
      {' '}{order.paymentReview ? 'Em verificação' : order.status === 'PAID' ? 'Pago' : order.status === 'PENDING' ? 'Aguardando pagamento' : order.status === 'REFUNDED' ? 'Estornado' : 'Cancelado'}
      {order.status === 'PENDING' && <form action={commerce.bind(null, 'review-order')}><input name="id" type="hidden" value={order.id} /><button className="outline">Consultar pagamento</button></form>}
      {can(member, 'finance.refund') && order.status === 'PAID' && <form action={commerce.bind(null, 'refund-order')}>
        <input type="hidden" name="id" value={order.id} /><button className="outline">Estornar pedido e repor estoque</button>
      </form>}
      <ul>{order.items.map(item => <li key={item.productId}>{item.quantity} × {item.name}</li>)}</ul>
    </li>)}</ul> : <p>Nenhum pedido online.</p>}</article>
    }{stock && <article><h2>Histórico de estoque</h2>
      {history.length ? <ul>{history.map(item => <li key={item.id}>
        {date(item.createdAt)} · {item.product.name} · {item.quantity > 0 ? '+' : ''}{item.quantity} · {item.kind === 'SALE' ? 'Venda presencial' : item.kind === 'REVERSAL' ? 'Cancelamento de venda' : 'Ajuste'}
        {item.kind === 'SALE' && !item.reversedAt && can(member, 'sale.create') && <form action={commerce.bind(null, 'reverse')}>
          <input type="hidden" name="id" value={item.id} /><button className="outline">Cancelar venda e devolver ao estoque</button>
        </form>}
      </li>)}</ul> : <p>Nenhuma movimentação de estoque.</p>}
    </article>
    }
  </MerchantShell>
}
