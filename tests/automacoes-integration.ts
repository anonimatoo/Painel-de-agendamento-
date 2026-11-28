import { initialGraph } from '../lib/automation-graph'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { DateTime } from 'luxon'
import { book, availability } from '../lib/agenda'
import { db } from '../lib/db'

async function main() {
  const database = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid/invalid')
  const redis = new URL(process.env.REDIS_URL ?? 'redis://invalid')
  assert.equal(database.hostname, '127.0.0.1')
  assert.ok(['/cs_commercial_worker', '/cs_v3_worker', '/cs_v4_worker'].includes(database.pathname))
  assert.equal(redis.hostname, '127.0.0.1')
  assert.equal(redis.pathname, database.pathname === '/cs_v4_worker' ? '/12' : '/14')
  assert.equal(await db.tenant.count(), 0)
  const businessSuite = database.pathname === '/cs_v4_worker'
  const merchantPhone = '5511987654141'
  const consumerPhone = '5511998764141'
  const instance = 'wa-fixture-' + randomUUID()
  const store = await db.tenant.create({ data: { name: 'Estúdio de verificação', active: true, slug: instance,
    merchantNoticePhone: merchantPhone, whatsappInstance: instance, statusMessages: true } })
  const tenantId = store.id
  const received: { number: string; text: string }[] = []
  const provider = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/message/sendText/' + instance || req.headers.apikey !== 'evolution-fixture') {
      res.writeHead(404).end()
      return
    }
    let body = ''
    for await (const chunk of req) body += chunk
    received.push(JSON.parse(body))
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ key: { id: 'provider-' + received.length } }))
  })
  await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve))
  let worker: ReturnType<typeof spawn> | undefined
  let campaignUserId: string | undefined
  try {
    const service = await db.service.create({ data: { tenantId, name: 'Atendimento de teste', duration: 30, cents: 8000 } })
    const professional = await db.professional.create({ data: { tenantId, name: 'Profissional de teste' } })
    const future = DateTime.now().setZone(store.timezone).plus({ days: 2 })
    await db.assignment.create({ data: { tenantId, professionalId: professional.id, serviceId: service.id } })
    await db.workHours.create({ data: { tenantId, professionalId: professional.id, weekday: future.weekday, startMinute: 540, endMinute: 660 } })
    if (businessSuite) {
      const graph = { ...initialGraph, nodes: [initialGraph.nodes[0], {
        ...initialGraph.nodes[1], data: { action: 'WHATSAPP_REMINDER', minutes: 60 }
      }] }
      await db.automationRule.create({ data: { tenantId, name: 'Lembrete visual', enabled: true, trigger: 'CONFIRMED', graph } })
      const consumer = await db.user.create({ data: { email: randomUUID() + '@example.test' } })
      campaignUserId = consumer.id
      await db.consumerProfile.create({ data: { tenantId, userId: consumer.id, name: 'Autorizado', phone: consumerPhone,
        marketingPhone: consumerPhone, marketingPhoneAt: new Date() } })
      const campaign = await db.campaign.create({ data: { tenantId, channel: 'WHATSAPP', title: 'Campanha local', body: 'Conteúdo de teste' } })
      await db.campaignDelivery.create({ data: { tenantId, campaignId: campaign.id, userId: consumer.id } })
    }
    const slots = await availability(store, service.id, professional.id, future.toISODate()!)
    const data = { serviceId: service.id, professionalId: professional.id, name: 'Cliente de teste', online: false }
    await book(store, { ...data, startsAt: slots[0].start, phone: consumerPhone, consent: true })
    await book(store, { ...data, startsAt: slots[2].start, phone: '5511998764242', consent: false })
    worker = spawn(process.execPath, ['--import', 'tsx', 'worker/index.ts'], {
      env: { ...process.env, EVOLUTION_URL: 'http://127.0.0.1:' + (provider.address() as AddressInfo).port,
        EVOLUTION_API_KEY: 'evolution-fixture', STRIPE_SECRET_KEY: '' }, stdio: ['ignore', 'ignore', 'inherit']
    })
    const deadline = Date.now() + 25_000
    for (;;) {
      const delivered = await db.reminder.count({ where: { appointment: { tenantId }, deliveryState: 'SENT', providerMessageId: { not: null } } })
      const campaignSent = !businessSuite || await db.campaignDelivery.count({ where: { tenantId, state: 'ACCEPTED' } }) === 1
      const flowScheduled = !businessSuite || await db.automationRun.count({ where: { tenantId, state: 'SCHEDULED', reminder: { kind: 'CS_AUTOMATION' } } }) === 1
      if (delivered === 3 && campaignSent && flowScheduled) break
      if (worker.exitCode !== null || Date.now() > deadline) {
        const flows = await db.automationRun.groupBy({ by: ['state'], where: { tenantId }, _count: true })
        const campaigns = await db.campaignDelivery.groupBy({ by: ['state'], where: { tenantId }, _count: true })
        throw new Error(JSON.stringify({ delivered, flows, campaigns, received: received.length }))
      }
      await delay(150)
    }
    assert.equal(received.filter(item => item.number === merchantPhone).length, 2)
    assert.equal(received.filter(item => item.number === consumerPhone).length, businessSuite ? 2 : 1)
    assert.ok(received.filter(item => item.number === merchantPhone).every(item => !item.text.includes('Cliente de teste')))
    const merchant = await db.reminder.findMany({ where: { kind: 'MERCHANT_CONFIRMED', appointment: { tenantId } } })
    assert.equal(merchant.length, 2)
    assert.equal(new Set(merchant.map(item => item.dedupeKey)).size, 2)
    if (businessSuite) {
      assert.equal(await db.automationRun.count({ where: { tenantId, state: 'DISCARDED' } }), 1)
      assert.equal(received.filter(item => item.text.includes('Campanha local')).length, 1)
      console.log('CS Automation Pro: lembrete agendado somente com consentimento. Campanha WhatsApp em fila aceita uma vez pelo provedor simulado.')
    }
    console.log('BullMQ e Evolution simulada: duas mensagens ao comerciante, uma ao consumidor que consentiu e três aceites com referência.')
  } finally {
    if (worker && worker.exitCode === null) {
      const stopped = new Promise(resolve => worker?.once('exit', resolve))
      worker.kill('SIGTERM')
      await stopped
    }
    await new Promise<void>(resolve => provider.close(() => resolve()))
    await db.$transaction([
      db.automationRun.deleteMany({ where: { tenantId } }),
      db.reminder.deleteMany({ where: { appointment: { tenantId } } }),
      db.appointment.deleteMany({ where: { tenantId } }),
      db.customer.deleteMany({ where: { tenantId } }),
      db.assignment.deleteMany({ where: { tenantId } }),
      db.workHours.deleteMany({ where: { tenantId } }),
      db.professional.deleteMany({ where: { tenantId } }),
      db.service.deleteMany({ where: { tenantId } }),
      db.tenant.delete({ where: { id: tenantId } })
    ])
    if (campaignUserId) await db.user.delete({ where: { id: campaignUserId } })
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => db.$disconnect())
