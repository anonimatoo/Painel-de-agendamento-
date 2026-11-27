import { Secret, TOTP } from 'otpauth'
import QRCode from 'qrcode'

function authenticator(secret: string, email?: string) {
  return new TOTP({
    issuer: 'CS Agenda Pro', label: email, issuerInLabel: true,
    secret: Secret.fromBase32(secret), algorithm: 'SHA1', digits: 6, period: 30
  })
}

export function mfaUri(secret: string, email: string) {
  return authenticator(secret, email).toString()
}

export function mfaQr(secret: string, email: string) {
  return QRCode.toDataURL(mfaUri(secret, email), { width: 240, margin: 4, errorCorrectionLevel: 'M' })
}

export function acceptedMfaCounter(secret: string, code: string, now: number) {
  if (!/^\d{6}$/.test(code)) return null
  const offset = authenticator(secret).validate({ token: code, timestamp: now, window: 1 })
  return offset === null ? null : Math.floor(now / 30_000) + offset
}
