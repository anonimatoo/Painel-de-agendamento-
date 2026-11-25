'use client'

export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="center"><article><h1>Não foi possível carregar a página</h1><p>Tente novamente em instantes.</p><button onClick={reset}>Tentar novamente</button></article></main>
}
