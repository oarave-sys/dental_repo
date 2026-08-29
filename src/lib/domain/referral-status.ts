/**
 * The referral status machine (brief §7). Pure: no database, no clock.
 *
 * Transitions are explicit rather than "anything to anything" because the
 * timeline is an operational record. A referral that jumps from NEW to
 * SCHEDULED without passing through review is either a data-entry mistake or a
 * process someone should be asked about — the machine surfaces both.
 */
export const REFERRAL_STATUSES = [
  'NEW',
  'UNDER_REVIEW',
  'MISSING_INFORMATION',
  'WAITING_ON_REFERRING_OFFICE',
  'READY_TO_CONTACT',
  'PATIENT_CONTACTED',
  'READY_TO_SCHEDULE',
  'SCHEDULED',
  'DECLINED',
  'UNABLE_TO_REACH',
  'NOT_ACCEPTED',
  'CLOSED',
] as const

export type ReferralStatus = (typeof REFERRAL_STATUSES)[number]

/** Terminal states. A referral leaves these only by being reopened to UNDER_REVIEW. */
export const TERMINAL_STATUSES: readonly ReferralStatus[] = [
  'DECLINED',
  'UNABLE_TO_REACH',
  'NOT_ACCEPTED',
  'CLOSED',
]

/** Statuses that count as open work in the inbox and the exception dashboard. */
export const OPEN_STATUSES: readonly ReferralStatus[] = REFERRAL_STATUSES.filter(
  (s) => !TERMINAL_STATUSES.includes(s) && s !== 'SCHEDULED',
)

/** Any open referral may be closed out or declined; those edges are implicit. */
const ALWAYS_AVAILABLE: readonly ReferralStatus[] = [
  'DECLINED',
  'NOT_ACCEPTED',
  'CLOSED',
]

const EDGES: Record<ReferralStatus, readonly ReferralStatus[]> = {
  NEW: ['UNDER_REVIEW', 'MISSING_INFORMATION', 'READY_TO_CONTACT'],
  UNDER_REVIEW: ['MISSING_INFORMATION', 'READY_TO_CONTACT', 'READY_TO_SCHEDULE'],
  MISSING_INFORMATION: ['WAITING_ON_REFERRING_OFFICE', 'UNDER_REVIEW'],
  WAITING_ON_REFERRING_OFFICE: ['UNDER_REVIEW', 'MISSING_INFORMATION'],
  READY_TO_CONTACT: ['PATIENT_CONTACTED', 'UNABLE_TO_REACH', 'UNDER_REVIEW'],
  PATIENT_CONTACTED: ['READY_TO_SCHEDULE', 'UNABLE_TO_REACH', 'READY_TO_CONTACT'],
  READY_TO_SCHEDULE: ['SCHEDULED', 'PATIENT_CONTACTED', 'UNABLE_TO_REACH'],
  SCHEDULED: ['CLOSED', 'READY_TO_SCHEDULE'],
  // Terminal states reopen to review rather than jumping back into the middle
  // of the workflow, so the timeline shows the reopening explicitly.
  DECLINED: ['UNDER_REVIEW'],
  UNABLE_TO_REACH: ['READY_TO_CONTACT', 'UNDER_REVIEW'],
  NOT_ACCEPTED: ['UNDER_REVIEW'],
  CLOSED: ['UNDER_REVIEW'],
}

export function allowedTransitions(from: ReferralStatus): readonly ReferralStatus[] {
  const base = EDGES[from]
  if (TERMINAL_STATUSES.includes(from)) return base
  return [...new Set([...base, ...ALWAYS_AVAILABLE])]
}

export function canTransition(from: ReferralStatus, to: ReferralStatus): boolean {
  if (from === to) return false
  return allowedTransitions(from).includes(to)
}

export interface TransitionEffect {
  /** Workflow timestamps set by this transition, if not already set. */
  setOnce: Partial<Record<
    'firstTriagedAt' | 'firstContactedAt' | 'readyToScheduleAt' | 'scheduledAt' | 'closedAt',
    true
  >>
  clear: readonly ('closedAt' | 'scheduledAt')[]
}

/**
 * What a transition does to the referral's workflow timestamps.
 * "Set once" is deliberate: reopening a referral must not erase the fact that
 * it was first triaged on a Tuesday in March.
 */
export function transitionEffect(to: ReferralStatus): TransitionEffect {
  switch (to) {
    case 'UNDER_REVIEW':
      return { setOnce: { firstTriagedAt: true }, clear: ['closedAt'] }
    case 'PATIENT_CONTACTED':
      return { setOnce: { firstContactedAt: true }, clear: [] }
    case 'READY_TO_SCHEDULE':
      return { setOnce: { readyToScheduleAt: true }, clear: [] }
    case 'SCHEDULED':
      return { setOnce: { scheduledAt: true }, clear: ['closedAt'] }
    case 'DECLINED':
    case 'NOT_ACCEPTED':
    case 'UNABLE_TO_REACH':
    case 'CLOSED':
      return { setOnce: { closedAt: true }, clear: [] }
    default:
      return { setOnce: {}, clear: ['closedAt'] }
  }
}

export const STATUS_LABELS: Record<ReferralStatus, string> = {
  NEW: 'New',
  UNDER_REVIEW: 'Under review',
  MISSING_INFORMATION: 'Missing information',
  WAITING_ON_REFERRING_OFFICE: 'Waiting on referring office',
  READY_TO_CONTACT: 'Ready to contact',
  PATIENT_CONTACTED: 'Patient contacted',
  READY_TO_SCHEDULE: 'Ready to schedule',
  SCHEDULED: 'Scheduled',
  DECLINED: 'Declined',
  UNABLE_TO_REACH: 'Unable to reach',
  NOT_ACCEPTED: 'Not accepted',
  CLOSED: 'Closed',
}

/** What a coordinator should do next. Drives the inbox's "next action" column. */
export function nextAction(status: ReferralStatus): string {
  switch (status) {
    case 'NEW': return 'Start review'
    case 'UNDER_REVIEW': return 'Complete review'
    case 'MISSING_INFORMATION': return 'Request records'
    case 'WAITING_ON_REFERRING_OFFICE': return 'Follow up with office'
    case 'READY_TO_CONTACT': return 'Call patient'
    case 'PATIENT_CONTACTED': return 'Confirm readiness'
    case 'READY_TO_SCHEDULE': return 'Schedule appointment'
    case 'SCHEDULED': return 'Link EHR patient'
    default: return 'No action needed'
  }
}
