import type { Metadata } from 'next'
import './style.css'

export const metadata: Metadata = {
  title: 'CS Agenda Pro',
  description: 'Agendamento e gestão para salões, barbearias e profissionais da beleza.'
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><body>{children}</body></html>
}
