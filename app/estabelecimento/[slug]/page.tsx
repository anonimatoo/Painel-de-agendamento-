import { randomUUID } from 'node:crypto'
import { notFound } from 'next/navigation'
import { DateTime } from 'luxon'
import { db } from '@/lib/db'
import { AgendaError, availability } from '@/lib/agenda'
import { SlotPicker } from './slot-picker'
import { joinWaitlist, reserve, retryPayment, shopCheckout } from '../../actions'
import { Brand, ErrorNote, Field, brl } from '../../ui'

export const dynamic = 'force-dynamic'

export default async function Establishment({ params, searchParams }: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ servico?: string; profissional?: string; dia?: string; erro?: string; reserva?: string; espera?: string; pedido?: string; pagamento?: string }>
}) {
  const { slug } = await params
  const query = await searchParams
  const tenant = await db.tenant.findFirst({
    where: { slug, active: true, suspended: false },
    include: {
      services: { where: { active: true, assignments: { some: { professional: { active: true } } } }, include: {
        assignments: { where: { professional: { active: true } }, include: { professional: true } }
      } },
      media: true,
      products: { where: { stock: { gt: 0 } } }
    }
  })
  if (!tenant) notFound()
  const image = (kind: string, target = '') => tenant.media.find(item => item.kind === kind && item.target === target)?.key
  const cover = image('COVER') ?? tenant.coverKey
  const banner = image('BANNER')
  const logo = image('LOGO')
  const gallery = tenant.media.filter(item => item.kind === 'GALLERY')
  const confirmed = typeof query.reserva === 'string' && query.reserva.length < 100 && query.reserva !== 'pagamento'
    ? await db.appointment.count({ where: { id: query.reserva, tenantId: tenant.id, status: 'CONFIRMED' } })
    : 0
  const paymentToken = typeof query.pagamento === 'string' && /^[a-f0-9-]{36}$/.test(query.pagamento) ? query.pagamento : undefined
  const payment = paymentToken ? await db.appointment.findFirst({
    where: { tenantId: tenant.id, paymentToken }, select: { status: true, checkoutState: true, expiresAt: true }
  }) : null
  const order = typeof query.pedido === 'string' && query.pedido.length < 100
    ? await db.shopOrder.findFirst({ where: { id: query.pedido, tenantId: tenant.id }, select: { status: true, paymentReview: true } }) : null
  const purchasable = tenant.stripeAccountId && tenant.products.some(product => (product.promotionCents ?? product.cents) > 0)
  const today = DateTime.now().setZone(tenant.timezone).toISODate()!
  const day = query.dia ?? today
  const chosen = tenant.services.find(s => s.id === query.servico) ?? tenant.services[0]
  const professional = chosen?.assignments.find(a => a.professionalId === query.profissional)?.professional
  let slots: Awaited<ReturnType<typeof availability>> = []
  let dateError: string | undefined
  if (chosen && professional) {
    try {
      slots = await availability(tenant, chosen.id, professional.id, day)
    } catch (error) {
      if (!(error instanceof AgendaError)) throw error
      dateError = error.message
    }
  }
  return <div className="site" style={{ '--accent': tenant.color } as React.CSSProperties}>
    <header><Brand /></header><main className="content booking">
      <section className={'public-title ' + (tenant.theme === 'dark' ? 'dark-profile' : '')}>
        {banner && <img className="cover" src={'/api/imagens/' + banner} alt="" />}
        {cover && <img className="cover" src={'/api/imagens/' + cover} alt="" />}
        {logo && <img width={64} height={64} className="profile-logo" src={'/api/imagens/' + logo} alt="" />}
        <h1>{tenant.name}</h1><p>{tenant.description}</p>{tenant.address && <p>{tenant.address}</p>}
        <nav className="inline" aria-label="Contato">
          {tenant.instagramUrl && <a href={tenant.instagramUrl} rel="noreferrer">Instagram</a>}
          {tenant.contactPhone && <a href={'https://wa.me/' + tenant.contactPhone} rel="noreferrer">WhatsApp</a>}
        </nav>
      </section>
      <ErrorNote error={query.erro ?? dateError} />
      {payment && <article><h2>Situação do pagamento</h2>
        <p role="status">{payment.status === 'CONFIRMED' ? 'Pagamento confirmado. Seu horário está reservado.' : payment.checkoutState === 'REVIEW' ? 'Pagamento em verificação. Entre em contato com o estabelecimento antes de pagar novamente.' : payment.status === 'CANCELED' ? 'O prazo para pagamento terminou.' : 'Aguardamos a confirmação do pagamento.'}</p>
        {paymentToken && payment.status === 'PENDING' && payment.checkoutState !== 'REVIEW' && payment.expiresAt && payment.expiresAt > new Date() &&
          <form action={retryPayment.bind(null, slug, paymentToken)}><button>Continuar pagamento</button></form>}
      </article>}
      {order && <p className="success" role="status">{order.paymentReview ? 'O pagamento está em verificação. Consulte o estabelecimento antes de pagar novamente.' : order.status === 'PAID' ? 'Pagamento do pedido confirmado. Combine a retirada com o estabelecimento.' : order.status === 'PENDING' ? 'Aguardando confirmação do pagamento do pedido.' : 'Este pedido foi cancelado ou estornado.'}</p>}
      {query.espera && <p className="success" role="status">Solicitação de lista de espera enviada.</p>}
      {confirmed > 0 && <p className="success" role="status">Seu agendamento foi confirmado.</p>}
      {query.reserva === 'pagamento' && <p className="success" role="status">Seu agendamento será confirmado após a validação do pagamento.</p>}
      <article><h2>Agendar atendimento</h2>
        {chosen ? <SlotPicker chosenId={chosen.id} professionalId={professional?.id ?? ''} day={day} today={today}
          services={tenant.services.map(s => ({
            id: s.id, label: s.name + ' · ' + brl(s.cents) + ' · ' + s.duration + ' min',
            professionals: s.assignments.map(a => ({ id: a.professionalId, name: a.professional.name }))
          }))} /> : <p>O estabelecimento ainda não abriu a agenda.</p>}
        {professional && chosen && !slots.length && !dateError && <>
          <p>Nenhum horário disponível nesta data.</p>
          <details><summary>Entrar na lista de espera</summary><form action={joinWaitlist.bind(null, slug)}>
            <input type="hidden" name="serviceId" value={chosen.id} /><input type="hidden" name="professionalId" value={professional.id} />
            <input type="hidden" name="day" value={day} /><Field label="Nome" name="name" />
            <Field label="Telefone com DDI para contato" name="phone" type="tel" /><button>Enviar solicitação</button>
          </form></details>
        </>}
        {!!slots.length && <form action={reserve.bind(null, slug)}>
          <input type="hidden" name="serviceId" value={chosen.id} /><input type="hidden" name="professionalId" value={professional!.id} />
          <label>Horário<select name="startsAt" required>{slots.map(s => <option key={s.start} value={s.start}>{s.label}</option>)}</select></label>
          <Field label="Nome" name="name" /><Field label="WhatsApp com DDI (ex. 5511999999999)" name="phone" type="tel" />
          <label className="check"><input type="checkbox" name="consent" /> Quero receber lembretes e atualizações deste atendimento pelo WhatsApp.</label>
          <button>{tenant.onlinePayment && chosen.cents > 0 ? 'Continuar para pagamento' : 'Confirmar agendamento'}</button>
        </form>}
      </article>
      {chosen && (image('SERVICE', chosen.id) || professional && image('PROFESSIONAL', professional.id)) && <article><h2>Serviço e profissional</h2>
        <div className="grid">
          {image('SERVICE', chosen.id) && <figure><img className="cover" src={'/api/imagens/' + image('SERVICE', chosen.id)} alt="" /><figcaption>{chosen.name}</figcaption></figure>}
          {professional && image('PROFESSIONAL', professional.id) && <figure><img className="cover" src={'/api/imagens/' + image('PROFESSIONAL', professional.id)} alt="" /><figcaption>{professional.name}</figcaption></figure>}
        </div>
      </article>}
      {gallery.length > 0 && <article><h2>Galeria</h2><div className="grid">{gallery.map(item => <img key={item.key} className="cover" src={'/api/imagens/' + item.key} alt={'Foto de ' + tenant.name} />)}</div></article>}
      {tenant.policies && <article><h2>Políticas de atendimento</h2><p className="preserve-lines">{tenant.policies}</p></article>}
      {tenant.products.length > 0 && <article><h2>Produtos disponíveis</h2>
        <ul>{tenant.products.map(product => <li key={product.id}>
          {image('PRODUCT', product.id) && <img className="catalog-photo" src={'/api/imagens/' + image('PRODUCT', product.id)} alt="" />}
          {product.name} · {brl(product.promotionCents ?? product.cents)}
        </li>)}</ul>
        {purchasable && <details><summary>Montar pedido para retirada</summary><form action={shopCheckout.bind(null, slug)}>
          <input type="hidden" name="requestId" value={randomUUID()} />
          {tenant.products.filter(product => (product.promotionCents ?? product.cents) > 0).map(product =>
            <Field key={product.id} label={'Unidades de ' + product.name} name={'product:' + product.id} type="number" min={0} max={Math.min(product.stock, 100)} value={0} />
          )}
          <Field label="Nome" name="name" /><Field label="Telefone com DDI para retirada" name="phone" type="tel" /><button>Ir para pagamento</button>
        </form></details>}
      </article>}
    </main>
  </div>
}
