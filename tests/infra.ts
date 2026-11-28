import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { Queue, QueueEvents, Worker } from 'bullmq'
import sharp from 'sharp'
import { db } from '../lib/db'
import { deleteMedia, readCover, storeMedia } from '../lib/storage'

async function verifyQueue() {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:56379')
  const connection = {
    host: url.hostname, port: Number(url.port || 6379), db: Number(url.pathname.slice(1) || '0'), maxRetriesPerRequest: null,
    username: url.username || undefined, password: url.password || undefined,
    tls: url.protocol === 'rediss:' ? {} : undefined
  }
  const name = 'agenda-test-' + randomUUID()
  const queue = new Queue(name, { connection })
  const events = new QueueEvents(name, { connection })
  let executions = 0
  const worker = new Worker(name, async () => {
    executions++
    if (executions === 1) throw new Error('Retentativa de teste')
    return 'processed'
  }, { connection })
  try {
    await events.waitUntilReady()
    const options = { jobId: 'single', attempts: 2, backoff: { type: 'fixed', delay: 50 } }
    const initial = await queue.add('test', {}, options)
    const duplicate = await queue.add('test', {}, options)
    assert.equal(duplicate.id, initial.id)
    assert.equal(await initial.waitUntilFinished(events, 10_000), 'processed')
    assert.equal(executions, 2)
    assert.equal(await queue.getCompletedCount(), 1)
  } finally {
    await worker.close()
    await events.close()
    await queue.obliterate({ force: true })
    await queue.close()
  }
}

async function verifyStorage() {
  const first = await db.tenant.create({ data: { name: 'Mídia de teste', slug: randomUUID(), active: true } })
  const other = await db.tenant.create({ data: { name: 'Outra empresa', slug: randomUUID(), active: true } })
  const where = { tenantId: first.id, kind: 'LOGO' as const, target: '' }
  const createFile = async (background: string) => {
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background } }).png().toBuffer()
    return new File([new Uint8Array(png)], 'logo.png', { type: 'image/png' })
  }
  try {
    await storeMedia(first.id, 'LOGO', '', await createFile('#663399'))
    const logo = await db.mediaAsset.findFirstOrThrow({ where })
    const stream = await readCover(logo.key)
    assert.ok(stream)
    assert.equal((await sharp(Buffer.from(await new Response(stream).arrayBuffer())).metadata()).format, 'webp')
    await deleteMedia(other.id, logo.id)
    assert.ok(await db.mediaAsset.findFirst({ where }))
    await storeMedia(first.id, 'LOGO', '', await createFile('#222222'))
    const replaced = await db.mediaAsset.findFirstOrThrow({ where })
    assert.notEqual(replaced.key, logo.key)
    await assert.rejects(readCover(logo.key))
    await deleteMedia(first.id, replaced.id)
    await assert.rejects(readCover(replaced.key))
  } finally {
    for (const item of await db.mediaAsset.findMany({ where })) await deleteMedia(first.id, item.id)
    await db.tenant.deleteMany({ where: { id: { in: [first.id, other.id] } } })
  }
}

async function main() {
  await verifyQueue()
  console.log('Redis e BullMQ confirmaram retentativa e deduplicação.')
  await verifyStorage()
  console.log('O armazenamento S3 confirmou upload, leitura, substituição, exclusão e isolamento.')
}

main().finally(() => db.$disconnect()).catch(error => { console.error(error); process.exitCode = 1 })
