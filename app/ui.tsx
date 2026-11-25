import Link from 'next/link'
import { CalendarDays } from 'lucide-react'

export function Brand() {
  return <Link className="brand" href="/"><CalendarDays aria-hidden /> CS Agenda Pro</Link>
}

export function Field({ label, name, type = 'text', required = true, min, max, value }: {
  label: string; name: string; type?: string; required?: boolean; min?: number; max?: number; value?: string | number
}) {
  return <label>{label}<input name={name} type={type} required={required} min={min} max={max} defaultValue={value} /></label>
}

export function ErrorNote({ error }: { error?: string }) {
  return error ? <p className="error" role="alert">{error}</p> : null
}

export const brl = (cents: number) => Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
