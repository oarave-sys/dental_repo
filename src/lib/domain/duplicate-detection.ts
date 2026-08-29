/**
 * Possible-duplicate detection (brief §9). Pure: candidates in, scores out.
 *
 * The system NEVER merges automatically. It surfaces a suspicion, shows what
 * matched, and lets a human decide. A wrong merge in a staging database is
 * recoverable; a wrong merge propagated into an EHR is not.
 */

export interface PersonRecord {
  id: string
  firstName: string
  lastName: string
  dateOfBirth: Date
  phonePrimary?: string | null
  phoneSecondary?: string | null
  addressLine1?: string | null
  postalCode?: string | null
  mrn?: string | null
}

export type MatchSignal =
  | 'MRN'
  | 'NAME_DOB'
  | 'DOB_PHONE'
  | 'DOB_ADDRESS'
  | 'NAME_PHONE'
  | 'FUZZY_NAME_DOB'

export interface DuplicateMatch {
  candidateId: string
  score: number
  signals: MatchSignal[]
  /** True when the evidence is strong enough to lead the review queue. */
  strong: boolean
}

const WEIGHTS: Record<MatchSignal, number> = {
  MRN: 100,
  NAME_DOB: 85,
  DOB_PHONE: 80,
  DOB_ADDRESS: 70,
  NAME_PHONE: 60,
  FUZZY_NAME_DOB: 55,
}

export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '')
}

/** Last 10 digits, so formatting and a country code do not defeat a match. */
export function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null
  const digits = value.replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : null
}

export function normalizeAddress(value: string | null | undefined): string | null {
  if (!value) return null
  const cleaned = value
    .toLowerCase()
    .replace(/\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|suite|ste|apt|apartment|unit|#)\b/g, '')
    .replace(/[^a-z0-9]/g, '')
  return cleaned.length > 0 ? cleaned : null
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  )
}

/**
 * Damerau-style closeness, capped at a small edit distance. Catches the
 * transpositions and dropped letters that fax OCR and hurried typing produce
 * without pulling unrelated names together.
 */
function closeEnough(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 2) return false
  const max = Math.max(a.length, b.length)
  if (max <= 4) return false
  const allowed = max <= 8 ? 1 : 2

  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      let v = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, dp[i - 2]![j - 2]! + 1)
      }
      dp[i]![j] = v
    }
  }
  return dp[a.length]![b.length]! <= allowed
}

export function scoreMatch(subject: PersonRecord, candidate: PersonRecord): DuplicateMatch | null {
  if (subject.id === candidate.id) return null
  const signals: MatchSignal[] = []

  if (subject.mrn && candidate.mrn && subject.mrn === candidate.mrn) signals.push('MRN')

  const dobMatch = sameDay(subject.dateOfBirth, candidate.dateOfBirth)
  const first = normalizeName(subject.firstName)
  const last = normalizeName(subject.lastName)
  const cFirst = normalizeName(candidate.firstName)
  const cLast = normalizeName(candidate.lastName)
  const exactName = first === cFirst && last === cLast
  const fuzzyName = !exactName && closeEnough(first, cFirst) && closeEnough(last, cLast)

  if (dobMatch && exactName) signals.push('NAME_DOB')
  if (dobMatch && fuzzyName) signals.push('FUZZY_NAME_DOB')

  const phones = new Set(
    [subject.phonePrimary, subject.phoneSecondary].map(normalizePhone).filter(Boolean) as string[],
  )
  const cPhones = [candidate.phonePrimary, candidate.phoneSecondary]
    .map(normalizePhone)
    .filter(Boolean) as string[]
  const phoneMatch = cPhones.some((p) => phones.has(p))

  if (dobMatch && phoneMatch) signals.push('DOB_PHONE')
  if (!dobMatch && phoneMatch && (exactName || fuzzyName)) signals.push('NAME_PHONE')

  const addr = normalizeAddress(subject.addressLine1)
  const cAddr = normalizeAddress(candidate.addressLine1)
  const addressMatch =
    addr !== null &&
    addr === cAddr &&
    (!subject.postalCode || !candidate.postalCode || subject.postalCode === candidate.postalCode)
  if (dobMatch && addressMatch) signals.push('DOB_ADDRESS')

  if (signals.length === 0) return null

  // Strongest signal leads; corroborating signals add a little, with a ceiling.
  const sorted = signals.slice().sort((a, b) => WEIGHTS[b] - WEIGHTS[a])
  const lead = WEIGHTS[sorted[0]!]
  const corroboration = sorted.slice(1).reduce((sum, s) => sum + WEIGHTS[s] * 0.08, 0)
  const score = Math.min(99, Math.round(lead + corroboration))

  return { candidateId: candidate.id, score, signals: sorted, strong: score >= 80 }
}

export function findDuplicates(
  subject: PersonRecord,
  candidates: readonly PersonRecord[],
  threshold = 60,
): DuplicateMatch[] {
  return candidates
    .map((c) => scoreMatch(subject, c))
    .filter((m): m is DuplicateMatch => m !== null && m.score >= threshold)
    .sort((a, b) => b.score - a.score)
}

export const SIGNAL_LABELS: Record<MatchSignal, string> = {
  MRN: 'Same MRN',
  NAME_DOB: 'Same name and date of birth',
  DOB_PHONE: 'Same date of birth and phone',
  DOB_ADDRESS: 'Same date of birth and address',
  NAME_PHONE: 'Same name and phone',
  FUZZY_NAME_DOB: 'Similar name, same date of birth',
}
