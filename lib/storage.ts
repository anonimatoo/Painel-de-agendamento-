import { randomUUID } from 'node:crypto'
import { HeadBucketCommand, DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { MediaKind } from '@prisma/client'
import { db } from './db'
import sharp from 'sharp'
import { AgendaError } from './agenda'
import { productGallery, productMediaFilter, resolvePhotoLimit } from './product-gallery'

function storage() {
  const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) throw new AgendaError('O armazenamento de imagens está indisponível.')
  return {
    bucket: S3_BUCKET,
    client: new S3Client({
      endpoint: S3_ENDPOINT,
      region: S3_REGION ?? 'auto',
      forcePathStyle: true,
      credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY }
    })
  }
}

async function encodeImage(file: File) {
  if (!file.size || file.size > 4_000_000) throw new AgendaError('Envie uma imagem de até 4 MB.')
  const image = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 16_000_000 })
  return (async () => {
    try {
      const metadata = await image.metadata()
      if (!['jpeg','png','webp'].includes(metadata.format ?? '')) throw new Error()
      return await image.rotate().resize({ width: 1500, height: 1000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer()
    } catch {
      throw new AgendaError('Selecione uma imagem JPG, PNG ou WebP válida.')
    }
  })()
}

async function writeImage(key: string, buffer: Buffer) {
  const { client, bucket } = storage()
  try {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: 'image/webp' }), { abortSignal: AbortSignal.timeout(12_000) })
  } finally { client.destroy() }
  return key
}

export async function uploadCover(tenantId: string, file: File) {
  return writeImage(tenantId + '_' + randomUUID() + '.webp', await encodeImage(file))
}

async function removeImage(key: string) {
  const { client, bucket } = storage()
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(12_000) })
  } finally { client.destroy() }
}

async function releaseImage(key: string, attempts = 0) {
  try {
    // A timed-out commit might have stored this object successfully.
    const linked = await db.tenant.count({ where: { OR: [{ coverKey: key }, { media: { some: { key } } }] } })
    if (!linked) await removeImage(key)
    await db.mediaCleanup.deleteMany({ where: { key } })
  } catch {
    const nextAt = new Date(Date.now() + Math.min(60_000 * 2 ** attempts, 86_400_000))
    await db.mediaCleanup.updateMany({ where: { key, attempts }, data: { attempts: { increment: 1 }, nextAt } }).catch(() => {})
  }
}

export async function retryMediaCleanup(now = new Date()) {
  const rows = await db.mediaCleanup.findMany({ where: { nextAt: { lte: now } }, orderBy: { nextAt: 'asc' }, take: 20 })
  await Promise.all(rows.map(row => releaseImage(row.key, row.attempts)))
}

