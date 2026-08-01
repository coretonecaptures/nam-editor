import { describe, it, expect } from 'vitest'
import type { NamFile } from '../types/nam'
import { UNTAGGED_KEY } from './gearMake'
import {
  buildScanFacets,
  defaultScanKey,
  emptyScanScope,
  isScopeEmpty,
  orderScanFiles,
  scopeFiles,
  toggleScopeValue,
  toneRank
} from './scanOrder'

let n = 0
function cap(meta: Partial<NamFile['metadata']>): NamFile {
  n++
  return {
    filePath: `/lib/${String(n).padStart(4, '0')}.nam`,
    fileName: `cap-${n}`,
    metadata: meta,
    originalMetadata: meta
  } as NamFile
}

describe('toneRank', () => {
  it('sweeps from clean to most aggressive', () => {
    expect(toneRank('clean')).toBeLessThan(toneRank('crunch'))
    expect(toneRank('crunch')).toBeLessThan(toneRank('overdrive'))
    expect(toneRank('overdrive')).toBeLessThan(toneRank('hi_gain'))
  })

  it('sweeps untagged last rather than dropping it', () => {
    // Untagged is a third of some real libraries; dropping it would hide most of the collection.
    expect(toneRank(null)).toBeGreaterThan(toneRank('fuzz'))
    expect(toneRank('nonsense')).toBe(toneRank(null))
  })

  it('is case and whitespace insensitive', () => {
    expect(toneRank('  Clean ')).toBe(toneRank('clean'))
  })
})

describe('orderScanFiles', () => {
  it('groups by tone type before gain', () => {
    // A very saturated clean capture must still sweep before a low-gain hi_gain one, or the
    // sweep stops being a journey from clean to heavy.
    const files = [
      cap({ tone_type: 'hi_gain', gain: 0.5 }),
      cap({ tone_type: 'clean', gain: 0.9 })
    ]
    expect(orderScanFiles(files).map((f) => f.metadata.tone_type)).toEqual(['clean', 'hi_gain'])
  })

  it('breaks ties on gain inside a bucket', () => {
    const files = [
      cap({ tone_type: 'crunch', gain: 0.8 }),
      cap({ tone_type: 'crunch', gain: 0.6 }),
      cap({ tone_type: 'crunch', gain: 0.7 })
    ]
    expect(orderScanFiles(files).map((f) => f.metadata.gain)).toEqual([0.6, 0.7, 0.8])
  })

  it('is reproducible, so "the third one I heard" keeps meaning something', () => {
    const files = [
      cap({ tone_type: 'crunch', gain: 0.7 }),
      cap({ tone_type: 'crunch', gain: 0.7 }),
      cap({ tone_type: 'crunch', gain: 0.7 })
    ]
    const a = orderScanFiles(files).map((f) => f.filePath)
    const b = orderScanFiles([...files].reverse()).map((f) => f.filePath)
    expect(a).toEqual(b)
  })

  it('sorts captures with no gain last within their bucket', () => {
    const files = [cap({ tone_type: 'crunch' }), cap({ tone_type: 'crunch', gain: 0.6 })]
    expect(orderScanFiles(files)[0].metadata.gain).toBe(0.6)
  })

  it('accepts a replacement key, which is how a brightness ordering drops in', () => {
    const files = [cap({ tone_type: 'clean', gain: 0.2 }), cap({ tone_type: 'hi_gain', gain: 0.9 })]
    const byGainOnly = orderScanFiles(files, (f) => -(f.metadata.gain as number))
    expect(byGainOnly[0].metadata.gain).toBe(0.9)
  })

  it('does not mutate its input', () => {
    const files = [cap({ tone_type: 'hi_gain' }), cap({ tone_type: 'clean' })]
    const before = files.map((f) => f.filePath)
    orderScanFiles(files)
    expect(files.map((f) => f.filePath)).toEqual(before)
  })

  it('handles an empty list', () => {
    expect(orderScanFiles([])).toEqual([])
  })
})

