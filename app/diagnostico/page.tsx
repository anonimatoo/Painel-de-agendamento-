import Link from 'next/link'
import { redirect } from 'next/navigation'
import { userSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { diagnostics } from '@/lib/diagnostics'
import { saveEvolutionSettings } from '../actions'
import { Brand, ErrorNote, Field } from '../ui'

export default async function Diagnostics({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const user = await userSession()
  if (!user?.platformAdmin || !user.adminMfaVerified) redirect('/login')
  const checks = await diagnostics()
  const saved = await db.evolutionSetting.findUnique({
    where: { id: 1 }, select: { endpoint: true, qrEnabled: true, checkedAt: true }
  }).catch(() => null)
  return <div className="site"><header><Brand /><Link href="/super-admin">Voltar à administração</Link></header>
    <main className="content"><h1>Diagnóstico das integrações</h1><ErrorNote error={(await searchParams).erro} />
      <section className="grid">{checks.map(check => <article key={check.name}><h2>{check.name}</h2><p>{check.status}</p></article>)}</section>
      <article><h2>Conexão central de WhatsApp</h2>
        <p>Cadastre o endereço habilitado pela equipe técnica. O provisionamento por QR é opcional e deve respeitar as políticas do WhatsApp.</p>
        <form action={saveEvolutionSettings}>
          <Field label="Endereço da integração" name="origin" type="url" value={saved?.endpoint ?? ''} />
          <Field label="Chave da integração" name="key" type="password" />
          <label className="check"><input name="qr" type="checkbox" defaultChecked={saved?.qrEnabled ?? false} /> Permitir conexão por QR no modo compatível</label>
          <Field label="Sua senha" name="password" type="password" /><button>Testar e salvar conexão</button>
        </form>
      </article>
    </main></div>
}
