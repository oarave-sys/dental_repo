/**
 * Structured logger that refuses to emit clinical input.
 *
 * Users are told not to enter patient identifiers, but a log is the wrong
 * place to find out they did anyway. Rather than trusting every call site to
 * remember, this redacts by key name and will not serialise anything it does
 * not recognise as safe. Unkeyed free text is never emitted at all.
 *
 * tests/guardrails/logging.test.ts pushes a fixture full of clinical text and
 * identifiers through this and fails if any value survives.
 */
type Level = 'debug' | 'info' | 'warn' | 'error'

/**
 * Field names that may carry clinical input, patient identifiers or
 * credentials. Redacted, never emitted.
 */
const DENY = new Set([
  // Identity a user might paste in despite the warning.
  'firstname', 'lastname', 'name', 'patientname', 'dateofbirth', 'dob', 'sex',
  'phone', 'email', 'address', 'addressline1', 'addressline2', 'city',
  'postalcode', 'zip', 'mrn', 'memberid', 'subscriberid', 'ssn',
  // Clinical input and anything derived from it verbatim.
  'inputtext', 'input', 'description', 'clinicalnote', 'note', 'notes',
  'narrative', 'answer', 'question', 'content', 'text', 'reason', 'reasons',
  'snippet', 'prompt', 'completion', 'facts', 'result', 'diagnosis',
  // Credentials.
  'password', 'passwordhash', 'token', 'tokenhash', 'secret', 'apikey',
  'authorization', 'cookie', 'body', 'query', 'searchterm', 'q',
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
