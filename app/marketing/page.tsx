import Link from 'next/link'
import { redirect } from 'next/navigation'
import { DateTime } from 'luxon'
import QRCode from 'qrcode'
import { membership, userSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { can } from '@/lib/permissions'
import { MerchantShell } from '../merchant-shell'
import { ErrorNote, Field } from '../ui'
import { ArtEditor } from './art-editor'
import { manageOffer } from './actions'

const labels = { COUPON: 'Cupom', PROMOTION: 'Promoção programada', COMBO: 'Combo' }

export default async function Marketing({ searchParams }: { searchParams: Promise<{ erro?: string; resultado?: string }> }) {
  const user = await userSession()
  const member = user ? await membership(user.id) : null
  if (!member?.tenant.active || member.tenant.suspended || !can(member, 'product.manage')) redirect('/dashboard')
  const { tenant, tenantId } = member
  const where = { tenantId }
  const [products, offers, query] = await Promise.all([
    db.product.findMany({ where: { ...where, archivedAt: null }, orderBy: { name: 'asc' } }),
    db.commercialOffer.findMany({ where, take: 100, orderBy: { startsAt: 'desc' } }), searchParams
  ])
  const site = new URL('/estabelecimento/' + encodeURIComponent(tenant.slug), process.env.APP_URL ?? 'http://localhost:3000').href
  const image = await QRCode.toDataURL(site, { width: 192, margin: 1 })
  const now = DateTime.now().setZone(tenant.timezone)
  return <MerchantShell member={member} current="/marketing">
    <div className="row"><div><h1>Marketing e ofertas</h1><p>Prepare suas ofertas e compartilhe a página do estabelecimento.</p></div>
      {can(member, 'whatsapp.manage') && <Link className="button outline" href="/whatsapp">Comunicação via WhatsApp</Link>}</div>
    <ErrorNote error={query.erro} />{query.resultado === 'ok' && <p role="status" className="success">Oferta atualizada.</p>}
    <div className="grid">
      <article><h2>Ofertas da loja</h2>
        {(Object.entries(labels) as [keyof typeof labels, string][]).map(([kind, label]) => <details key={kind}><summary>Criar {label.toLowerCase()}</summary>
          <form action={manageOffer}><input type="hidden" name="kind" value={kind} />
            <Field name="name" label="Nome da oferta" />
            {kind === 'COUPON' && <Field name="code" label="Código do cupom" />}
            {kind === 'PROMOTION' && <label>Produto<select name="product" required><option value="">Selecione</option>
              {products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>}
            {kind === 'COMBO' && [1,2,3].map(index => <div key={index} className="inline">
              <label>Produto {index}<select name={'product' + index} required={index < 3}><option value="">Selecione</option>
              {products.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label>
              <Field name={'units' + index} label={'Unidades do produto ' + index} type="number" value={1} min={1} max={20} />
            </div>)}
            <label>Desconto (%)<input name="percent" type="number" min="0.01" max="99" step="0.01" required /></label>
            <Field name="starts" label="Início da oferta" type="datetime-local" value={now.toFormat("yyyy-LL-dd'T'HH:mm")} />
            <Field name="ends" label="Fim da oferta" type="datetime-local" value={now.plus({ days: 7 }).toFormat("yyyy-LL-dd'T'HH:mm")} />
            <button>Salvar oferta</button>
          </form></details>)}
        {offers.length ? <ul>{offers.map(offer => <li key={offer.id}><strong>{offer.name}</strong> · {labels[offer.kind as keyof typeof labels]} · {offer.bps / 100}%
          {offer.code && ' · ' + offer.code}
          <form action={manageOffer}><input type="hidden" name="id" value={offer.id} />
            <input type="hidden" name="active" value={String(!offer.enabled)} />
            <button className="outline" name="command" value="toggle">{offer.enabled ? 'Desativar' : 'Reativar'}</button></form>
        </li>)}</ul> : <p>Nenhuma oferta cadastrada.</p>}
      </article>
      <div><ArtEditor name={tenant.name} /><article><h2>Compartilhar loja</h2>
        <p><a href={site}>{site}</a></p><img src={image} width={192} height={192} alt="QR Code da loja" />
        <div className="inline"><a download="qr-codigo-loja.png" className="button outline" href={image}>Baixar QR Code</a>
        <a className="button outline" href={'https://wa.me/?text=' + encodeURIComponent(site)} rel="noreferrer">Compartilhar no WhatsApp</a></div>
      </article></div>
    </div>
  </MerchantShell>
}
