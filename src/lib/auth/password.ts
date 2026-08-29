import { hash, verify } from '@node-rs/argon2'

/**
 * Argon2id. Parameters follow the OWASP Password Storage Cheat Sheet's
 * second recommended configuration (19 MiB, t=2, p=1).
 */
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS)
}

export async function verifyPassword(digest: string, plain: string): Promise<boolean> {
  try {
    return await verify(digest, plain, OPTIONS)
  } catch {
    // A malformed stored digest is a failed login, not a crash.
    return false
  }
}

export interface PasswordProblem {
  message: string
}

/**
 * Deliberately length-led rather than composition-led: NIST SP 800-63B
 * discourages arbitrary character-class rules and encourages longer secrets.
 */
export function validatePasswordStrength(plain: string): PasswordProblem | null {
  if (plain.length < 12) return { message: 'Use at least 12 characters.' }
  if (plain.length > 200) return { message: 'Use fewer than 200 characters.' }
  if (/^(.)\1+$/.test(plain)) return { message: 'Use something less repetitive.' }
  return null
}
