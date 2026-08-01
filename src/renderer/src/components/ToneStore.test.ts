/**
 * Regression tests for the Tone3000 result filters.
 *
 * These exist because of a real blackout: the API stopped returning `sizes` on search results,
 * and the client's second pass over the same criterion read the missing field as "does not match"
 * — so every result was discarded and the panel went blank, with no error anywhere. The rule
 * these lock in is that a criterion the SERVER has already applied must never be used to exclude
 * a result whose field the API simply did not send.
 */
import { describe, it, expect } from 'vitest'
import {
  asLowerString,
  filterToneByFormat,
  filterToneBySize,
  normalizeGear,
  toneEffectiveFormat
} from './ToneStore'

// The filters only read a few fields; the cast keeps the fixtures to what is under test.
const tone = (fields: Record<string, unknown>) => fields as never

describe('asLowerString', () => {
  it('lowercases a normal string', () => {
    expect(asLowerString('NAM')).toBe('nam')
  })

  it('returns empty for null and undefined instead of throwing', () => {
    expect(asLowerString(null)).toBe('')
    expect(asLowerString(undefined)).toBe('')
  })

  it('unwraps a single-element array, the usual way an API widens a scalar', () => {
    expect(asLowerString(['NAM'])).toBe('nam')
  })

  it('survives objects and empty arrays rather than throwing', () => {
    expect(asLowerString({})).toBe('')
    expect(asLowerString([])).toBe('')
  })

  it('does not throw on any shape an API might send', () => {
    for (const value of [0, false, NaN, [], {}, null, undefined, [[]], Symbol.iterator]) {
      expect(() => asLowerString(value)).not.toThrow()
    }
  })
})

describe('filterToneBySize', () => {
  it('keeps everything when no size is selected', () => {
    expect(filterToneBySize(tone({}), '')).toBe(true)
  })

  it('keeps a tone whose sizes the API did not send — the server already filtered', () => {
    // This is the exact blackout: `sizes` absent must not mean "excluded".
    expect(filterToneBySize(tone({ id: 1 }), 'standard')).toBe(true)
  })

  it('still excludes a tone that genuinely lists other sizes', () => {
    expect(filterToneBySize(tone({ sizes: ['lite', 'nano'] }), 'standard')).toBe(false)
  })

  it('matches case-insensitively', () => {
    expect(filterToneBySize(tone({ sizes: ['Standard'] }), 'standard')).toBe(true)
  })

  it('treats a present-but-empty list as a genuine no-match', () => {
    expect(filterToneBySize(tone({ sizes: [] }), 'standard')).toBe(false)
  })
})

describe('filterToneByFormat', () => {
  it('keeps everything when no format is selected', () => {
    expect(filterToneByFormat(tone({ format: 'ir' }), '')).toBe(true)
  })

  it('keeps a tone that declares no format at all', () => {
    expect(filterToneByFormat(tone({ id: 1 }), 'nam')).toBe(true)
  })

  it('matches on the new format field', () => {
    expect(filterToneByFormat(tone({ format: 'nam' }), 'nam')).toBe(true)
    expect(filterToneByFormat(tone({ format: 'ir' }), 'nam')).toBe(false)
  })

  it('falls back to the legacy platform field', () => {
    expect(filterToneByFormat(tone({ platform: 'nam' }), 'nam')).toBe(true)
  })

  it('copes with the field arriving as an array', () => {
    expect(filterToneByFormat(tone({ format: ['nam'] }), 'nam')).toBe(true)
  })
})

describe('toneEffectiveFormat', () => {
  it('prefers format over the legacy platform', () => {
    expect(toneEffectiveFormat(tone({ format: 'ir', platform: 'nam' }))).toBe('ir')
  })

  it('is empty when neither is present, rather than throwing', () => {
    expect(toneEffectiveFormat(tone({}))).toBe('')
  })
})

describe('normalizeGear', () => {
  it('maps the legacy preview names onto the live API ones', () => {
    expect(normalizeGear('full-rig')).toBe('amp-cab')
    expect(normalizeGear('speaker-cab')).toBe('cab')
  })

  it('passes through anything else, lowercased', () => {
    expect(normalizeGear('AMP')).toBe('amp')
  })

  it('does not throw on a missing or non-string value', () => {
    expect(normalizeGear(undefined)).toBe('')
    expect(normalizeGear({ name: 'amp' })).toBe('')
  })
})
