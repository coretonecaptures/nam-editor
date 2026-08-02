import { describe, it, expect } from 'vitest'
import { fxGridTemplate, fxLayoutFor } from './fxLayout'

/**
 * The panel's hard floor, set by the transport caps at TRANSPORT_SCALE. Nothing may break here.
 *
 * Kept as a literal rather than imported: pulling it from PlayerPanel would drag the whole
 * component — and every transport image it imports — into a test about arithmetic.
 */
const PLAYER_MIN = 311

describe('fxLayoutFor', () => {
  it('stays single-column and compact at the panel minimum', () => {
    const layout = fxLayoutFor(PLAYER_MIN)
    expect(layout.cardsPerRow).toBe(1)
    expect(layout.cardControls).toBe(1)
    expect(layout.reverbControls).toBe(1)
    expect(layout.compact).toBe(true)
  })

  it('never puts a compact row in a column — that would be the worst of both', () => {
    for (let width = 200; width < 560; width += 10) {
      const layout = fxLayoutFor(width)
      expect(layout.compact, `${width}px`).toBe(true)
      expect(layout.cardControls, `${width}px`).toBe(1)
      expect(layout.reverbControls, `${width}px`).toBe(1)
    }
  })

  it('puts Delay and Chorus side by side only once each half holds two controls', () => {
    // 716px: 32 page padding + two 336px cards + a 12px gap. Below it, stacked full-width cards
    // fit MORE controls per row than two narrow ones would, so going side by side would lose.
    expect(fxLayoutFor(700).cardsPerRow).toBe(1)
    expect(fxLayoutFor(716).cardsPerRow).toBe(2)
  })

  it('reaches three reverb columns at the width the mockup was drawn at', () => {
    expect(fxLayoutFor(710).reverbControls).toBe(3)
  })

  it('gives the full-width reverb card at least as many columns as a half-width card', () => {
    for (let width = PLAYER_MIN; width <= 1600; width += 13) {
      const layout = fxLayoutFor(width)
      expect(layout.reverbControls, `${width}px`).toBeGreaterThanOrEqual(layout.cardControls)
    }
  })

  it('never adds reverb columns and then takes them away', () => {
    let last = 0
    for (let width = PLAYER_MIN; width <= 1600; width += 7) {
      const columns = fxLayoutFor(width).reverbControls
      expect(columns, `${width}px`).toBeGreaterThanOrEqual(last)
      last = columns
    }
  })

  it('never gets TALLER as the panel gets wider', () => {
    // The invariant that actually matters, and the one a per-card column count cannot express:
    // going two-up halves each card's width, so more width can mean more rows unless the
    // threshold is set to forbid it. Delay has 7 controls, Chorus 3.
    const rows = (width: number): number => {
      const { cardsPerRow, cardControls } = fxLayoutFor(width)
      const delay = Math.ceil(7 / cardControls)
      const chorus = Math.ceil(3 / cardControls)
      return cardsPerRow === 2 ? Math.max(delay, chorus) : delay + chorus
    }
    // Compare only within the gridded region; compact rows are half-height and not comparable.
    let last = Infinity
    for (let width = 560; width <= 1600; width += 3) {
      const height = rows(width)
      expect(height, `${width}px`).toBeLessThanOrEqual(last)
      last = height
    }
  })

  it('only goes two-up when each card can still hold two controls across', () => {
    for (let width = 560; width <= 1600; width += 7) {
      const layout = fxLayoutFor(width)
      if (layout.cardsPerRow === 2) {
        expect(layout.cardControls, `${width}px`).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('caps at three columns, however wide the panel gets', () => {
    expect(fxLayoutFor(4000).reverbControls).toBe(3)
    expect(fxLayoutFor(4000).cardControls).toBe(3)
  })

  it('leaves every control at least 150px of its own', () => {
    const PAGE_PADDING = 32
    const CARD_PADDING = 24
    const CARD_GAP = 12
    const CONTROL_GAP = 12
    for (let width = 560; width <= 1600; width += 11) {
      const layout = fxLayoutFor(width)
      const content = width - PAGE_PADDING
      const cardWidth = layout.cardsPerRow === 2 ? (content - CARD_GAP) / 2 : content
      const per = (n: number, outer: number): number =>
        (outer - CARD_PADDING - CONTROL_GAP * (n - 1)) / n
      expect(per(layout.cardControls, cardWidth), `card @ ${width}px`).toBeGreaterThanOrEqual(150)
      expect(per(layout.reverbControls, content), `reverb @ ${width}px`).toBeGreaterThanOrEqual(150)
    }
  })

  it('survives a zero or nonsense width rather than throwing', () => {
    for (const width of [0, -100, NaN]) {
      expect(() => fxLayoutFor(width)).not.toThrow()
      expect(fxLayoutFor(width).cardControls).toBe(1)
    }
  })
})

describe('fxGridTemplate', () => {
  it('builds an equal-column template', () => {
    expect(fxGridTemplate(3)).toBe('repeat(3, minmax(0, 1fr))')
  })

  it('never emits a zero-column grid', () => {
    expect(fxGridTemplate(0)).toBe('repeat(1, minmax(0, 1fr))')
  })
})
