import { describe, expect, it } from 'vitest'
import {
  REFERRAL_STATUSES, OPEN_STATUSES, TERMINAL_STATUSES,
  canTransition, allowedTransitions, transitionEffect, nextAction, STATUS_LABELS,
} from '@/lib/domain/referral-status'

describe('the status machine', () => {
  it('labels and next actions exist for every status', () => {
    for (const status of REFERRAL_STATUSES) {
      expect(STATUS_LABELS[status]).toBeTruthy()
      expect(nextAction(status)).toBeTruthy()
    }
  })

  it('treats scheduled and terminal statuses as closed work', () => {
    expect(OPEN_STATUSES).not.toContain('SCHEDULED')
    for (const t of TERMINAL_STATUSES) expect(OPEN_STATUSES).not.toContain(t)
    expect(OPEN_STATUSES).toContain('NEW')
    expect(OPEN_STATUSES).toContain('WAITING_ON_REFERRING_OFFICE')
  })

  it('walks the happy path', () => {
    const path = [
      'NEW', 'UNDER_REVIEW', 'READY_TO_CONTACT',
      'PATIENT_CONTACTED', 'READY_TO_SCHEDULE', 'SCHEDULED',
    ] as const
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i]!, path[i + 1]!), `${path[i]} -> ${path[i + 1]}`).toBe(true)
    }
  })

  it('refuses to skip the middle of the workflow', () => {
    expect(canTransition('NEW', 'SCHEDULED')).toBe(false)
    expect(canTransition('NEW', 'PATIENT_CONTACTED')).toBe(false)
    expect(canTransition('MISSING_INFORMATION', 'SCHEDULED')).toBe(false)
  })

  it('refuses a no-op transition', () => {
    for (const status of REFERRAL_STATUSES) expect(canTransition(status, status)).toBe(false)
  })

  it('lets any open referral be declined or closed', () => {
    for (const status of OPEN_STATUSES) {
      expect(canTransition(status, 'CLOSED'), status).toBe(true)
      expect(canTransition(status, 'NOT_ACCEPTED'), status).toBe(true)
    }
  })

  it('reopens terminal referrals through review rather than mid-workflow', () => {
    expect(canTransition('CLOSED', 'UNDER_REVIEW')).toBe(true)
    expect(canTransition('CLOSED', 'SCHEDULED')).toBe(false)
    expect(canTransition('NOT_ACCEPTED', 'READY_TO_SCHEDULE')).toBe(false)
  })

  it('offers a way out of every status', () => {
    for (const status of REFERRAL_STATUSES) {
      expect(allowedTransitions(status).length, status).toBeGreaterThan(0)
    }
  })
})

describe('transition effects', () => {
  it('stamps the workflow timestamp that matches the destination', () => {
    expect(transitionEffect('UNDER_REVIEW').setOnce.firstTriagedAt).toBe(true)
    expect(transitionEffect('PATIENT_CONTACTED').setOnce.firstContactedAt).toBe(true)
    expect(transitionEffect('SCHEDULED').setOnce.scheduledAt).toBe(true)
    expect(transitionEffect('DECLINED').setOnce.closedAt).toBe(true)
  })

  it('clears the closed timestamp when a referral comes back to life', () => {
    expect(transitionEffect('UNDER_REVIEW').clear).toContain('closedAt')
    expect(transitionEffect('SCHEDULED').clear).toContain('closedAt')
  })
})
