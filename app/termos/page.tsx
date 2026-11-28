import Link from 'next/link'
import { Brand } from '../ui'

export default function Terms() {
  return <div className="site"><header><Brand /><Link href="/ajuda">Ajuda</Link></header><main className="content help-content">
    <h1>Termos de uso</h1>
    <article><h2>Uso da plataforma</h2><p>O CS Agenda Pro permite que estabelecimentos publiquem serviços e produtos e administrem reservas. Os preços, horários e políticas de atendimento são informados pelo estabelecimento na sua página pública.</p><h2>Pagamentos e cancelamentos</h2><p>Consulte o método de pagamento, o total e as condições do estabelecimento antes de contratar. Pagamentos online elegíveis são encaminhados ao Stripe Checkout.</p><p>A versão contratual completa ainda não foi publicada.</p></article>
  </main></div>
}
