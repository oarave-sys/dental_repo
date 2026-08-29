/**
 * Business-day arithmetic over an organization's own calendar.
 *
 * Every SLA in the brief — "no activity > 1 business day", "waiting > 3 days" —
 * is uncomputable without a timezone, business hours and a holiday list
 * (docs/OPEN-QUESTIONS.md A-10). Pure: the clock is always passed in.
 */

/** Minutes from local midnight. `[540, 1020]` is 09:00–17:00. */
export type DayWindow = readonly [number, number] | null

export interface BusinessCalendar {
  timezone: string
  /** Index 0 = Sunday, matching Date.getDay(). */
  week: readonly [DayWindow, DayWindow, DayWindow, DayWindow, DayWindow, DayWindow, DayWindow]
  /** ISO dates, 'YYYY-MM-DD', in the organization's timezone. */
  holidays: ReadonlySet<string>
}

export const DEFAULT_WEEK = [
  null,            // Sun
  [480, 1020],     // Mon 08:00-17:00
  [480, 1020],
  [480, 1020],
  [480, 1020],
  [480, 990],      // Fri 08:00-16:30
  null,            // Sat
] as const

export function buildCalendar(input: {
  timezone: string
  businessHours?: unknown
  holidays?: readonly string[]
}): BusinessCalendar {
  const week = normalizeWeek(input.businessHours)
  return {
    timezone: input.timezone,
    week,
    holidays: new Set(input.holidays ?? []),
  }
}

function normalizeWeek(raw: unknown): BusinessCalendar['week'] {
  if (!Array.isArray(raw) || raw.length !== 7) return DEFAULT_WEEK as BusinessCalendar['week']
  const out = raw.map((d) => {
    if (!Array.isArray(d) || d.length !== 2) return null
    const [a, b] = d as [unknown, unknown]
    if (typeof a !== 'number' || typeof b !== 'number' || b <= a) return null
    return [a, b] as const
  })
  return out as unknown as BusinessCalendar['week']
}

/** Parts of an instant, in the calendar's timezone. */
function parts(at: Date, timezone: string): { iso: string; weekday: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  })
  const map: Record<string, string> = {}
  for (const p of fmt.formatToParts(at)) if (p.type !== 'literal') map[p.type] = p.value
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return {
    iso: `${map.year}-${map.month}-${map.day}`,
    weekday: weekdays.indexOf(map.weekday ?? 'Sun'),
    // Intl renders midnight as "24" in some locales/engines.
    minutes: (Number(map.hour) % 24) * 60 + Number(map.minute),
  }
}

export function isBusinessDay(at: Date, cal: BusinessCalendar): boolean {
  const p = parts(at, cal.timezone)
  return cal.week[p.weekday] !== null && !cal.holidays.has(p.iso)
}

const DAY_MS = 86_400_000

/**
 * Business seconds between two instants.
 *
 * Walks day by day rather than doing calendar arithmetic, which keeps daylight
 * saving transitions correct: the window is resolved in local time each day.
 * Ranges beyond `maxDays` are truncated — an "open for 400 days" referral is a
 * data problem, not a number anyone needs to the second.
 */
export function businessSecondsBetween(
  from: Date,
  to: Date,
  cal: BusinessCalendar,
  maxDays = 400,
): number {
  if (to <= from) return 0
  let total = 0
  let cursor = from
  let guard = 0

  while (cursor < to && guard++ < maxDays) {
    const p = parts(cursor, cal.timezone)
    const window = cal.week[p.weekday]
    if (window && !cal.holidays.has(p.iso)) {
      const [open, close] = window
      const dayStartMs = cursor.getTime() - p.minutes * 60_000
      const openAt = new Date(dayStartMs + open * 60_000)
      const closeAt = new Date(dayStartMs + close * 60_000)
      const start = cursor > openAt ? cursor : openAt
      const end = to < closeAt ? to : closeAt
      if (end > start) total += Math.floor((end.getTime() - start.getTime()) / 1000)
    }
    // Advance to the next local midnight.
    const next = new Date(cursor.getTime() - p.minutes * 60_000 + DAY_MS)
    cursor = next > cursor ? next : new Date(cursor.getTime() + DAY_MS)
  }
  return total
}

/** One full business day, used by the "untouched" exception card. */
export function businessDaysBetween(from: Date, to: Date, cal: BusinessCalendar): number {
  let count = 0
  let cursor = new Date(from.getTime())
  let guard = 0
  while (cursor < to && guard++ < 400) {
    const p = parts(cursor, cal.timezone)
    if (cal.week[p.weekday] !== null && !cal.holidays.has(p.iso)) count += 1
    cursor = new Date(cursor.getTime() - p.minutes * 60_000 + DAY_MS)
  }
  return count
}

export function hasExceededBusinessDays(
  since: Date,
  now: Date,
  days: number,
  cal: BusinessCalendar,
): boolean {
  return businessDaysBetween(since, now, cal) > days
}

/** Calendar-day age, for the plain "referral age" column. */
export function calendarDaysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / DAY_MS))
}
