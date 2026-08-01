/**
 * ToneGrid rendering behaviour, focused on the density/zoom relationship.
 *
 * The whole point of zoom is that going in resolves a heat band into individual, clickable dots.
 * That only works because the density threshold is applied to the marks VISIBLE in the current
 * domain rather than the row's total — an earlier version tested the total, so a dense row stayed
 * heat no matter how far you zoomed and the feature was pointless.
 */
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import {
  TONE_GRID_CHROME_HEIGHT,
  TONE_GRID_ROW_HEIGHT,
  ToneGrid,
  toneGridDotRadius,
  toneGridHeight,
  type ToneGridMark,
  type ToneGridRow
} from './ToneGrid'

const ROWS: ToneGridRow[] = [{ key: 'marshall', label: 'MARSHALL' }]

/** `count` marks spread evenly across [lo, hi]. */
function marks(count: number, lo = 0.2, hi = 0.9): ToneGridMark[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `m${i}`,
    rowKey: 'marshall',
    x: lo + ((hi - lo) * i) / Math.max(1, count - 1),
    color: '#eab308',
    label: `capture ${i}`
  }))
}

function render(m: ToneGridMark[], xDomain: [number, number], rows: ToneGridRow[] = ROWS): string {
  return renderToString(
    createElement(ToneGrid, {
      rows,
      marks: m,
      xDomain,
      xLabel: 'saturation',
      width: 800,
      height: toneGridHeight(rows.length),
      onSelect: () => {},
      onDrillCell: () => {},
      onSelectRow: () => {}
    })
  )
}

const circles = (html: string) => (html.match(/<circle/g) ?? []).length
/** Cells are the only <rect> with an rx of 1; row bands and the hit overlay have no rx. */
const cells = (html: string) => (html.match(/rx="1"/g) ?? []).length

describe('ToneGrid density', () => {
  it('draws individual dots for a sparse row', () => {
    const html = render(marks(20), [0.1, 1.0])
    expect(circles(html)).toBe(20)
    expect(cells(html)).toBe(0)
  })

  it('collapses a dense row to heat cells', () => {
    const html = render(marks(400), [0.1, 1.0])
    expect(circles(html)).toBe(0)
    expect(cells(html)).toBeGreaterThan(0)
  })

  // The behaviour zoom depends on.
  it('resolves heat into dots when the domain narrows', () => {
    const all = marks(400, 0.2, 0.9)
    expect(circles(render(all, [0.1, 1.0]))).toBe(0)

    // A narrow window contains few enough marks to draw individually.
    const zoomed = render(all, [0.5, 0.52])
    expect(circles(zoomed)).toBeGreaterThan(0)
    expect(cells(zoomed)).toBe(0)
  })

  it('excludes marks outside the domain so nothing draws off-plot', () => {
    const html = render(marks(20, 0.0, 1.0), [0.4, 0.6])
    // Roughly a fifth of an even spread falls inside 0.4..0.6.
    expect(circles(html)).toBeGreaterThan(0)
    expect(circles(html)).toBeLessThan(20)
  })

  it('renders nothing but chrome when the domain excludes everything', () => {
    const html = render(marks(20, 0.8, 0.9), [0.1, 0.2])
    expect(circles(html)).toBe(0)
    expect(cells(html)).toBe(0)
  })

  it('keeps row labels regardless of zoom, so rows never move under you', () => {
    // Zoom is a view, not a filter: the row set must be identical at any domain.
    expect(render(marks(400), [0.1, 1.0])).toContain('MARSHALL')
    expect(render(marks(400), [0.5, 0.52])).toContain('MARSHALL')
    expect(render(marks(400), [0.95, 0.99])).toContain('MARSHALL')
  })

  it('handles an empty mark set', () => {
    expect(() => render([], [0, 1])).not.toThrow()
  })

  it('handles a degenerate domain without dividing by zero', () => {
    expect(() => render(marks(10), [0.5, 0.5])).not.toThrow()
  })
})

/**
 * Vertical scaling. A library with few amps left most of the window empty at the fixed row
 * height, so rows stretch to fill it — and the dots have to grow with them, or a taller row is
 * just the same specks spread further apart, which is the emptiness it was meant to fix.
 */
describe('ToneGrid vertical scaling', () => {
  function renderAt(rowHeight: number, markCount = 10): string {
    return renderToString(
      createElement(ToneGrid, {
        rows: ROWS,
        marks: marks(markCount),
        xDomain: [0.1, 1.0] as [number, number],
        xLabel: 'saturation',
        width: 800,
        height: toneGridHeight(ROWS.length, rowHeight),
        rowHeight
      })
    )
  }

  /** Every circle radius in the markup, in document order. */
  const radii = (html: string): number[] =>
    Array.from(html.matchAll(/<circle[^>]*\sr="([\d.]+)"/g)).map((m) => Number(m[1]))

  it('grows the dot radius as rows get taller', () => {
    expect(toneGridDotRadius(52)).toBeGreaterThan(toneGridDotRadius(TONE_GRID_ROW_HEIGHT))
  })

  it('never shrinks dots below the default row height, however cramped', () => {
    expect(toneGridDotRadius(4)).toBe(toneGridDotRadius(TONE_GRID_ROW_HEIGHT))
    expect(toneGridDotRadius(TONE_GRID_ROW_HEIGHT)).toBeCloseTo(3, 5)
  })

  it('caps the radius so a very tall row is not overlapping blobs', () => {
    expect(toneGridDotRadius(400)).toBe(toneGridDotRadius(1000))
    expect(toneGridDotRadius(400)).toBeLessThanOrEqual(8)
  })

  it('actually draws bigger circles at a taller row height', () => {
    // The regression this guards: rowHeight was a prop, but the radius was hardcoded, so taller
    // rows changed the spacing and nothing else.
    const small = radii(renderAt(TONE_GRID_ROW_HEIGHT))
    const large = radii(renderAt(80))
    expect(small).toHaveLength(10)
    expect(large).toHaveLength(10)
    expect(Math.max(...large)).toBeGreaterThan(Math.max(...small))
  })

  it('reserves the same chrome regardless of row height', () => {
    // toneGridHeight is what the view uses to work out how many rows fit, so the fixed part has
    // to stay fixed or the auto-fit maths drifts.
    const oneRow = toneGridHeight(1, 40)
    const twoRows = toneGridHeight(2, 40)
    expect(twoRows - oneRow).toBe(40)
    expect(oneRow - 40).toBe(TONE_GRID_CHROME_HEIGHT)
  })

  it('keeps every mark on the plot when rows are tall', () => {
    expect(radii(renderAt(96, 20))).toHaveLength(20)
  })
})
