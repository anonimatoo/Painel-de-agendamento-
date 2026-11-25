import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

function key() {
  const value = process.env.CREDENTIAL_ENCRYPTION_KEY
  if (!value || !/^[a-f\d]{64}$/i.test(value)) throw new Error('Chave de criptografia indisponível')
  return Buffer.from(value, 'hex')
}

export function seal(value: string, context: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  cipher.setAAD(Buffer.from(context))
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), body].map(part => part.toString('base64url')).join('.')
}

export function unseal(value: string, context: string) {
  const [iv, tag, body] = value.split('.').map(part => Buffer.from(part, 'base64url'))
  const decipher = createDecipheriv('aes-256-gcm', key(), iv)
  decipher.setAAD(Buffer.from(context))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
}
