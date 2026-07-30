import { describe, it, expect } from 'vitest'
import type { NamFile } from '../types/nam'
import { MIN_CONFIDENT_COUNT, rankAmpsByHeaviness, rankModelsByHeaviness } from './ampHeaviness'
import { UNTAGGED_KEY } from './gearMake'

function file(make: string | null, gain: number | null, model = 'M'): NamFile {
  return {
    filePath: `/lib/${make}-${gain}-${Math.random()}.nam`,
    fileName: 'x',
    version: '0.5.0',
    architecture: 'WaveNet',
    config: {},
    metadata: { gear_make: make, gear_model: model, gain },
    originalMetadata: {},
    autoFilledFields: [],
    isDirty: false
  } as NamFile
}

/** N captures of one make at a fixed gain — enough to clear the confidence threshold. */
function amp(make: string, gain: number | null, count = MIN_CONFIDENT_COUNT): NamFile[] {
  return Array(count)
    .fill(null)
    .map(() => file(make, gain))
}

const labels = (rows: { label: string }[]) => rows.map((r) => r.label)

describe('rankAmpsByHeaviness', () => {
  it('orders amps by mean measured gain, cleanest first', () => {
    const rows = rankAmpsByHeaviness([
      ...amp('Friedman', 0.79),
      ...amp('Fender', 0.38),
      ...amp('MARSHALL', 0.74),
      ...amp('VOX', 0.52)
    ])
    expect(labels(rows)).toEqual(['Fender', 'VOX', 'MARSHALL', 'Friedman'])
  })

  it('averages within an amp rather than using any single capture', () => {
    // Mean 0.5 must sort below a flat 0.6, even though one capture reaches 0.9.
    const rows = rankAmpsByHeaviness([
      ...[file('Mixed', 0.1), file('Mixed', 0.5), file('Mixed', 0.9)],
      ...amp('Flat', 0.6)
    ])
    expect(labels(rows)).toEqual(['Mixed', 'Flat'])
    expect(rows[0].meanGain).toBeCloseTo(0.5, 6)
  })

  it('merges case-split makes before ranking', () => {
    const rows = rankAmpsByHeaviness([
      ...amp('MARSHALL', 0.8),
      ...amp('Marshall', 0.8),
      ...amp('Fender', 0.3)
    ])
    expect(rows).toHaveLength(2)
    expect(rows[1].label).toBe('MARSHALL')
    expect(rows[1].files).toHaveLength(MIN_CONFIDENT_COUNT * 2)
  })

  // The bug this test exists to prevent: treating "no gain data" as 0 would plant an unmeasurable
  // amp at the cleanest extreme and assert something false about it.
  it('sorts amps with no measured gain LAST, never at the clean end', () => {
    const rows = rankAmpsByHeaviness([
      ...amp('NoData', null),
      ...amp('Fender', 0.38),
      ...amp('Friedman', 0.79)
    ])
    expect(labels(rows)).toEqual(['Fender', 'Friedman', 'NoData'])
    expect(rows[rows.length - 1].meanGain).toBeNull()
  })

  it('excludes null gains from the mean instead of counting them as zero', () => {
    const rows = rankAmpsByHeaviness([file('A', 0.8), file('A', null), file('A', 0.8)])
    expect(rows[0].meanGain).toBeCloseTo(0.8, 6)
    expect(rows[0].measuredCount).toBe(2)
    expect(rows[0].files).toHaveLength(3)
  })

  it('ignores non-finite gains', () => {
    const rows = rankAmpsByHeaviness([file('A', NaN), file('A', Infinity), file('A', 0.5)])
    expect(rows[0].meanGain).toBeCloseTo(0.5, 6)
    expect(rows[0].measuredCount).toBe(1)
  })

  it('flags rows with too few measured captures as low confidence', () => {
    const rows = rankAmpsByHeaviness([
      ...amp('Confident', 0.5, MIN_CONFIDENT_COUNT),
      ...amp('Sparse', 0.9, MIN_CONFIDENT_COUNT - 1)
    ])
    const byLabel = new Map(rows.map((r) => [r.label, r]))
    expect(byLabel.get('Confident')!.lowConfidence).toBe(false)
    expect(byLabel.get('Sparse')!.lowConfidence).toBe(true)
  })

  it('still ranks low-confidence rows rather than hiding the user’s gear', () => {
    const rows = rankAmpsByHeaviness([file('Solo', 0.95), ...amp('Fender', 0.3)])
    expect(labels(rows)).toEqual(['Fender', 'Solo'])
    expect(rows[1].lowConfidence).toBe(true)
  })

  it('includes the Untagged bucket, ranked by its own captures', () => {
    // Placeholder names are unusable, but the measurements behind them are fine.
    const rows = rankAmpsByHeaviness([
      ...amp('tz-make', 0.2),
      ...amp('Friedman', 0.79)
    ])
    expect(rows[0].key).toBe(UNTAGGED_KEY)
    expect(rows[0].junk).toBe(true)
    expect(rows[0].meanGain).toBeCloseTo(0.2, 6)
  })

  it('is deterministic when means tie', () => {
    const input = [...amp('Bravo', 0.5), ...amp('Alpha', 0.5)]
    expect(labels(rankAmpsByHeaviness(input))).toEqual(['Alpha', 'Bravo'])
    expect(labels(rankAmpsByHeaviness([...input].reverse()))).toEqual(['Alpha', 'Bravo'])
  })

  it('orders unmeasurable rows by size then alphabetically, not arbitrarily', () => {
    const rows = rankAmpsByHeaviness([
      ...amp('Small', null, 2),
      ...amp('Large', null, 5)
    ])
    expect(labels(rows)).toEqual(['Large', 'Small'])
  })

  it('does not mutate its input', () => {
    const input = [...amp('B', 0.9), ...amp('A', 0.1)]
    const snapshot = input.map((f) => f.filePath)
    rankAmpsByHeaviness(input)
    expect(input.map((f) => f.filePath)).toEqual(snapshot)
  })

  it('handles an empty library', () => {
    expect(rankAmpsByHeaviness([])).toEqual([])
  })
})

describe('rankModelsByHeaviness', () => {
  it('ranks by model within a set of captures', () => {
    const rows = rankModelsByHeaviness([
      file('MARSHALL', 0.9, 'JCM800'),
      file('MARSHALL', 0.9, 'JCM800'),
      file('MARSHALL', 0.9, 'JCM800'),
      file('MARSHALL', 0.4, 'Bassman'),
      file('MARSHALL', 0.4, 'Bassman'),
      file('MARSHALL', 0.4, 'Bassman')
    ])
    expect(labels(rows)).toEqual(['Bassman', 'JCM800'])
  })
})
