import { describe, expect, it } from 'vitest'
import {
  findDuplicates, scoreMatch, normalizePhone, normalizeAddress, normalizeName,
  type PersonRecord,
} from '@/lib/domain/duplicate-detection'

const person = (over: Partial<PersonRecord> & { id: string }): PersonRecord => ({
  firstName: 'Marcus',
  lastName: 'Delgado',
  dateOfBirth: new Date('1968-11-02T00:00:00Z'),
  phonePrimary: '555-0202',
  addressLine1: '221 Baker Street',
  postalCode: '12402',
  ...over,
})

describe('normalisation', () => {
  it('reduces phones to their last ten digits', () => {
    expect(normalizePhone('+1 (555) 020-2000')).toBe('5550202000')
    expect(normalizePhone('555-0202')).toBeNull() // too short to trust
  })

  it('ignores street-type words and punctuation in addresses', () => {
    expect(normalizeAddress('221 Baker Street')).toBe(normalizeAddress('221 Baker St.'))
    expect(normalizeAddress('221 Baker St, Apt 4')).toBe(normalizeAddress('221 Baker Street #4'))
  })

  it('strips accents and case from names', () => {
    expect(normalizeName('Sjögren')).toBe(normalizeName('sjogren'))
  })
})

describe('scoring', () => {
  it('never matches a record against itself', () => {
    expect(scoreMatch(person({ id: 'a' }), person({ id: 'a' }))).toBeNull()
  })

  it('scores an exact name and date of birth highly', () => {
    const match = scoreMatch(person({ id: 'a' }), person({ id: 'b' }))
    expect(match?.signals).toContain('NAME_DOB')
    expect(match?.strong).toBe(true)
  })

  it('catches a misspelled surname on the same date of birth', () => {
    const match = scoreMatch(
      person({ id: 'a', firstName: 'Marcus', lastName: 'Delgado' }),
      person({ id: 'b', firstName: 'Marcos', lastName: 'Delgado', phonePrimary: '555-020-2000' }),
    )
    expect(match?.signals).toContain('FUZZY_NAME_DOB')
  })

  it('does not confuse two different people who share a date of birth', () => {
    const match = scoreMatch(
      person({ id: 'a', firstName: 'Marcus', lastName: 'Delgado', phonePrimary: null, addressLine1: null }),
      person({ id: 'b', firstName: 'Priya', lastName: 'Raman', phonePrimary: null, addressLine1: null }),
    )
    expect(match).toBeNull()
  })

  it('does not match siblings at the same address with different birthdays', () => {
    const match = scoreMatch(
      person({ id: 'a', firstName: 'Ana', lastName: 'Ruiz', dateOfBirth: new Date('2001-05-05T00:00:00Z'), phonePrimary: null }),
      person({ id: 'b', firstName: 'Luis', lastName: 'Ruiz', dateOfBirth: new Date('2004-09-09T00:00:00Z'), phonePrimary: null }),
    )
    expect(match).toBeNull()
  })

  it('matches on a shared MRN above everything else', () => {
    const match = scoreMatch(
      person({ id: 'a', mrn: 'MRN-1', firstName: 'Robert', phonePrimary: null, addressLine1: null }),
      person({ id: 'b', mrn: 'MRN-1', firstName: 'Bob', lastName: 'Other', dateOfBirth: new Date('1900-01-01T00:00:00Z'), phonePrimary: null, addressLine1: null }),
    )
    expect(match?.signals[0]).toBe('MRN')
    expect(match?.score).toBeGreaterThanOrEqual(99)
  })

  it('never reaches a certain 100', () => {
    const match = scoreMatch(person({ id: 'a', mrn: 'M' }), person({ id: 'b', mrn: 'M' }))
    expect(match!.score).toBeLessThanOrEqual(99)
  })
})

describe('findDuplicates', () => {
  it('ranks strongest first and respects the threshold', () => {
    const subject = person({ id: 'subject' })
    const pool = [
      person({ id: 'weak', firstName: 'Marco', lastName: 'Delgado', dateOfBirth: new Date('1968-11-02T00:00:00Z'), phonePrimary: null, addressLine1: null }),
      person({ id: 'exact' }),
      person({ id: 'unrelated', firstName: 'Ingrid', lastName: 'Solberg', dateOfBirth: new Date('1949-07-19T00:00:00Z'), phonePrimary: null, addressLine1: null }),
    ]
    const results = findDuplicates(subject, pool, 60)
    expect(results[0]!.candidateId).toBe('exact')
    expect(results.map((r) => r.candidateId)).not.toContain('unrelated')
    expect(findDuplicates(subject, pool, 95).length).toBeLessThan(results.length)
  })

  it('returns nothing when there is nothing to find', () => {
    expect(findDuplicates(person({ id: 'a' }), [])).toEqual([])
  })
})
