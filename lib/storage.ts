import { randomUUID } from 'node:crypto'
import { HeadBucketCommand, DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import type { MediaKind } from '@prisma/client'
import { db } from './db'
import sharp from 'sharp'
import { AgendaError } from './agenda'

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

async function writeImage(tenantId: string, buffer: Buffer) {
  const key = tenantId + '_' + randomUUID() + '.webp'
  const { client, bucket } = storage()
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: 'image/webp' }))
  return key
}

export async function uploadCover(tenantId: string, file: File) {
  return writeImage(tenantId, await encodeImage(file))
}

async function removeImage(key: string) {
  const { client, bucket } = storage()
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
}

async function releaseImage(key: string) {
  try { await removeImage(key) } catch { console.error('storage-object-cleanup') }
}

export async function storeMedia(tenantId: string, kind: MediaKind, target: string, file: File) {
  const buffer = await encodeImage(file)
  const dimensions = { kind, target, tenantId }
  const result = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`
    const ownership = kind === 'PROFESSIONAL' ? await tx.professional.count({ where: { id: target, tenantId } })
      : kind === 'SERVICE' ? await tx.service.count({ where: { id: target, tenantId } })
        : kind === 'PRODUCT' ? await tx.product.count({ where: { id: target, tenantId } }) : 1
    if (!ownership) throw new AgendaError('O item selecionado não está disponível.')
    const prior = await tx.mediaAsset.findUnique({ where: { tenantId_kind_target: dimensions } })
    const count = await tx.mediaAsset.count({ where: { tenantId } })
    const total = await tx.mediaAsset.aggregate({ where: { tenantId }, _sum: { bytes: true } })
    if ((!prior && count >= 24) || (total._sum.bytes ?? 0) - (prior?.bytes ?? 0) + buffer.length > 12_000_000 || buffer.length > 4_000_000) {
      throw new AgendaError('O limite de imagens do estabelecimento foi atingido.')
    }
    const key = await writeImage(tenantId, buffer)
    const values = { key, bytes: buffer.length }
    await tx.mediaAsset.upsert({ where: { tenantId_kind_target: dimensions }, create: { ...dimensions, ...values }, update: values })
    const tenant = kind === 'COVER' ? await tx.tenant.findUnique({ where: { id: tenantId }, select: { coverKey: true } }) : undefined
    if (tenant?.coverKey) await tx.tenant.update({ where: { id: tenantId }, data: { coverKey: null } })
    return [prior?.key, tenant?.coverKey]
  }, { timeout: 25_000 })
  await Promise.all(result.filter((key): key is string => Boolean(key)).map(releaseImage))
}

export async function deleteMedia(tenantId: string, id: string) {
  const removed = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`
    const where = { id, tenantId }
    const item = await tx.mediaAsset.findFirst({ where, select: { key: true } })
    if (item) await tx.mediaAsset.deleteMany({ where })
    return item
  })
  if (removed) await releaseImage(removed.key)
}

export async function readCover(key: string) {
  const { client, bucket } = storage()
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  return response.Body?.transformToWebStream()
}

export async function checkStorage() {
  const { client, bucket } = storage()
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }), { abortSignal: AbortSignal.timeout(6000) })
  } finally {
    client.destroy()
  }
}
