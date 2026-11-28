import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import { db } from '../lib/db'
import { DateTime } from 'luxon'
import { book } from '../lib/agenda'
import { randomUUID } from 'node:crypto'

async function serverMetrics(pid: number) {
  const status = await readFile('/proc/' + pid + '/status', 'utf8')
  const raw = await readFile('/proc/' + pid + '/stat', 'utf8')
  const stats = raw.slice(raw.lastIndexOf(') ') + 2).split(' ')
  return { rssKb: Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1]), cpuTicks: Number(stats[11]) + Number(stats[12]) }
}

async function main() {
  const base = new URL(process.env.APP_URL ?? '')
  const database = new URL(process.env.DATABASE_URL ?? '')
  const pid = Number(process.env.V3_LOAD_SERVER_PID)
  assert.equal(base.hostname, '127.0.0.1')
  assert.equal(database.hostname, '127.0.0.1')
  assert.equal(database.pathname, '/cs_v3_load')
  assert.ok(Number.isInteger(pid) && pid > 1)
  const suffix = randomUUID()
  const store = await db.tenant.create({ data: { slug: 'carga-' + suffix, name: 'Estabelecimento de carga', active: true } })
  const tenantId = store.id
  try {
    const service = await db.service.create({ data: { tenantId, name: 'Corte teste', duration: 45, cents: 10000 } })
    const professional = await db.professional.create({ data: { tenantId, name: 'Profissional teste' } })
    const day = DateTime.now().setZone(store.timezone).plus({ days: 2 }).startOf('day')
    const scope = { tenantId, serviceId: service.id, professionalId: professional.id }
    await db.assignment.create({ data: scope })
    await db.workHours.create({ data: { tenantId, professionalId: professional.id, weekday: day.weekday, startMinute: 540, endMinute: 585 } })
    const route = new URL('/estabelecimento/' + store.slug, base)
    const concurrency = [10, 50, 100, ...(process.argv.includes('--500') ? [500] : [])]
    for (const concurrent of concurrency) {
      await (await fetch(route)).body?.cancel()
      const initial = await serverMetrics(pid)
      const start = performance.now()
      const latencies: number[] = []
      let errors = 0
      let pgMax = 0
      let queries = Promise.resolve()
      const sample = setInterval(() => {
        queries = db.$queryRaw<{ count: number }[]>`
          SELECT count(*)::int FROM pg_stat_activity WHERE datname = current_database() AND backend_type = 'client backend'
        `.then(([row]) => { pgMax = Math.max(pgMax, row.count) })
      }, 500)
      try {
        await Promise.all(Array.from({ length: concurrent }, async () => {
          do {
            const sent = performance.now()
            try {
              const response = await fetch(route, { signal: AbortSignal.timeout(12_000), redirect: 'error' })
              await response.arrayBuffer()
              if (!response.ok) errors++
            } catch { errors++ }
            latencies.push(performance.now() - sent)
          } while (performance.now() - start < 5000)
        }))
      } finally {
        clearInterval(sample)
        await queries
      }
      const end = await serverMetrics(pid)
      latencies.sort((a, b) => a - b)
      const percentile = (p: number) => Math.round(latencies[Math.ceil(latencies.length * p) - 1])
      console.log(JSON.stringify({ concurrent, requests: latencies.length, errors,
        meanMs: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
        p95Ms: percentile(.95), p99Ms: percentile(.99), pgMax,
        firstRssKb: initial.rssKb, lastRssKb: end.rssKb, cpuTicks: end.cpuTicks - initial.cpuTicks,
        elapsedMs: Math.round(performance.now() - start) }))
    }
    const startsAt = day.set({ hour: 9 }).toUTC().toISO()!
    const races = await Promise.allSettled(Array.from({ length: 100 }, (_, i) => book(store, {
      ...scope, online: false, consent: false, startsAt, name: 'Cliente de carga', phone: '5511999991' + String(i).padStart(3, '0')
    })))
    const bookings = await db.appointment.count({ where: { tenantId, status: 'CONFIRMED' } })
    assert.equal(races.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(bookings, 1)
    assert.equal(await db.appointment.count({ where: { tenantId, paidAt: { not: null } } }), 0)
    console.log(JSON.stringify({ competingReservations: 100, bookings, syntheticPayments: 0 }))
  } finally {
    await db.$transaction([
      db.appointment.deleteMany({ where: { tenantId } }), db.customer.deleteMany({ where: { tenantId } }),
      db.assignment.deleteMany({ where: { tenantId } }), db.workHours.deleteMany({ where: { tenantId } }),
      db.professional.deleteMany({ where: { tenantId } }), db.service.deleteMany({ where: { tenantId } }),
      db.tenant.delete({ where: { id: tenantId } })
    ])
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => db.$disconnect())
