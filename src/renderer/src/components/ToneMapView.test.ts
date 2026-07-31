/**
 * Mount-safety tests for ToneMapView.
 *
 * Uses renderToString rather than a DOM harness: it needs no jsdom and no ResizeObserver, yet it
 * still executes every useMemo in the component — which is where the crash risk actually lives
 * (row/mark derivation over messy real-world metadata, and the non-null row lookups in ToneGrid).
 *
 * The fixtures deliberately mirror what the real 2,577-capture library contains: case-split makes,
 * `tz-make` placeholders, captures missing `gain` entirely, and 98%-one-tone-type skew.
 */
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import type { NamFile } from '../types/nam'
import { ToneMapView, autoRowHeightFor } from './ToneMapView'

let counter = 0
function capture(meta: Partial<NamFile['metadata']>): NamFile {
  counter++
  return {
    filePath: `/lib/cap-${counter}.nam`,
    fileName: `cap-${counter}`,
    version: '0.5.0',
    architecture: 'WaveNet',
    config: {},
    metadata: meta,
    originalMetadata: meta,
    autoFilledFields: [],
    isDirty: false
  } as NamFile
}

// createElement rather than JSX so this needs no JSX transform: the Vite 7 / rolldown toolchain
// vitest uses ignores the React plugin's jsx option, and a config just for one test file is more
// machinery than a mount-safety check warrants.
function render(files: NamFile[], nowPlaying: NamFile | null = null): string {
  return renderToString(
    createElement(ToneMapView, {
      files,
      scopedFiles: files,
      scopeLabel: 'Test Folder',
      onPlay: () => {},
      nowPlaying,
      onClose: () => {}
    })
  )
}

describe('ToneMapView', () => {
  it('renders an empty library without crashing', () => {
    const html = render([])
    expect(html).toContain('Tone Map')
    expect(html).toMatch(/No captures report a measured gain/i)
  })

  it('renders a realistic messy library', () => {
    const files = [
      // Case-split make — must merge into one row.
      ...Array(5).fill(null).map(() => capture({ gear_make: 'MARSHALL', gear_model: 'JCM800', tone_type: 'overdrive', gain: 0.74, modeled_by: 'SLAMMIN MOFO' })),
      ...Array(3).fill(null).map(() => capture({ gear_make: 'Marshall', gear_model: 'JCM800', tone_type: 'overdrive', gain: 0.71, modeled_by: 'slamminmofo' })),
      // Placeholder make — must land in Untagged, not be dropped.
      ...Array(4).fill(null).map(() => capture({ gear_make: 'tz-make', gear_model: 'tz-model', tone_type: 'overdrive', gain: 0.66 })),
      // Clean amp at the other end of the axis.
      ...Array(3).fill(null).map(() => capture({ gear_make: 'Fender', gear_model: 'Bassman', tone_type: 'clean', gain: 0.31, modeled_by: '2dor' })),
      // No gain at all — must be excluded from the plot, not plotted at zero.
      capture({ gear_make: 'Friedman', gear_model: 'BE100', tone_type: 'hi_gain' }),
      // Entirely untagged.
      capture({ gain: 0.5 })
    ]
    const html = render(files)
    expect(html).toContain('Tone Map')
    // 16 of 17 are positionable; the gain-less Friedman is excluded and surfaced, not hidden.
    expect(html).toContain('excluded (no measured gain)')
    expect(html).toContain('MARSHALL')
    expect(html).toContain('Untagged')
  })

  it('reports excluded captures rather than silently dropping them', () => {
    const files = [
      capture({ gear_make: 'A', gain: 0.5 }),
      capture({ gear_make: 'A' }),
      capture({ gear_make: 'A', gain: null })
    ]
    const html = render(files)
    expect(html).toContain('2')
    expect(html).toContain('excluded')
  })

  it('renders drill-down offers for the playing capture', () => {
    const playing = capture({
      gear_make: 'Mesa Boogie',
      gear_model: 'MARK IV',
      tone_type: 'overdrive',
      gain: 0.7,
      modeled_by: 'Amalgam Audio',
      name: 'AA MESA MARK IV Lead'
    })
    const html = render([playing, capture({ gear_make: 'Fender', gain: 0.3 })], playing)
    expect(html).toContain('Now playing')
    expect(html).toContain('AA MESA MARK IV Lead')
    // The scoping options the user asked for: by amp, by maker, and by both.
    expect(html).toContain('Mesa Boogie')
    expect(html).toContain('Amalgam Audio')
    expect(html).toContain('Narrow to')
  })

  it('survives a capture whose metadata is entirely empty', () => {
    expect(() => render([capture({})])).not.toThrow()
  })

  it('survives non-finite gain values', () => {
    const files = [
      capture({ gear_make: 'A', gain: NaN }),
      capture({ gear_make: 'A', gain: Infinity }),
      capture({ gear_make: 'A', gain: 0.5 })
    ]
    expect(() => render(files)).not.toThrow()
  })

  it('handles a single capture, where the axis domain would otherwise be zero-width', () => {
    // paddedDomain must not produce a degenerate range here or every scale divides by zero.
    expect(() => render([capture({ gear_make: 'Solo', gain: 0.42 })])).not.toThrow()
  })

  it('renders a dense library that triggers the density path', () => {
    // Above ToneGrid's 140-mark threshold a row draws heat cells instead of circles.
    const files = Array(400)
      .fill(null)
      .map((_, i) => capture({ gear_make: 'MARSHALL', tone_type: 'overdrive', gain: 0.3 + (i % 60) / 100 }))
    const html = render(files)
    expect(html).toContain('MARSHALL')
    // Density cells are <rect>, not <circle>.
    expect(html).toContain('<rect')
  })
})

