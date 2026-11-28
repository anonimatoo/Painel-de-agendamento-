import { centsWithDiscount, comboItems } from '@/lib/offers'
import { productGallery } from '@/lib/product-gallery'
import Link from 'next/link'
import { CalendarCheck, CalendarDays, CircleCheck, CreditCard, MapPin, ShoppingBag, Store, UserRound } from 'lucide-react'
import { randomUUID } from 'node:crypto'
import { notFound, redirect } from 'next/navigation'
import { DateTime } from 'luxon'
import { membership, userSession } from '@/lib/auth'
import { can } from '@/lib/permissions'
import { featuredFirst, readPublicDesign } from '@/lib/public-design'
import { connectStatus } from '@/lib/connect'
import { stripeForNewPayments } from '@/lib/stripe-settings'
import { pixMinimumCents } from '@/lib/checkout-method'
import { currentConsumer, consumerPath } from '@/lib/consumer'
import { db } from '@/lib/db'
import { AgendaError, availability } from '@/lib/agenda'
import { SlotPicker } from './slot-picker'
import { joinWaitlist, reserve, retryPayment, shopCheckout } from '../../actions'
import { FormSubmit } from '../../form-submit'
import { PublicBrand } from '../../public-brand'
import { ErrorNote, Field, brl } from '../../ui'

export const dynamic = 'force-dynamic'

