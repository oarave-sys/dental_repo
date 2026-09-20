import { describe, expect, it } from 'vitest'
import { logger } from '@/lib/logging/logger'

/**
 * Users are told not to enter patient identifiers. A log is the wrong place to
 * discover that somebody did it anyway, so the logger refuses to emit anything
 * it is not sure about. This test pushes a deliberately awful payload through
 * it and fails if any of it survives.
 */
describe('the logger refuses clinical input and identifiers', () => {
  const payload = {
    organizationId: 'org-123',
    tool: 'FIND_CODE',
    durationMs: 42,
    codeCount: 2,
    // None of the following may ever appear in a log line.
    inputText: 'MOD composite #30 for Jane Smith DOB 01/02/1970',
    note: 'Patient reported pain in the lower left quadrant',
    patientName: 'Jane Smith',
    dob: '1970-01-02',
    memberId: 'MEM-99887',
    email: 'jane@example.com',
    password: 'hunter2hunter2',
    apiKey: 'sk-ant-secret',
    nested: {
      description: 'existing amalgam removed, recurrent decay',
      diagnosis: 'irreversible pulpitis',
    },
  }

  const scrubbed = JSON.stringify(logger._scrub(payload))

  it('keeps the non-identifying operational fields', () => {
    expect(scrubbed).toContain('org-123')
    expect(scrubbed).toContain('FIND_CODE')
    expect(scrubbed).toContain('42')
  })

  it('drops every clinical and identifying value', () => {
    for (const secret of [
      'Jane Smith',
      '01/02/1970',
      '1970-01-02',
      'MEM-99887',
      'jane@example.com',
      'hunter2hunter2',
      'sk-ant-secret',
      'lower left quadrant',
      'recurrent decay',
      'irreversible pulpitis',
      'MOD composite',
    ]) {
      expect(scrubbed, `leaked: ${secret}`).not.toContain(secret)
    }
  })

  it('redacts unkeyed free text rather than emitting it', () => {
    expect(logger._scrub('some free text')).toBe('[redacted]')
  })

  it('redacts values of unrecognised object shapes', () => {
    const out = JSON.stringify(logger._scrub({ weird: new Map([['a', 'b']]) }))
    expect(out).not.toContain('a')
  })
})
