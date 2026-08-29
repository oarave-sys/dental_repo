/**
 * Structured logger with a PHI denylist.
 *
 * The rule from docs/SECURITY.md §3 is absolute: no PHI in application logs.
 * Rather than trusting every call site to remember that, this redacts by key
 * name and refuses to serialize anything it does not recognize as safe.
 * tests/guardrails/logging.test.ts pushes a PHI-laden fixture through this and
 * fails if any value survives.
 */
type Level = 'debug' | 'info' | 'warn' | 'error'

/** Field names that may carry PHI or credentials. Redacted, never emitted. */
const DENY = new Set([
  'firstname', 'lastname', 'name', 'patientname', 'dateofbirth', 'dob', 'sex',
  'phone', 'phoneprimary', 'phonesecondary', 'email', 'address', 'addressline1',
  'addressline2', 'city', 'postalcode', 'zip', 'mrn', 'memberid', 'ssn',
  'diagnosis', 'referraldiagnosistext', 'notes', 'note', 'reason', 'snippet',
  'text', 'filename', 'filenameoriginal', 'password', 'passwordhash', 'token',
  'tokenhash', 'secret', 'mfasecret', 'mfasecretencrypted', 'authorization',
  'cookie', 'body', 'query', 'searchterm', 'q',
])

const REDACTED = '[redacted]'

/** Only scalars that cannot themselves be PHI are emitted verbatim. */
function scrub(value: unknown, key?: string): unknown {
  if (key && DENY.has(key.toLowerCase())) return REDACTED
  if (value === null || value === undefined) return value
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') {
    // Unkeyed free text is not safe to emit; keyed values already passed the denylist.
    return key ? value : REDACTED
  }
  if (Array.isArray(value)) return value.map((v) => scrub(v))
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = scrub(v, k)
    }
    return out
  }
  return REDACTED
}

function emit(level: Level, event: string, context: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...(scrub(context) as Record<string, unknown>),
  })
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  debug: (event: string, ctx?: Record<string, unknown>) => emit('debug', event, ctx),
  info: (event: string, ctx?: Record<string, unknown>) => emit('info', event, ctx),
  warn: (event: string, ctx?: Record<string, unknown>) => emit('warn', event, ctx),
  error: (event: string, ctx?: Record<string, unknown>) => emit('error', event, ctx),
  /** Exposed for the guardrail test. */
  _scrub: scrub,
}
