'use client'

import { useState } from 'react'

type Service = { id: string; label: string; professionals: { id: string; name: string }[] }

export function SlotPicker({ services, chosenId, professionalId, day, today }: {
  services: Service[]; chosenId: string; professionalId: string; day: string; today: string
}) {
  const [serviceId, setServiceId] = useState(chosenId)
  const [professional, setProfessional] = useState(professionalId)
  const service = services.find(s => s.id === serviceId)
  return <form method="get" className="inline">
    <label>Serviço<select name="servico" value={serviceId} onChange={event => { setServiceId(event.target.value); setProfessional('') }}>
      {services.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
    </select></label>
    <label>Profissional<select name="profissional" value={professional} onChange={event => setProfessional(event.target.value)} required>
      <option value="">Escolha um profissional</option>
      {service?.professionals.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}
    </select></label>
    <label>Data<input type="date" name="dia" defaultValue={day} min={today} required /></label>
    <button>Consultar horários</button>
  </form>
}
