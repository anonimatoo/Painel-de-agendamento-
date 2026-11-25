import Link from 'next/link'
import { redirect } from 'next/navigation'
import { userSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { sendInvoiceNotice } from '../actions'
import { Brand, brl, ErrorNote } from '../ui'

export default async function Communication({ searchParams }: { searchParams: Promise<{ erro?: string; enviado?: string }> }) {
  const user = await userSession()
  if (!user?.platformAdmin || !user.adminMfaVerified) redirect('/login')
  const query = await searchParams
  const [invoices, sends] = await Promise.all([
    db.billingInvoice.findMany({
      where: { status: 'open', currency: 'brl', tenant: { members: { some: { role: 'ADMIN', disabledAt: null, user: { emailVerifiedAt: { not: null } } } } } },
      orderBy: { issuedAt: 'desc' }, take: 60, include: { tenant: { select: { name: true } } }
    }),
    db.adminAudit.findMany({ where: { action: 'INVOICE_NOTICE_SENT' }, orderBy: { createdAt: 'desc' }, take: 30 })
  ])
  const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })
  return <div className="site"><header><Brand /><Link href="/super-admin">Voltar à administração</Link></header><main className="content">
    <h1>Comunicação com assinantes</h1><ErrorNote error={query.erro} />
    {query.enviado && <p className="success" role="status">O serviço de e-mail aceitou o aviso.</p>}
    <article><h2>Avisar sobre fatura em aberto</h2>
      <p>O responsável recebe o link da fatura existente para consultar e regularizar o pagamento.</p>
      {invoices.length ? <ul>{invoices.map(invoice => <li key={invoice.id}>{invoice.tenant.name} · {brl(Math.max(0, invoice.amountDue - invoice.amountPaid))} · {date.format(invoice.issuedAt)}
        <form action={sendInvoiceNotice} className="inline">
          <input name="id" type="hidden" value={invoice.id} />
          <label className="check"><input name="confirmed" type="checkbox" required /> Confirmo que o envio foi autorizado</label>
          <button>Enviar aviso por e-mail</button>
        </form></li>)}</ul> : <p>Nenhuma fatura elegível para aviso.</p>}
    </article>
    <article><h2>Envios recentes</h2>{sends.length ? <ul>{sends.map(record => <li key={record.id}>{date.format(record.createdAt)} · Aviso de fatura enviado</li>)}</ul> : <p>Nenhum aviso enviado.</p>}</article>
  </main></div>
}
