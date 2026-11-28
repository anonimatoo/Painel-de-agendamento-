'use client'

import { useState } from 'react'
import { DateTime } from 'luxon'
import { ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, Scissors, UserRound } from 'lucide-react'

type Service = { id: string; name: string; price: string; duration: number; professionals: { id: string; name: string; photo?: string }[] }

export function SlotPicker({ services, chosenId, professionalId, day, today }: {
  services: Service[]; chosenId: string; professionalId: string; day: string; today: string
}) {
  const [serviceId, setServiceId] = useState(chosenId)
  const [professional, setProfessional] = useState(professionalId)
  const minimum = DateTime.fromISO(today, { zone: 'UTC', locale: 'pt-BR' })
  const maximum = minimum.plus({ days: 90 })
  const initial = DateTime.fromISO(day, { zone: 'UTC', locale: 'pt-BR' })
  const [date, setDate] = useState(initial.isValid && initial >= minimum && initial <= maximum ? day : today)
  const [month, setMonth] = useState(() => DateTime.fromISO(date, { zone: 'UTC', locale: 'pt-BR' }).startOf('month'))
  const first = month.startOf('week')
  const days = Array.from({ length: Math.ceil(month.endOf('month').diff(first, 'days').days / 7) * 7 }, (_, i) => first.plus({ days: i }))
  const service = services.find(s => s.id === serviceId)
  return <form method="get" className="booking-columns">
    <fieldset><legend><Scissors size={18} aria-hidden /> Serviço</legend>
      {services.map(row => <label className="booking-choice" key={row.id}>
        <input type="radio" name="servico" value={row.id} checked={serviceId === row.id} onChange={() => { setServiceId(row.id); setProfessional('') }} />
        <span><strong>{row.name}</strong><small>{row.duration} min · {row.price}</small></span><Check className="selection-check" size={17} aria-hidden />
      </label>)}
    </fieldset>
    <fieldset><legend><UserRound size={18} aria-hidden /> Profissional</legend>
      {service?.professionals.map(row => <label className="booking-choice" key={row.id}>
        <input type="radio" name="profissional" value={row.id} checked={professional === row.id} onChange={() => setProfessional(row.id)} required />
        {row.photo && <img src={row.photo} alt="" width={34} height={34} />}
        <span>{row.name}</span><Check className="selection-check" size={17} aria-hidden />
      </label>)}
    </fieldset>
    <fieldset><legend><CalendarDays size={18} aria-hidden /> Data</legend>
      <div className="booking-calendar">
        <div className="booking-calendar-head">
          <button type="button" className="outline" aria-label="Mês anterior" disabled={+month <= +minimum.startOf('month')} onClick={() => setMonth(month.minus({ months: 1 }))}><ChevronLeft aria-hidden size={16} /></button>
          <strong aria-live="polite">{month.toFormat('MMMM yyyy')}</strong>
          <button type="button" className="outline" aria-label="Próximo mês" disabled={+month >= +maximum.startOf('month')} onClick={() => setMonth(month.plus({ months: 1 }))}><ChevronRight aria-hidden size={16} /></button>
        </div>
        <div className="booking-calendar-grid">
          {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map(name => <span key={name}>{name}</span>)}
          {days.map(value => {
            const selected = value.toISODate() === date
            return value.month === month.month
              ? <button key={value.toISODate()} type="button" aria-pressed={selected} aria-label={value.toFormat("dd 'de' MMMM 'de' yyyy")}
                disabled={value < minimum || value > maximum} onClick={() => setDate(value.toISODate()!)}>{value.day}</button>
              : <span key={value.toISODate()} />
          })}
        </div>
      </div>
      <label>Escolha um dia<input type="date" name="dia" value={date} min={today} max={maximum.toISODate()!} required onChange={event => {
        setDate(event.target.value)
        const next = DateTime.fromISO(event.target.value, { zone: 'UTC', locale: 'pt-BR' })
        if (next.isValid && next >= minimum && next <= maximum) setMonth(next.startOf('month'))
      }} /></label>
      <button>Consultar horários <ArrowRight size={17} aria-hidden /></button>
    </fieldset>
  </form>
}
