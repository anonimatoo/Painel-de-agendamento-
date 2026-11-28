import { db } from './db'
import { evolutionConfiguration, probeEvolution } from './evolution-settings'
import { mailConfiguration } from './mail'
import { checkStorage } from './storage'
import { stripe } from './stripe'
import { connectStatus } from './connect'

async function probe(ready: boolean, execute: () => Promise<string>) {
  if (!ready) return 'Não configurado'
  try { return await execute() } catch { return 'Falha na verificação' }
}

export async function diagnostics() {
  const postgres = await probe(true, async () => { await db.$queryRaw`SELECT 1 AS connected`; return 'Conectado' })
  if (postgres !== 'Conectado') return [{ name: 'Banco de dados', status: postgres }]
  const [settings, connect, heartbeat, hooks, failures] = await Promise.all([
    db.stripeSettings.findUnique({ where: { id: 1 }, select: { id: true } }),
    db.tenant.findFirst({ where: { stripeAccountId: { not: null } }, select: { stripeAccountId: true } }),
    db.workerHeartbeat.findUnique({ where: { id: 1 } }),
    db.webhookEvent.groupBy({ by: ['source'], where: { source: { in: ['billing', 'connect'] } }, _max: { createdAt: true } }),
    db.reminder.count({ where: { deliveryState: 'FAILED' } })
  ])
  const [billing, payouts, evolution, resend, s3] = await Promise.all([
    probe(Boolean(settings || process.env.STRIPE_SECRET_KEY), async () => {
      const api = await stripe()
      await api.accounts.retrieve()
      await api.products.list({ limit: 1 })
      return 'Conectado · Sem cobrança de teste'
    }),
    probe(Boolean(connect?.stripeAccountId), async () => (await connectStatus(connect!.stripeAccountId!)).payments ? 'Conta consultada · Recebimentos habilitados' : 'Conta consultada · Cadastro ou recebimentos pendentes'),
    probe(true, async () => {
      const config = await evolutionConfiguration()
      if (!config.origin || !config.key) return 'Não configurado'
      return 'Conectado · ' + await probeEvolution(config.origin, config.key) + ' instância(s)'
    }),
    probe(true, async () => {
      const config = await mailConfiguration()
      if (!config) return 'Não configurado'
      const response = await fetch('https://api.resend.com/domains', {
        headers: { Authorization: 'Bearer ' + config.apiKey },
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(6000)
      })
      if (response.status === 403) return 'Configurado · Chave sem acesso à consulta de domínios'
      if (!response.ok) throw new Error('Falha no provedor')
      return 'Conectado · Aguardando homologação de envio'
    }),
    probe(Boolean(process.env.S3_BUCKET && process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY), async () => {
      await checkStorage()
      return 'Conectado · Aguardando homologação de persistência'
    })
  ])
  const alive = heartbeat && Date.now() - +heartbeat.seenAt < 60_000
  const hook = (source: string) => hooks.some(item => item.source === source && item._max.createdAt) ? 'Evento recebido · Confira os cenários de homologação' : 'Aguardando evento de homologação'
  return [
    { name: 'Banco de dados', status: postgres },
    { name: 'Stripe Billing', status: billing }, { name: 'Stripe Connect', status: payouts },
    { name: 'Webhook de assinatura', status: hook('billing') }, { name: 'Webhook de recebimentos', status: hook('connect') },
    { name: 'Evolution API', status: evolution + ' · ' + failures + ' falha(s) de envio registradas' },
    { name: 'Resend', status: resend },
    { name: 'Redis', status: alive ? 'Respondendo ao worker' : 'Sem confirmação recente do worker' },
    { name: 'Worker', status: alive ? 'Ativo recentemente' : 'Sem sinal recente' },
    { name: 'Armazenamento S3', status: s3 }
  ]
}
