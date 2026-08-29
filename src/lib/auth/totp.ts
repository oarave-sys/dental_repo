import { Secret, TOTP } from 'otpauth'
import { decryptSecret, encryptSecret } from './crypto'

/**
 * TOTP multi-factor authentication, required for every user (A-7).
 * A one-step window either side tolerates clock drift.
 */
const ISSUER = 'Referral OS'

export function generateTotpSecret(): { secret: string; encrypted: string } {
  const secret = new Secret({ size: 20 }).base32
  return { secret, encrypted: encryptSecret(secret) }
}

/**
 * The enrolment URI. Contains the user's email as the account label, which is
 * PII — it is rendered to the enrolling user and never logged or persisted.
 */
export function totpEnrolmentUri(email: string, secret: string): string {
  return new TOTP({
    issuer: ISSUER,
    label: email,
    secret: Secret.fromBase32(secret),
  }).toString()
}

export function verifyTotp(encryptedSecret: string, code: string): boolean {
  const normalized = code.replace(/\s+/g, '')
  if (!/^\d{6}$/.test(normalized)) return false
  try {
    const totp = new TOTP({ issuer: ISSUER, secret: Secret.fromBase32(decryptSecret(encryptedSecret)) })
    return totp.validate({ token: normalized, window: 1 }) !== null
  } catch {
    return false
  }
}
