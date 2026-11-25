import Link from 'next/link'
import { account } from '../actions'
import { Brand, ErrorNote, Field } from '../ui'

export default async function Login({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  return <div className="site"><header><Brand /></header><main className="center"><article>
    <h1>Entrar</h1><ErrorNote error={(await searchParams).erro} />
    <form action={account.bind(null, 'login')}>
      <Field label="E-mail" name="email" type="email" /><Field label="Senha" name="password" type="password" /><details><summary>Acesso de Super Admin</summary><Field label="Código do autenticador" name="code" required={false} /></details><button>Entrar</button>
    </form><p><Link href="/conta">Esqueci minha senha</Link></p><p><Link href="/cadastro">Criar conta</Link></p>
  </article></main></div>
}
