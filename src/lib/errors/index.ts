/**
 * Structured application errors. Every error carries a code, an HTTP status,
 * and a message that is safe to show a user.
 *
 * Containment rule: `message` is rendered to the browser and written to logs.
 * It must never quote clinical input. Put identifiers in `meta`, which is
 * restricted to opaque IDs, enum values and field names. See docs/SECURITY.md.
 */
export type AppErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'TENANT_MISMATCH'
  | 'AI_UNAVAILABLE'
  | 'INTERNAL'

const STATUS: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  TENANT_MISMATCH: 403,
  AI_UNAVAILABLE: 503,
  INTERNAL: 500,
}

export class AppError extends Error {
  readonly code: AppErrorCode
  readonly status: number
  readonly meta: Record<string, string | number | boolean | null>

  constructor(
    code: AppErrorCode,
    message: string,
    meta: Record<string, string | number | boolean | null> = {},
  ) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.status = STATUS[code]
    this.meta = meta
  }
}

export const unauthenticated = (m = 'Sign in to continue.') => new AppError('UNAUTHENTICATED', m)
export const forbidden = (m = 'You do not have access to this.') => new AppError('FORBIDDEN', m)
export const notFound = (m = 'Not found.') => new AppError('NOT_FOUND', m)
export const conflict = (m: string) => new AppError('CONFLICT', m)
export const validation = (m: string, meta?: Record<string, string>) =>
  new AppError('VALIDATION', m, meta)
export const rateLimited = (m = 'Too many requests. Try again shortly.') =>
  new AppError('RATE_LIMITED', m)
export const tenantMismatch = () =>
  new AppError('TENANT_MISMATCH', 'That record belongs to a different organization.')

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError
}
