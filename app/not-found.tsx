import Link from 'next/link'

export default function NotFound() {
  return <main className="center"><article><h1>Página indisponível</h1><p>Confira o endereço e tente novamente.</p><Link className="button" href="/">Ir para o início</Link></article></main>
}
