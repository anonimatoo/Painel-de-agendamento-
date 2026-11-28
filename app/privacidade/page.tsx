import Link from 'next/link'
import { Brand } from '../ui'

export default function Privacy() {
  return <div className="site"><header><Brand /><Link href="/ajuda">Ajuda</Link></header><main className="content help-content">
    <h1>Privacidade</h1>
    <article><h2>Dados usados para agendar</h2><p>O estabelecimento recebe os dados de contato necessários para prestar o atendimento. Atualizações por WhatsApp seguem as preferências informadas ao agendar. Pagamentos online elegíveis usam o Stripe Checkout.</p><p>Use os contatos do estabelecimento para tratar dos dados da sua reserva. A política de privacidade completa ainda não foi publicada.</p></article>
  </main></div>
}
