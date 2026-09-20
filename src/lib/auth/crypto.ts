import crypto from 'node:crypto'
import { AppError } from '@/lib/errors'

/**
 * Application-level encryption for values that must be reversible.
 *
 * Nothing in the MVP requires it — passwords are hashed with Argon2id and
 * session, invitation and reset tokens are HMACed, none of which round-trip.
 * It is kept because the first reversible secret (a stored integration
 * credential) should not arrive alongside a hand-rolled cipher.
 *
 * In production this key belongs in a KMS with envelope encryption. Deriving
 * it from SESSION_SECRET is a development convenience, listed in the
 * pre-production hardening steps in the README.
 */
function key(): Buffer {
  const secret = process.env.SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new AppError('INTERNAL', 'SESSION_SECRET is missing or too short.')
  }
  return crypto.createHash('sha256').update(`aead:${secret}`).digest()
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`
}

export function decryptSecret(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split('.')
  if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
    throw new AppError('INTERNAL', 'Stored secret is malformed.')
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key(),
    Buffer.from(ivB64, 'base64url'),
  )
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}

/** Session tokens are opaque; only this hash is stored. */
export function hashToken(token: string): string {
  const secret = process.env.SESSION_SECRET ?? ''
  return crypto.createHmac('sha256', secret).update(token).digest('hex')
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url')
}

/** IP addresses are identifiers; sessions store a hash, not the address. */
export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null
  return crypto
    .createHmac('sha256', process.env.SESSION_SECRET ?? '')
    .update(ip)
    .digest('hex')
    .slice(0, 32)
}
