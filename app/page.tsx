import Link from 'next/link'
import { CalendarCheck, UsersRound, Store } from 'lucide-react'
import { Brand } from './ui'

export default function Home() {
  return <div className="site">
    <header><Brand /><nav><Link href="/planos">Planos</Link><Link href="/login">Entrar</Link></nav></header>
    <main>
      <section className="hero">
        <p className="eyebrow">Para salões, barbearias e profissionais da beleza</p>
        <h1>Seu próximo atendimento começa aqui.</h1>
        <p>Reúna sua agenda, equipe e serviços em um só lugar. Seus clientes escolhem um horário disponível e você acompanha as reservas em tempo real.</p>
        <Link className="button" href="/planos">Conhecer os planos</Link>
      </section>
      <section className="grid marketing" aria-label="Recursos">
        <article><CalendarCheck /><h2>Agenda online</h2><p>Defina a disponibilidade da equipe e receba reservas pela internet.</p></article>
        <article><UsersRound /><h2>Equipe e serviços</h2><p>Organize os profissionais e escolha quais serviços cada um realiza.</p></article>
        <article><Store /><h2>Página do estabelecimento</h2><p>Compartilhe um endereço próprio com seu catálogo e horários.</p></article>
      </section>
    </main>
  </div>
}
