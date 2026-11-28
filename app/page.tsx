import Link from 'next/link'
import { CalendarCheck2, Boxes, CreditCard, MessageCircle, UsersRound, Palette } from 'lucide-react'
import { db } from '@/lib/db'
import { PublicBrand } from './public-brand'
import { brl } from './ui'

export const dynamic = 'force-dynamic'
const features = [
  [CalendarCheck2,'Agendamentos online','Clientes escolhem horários livres, e você acompanha confirmações e cancelamentos.'],
  [CreditCard,'Recebimentos integrados','Receba pagamentos elegíveis por Stripe Checkout na conta do estabelecimento.'],
  [Boxes,'Produtos, serviços e estoque','Organize preços, publique itens e acompanhe movimentações e estoque mínimo.'],
  [MessageCircle,'Notificações por WhatsApp','Configure avisos e lembretes para atendimentos com autorização de contato.'],
  [UsersRound,'Equipe e clientes','Distribua horários por profissional e defina permissões de acesso.'],
  [Palette,'Página com sua identidade','Compartilhe uma página com suas fotos, horários e catálogo.']
] as const

export default async function Home() {
  const plans = await db.plan.findMany({where:{active:true},select:{id:true,name:true,description:true,monthlyCents:true,annualCents:true},orderBy:{monthlyCents:'asc'}})
  return <div className="commercial-home">
    <header><PublicBrand /><nav><a href="#recursos">Recursos</a><a href="#planos">Planos</a><Link href="/login">Entrar</Link></nav></header>
    <main>
      <section className="commercial-hero">
        <div><h1>Seu próximo atendimento começa aqui.</h1>
        <p>Gerencie a agenda, a equipe e as vendas do seu estabelecimento. Deixe seus clientes reservarem online, no horário que funciona para eles.</p>
        <div className="inline"><Link className="button" href="/cadastro">Criar minha conta</Link><a className="button outline" href="#recursos">Explorar recursos</a></div></div>
        <figure><img src="/marketing/recepcao-salao.webp" alt="Recepção de um salão de beleza" width={768} height={512} /></figure>
      </section>
      <section className="marketing commercial-section" id="recursos"><h2>Da reserva ao recebimento</h2><div className="grid">
        {features.map(([Icon,title,description]) => <article key={title}><Icon aria-hidden /><h3>{title}</h3><p>{description}</p></article>)}
      </div></section>
      <section className="marketing commercial-section" id="planos"><h2>Planos</h2>{plans.length ? <div className="grid">{plans.map(plan => <article key={plan.id}><h3>{plan.name}</h3><p>{plan.description}</p><strong>{brl(plan.monthlyCents)} por mês</strong><p>{brl(plan.annualCents)} por ano</p><Link href="/cadastro">Criar conta para assinar</Link></article>)}</div> : <p>Nenhum plano publicado no momento.</p>}</section>
      <section className="marketing commercial-section"><h2>Perguntas frequentes</h2>
        <details><summary>Como meus clientes reservam?</summary><p>Você compartilha seu endereço público. O cliente escolhe serviço, profissional e um horário disponível.</p></details>
        <details><summary>Como recebo pagamentos online?</summary><p>Vincule sua conta Stripe no painel de recebimentos. Os métodos disponíveis dependem da configuração e elegibilidade da conta.</p></details>
        <details><summary>Como configuro lembretes e o catálogo?</summary><p>Consulte as instruções na <Link href="/ajuda">central de ajuda</Link>.</p></details>
      </section>
    </main>
    <footer className="commercial-footer"><PublicBrand /><nav><Link href="/ajuda">Contato e suporte</Link><Link href="/termos">Termos de uso</Link><Link href="/privacidade">Privacidade</Link></nav></footer>
  </div>
}
