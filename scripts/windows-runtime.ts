import { spawn, type ChildProcess } from 'node:child_process'
import { readFile, appendFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { setTimeout as wait } from 'node:timers/promises'
import { loadEnvConfig } from '@next/env'
import { Queue } from 'bullmq'

const children: ChildProcess[] = []
let ending = false
let startupPhase = 'carregar a configuração'
Object.assign(process.env, { NODE_ENV: 'production' })
loadEnvConfig(process.cwd(), false, { info() {}, error() {} })

async function status(message: string) {
  console.log(message)
  await mkdir('.local', { recursive: true })
  await appendFile('.local/windows-runtime.log', new Date().toISOString() + ' ' + message + '\n')
}

function own(args: string[]) {
  const processChild = spawn(process.execPath, args, { stdio: 'ignore', windowsHide: true })
  children.push(processChild)
  return new Promise<number>(resolve => {
    processChild.once('error', () => resolve(1))
    processChild.once('exit', code => resolve(code ?? 1))
  })
}

function shutdown() {
  if (ending) return
  ending = true
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill()
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

async function run() {
  if (process.platform !== 'win32' || Number(process.versions.node.split('.')[0]) < 22) throw new Error('Windows e Node compatível exigidos')
  const dbUrl = new URL(process.env.DATABASE_URL ?? '')
  const redis = new URL(process.env.REDIS_URL ?? '')
  const application = new URL(process.env.APP_URL ?? '')
  if (!['postgres:', 'postgresql:'].includes(dbUrl.protocol) || !['redis:', 'rediss:'].includes(redis.protocol) ||
      application.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(application.hostname) || application.pathname !== '/' ||
      application.username || application.password || application.search || application.hash ||
      !/^[a-f0-9]{64}$/i.test(process.env.CREDENTIAL_ENCRYPTION_KEY ?? '') || !process.env.APP_URL) throw new Error('Configuração inválida')
  const port = Number(application.port || 80)
  startupPhase = 'verificar processos e porta local'
  await new Promise<void>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => server.close(error => error ? reject(error) : resolve()))
  })

  startupPhase = 'verificar PostgreSQL e migrations'
  const { db } = await import('../lib/db')
  try {
    await db.$queryRaw`SELECT id FROM "Tenant" LIMIT 1`
    const pending = await db.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) FROM "_prisma_migrations" WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL`
    if (pending[0]?.count) throw new Error('Migration incompleta')
  } finally { await db.$disconnect() }
  if (await own(['node_modules/prisma/build/index.js', 'migrate', 'status']) !== 0) throw new Error('Migrations pendentes')

  startupPhase = 'verificar Redis'
  const queue = new Queue('agenda-bootstrap', { connection: {
    host: redis.hostname, port: Number(redis.port || 6379),
    username: decodeURIComponent(redis.username) || undefined, password: decodeURIComponent(redis.password) || undefined,
    db: Number(redis.pathname.slice(1) || '0'), tls: redis.protocol === 'rediss:' ? {} : undefined,
    connectTimeout: 5000, maxRetriesPerRequest: 0, retryStrategy: () => null
  } })
  queue.on('error', () => {})
  try { await queue.getWaitingCount() } finally { await queue.close() }

  startupPhase = 'preparar a compilação'
  if (process.argv.includes('--build')) {
    if (await own(['node_modules/prisma/build/index.js', 'generate']) !== 0 ||
        await own(['node_modules/next/dist/bin/next', 'build']) !== 0) throw new Error('Falha no build')
  }
  await readFile('.next/BUILD_ID')

  startupPhase = 'iniciar o servidor'
  const server = own(['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)])
  const endpoint = new URL('/api/saude', 'http://127.0.0.1:' + port)
  const healthy = (async () => {
    for (let attempt = 0; attempt < 40 && !ending; attempt++) {
      if (await fetch(endpoint, { signal: AbortSignal.timeout(1000), redirect: 'error' }).then(response => response.ok, () => false)) return true
      await wait(500)
    }
    return false
  })()
  if (!await Promise.race([healthy, server.then(() => false)])) throw new Error('HTTP indisponível')

  startupPhase = 'supervisionar o servidor e o worker'
  const child = spawn(process.execPath, ['--import', 'tsx', 'worker/index.ts'], {
    windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  })
  children.push(child)
  const worker = new Promise<void>(resolve => {
    child.once('error', () => resolve())
    child.once('exit', () => resolve())
  })
  const connected = new Promise<boolean>(resolve => child.on('message', value => { if (value === 'ready') resolve(true) }))
  if (!await Promise.race([connected, worker.then(() => false), server.then(() => false), wait(20_000, false, { ref: false })])) {
    throw new Error('Worker indisponível')
  }
  await status('Servidor HTTP e worker verificados.')
  await Promise.race([worker, server])
  if (!ending) throw new Error('Processo encerrou')
}

run().catch(async () => {
  if (!ending) {
    process.exitCode = 1
    await status('Falha ao ' + startupPhase + '.').catch(() => {})
  }
}).finally(shutdown)
