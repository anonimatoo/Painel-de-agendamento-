import Link from 'next/link'
import { finishTeamInvite } from '../actions'
import { Brand, ErrorNote, Field } from '../ui'

export default async function Invitation({ searchParams }: { searchParams: Promise<{ codigo?: string; erro?: string }> }) {
  const { codigo, erro } = await searchParams
  const token = typeof codigo === 'string' && /^[\w-]{43}$/.test(codigo) ? codigo : null
  return <div className="site"><header><Brand /></header><main className="center"><article>
    <h1>Convite para a equipe</h1><ErrorNote error={erro} />
    {token ? <form action={finishTeamInvite}>
      <input type="hidden" name="code" value={token} />
      <Field label="Crie uma senha com pelo menos 12 caracteres" name="password" type="password" />
      <button>Aceitar convite</button>
    </form> : <p>Solicite um link de convite ao administrador do estabelecimento.</p>}
    <Link href="/login">Voltar para entrar</Link>
  </article></main></div>
}
