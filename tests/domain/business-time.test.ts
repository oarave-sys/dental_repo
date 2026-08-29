import { describe, expect, it } from 'vitest'
import {
  buildCalendar, businessSecondsBetween, businessDaysBetween,
  hasExceededBusinessDays, isBusinessDay, calendarDaysBetween, DEFAULT_WEEK,
} from '@/lib/domain/business-time'

const cal = buildCalendar({
  timezone: 'America/New_York',
  businessHours: DEFAULT_WEEK,
  holidays: ['2026-07-03'],
})

// 2026-03-02 is a Monday; 2026-03-07 a Saturday.
const at = (iso: string) => new Date(iso)

describe('business days', () => {
  it('counts weekdays and skips weekends', () => {
    expect(isBusinessDay(at('2026-03-02T14:00:00Z'), cal)).toBe(true)  // Mon
    expect(isBusinessDay(at('2026-03-07T14:00:00Z'), cal)).toBe(false) // Sat
    expect(isBusinessDay(at('2026-03-08T14:00:00Z'), cal)).toBe(false) // Sun
  })

  it('skips configured holidays', () => {
    expect(isBusinessDay(at('2026-07-03T14:00:00Z'), cal)).toBe(false)
    expect(isBusinessDay(at('2026-07-02T14:00:00Z'), cal)).toBe(true)
  })

  it('does not count a Friday-to-Monday gap as three business days', () => {
    // Friday 16:00 ET to Monday 09:00 ET.
    const friday = at('2026-03-06T21:00:00Z')
    const monday = at('2026-03-09T13:00:00Z')
    expect(businessDaysBetween(friday, monday, cal)).toBe(2) // Fri + Mon
    expect(hasExceededBusinessDays(friday, monday, 1, cal)).toBe(true)
    expect(hasExceededBusinessDays(friday, monday, 2, cal)).toBe(false)
  })
})

describe('business seconds', () => {
  it('is zero when the range runs entirely outside business hours', () => {
    // Saturday 10:00 ET to Sunday 10:00 ET.
    expect(businessSecondsBetween(
      at('2026-03-07T15:00:00Z'), at('2026-03-08T15:00:00Z'), cal,
    )).toBe(0)
  })

  it('counts only the part of the day inside the window', () => {
    // Monday 06:00 ET to Monday 10:00 ET; the window opens at 08:00.
    const seconds = businessSecondsBetween(
      at('2026-03-02T11:00:00Z'), at('2026-03-02T15:00:00Z'), cal,
    )
    expect(seconds).toBe(2 * 3600)
  })

  it('accumulates a full standard week', () => {
    // Monday 00:00 ET to Saturday 00:00 ET: four 9-hour days plus one 8.5-hour Friday.
    const seconds = businessSecondsBetween(
      at('2026-03-02T05:00:00Z'), at('2026-03-07T05:00:00Z'), cal,
    )
    expect(seconds).toBe((4 * 9 + 8.5) * 3600)
  })

  it('is zero for a reversed or empty range', () => {
    expect(businessSecondsBetween(at('2026-03-05T15:00:00Z'), at('2026-03-02T15:00:00Z'), cal)).toBe(0)
    expect(businessSecondsBetween(at('2026-03-02T15:00:00Z'), at('2026-03-02T15:00:00Z'), cal)).toBe(0)
  })

  it('stays correct across a daylight-saving transition', () => {
    // US DST began 2026-03-08. The following week is still five business days.
    const seconds = businessSecondsBetween(
      at('2026-03-09T04:00:00Z'), at('2026-03-14T04:00:00Z'), cal,
    )
    expect(seconds).toBe((4 * 9 + 8.5) * 3600)
  })
})

describe('calendar age', () => {
  it('measures plain elapsed days for the referral-age column', () => {
    expect(calendarDaysBetween(at('2026-03-01T00:00:00Z'), at('2026-03-09T00:00:00Z'))).toBe(8)
    expect(calendarDaysBetween(at('2026-03-09T00:00:00Z'), at('2026-03-01T00:00:00Z'))).toBe(0)
  })
})
