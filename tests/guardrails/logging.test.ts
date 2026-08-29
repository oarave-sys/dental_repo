import { describe, expect, it, vi, afterEach } from 'vitest'
import { logger } from '@/lib/logging/logger'

/**
 * The rule from docs/SECURITY.md §3 is absolute: no PHI in application logs.
 * This pushes a PHI-laden fixture through the logger and fails if any value
 * survives — so the rule is enforced by CI rather than by memory.
 */
const PHI = {
  firstName: 'Eleanor',
  lastName: 'Vance',
  dateOfBirth: '1954-03-12',
  phonePrimary: '555-0201',
  email: 'eleanor.vance@example.com',
  addressLine1: '14 Willow Lane',
  mrn: 'MRN-004821',
  memberId: 'MBR100001',
  diagnosis: 'Seropositive rheumatoid arthritis',
  notes: 'Patient reports morning stiffness lasting two hours.',
  filenameOriginal: 'VANCE_ELEANOR_031254.pdf',
  password: 'correct-horse-battery-staple',
  tokenHash: 'deadbeef',
}

const FORBIDDEN = Object.values(PHI)

afterEach(() => vi.restoreAllMocks())

function capture(fn: () => void): string {
  const lines: string[] = []
  vi.spyOn(console, 'log').mockImplementation((l) => lines.push(String(l)))
  vi.spyOn(console, 'warn').mockImplementation((l) => lines.push(String(l)))
  vi.spyOn(console, 'error').mockImplementation((l) => lines.push(String(l)))
  fn()
  return lines.join('\n')
}

describe('the logger', () => {
  it('emits no PHI value, at any nesting depth', () => {
    const output = capture(() => {
      logger.info('referral.viewed', {
        referralId: 'b1faecf0-e313-4d6a-a128-33cc4c78cb3e',
        patient: PHI,
        nested: { deeper: { alsoPatient: PHI } },
        list: [PHI],
      })
    })
    for (const value of FORBIDDEN) {
      expect(output, `leaked: ${value}`).not.toContain(value)
    }
  })

  it('still emits the identifiers that make a log useful', () => {
    const output = capture(() => {
      logger.warn('action.rejected', {
        referralId: 'b1faecf0-e313-4d6a-a128-33cc4c78cb3e',
        organizationId: '11111111-1111-1111-1111-111111111111',
        code: 'FORBIDDEN',
        attempt: 3,
        blocked: true,
      })
    })
    expect(output).toContain('b1faecf0-e313-4d6a-a128-33cc4c78cb3e')
    expect(output).toContain('FORBIDDEN')
    expect(output).toContain('"attempt":3')
    expect(output).toContain('"blocked":true')
  })

  it('redacts unkeyed free text rather than trusting it', () => {
    expect(logger._scrub('Patient reports chest pain')).toBe('[redacted]')
    expect(logger._scrub('anything', 'code')).toBe('anything')
  })

  it('emits valid JSON with a level and a timestamp', () => {
    const output = capture(() => logger.error('boom', { code: 'INTERNAL' }))
    const parsed = JSON.parse(output)
    expect(parsed.level).toBe('error')
    expect(parsed.event).toBe('boom')
    expect(typeof parsed.ts).toBe('string')
  })
})
