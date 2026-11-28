import Link from 'next/link'
import { Brand } from '../ui'

export default function Help() {
  const contact = process.env.SUPPORT_EMAIL
  return <div className="site"><header><Brand /><Link href="/">Início</Link></header><main className="content help-content">
    <h1>Ajuda e suporte</h1>
    <article><h2>Comerciantes</h2><ol><li>Ative a assinatura no <Link href="/assinatura">painel da assinatura</Link>.</li><li>Cadastre serviços, profissionais e horários.</li><li>Compartilhe o endereço público e configure os recebimentos se quiser aceitar pagamento online.</li></ol></article>
    <article id="clientes"><h2>Clientes</h2><p>Abra o link enviado pelo estabelecimento para reservar ou comprar. Para dúvidas sobre horários, retirada e políticas, use os contatos da página do estabelecimento.</p></article>
    <article><h2>Contato</h2>{contact && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) ? <a href={'mailto:' + contact}>{contact}</a> : <p>O canal de suporte da plataforma ainda não está configurado.</p>}</article>
  </main></div>
}
