import { describe, it, expect } from 'vitest'
import { compact, escapeRegExp, extractSegments, extractTokens, matchByType, matchesToken, normalizePath } from './suggestMatching'

describe('compact', () => {
  it('lowercases and strips non-alphanumerics', () => {
    expect(compact('Mesa 4x12 - V30')).toBe('mesa4x12v30')
  })
})

describe('extractTokens', () => {
  it('extracts lowercase alphanumeric words as a set, splitting on non-alphanumeric separators', () => {
    expect(extractTokens('Marshall_412 SM57.wav')).toEqual(new Set(['marshall', '412', 'sm57', 'wav']))
  })
})

describe('extractSegments', () => {
  it('splits on whitespace, trims, drops empties', () => {
    expect(extractSegments('  Marshall  412   SM57 ')).toEqual(['Marshall', '412', 'SM57'])
  })
})

describe('normalizePath', () => {
  it('converts backslashes to forward slashes', () => {
    expect(normalizePath('Cabs\\Marshall\\412.wav')).toBe('Cabs/Marshall/412.wav')
  })
})

describe('matchesToken', () => {
  it('matches a whole token present in the token set', () => {
    expect(matchesToken('Marshall 412.wav', extractTokens('Marshall 412.wav'), 'Marshall')).toBe(true)
  })

  it('does not false-positive a short token as a substring of a longer word without a boundary', () => {
    // "di" should not match inside "distance" without a word boundary.
    expect(matchesToken('distance.wav', extractTokens('distance.wav'), 'di')).toBe(false)
  })

  it('matches a short token at a real word boundary', () => {
    expect(matchesToken('Amp DI.wav', extractTokens('Amp DI.wav'), 'di')).toBe(true)
  })

  it('matches a multi-word token via substring, not token-set membership', () => {
    expect(matchesToken('Celestion V30 Blend.wav', extractTokens('Celestion V30 Blend.wav'), 'V30 Blend')).toBe(true)
  })
})

describe('matchByType', () => {
  it('contains: substring match ignoring separators', () => {
    expect(matchByType('Mesa-4x12.wav', extractTokens('Mesa-4x12.wav'), '4x12', 'contains').matched).toBe(true)
  })

  it('starts_with / ends_with', () => {
    expect(matchByType('Marshall412.wav', extractTokens('Marshall412.wav'), 'Marshall', 'starts_with').matched).toBe(true)
    expect(matchByType('Marshall412.wav', extractTokens('Marshall412.wav'), '412.wav', 'ends_with').matched).toBe(true)
  })

  it('prefix_value extracts the numeric value and the full matched span, requiring the digits immediately after the token', () => {
    // The decimal portion only counts when what follows it is itself a non-alphanumeric boundary
    // (here, end of string) — "in"/"cm" glued directly onto the decimal (e.g. "3.5in") backtracks
    // to matching just the integer part ahead of the decimal point, a real pre-existing quirk of
    // this regex this test pins down rather than silently "fixing" during the dedup.
    const result = matchByType('Marshall Distance3.5', new Set(), 'Distance', 'prefix_value')
    expect(result.matched).toBe(true)
    expect(result.extractedValue).toBe('3.5')
    expect(result.extractedMatch).toBe('Distance3.5')
  })

  it('prefix_value does not match when no number immediately follows the prefix', () => {
    expect(matchByType('Distance unknown.wav', new Set(), 'Distance', 'prefix_value').matched).toBe(false)
  })

  it('exact falls back to matchesToken', () => {
    expect(matchByType('Marshall 412.wav', extractTokens('Marshall 412.wav'), 'Marshall', 'exact').matched).toBe(true)
    expect(matchByType('Marshall 412.wav', extractTokens('Marshall 412.wav'), 'Fender', 'exact').matched).toBe(false)
  })
})

describe('escapeRegExp', () => {
  it('escapes regex metacharacters so a literal token is safe to embed in a RegExp', () => {
    expect(() => new RegExp(escapeRegExp('V30 (4x12)'))).not.toThrow()
    expect(escapeRegExp('a.b*c')).toBe('a\\.b\\*c')
  })
})