describe('scopeFiles', () => {
  const files = [
    cap({ gear_make: 'MARSHALL', modeled_by: 'SLAMMIN MOFO', tone_type: 'crunch' }),
    cap({ gear_make: 'Marshall', modeled_by: 'slamminmofo', tone_type: 'clean' }),
    cap({ gear_make: 'Mesa Boogie', modeled_by: 'SLAMMIN MOFO', tone_type: 'hi_gain' }),
    cap({ gear_make: null, modeled_by: null, tone_type: null })
  ]

  it('returns everything when nothing is selected', () => {
    expect(scopeFiles(files, emptyScanScope())).toHaveLength(4)
  })

  it('merges split spellings, so a make selection is not silently partial', () => {
    // MARSHALL and Marshall are the same amp; selecting one must find both.
    const scope = { ...emptyScanScope(), makes: new Set(['marshall']) }
    expect(scopeFiles(files, scope)).toHaveLength(2)
  })

  it('ORs within a facet — selecting several makes IS the user-defined family', () => {
    const scope = { ...emptyScanScope(), makes: new Set(['marshall', 'mesaboogie']) }
    expect(scopeFiles(files, scope)).toHaveLength(3)
  })

  it('ANDs across facets', () => {
    const scope = {
      ...emptyScanScope(),
      makes: new Set(['marshall']),
      tones: new Set(['clean'])
    }
    expect(scopeFiles(files, scope)).toHaveLength(1)
  })

  it('can select untagged captures explicitly', () => {
    const scope = { ...emptyScanScope(), makes: new Set([UNTAGGED_KEY]) }
    expect(scopeFiles(files, scope)).toHaveLength(1)
  })

  it('files junk placeholders under Untagged, matching the facet list', () => {
    // tz-make normalizes to a healthy-looking 'tzmake' key while the facet list files it under
    // Untagged. If scoping disagreed, the picker would show a count it could not deliver -
    // 1,947 captures in a real library.
    const junk = [cap({ gear_make: 'tz-make' }), cap({ gear_make: 'TZ-Make' })]
    const facet = buildScanFacets(junk).makes
    expect(facet).toHaveLength(1)
    expect(facet[0].key).toBe(UNTAGGED_KEY)
    expect(facet[0].count).toBe(2)
    const scope = { ...emptyScanScope(), makes: new Set([UNTAGGED_KEY]) }
    expect(scopeFiles(junk, scope)).toHaveLength(facet[0].count)
  })

  it('returns nothing when the combination matches nothing', () => {
    const scope = {
      ...emptyScanScope(),
      makes: new Set(['mesaboogie']),
      tones: new Set(['clean'])
    }
    expect(scopeFiles(files, scope)).toHaveLength(0)
  })
})

describe('buildScanFacets', () => {
  const files = [
    ...Array.from({ length: 3 }, () => cap({ gear_make: 'MARSHALL', tone_type: 'crunch' })),
    cap({ gear_make: 'Marshall', tone_type: 'clean' }),
    cap({ gear_make: 'Fender', tone_type: 'clean' }),
    cap({ gear_make: null, tone_type: null })
  ]

  it('counts split spellings as one make', () => {
    const marshall = buildScanFacets(files).makes.find((m) => m.key === 'marshall')
    expect(marshall?.count).toBe(4)
  })

  it('orders by count so the useful choices are first', () => {
    const makes = buildScanFacets(files).makes
    expect(makes[0].key).toBe('marshall')
  })

  it('always puts Untagged last, however many there are', () => {
    // 40% of a real library has no make; commonest-first would otherwise bury every real one.
    const many = [...files, ...Array.from({ length: 50 }, () => cap({ gear_make: null }))]
    const makes = buildScanFacets(many).makes
    expect(makes[makes.length - 1].key).toBe(UNTAGGED_KEY)
  })

  it('humanises tone labels', () => {
    const tones = buildScanFacets(files).tones
    expect(tones.map((t) => t.label)).toContain('Clean')
  })

  it('handles an empty library', () => {
    const f = buildScanFacets([])
    expect(f.makes).toEqual([])
    expect(f.tones).toEqual([])
  })
})

describe('toggleScopeValue', () => {
  it('adds, removes, and leaves other facets alone', () => {
    let scope = emptyScanScope()
    scope = toggleScopeValue(scope, 'makes', 'marshall')
    expect(scope.makes.has('marshall')).toBe(true)
    scope = toggleScopeValue(scope, 'tones', 'clean')
    expect(scope.makes.has('marshall')).toBe(true)
    scope = toggleScopeValue(scope, 'makes', 'marshall')
    expect(scope.makes.has('marshall')).toBe(false)
    expect(scope.tones.has('clean')).toBe(true)
  })

  it('returns a new object so React sees the change', () => {
    const scope = emptyScanScope()
    expect(toggleScopeValue(scope, 'makes', 'x')).not.toBe(scope)
    expect(scope.makes.size).toBe(0)
  })
})

describe('defaultScanKey / isScopeEmpty', () => {
  it('exposes the tone-then-gain pair', () => {
    expect(defaultScanKey(cap({ tone_type: 'clean', gain: 0.4 }))).toEqual([0, 0.4])
  })

  it('knows an untouched scope is empty', () => {
    expect(isScopeEmpty(emptyScanScope())).toBe(true)
    expect(isScopeEmpty(toggleScopeValue(emptyScanScope(), 'makes', 'x'))).toBe(false)
  })
})
