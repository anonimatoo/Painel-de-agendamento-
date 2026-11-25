import Link from 'next/link'
import { account } from '../actions'
import { Brand, ErrorNote, Field } from '../ui'

export default async function Register({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  return <div className="site"><header><Brand /></header><main className="center"><article>
    <h1>Criar conta</h1><ErrorNote error={(await searchParams).erro} />
    <form action={account.bind(null, 'register')}>
      <Field label="Nome do estabelecimento" name="business" />
      <Field label="Endereço da página (ex. studio-clara)" name="link" />
      <Field label="E-mail" name="email" type="email" /><Field label="Senha (mínimo 12 caracteres)" name="password" type="password" /><button>Criar conta</button>
    </form><p><Link href="/login">Já tenho conta</Link></p>
  </article></main></div>
}
