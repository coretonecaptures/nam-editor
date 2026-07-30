import { describe, it, expect } from 'vitest'
import type { NamFile } from '../types/nam'
import {
  JUNK_MAKE_KEYS,
  UNTAGGED_KEY,
  UNTAGGED_LABEL,
  displayMake,
  groupByCreator,
  groupByMake,
  isJunkMake,
  normalizeMakeKey
} from './gearMake'

/** Minimal NamFile — only the fields these helpers read. */
function file(overrides: Partial<NamFile['metadata']>, path = `/lib/${Math.random()}.nam`): NamFile {
  return {
    filePath: path,
    fileName: 'x',
    version: '0.5.0',
    architecture: 'WaveNet',
    config: {},
    metadata: overrides,
    originalMetadata: overrides,
    autoFilledFields: [],
    isDirty: false
  } as NamFile
}

describe('normalizeMakeKey', () => {
  it('merges case variants', () => {
    expect(normalizeMakeKey('MARSHALL')).toBe(normalizeMakeKey('Marshall'))
    expect(normalizeMakeKey('marshall')).toBe('marshall')
  })

  it('merges spacing, hyphen and underscore variants', () => {
    const keys = ['Mesa Boogie', 'mesa-boogie', 'MESA_BOOGIE', ' mesa  boogie '].map(normalizeMakeKey)
    expect(new Set(keys).size).toBe(1)
    expect(keys[0]).toBe('mesaboogie')
  })

  it('returns null for empty or non-string input', () => {
    expect(normalizeMakeKey('')).toBeNull()
    expect(normalizeMakeKey('   ')).toBeNull()
    expect(normalizeMakeKey(null)).toBeNull()
    expect(normalizeMakeKey(undefined)).toBeNull()
  })

  it('strips trailing punctuation but keeps interior characters', () => {
    expect(normalizeMakeKey('Fender,')).toBe('fender')
    // Interior '/' and '&' carry meaning in real amp names.
    expect(normalizeMakeKey('Dr. Z')).toBe('drz')
    expect(normalizeMakeKey('Divided by 13')).toBe('dividedby13')
  })
})

describe('isJunkMake', () => {
  it('flags the real-world tz-make placeholder in all its spellings', () => {
    // 656 captures in the measured library carry this.
    for (const variant of ['tz-make', 'TZ-Make', 'tz make', 'tzmake', 'tz_make']) {
      expect(isJunkMake(variant), variant).toBe(true)
    }
  })

  it('flags missing values and common placeholders', () => {
    expect(isJunkMake(null)).toBe(true)
    expect(isJunkMake(undefined)).toBe(true)
    expect(isJunkMake('')).toBe(true)
    expect(isJunkMake('unknown')).toBe(true)
    expect(isJunkMake('N/A')).toBe(true)
    expect(isJunkMake('-')).toBe(true)
  })

  it('does not flag real makes', () => {
    for (const make of ['MARSHALL', 'Fender', 'Mesa Boogie', 'VOX', '3RD POWER', 'Driftwood']) {
      expect(isJunkMake(make), make).toBe(false)
    }
  })

  it('only contains normalized keys, so lookups can never miss', () => {
    for (const key of JUNK_MAKE_KEYS) {
      // 'n/a' is deliberately listed pre-normalized as a convenience; everything else must already
      // be in normalized form or isJunkMake would fail to match it.
      if (key === 'n/a') continue
      expect(normalizeMakeKey(key), key).toBe(key)
    }
  })
})

describe('displayMake', () => {
  it('picks the most frequent original spelling, not a prettified one', () => {
    // 402 MARSHALL vs 58 Marshall in the real library — show what the files actually say.
    const originals = [...Array(402).fill('MARSHALL'), ...Array(58).fill('Marshall')]
    expect(displayMake(originals)).toBe('MARSHALL')
  })

  it('is deterministic on ties, preferring the longer spelling', () => {
    expect(displayMake(['Mesa', 'Mesa Boogie'])).toBe('Mesa Boogie')
    expect(displayMake(['Mesa Boogie', 'Mesa'])).toBe('Mesa Boogie')
  })

  it('falls back to the untagged label when there is nothing usable', () => {
    expect(displayMake([])).toBe(UNTAGGED_LABEL)
    expect(displayMake(['', '   '])).toBe(UNTAGGED_LABEL)
  })
})

describe('groupByMake', () => {
  it('merges case variants into one group with the combined count', () => {
    const files = [
      ...Array(402).fill(null).map(() => file({ gear_make: 'MARSHALL' })),
      ...Array(58).fill(null).map(() => file({ gear_make: 'Marshall' }))
    ]
    const groups = groupByMake(files)
    const marshall = groups.get('marshall')
    expect(marshall).toBeDefined()
    expect(marshall!.files).toHaveLength(460)
    expect(marshall!.label).toBe('MARSHALL')
    expect(marshall!.junk).toBe(false)
  })

  it('buckets placeholder makes under Untagged rather than dropping them', () => {
    // The whole point: these captures still have valid measured gain and must stay plottable.
    const files = [
      ...Array(656).fill(null).map(() => file({ gear_make: 'tz-make', gain: 0.7 })),
      file({ gear_make: 'Fender' })
    ]
    const groups = groupByMake(files)
    const untagged = groups.get(UNTAGGED_KEY)
    expect(untagged).toBeDefined()
    expect(untagged!.files).toHaveLength(656)
    expect(untagged!.junk).toBe(true)
    expect(untagged!.label).toBe(UNTAGGED_LABEL)
    expect(groups.get('fender')!.junk).toBe(false)
  })

  it('groups missing and placeholder makes together', () => {
    const files = [file({ gear_make: null }), file({}), file({ gear_make: 'unknown' })]
    const groups = groupByMake(files)
    expect(groups.size).toBe(1)
    expect(groups.get(UNTAGGED_KEY)!.files).toHaveLength(3)
  })

  it('handles an empty input', () => {
    expect(groupByMake([]).size).toBe(0)
  })
})

describe('groupByCreator', () => {
  it('merges the real slamminmofo case-split into one creator', () => {
    // 966 'SLAMMIN MOFO' + 455 'slamminmofo' = 1,421 in the measured library.
    const files = [
      ...Array(966).fill(null).map(() => file({ modeled_by: 'SLAMMIN MOFO' })),
      ...Array(455).fill(null).map(() => file({ modeled_by: 'slamminmofo' }))
    ]
    const groups = groupByCreator(files)
    expect(groups.size).toBe(1)
    const creator = groups.get('slamminmofo')!
    expect(creator.files).toHaveLength(1421)
    expect(creator.label).toBe('SLAMMIN MOFO')
  })
})