export async function storeMedia(tenantId: string, kind: MediaKind, target: string, file: File) {
  const buffer = await encodeImage(file)
  const dimensions = { kind, target, tenantId }
  let writtenKey: string | undefined
  const result = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`
    const productId = kind === 'PRODUCT' ? target.split(':')[0] : undefined
    const ownership = kind === 'PROFESSIONAL' ? await tx.professional.count({ where: { id: target, tenantId } })
      : kind === 'SERVICE' ? await tx.service.count({ where: { id: target, tenantId } })
        : productId ? await tx.product.count({ where: { id: productId, tenantId, archivedAt: null } }) : 1
    if (!ownership) throw new AgendaError('O item selecionado não está disponível.')
    const prior = await tx.mediaAsset.findUnique({ where: { tenantId_kind_target: dimensions } })
    let position: number | undefined
    if (productId) {
      const total = await tx.mediaAsset.aggregate({ where: { tenantId, kind: 'PRODUCT' }, _sum: { bytes: true } })
      if ((total._sum.bytes ?? 0) - (prior?.bytes ?? 0) + buffer.length > 512_000_000) {
        throw new AgendaError('O armazenamento do catálogo atingiu 512 MB. Remova fotos que não usa mais.')
      }
    }
    if (productId && !prior) {
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } })
      if (tenant.suspended) throw new AgendaError('Estabelecimento indisponível.')
      const assets = await tx.mediaAsset.findMany({ where: productMediaFilter(tenantId, productId) })
      const limit = await resolvePhotoLimit(tx, tenant)
      if (assets.length >= limit) throw new AgendaError('Este produto atingiu o limite de ' + limit + ' fotos.')
      position = Math.max(2, ...assets.map(asset => asset.position ?? 2)) + 1
    } else if (!productId) {
      const filter = { tenantId, kind: { not: 'PRODUCT' as const } }
      const count = await tx.mediaAsset.count({ where: filter })
      const total = await tx.mediaAsset.aggregate({ where: filter, _sum: { bytes: true } })
      if ((!prior && count >= 24) || (total._sum.bytes ?? 0) - (prior?.bytes ?? 0) + buffer.length > 12_000_000) {
        throw new AgendaError('O limite de imagens institucionais foi atingido.')
      }
    }
    const key = tenantId + '_' + randomUUID() + '.webp'
    writtenKey = key
    await writeImage(key, buffer)
    const values = { key, bytes: buffer.length, position }
    const asset = await tx.mediaAsset.upsert({ where: { tenantId_kind_target: dimensions }, create: { ...dimensions, ...values }, update: values })
    const tenant = kind === 'COVER' ? await tx.tenant.findUnique({ where: { id: tenantId }, select: { coverKey: true } }) : undefined
    if (tenant?.coverKey) await tx.tenant.update({ where: { id: tenantId }, data: { coverKey: null } })
    const obsolete = [prior?.key, tenant?.coverKey].filter((key): key is string => Boolean(key))
    if (obsolete.length) await tx.mediaCleanup.createMany({ data: obsolete.map(key => ({ key })), skipDuplicates: true })
    return { asset, obsolete }
  }, { timeout: 25_000 }).catch(async error => {
    if (writtenKey) {
      await db.mediaCleanup.upsert({ where: { key: writtenKey }, create: { key: writtenKey }, update: {} }).catch(() => {})
      await releaseImage(writtenKey)
    }
    throw error
  })
  await Promise.all(result.obsolete.map(key => releaseImage(key)))
  return result.asset
}

export async function orderProductPhotos(tenantId: string, productId: string, ids: string[]) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`
    const assets = await tx.mediaAsset.findMany({ where: productMediaFilter(tenantId, productId) })
    const valid = new Set(assets.map(asset => asset.id))
    if (ids.length !== valid.size || new Set(ids).size !== valid.size || ids.some(id => !valid.has(id))) {
      throw new AgendaError('A galeria mudou. Atualize a página antes de ordenar novamente.')
    }
    for (const [position, id] of ids.entries()) {
      await tx.mediaAsset.update({ where: { id }, data: { position } })
    }
  })
}

export async function addProductPhoto(tenantId: string, productId: string, file: File) {
  return storeMedia(tenantId, 'PRODUCT', productId + ':' + randomUUID(), file)
}

export async function productPhotos(tenantId: string, productId: string) {
  return productGallery(await db.mediaAsset.findMany({ where: productMediaFilter(tenantId, productId) }), productId)
}

export async function deleteMedia(tenantId: string, id: string) {
  const removed = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`
    const where = { id, tenantId }
    const item = await tx.mediaAsset.findFirst({ where, select: { key: true } })
    if (item) {
      await tx.mediaAsset.deleteMany({ where })
      await tx.mediaCleanup.upsert({ where: { key: item.key }, update: {}, create: { key: item.key } })
    }
    return item
  })
  if (removed) await releaseImage(removed.key)
}

export async function readCover(key: string) {
  const { client, bucket } = storage()
  try {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(12_000) })
    const stream = response.Body?.transformToWebStream()
    if (stream) return stream.pipeThrough(new TransformStream({ flush: () => client.destroy() }))
    client.destroy()
  } catch (error) {
    client.destroy()
    throw error
  }
}

export async function checkStorage() {
  const { client, bucket } = storage()
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: AbortSignal.timeout(6000) })
  } finally {
    client.destroy()
  }
}
