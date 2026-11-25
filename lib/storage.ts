import { randomUUID } from 'node:crypto'
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
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

export async function uploadCover(tenantId: string, file: File) {
  if (!file.size || file.size > 4_000_000) throw new AgendaError('Envie uma imagem de até 4 MB.')
  const image = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 16_000_000 })
  const buffer = await (async () => {
    try {
      const metadata = await image.metadata()
      if (!['jpeg','png','webp'].includes(metadata.format ?? '')) throw new Error()
      return await image.rotate().resize({ width: 1500, height: 1000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer()
    } catch {
      throw new AgendaError('Selecione uma imagem JPG, PNG ou WebP válida.')
    }
  })()
  const key = tenantId + '_' + randomUUID() + '.webp'
  const { client, bucket } = storage()
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: 'image/webp' }))
  return key
}

export async function readCover(key: string) {
  const { client, bucket } = storage()
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  return response.Body?.transformToWebStream()
}
