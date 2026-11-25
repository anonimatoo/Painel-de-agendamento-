import { notFound } from 'next/navigation'
import { DateTime } from 'luxon'
import { db } from '@/lib/db'
import { AgendaError, availability } from '@/lib/agenda'
import { SlotPicker } from './slot-picker'
import { reserve } from '../../actions'
import { Brand, ErrorNote, Field, brl } from '../../ui'

export const dynamic = 'force-dynamic'

export default async function Establishment({ params, searchParams }: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ servico?: string; profissional?: string; dia?: string; erro?: string; reserva?: string }>
}) {
  const { slug } = await params
  const query = await searchParams
  const tenant = await db.tenant.findFirst({
    where: { slug, active: true, suspended: false },
    include: {
      services: { where: { active: true, assignments: { some: { professional: { active: true } } } }, include: {
        assignments: { where: { professional: { active: true } }, include: { professional: true } }
      } },
      products: { where: { stock: { gt: 0 } } }
    }
  })
  if (!tenant) notFound()
  const confirmed = typeof query.reserva === 'string' && query.reserva.length < 100 && query.reserva !== 'pagamento'
    ? await db.appointment.count({ where: { id: query.reserva, tenantId: tenant.id, status: 'CONFIRMED' } })
    : 0
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
      <section className="public-title">{tenant.coverKey && <img className="cover" src={'/api/imagens/' + tenant.coverKey} alt="" />}<h1>{tenant.name}</h1><p>{tenant.description}</p>{tenant.address && <p>{tenant.address}</p>}</section>
      <ErrorNote error={query.erro ?? dateError} />
      {confirmed > 0 && <p className="success" role="status">Seu agendamento foi confirmado.</p>}
      {query.reserva === 'pagamento' && <p className="success" role="status">Seu agendamento será confirmado após a validação do pagamento.</p>}
      <article><h2>Agendar atendimento</h2>
        {chosen ? <SlotPicker chosenId={chosen.id} professionalId={professional?.id ?? ''} day={day} today={today}
          services={tenant.services.map(s => ({
            id: s.id, label: s.name + ' · ' + brl(s.cents) + ' · ' + s.duration + ' min',
            professionals: s.assignments.map(a => ({ id: a.professionalId, name: a.professional.name }))
          }))} /> : <p>O estabelecimento ainda não abriu a agenda.</p>}
        {professional && !slots.length && <p>Nenhum horário disponível nesta data.</p>}
        {!!slots.length && <form action={reserve.bind(null, slug)}>
          <input type="hidden" name="serviceId" value={chosen.id} /><input type="hidden" name="professionalId" value={professional!.id} />
          <label>Horário<select name="startsAt" required>{slots.map(s => <option key={s.start} value={s.start}>{s.label}</option>)}</select></label>
          <Field label="Nome" name="name" /><Field label="WhatsApp com DDI (ex. 5511999999999)" name="phone" type="tel" />
          <label className="check"><input type="checkbox" name="consent" /> Quero receber lembretes deste atendimento pelo WhatsApp.</label>
          <button>{tenant.onlinePayment && chosen.cents > 0 ? 'Continuar para pagamento' : 'Confirmar agendamento'}</button>
        </form>}
      </article>
      {tenant.products.length > 0 && <article><h2>Produtos disponíveis</h2><ul>{tenant.products.map(p => <li key={p.id}>{p.name} · {brl(p.promotionCents ?? p.cents)}</li>)}</ul></article>}
    </main>
  </div>
}
