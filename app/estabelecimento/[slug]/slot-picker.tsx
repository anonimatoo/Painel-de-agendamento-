'use client'

import { useState } from 'react'
import { ArrowRight, CalendarDays, Check, Scissors, UserRound } from 'lucide-react'

type Service = { id: string; name: string; price: string; duration: number; professionals: { id: string; name: string; photo?: string }[] }

export function SlotPicker({ services, chosenId, professionalId, day, today }: {
  services: Service[]; chosenId: string; professionalId: string; day: string; today: string
}) {
  const [serviceId, setServiceId] = useState(chosenId)
  const [professional, setProfessional] = useState(professionalId)
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
      <label>Escolha um dia<input type="date" name="dia" defaultValue={day} min={today} required /></label>
      <button>Consultar horários <ArrowRight size={17} aria-hidden /></button>
    </fieldset>
  </form>
}