export default async function Establishment({ params, searchParams }: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ servico?: string; profissional?: string; dia?: string; erro?: string; reserva?: string; espera?: string; pedido?: string; pagamento?: string; previa?: string }>
}) {
  const { slug } = await params
  const query = await searchParams
  const preview = query.previa === '1' ? await userSession() : null
  const member = preview ? await membership(preview.id) : null
  const previewTenant = member && can(member, 'brand.manage') ? member.tenantId : null
  const tenant = await db.tenant.findFirst({
    where: { slug, suspended: false, OR: [{ active: true }, ...(previewTenant ? [{ id: previewTenant }] : [])] },
    include: {
      services: { where: { active: true, archivedAt: null, assignments: { some: { professional: { active: true } } } }, include: {
        assignments: { where: { professional: { active: true } }, include: { professional: true } }
      } },
      media: true,
      products: { where: { published: true, archivedAt: null, stock: { gt: 0 } } }
    }
  })
  if (!tenant) {
    const alias = await db.tenantAlias.findUnique({ where: { slug }, include: { tenant: { select: { slug: true, active: true, suspended: true } } } })
    if (!alias?.tenant.active || alias.tenant.suspended) notFound()
    const preserved = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) if (typeof value === 'string' && value.length <= 500) preserved.set(key, value)
    redirect('/estabelecimento/' + encodeURIComponent(alias.tenant.slug) + (preserved.size ? '?' + preserved : ''))
  }
  const draft = previewTenant === tenant.id && tenant.publicDesignDraft !== null
  const design = readPublicDesign(draft ? tenant.publicDesignDraft : tenant.publicDesign)
  const preparing = previewTenant === tenant.id && !tenant.active
  const previewProducts = preparing ? await db.product.findMany({ where: { tenantId: tenant.id, archivedAt: null } }) : tenant.products
  const previewServices = preparing ? await db.service.findMany({
    where: { tenantId: tenant.id, archivedAt: null }, include: { assignments: { where: { professional: { active: true } }, include: { professional: true } } }
  }) : tenant.services
  const visibleProducts = featuredFirst(previewProducts, design.productIds)
  const visibleServices = featuredFirst(previewServices, design.serviceIds)
  const hours = await db.workHours.findMany({ where: { tenantId: tenant.id, professional: { active: true } },
    select: { weekday: true, startMinute: true, endMinute: true }, distinct: ['weekday', 'startMinute', 'endMinute'],
    orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }], take: 21 })
  const clock = (value: number) => String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0')
  const weekdays = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
  const image = (kind: string, target = '') => tenant.media.find(item => item.kind === kind && item.target === target)?.key
  const cover = image('COVER') ?? tenant.coverKey
  const banner = image('BANNER')
  const logo = image('LOGO')
  const profile = image('PROFILE')
  const gallery = tenant.media.filter(item => item.kind === 'GALLERY')
  const confirmed = typeof query.reserva === 'string' && query.reserva.length < 100 && query.reserva !== 'pagamento'
    ? await db.appointment.count({ where: { id: query.reserva, tenantId: tenant.id, status: 'CONFIRMED' } })
    : 0
  const paymentToken = typeof query.pagamento === 'string' && /^[a-f0-9-]{36}$/.test(query.pagamento) ? query.pagamento : undefined
  const payment = paymentToken ? await db.appointment.findFirst({
    where: { tenantId: tenant.id, paymentToken }, select: { id: true, status: true, checkoutState: true, expiresAt: true, startsAt: true, chargeCents: true, consumerUserId: true, paymentIntentId: true, paidAt: true, refundedAt: true, service: { select: { name: true } }, professional: { select: { name: true } } }
  }) : null
  const order = typeof query.pedido === 'string' && query.pedido.length < 100
    ? await db.shopOrder.findFirst({ where: { id: query.pedido, tenantId: tenant.id }, select: { status: true, paymentReview: true } }) : null
  const now = new Date()
  const offers = tenant.active ? await db.commercialOffer.findMany({
    where: { tenantId: tenant.id, enabled: true, startsAt: { lte: now }, endsAt: { gt: now } }
  }) : []
  const publicProducts = new Set(tenant.products.map(product => product.id))
  const combos = offers.filter(offer => {
    if (offer.kind !== 'COMBO') return false
    const parsed = comboItems.safeParse(offer.items)
    return parsed.success && parsed.data.every(item => publicProducts.has(item.productId))
  })
  const publicPrice = (product: typeof tenant.products[number]) => {
    const base = product.promotionCents ?? product.cents
    const bps = Math.max(0, ...offers.filter(offer => offer.kind === 'PROMOTION' && offer.productId === product.id).map(offer => offer.bps))
    return Math.min(base, centsWithDiscount(product.cents, bps))
  }
  const purchasable = tenant.active && !tenant.connectPausedAt && tenant.stripeAccountId && tenant.products.some(product => (product.promotionCents ?? product.cents) > 0)
  const today = DateTime.now().setZone(tenant.timezone).toISODate()!
  const day = typeof query.dia === 'string' ? query.dia : today
  const consumer = await currentConsumer(tenant.id)
  const portal = consumerPath(slug)
  const chosen = visibleServices.find(s => s.id === query.servico) ?? visibleServices[0]
  const professional = chosen?.assignments.find(a => a.professionalId === query.profissional)?.professional
  let slots: Awaited<ReturnType<typeof availability>> = []
  let dateError: string | undefined
  if (tenant.active && chosen && professional) {
    try {
      slots = await availability(tenant, chosen.id, professional.id, day)
    } catch (error) {
      if (!(error instanceof AgendaError)) throw error
      dateError = error.message
    }
  }
  const picture = banner ?? cover
  const online = Boolean(chosen && tenant.onlinePayment && chosen.cents > 0)
  const checkoutAccount = tenant.stripeAccountId
  const methods = tenant.active && checkoutAccount && tenant.pixCheckoutEnabled && !tenant.connectPausedAt
    ? await stripeForNewPayments().then(api => connectStatus(checkoutAccount, api)).catch(() => null) : null
  const pix = Boolean(methods?.pix)
  const pixForService = pix && chosen && Math.ceil(chosen.cents * tenant.depositPercent / 100) >= pixMinimumCents
  const completed = Boolean(payment?.paidAt && !payment.refundedAt && payment.checkoutState !== 'REVIEW')
  const checkoutPhoto = chosen ? image('SERVICE', chosen.id) : null
  const steps = ['Serviço', 'Profissional', 'Data', 'Horário', 'Revisão', 'Pagamento', 'Confirmação']
  const stage = completed || confirmed ? 6 : payment ? 5 : slots.length ? 3 : professional ? 2 : 0
  const productsSection = visibleProducts.length > 0 && <article id="produtos"><h2>Produtos disponíveis</h2>
        <ul className="storefront-products">{visibleProducts.map(product => <li key={product.id} id={'produto-' + product.id}>
          {productGallery(tenant.media.filter(item => item.kind === 'PRODUCT'), product.id).slice(0,1).map(photo =>
            <img key={photo.id} className="catalog-photo" src={'/api/imagens/' + photo.key} alt="" />)}
          <div><strong>{product.name}</strong>{design.productIds.includes(product.id) && <span className="state-pill">Em destaque</span>}<p>{product.description}</p>{brl(publicPrice(product))}</div>
        </li>)}</ul>
        {purchasable && <details><summary>Montar pedido para retirada</summary><form action={shopCheckout.bind(null, slug)}>
          <input type="hidden" name="requestId" value={randomUUID()} />
          {offers.some(offer => offer.kind === 'COUPON') && <Field name="coupon" label="Cupom" required={false} />}
          {combos.length > 0 && <label>Adicionar combo<select name="combo"><option value="">Sem combo</option>
            {combos.map(offer => <option key={offer.id} value={offer.id}>{offer.name} · {offer.bps / 100}% de desconto</option>)}
          </select></label>}
          {visibleProducts.filter(product => (product.promotionCents ?? product.cents) > 0).map(product =>
            <Field key={product.id} label={'Unidades de ' + product.name} name={'product:' + product.id} type="number" min={0} max={Math.min(product.stock, 100)} value={0} />
          )}
          <Field label="Nome" name="name" value={consumer?.name} /><Field label="Telefone com DDI para retirada" name="phone" type="tel" value={consumer?.phone} />{pix && <label>Forma de pagamento<select name="checkoutMethod" defaultValue={methods?.payments ? 'card' : 'pix'}>
            {methods?.payments && <option value="card">Cartão de crédito</option>}<option value="pix">Pix</option>
          </select></label>}<FormSubmit>Ir para pagamento</FormSubmit>
        </form></details>}
      </article>
  return <div className="consumer-site storefront" style={{ '--brand-accent': tenant.color, '--brand-secondary': design.secondaryColor,
      '--storefront-radius': design.buttonStyle === 'pill' ? '999px' : '10px' } as React.CSSProperties}>
    <header className="consumer-header"><PublicBrand /><Link className="button outline" href={portal}><UserRound size={18} aria-hidden /> {consumer ? 'Minha conta' : 'Entrar como cliente'}</Link></header>
    <main className="content">
      <section className={'storefront-hero ' + (tenant.theme === 'dark' ? 'storefront-dark' : '')}>
        {picture && <img className="storefront-cover" src={'/api/imagens/' + picture} alt="" />}
        {(logo || profile) && <img width={94} height={94} className="storefront-logo" src={'/api/imagens/' + (logo ?? profile)} alt="" />}
        <div><h1>{tenant.name}</h1>{tenant.description && <p>{tenant.description}</p>}
          <nav className="inline" aria-label="Redes sociais e contato">
            {tenant.instagramUrl && <a href={tenant.instagramUrl} rel="noreferrer">Instagram</a>}
            {tenant.contactPhone && <a href={'https://wa.me/' + tenant.contactPhone} rel="noreferrer">WhatsApp</a>}
          </nav>
        </div>
      </section>
      <nav className="consumer-nav" aria-label="Página do estabelecimento">
        <a href="#agendar"><CalendarDays size={18} aria-hidden /> Agendar</a>
        {tenant.products.length > 0 && <a href="#produtos"><ShoppingBag size={18} aria-hidden /> Comprar produtos</a>}
        <Link href={portal + '#agendamentos'}><CalendarCheck size={18} aria-hidden /> Meus agendamentos</Link>
        <Link href={portal + '#pedidos'}>Meus pedidos</Link><Link href={portal + '#meus-dados'}>Meus dados</Link>
      </nav>
      {!tenant.active && <p className="success" role="status">Prévia privada. O estabelecimento ainda não está publicado.</p>}
      {draft && <p className="success" role="status">Prévia do rascunho. <Link href="/personalizacao">Voltar ao editor</Link></p>}
      <ErrorNote error={query.erro ?? dateError} />
      {payment && <article className="booking-result"><h2><CircleCheck aria-hidden /> {completed ? 'Pagamento aprovado' : 'Situação do pagamento'}</h2>
        {completed && <><p role="status">Seu agendamento foi confirmado.</p><dl><dt>Número do agendamento</dt><dd>{payment.id}</dd><dt>Serviço</dt><dd>{payment.service.name}</dd><dt>Profissional</dt><dd>{payment.professional.name}</dd><dt>Data e horário</dt><dd>{DateTime.fromJSDate(payment.startsAt).setZone(tenant.timezone).toFormat('dd/LL/yyyy HH:mm')}</dd><dt>Valor pago</dt><dd>{brl(payment.chargeCents ?? 0)}</dd></dl>
          <div className="inline"><Link className="button" href={portal + '#agendamentos'}>Ver meus agendamentos</Link>{consumer?.userId && payment.consumerUserId === consumer.userId && payment.paymentIntentId && <Link href={portal + '/comprovante?tipo=agendamento&id=' + payment.id}>Comprovante Stripe</Link>}<Link href={'/estabelecimento/' + encodeURIComponent(slug)}>Voltar ao estabelecimento</Link></div></>}
        {!completed && <p role="status">{payment.refundedAt ? 'O pagamento foi estornado.' : payment.checkoutState === 'REVIEW' ? 'Pagamento em verificação. Entre em contato com o estabelecimento antes de pagar novamente.' : payment.status === 'CANCELED' ? 'O prazo para pagamento terminou.' : 'Aguardamos a confirmação do pagamento.'}</p>}
        {paymentToken && payment.status === 'PENDING' && payment.checkoutState !== 'REVIEW' && payment.expiresAt && payment.expiresAt > new Date() &&
          <form action={retryPayment.bind(null, slug, paymentToken)}><button>Continuar pagamento</button></form>}
      </article>}
      {order && <p className="success" role="status">{order.paymentReview ? 'O pagamento está em verificação. Consulte o estabelecimento antes de pagar novamente.' : order.status === 'PAID' ? 'Pagamento do pedido confirmado. Combine a retirada com o estabelecimento.' : order.status === 'PENDING' ? 'Aguardando confirmação do pagamento do pedido.' : 'Este pedido foi cancelado ou estornado.'}</p>}
      {query.espera && <p className="success" role="status">Solicitação de lista de espera enviada.</p>}
      {confirmed > 0 && <p className="success" role="status">Seu agendamento foi confirmado.</p>}
      {design.layout === 'products' && productsSection}
      <div className="storefront-grid"><article id="agendar"><h2>Agende seu atendimento</h2>
        <ol className="booking-progress" aria-label="Etapas do agendamento">{steps.map((name, i) => <li key={name} aria-current={i === stage ? 'step' : undefined}><span>{i + 1}</span>{name}</li>)}</ol>
        {tenant.active && chosen ? <SlotPicker chosenId={chosen.id} professionalId={professional?.id ?? ''} day={day} today={today}
          services={visibleServices.map(s => ({
            id: s.id, name: s.name, price: brl(s.cents), duration: s.duration,
            professionals: s.assignments.map(a => ({ id: a.professionalId, name: a.professional.name, photo: image('PROFESSIONAL', a.professionalId) ? '/api/imagens/' + image('PROFESSIONAL', a.professionalId) : undefined }))
          }))} /> : <p>O estabelecimento ainda não abriu a agenda.</p>}
        {tenant.active && professional && chosen && !slots.length && !dateError && <>
          <p>Nenhum horário disponível nesta data.</p>
          <details><summary>Entrar na lista de espera</summary><form action={joinWaitlist.bind(null, slug)}>
            <input type="hidden" name="serviceId" value={chosen.id} /><input type="hidden" name="professionalId" value={professional.id} />
            <input type="hidden" name="day" value={day} /><Field label="Nome" name="name" />
            <Field label="Telefone com DDI para contato" name="phone" type="tel" /><label className="check"><input type="checkbox" name="waitNotice" /> Quero receber pelo WhatsApp um aviso caso surja horário para esta solicitação.</label><button>Enviar solicitação</button>
          </form></details>
        </>}
        {!!slots.length && <form action={reserve.bind(null, slug)} className="booking-review">
          <input type="hidden" name="serviceId" value={chosen.id} /><input type="hidden" name="professionalId" value={professional!.id} />
          <fieldset className="booking-times"><legend>Horários disponíveis</legend>
            <div>{slots.map(slot => <label key={slot.start}><input type="radio" name="startsAt" required value={slot.start} /><span>{slot.label}</span></label>)}</div>
          </fieldset>
          <div className="booking-review-columns">
            <section><h3>Resumo da contratação</h3>
              {checkoutPhoto && <img className="catalog-photo" src={'/api/imagens/' + checkoutPhoto} alt="" />}
              <strong>{chosen.name}</strong><p>{chosen.description}</p>
              <dl><dt>Profissional</dt><dd>{professional!.name}</dd><dt>Data</dt><dd>{DateTime.fromISO(day).toFormat('dd/LL/yyyy')}</dd><dt>Duração</dt><dd>{chosen.duration} min</dd><dt>Total</dt><dd>{brl(chosen.cents)}</dd></dl>
              <p className="booking-payment">{online ? <><CreditCard aria-hidden size={20} /> {pixForService ? 'Stripe Checkout' : 'Cartão no Stripe Checkout'} · {brl(Math.ceil(chosen.cents * tenant.depositPercent / 100))} agora</> : <><Store aria-hidden size={20} /> {chosen.cents > 0 ? 'Pagamento no estabelecimento' : 'Sem cobrança'}</>}</p>
              {tenant.policies && <details><summary>Política de cancelamento</summary><p className="preserve-lines">{tenant.policies}</p></details>}
            </section>
            <section><h3>Seus dados</h3>
              <Field label="Nome" name="name" value={consumer?.name} /><Field label="WhatsApp com DDI (ex. 5511999999999)" name="phone" type="tel" value={consumer?.phone} />
              <label className="check"><input type="checkbox" name="consent" /> Quero receber lembretes e atualizações deste atendimento pelo WhatsApp.</label>
              {online && pixForService && <label>Forma de pagamento<select name="checkoutMethod" defaultValue={methods?.payments ? 'card' : 'pix'}>
                {methods?.payments && <option value="card">Cartão de crédito</option>}<option value="pix">Pix</option>
              </select></label>}
              <FormSubmit pendingText="Reservando horário…">{online ? 'Continuar para pagamento' : 'Confirmar agendamento'}</FormSubmit>
            </section>
          </div>
        </form>}
      </article>
      <aside aria-label="Sobre o estabelecimento"><article><h2><Store aria-hidden size={21} /> Sobre {tenant.name}</h2>
        {tenant.description && <p>{tenant.description}</p>}
        {tenant.address && <p><MapPin size={18} aria-hidden /> {tenant.address}</p>}
        {tenant.contactPhone && <p><a href={'https://wa.me/' + tenant.contactPhone}>Conversar pelo WhatsApp</a></p>}
        {hours.length > 0 && <details><summary>Horários de atendimento</summary><ul>{hours.map(row => <li key={[row.weekday, row.startMinute, row.endMinute].join(':')}>{weekdays[row.weekday - 1]} · {clock(row.startMinute)}–{clock(row.endMinute)}</li>)}</ul></details>}
        {(cover || gallery[0]) && <img className="cover" src={'/api/imagens/' + (cover ?? gallery[0].key)} alt={'Espaço de ' + tenant.name} />}
      </article></aside></div>
      {chosen && (image('SERVICE', chosen.id) || professional && image('PROFESSIONAL', professional.id)) && <article><h2>Serviço e profissional</h2>
        <div className="grid">
          {image('SERVICE', chosen.id) && <figure><img className="cover" src={'/api/imagens/' + image('SERVICE', chosen.id)} alt="" /><figcaption>{chosen.name}</figcaption></figure>}
          {professional && image('PROFESSIONAL', professional.id) && <figure><img className="cover" src={'/api/imagens/' + image('PROFESSIONAL', professional.id)} alt="" /><figcaption>{professional.name}</figcaption></figure>}
        </div>
      </article>}
      {gallery.length > 0 && <article><h2>Galeria</h2><div className="grid">{gallery.map(item => <img key={item.key} className="cover" src={'/api/imagens/' + item.key} alt={'Foto de ' + tenant.name} />)}</div></article>}
      {tenant.policies && <article><h2>Políticas de atendimento</h2><p className="preserve-lines">{tenant.policies}</p></article>}
      {design.layout === 'booking' && productsSection}
    </main>
  </div>
}
