import { loadEnvConfig } from '@next/env'
import { credentialKey } from '../lib/secrets'

async function run() {
  const current = process.env.CREDENTIAL_ENCRYPTION_KEY
  const next = process.env.CREDENTIAL_ENCRYPTION_NEXT_KEY
  const database = process.argv.find(arg => arg.startsWith('--database='))?.slice('--database='.length)
  const apply = process.argv.includes('--apply')
  if (!database || !/^[\w-]+$/.test(database) || (apply && !process.argv.includes('--backup-verified'))) throw new Error('Argumentos inválidos')
  loadEnvConfig(process.cwd(), false, { info() {}, error() {} })
  const first = credentialKey(current ?? '')
  const second = credentialKey(next ?? '')
  if (!process.env.DATABASE_URL) throw new Error('Banco ausente')
  const { db } = await import('../lib/db')
  try {
    const { rotateCredentials } = await import('../lib/rotate-credentials')
    const result = await rotateCredentials(database, first, second, apply)
    console.log(JSON.stringify({ applied: apply, ...result }))
  } finally {
    first.fill(0)
    second.fill(0)
    await db.$disconnect()
  }
}

run().catch(() => {
  console.error('Rotação interrompida. Confira banco autorizado, chaves, backup e processos ativos. Consulte o procedimento de recuperação.')
  process.exitCode = 1
})