describe('ToneMapView density interactivity', () => {
  /** A row dense enough to render as heat cells rather than dots. */
  const denseLibrary = () =>
    Array(400)
      .fill(null)
      .map((_, i) =>
        capture({
          gear_make: 'MARSHALL',
          gear_model: 'JCM800',
          tone_type: 'overdrive',
          gain: 0.3 + (i % 60) / 100,
          modeled_by: 'SLAMMIN MOFO'
        })
      )

  // Before this, a dense row was completely inert: hit-testing only searched individual dots, so
  // there was nothing to hover, nothing to click, and no way to zoom in.
  it('tells the user heat bands are clickable', () => {
    const html = render(denseLibrary())
    expect(html).toMatch(/click a heat band/i)
    expect(html).toMatch(/zoom in/i)
  })

  it('still renders heat cells for a dense row', () => {
    const html = render(denseLibrary())
    expect(html).toContain('<rect')
    expect(html).toContain('MARSHALL')
  })

  it('renders amp names as clickable zoom targets', () => {
    const html = render(denseLibrary())
    // Row labels carry a title advertising the isolate action.
    expect(html).toMatch(/Show only/i)
  })

  it('does not crash when every capture shares one saturation value', () => {
    // All marks land in one bin, so the cell range is zero-width — the axis must survive it.
    const files = Array(300)
      .fill(null)
      .map(() => capture({ gear_make: 'MARSHALL', tone_type: 'overdrive', gain: 0.7 }))
    expect(() => render(files)).not.toThrow()
  })
})

describe('ToneMapView zoom', () => {
  const denseLibrary = () =>
    Array(400)
      .fill(null)
      .map((_, i) =>
        capture({
          gear_make: 'MARSHALL',
          tone_type: 'overdrive',
          gain: 0.3 + (i % 60) / 100
        })
      )

  it('advertises scroll-to-zoom and drag-to-pan', () => {
    const html = render(denseLibrary())
    expect(html).toMatch(/scroll to zoom/i)
    expect(html).toMatch(/drag to pan/i)
  })

  // The scrollbar and Fit button only exist while zoomed; at full extent they would be inert
  // furniture.
  it('hides the zoom scrollbar until zoomed', () => {
    const html = render(denseLibrary())
    expect(html).not.toMatch(/>Fit</)
  })

  it('starts at the full range with no zoom breadcrumb', () => {
    const html = render(denseLibrary())
    expect(html).not.toMatch(/zoomed \d/)
  })
})

/**
 * Vertical sizing policy. The map fills half the free space so a small library doesn't read as
 * "the whole app is one chart" — and past a certain row count it stops shrinking and grows
 * instead, which is what "unless there are a lot of amps" means in practice.
 */
describe('autoRowHeightFor', () => {
  const TALL = 900
  const MIN = 26
  const MAX = 96

  it('stretches rows well past the minimum when there are few amps', () => {
    expect(autoRowHeightFor(4, TALL)).toBeGreaterThan(MIN)
  })

  it('uses about half the free space, not all of it', () => {
    const rows = 6
    const used = autoRowHeightFor(rows, TALL) * rows
    expect(used).toBeLessThanOrEqual(TALL * 0.5)
    // ...and is actually using that space rather than defaulting small.
    expect(used).toBeGreaterThan(TALL * 0.3)
  })

  it('stops shrinking once there are a lot of amps, so the plot grows and scrolls', () => {
    // 40 rows cannot fit in half the window at the minimum height; height must clamp, not shrink.
    expect(autoRowHeightFor(40, TALL)).toBe(MIN)
    expect(autoRowHeightFor(200, TALL)).toBe(MIN)
  })

  it('never exceeds the maximum, however few amps or however tall the window', () => {
    expect(autoRowHeightFor(1, 20000)).toBe(MAX)
    expect(autoRowHeightFor(2, TALL)).toBeLessThanOrEqual(MAX)
  })

  it('falls back to the default before the window has been measured', () => {
    expect(autoRowHeightFor(5, 0)).toBe(MIN)
    expect(autoRowHeightFor(0, TALL)).toBe(MIN)
    expect(autoRowHeightFor(-1, TALL)).toBe(MIN)
  })

  it('is monotonic: more amps never means taller rows', () => {
    let previous = Infinity
    for (const rows of [1, 2, 4, 8, 16, 32, 64]) {
      const height = autoRowHeightFor(rows, TALL)
      expect(height).toBeLessThanOrEqual(previous)
      previous = height
    }
  })
})
