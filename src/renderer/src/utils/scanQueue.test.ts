import { describe, it, expect } from 'vitest'
import { estimateRenderMs, formatDuration, prefetchWindow } from './scanQueue'

describe('prefetchWindow', () => {
  it('renders what the cursor is on before anything speculative', () => {
    // Jumping somewhere cold must not leave the pressed row waiting behind its own neighbours.
    expect(prefetchWindow(50, 100)[0]).toBe(50)
  })

  it('leans ahead, because sweeps run forward', () => {
    const w = prefetchWindow(50, 100, { ahead: 6, behind: 2 })
    expect(w.filter((i) => i > 50)).toHaveLength(6)
    expect(w.filter((i) => i < 50)).toHaveLength(2)
  })

  it('orders by nearness so the next press is the most likely to be ready', () => {
    const w = prefetchWindow(50, 100, { ahead: 3, behind: 0 })
    expect(w).toEqual([50, 51, 52, 53])
  })

  it('clamps at both ends of the list', () => {
    expect(prefetchWindow(0, 3, { ahead: 5, behind: 5 })).toEqual([0, 1, 2])
    expect(prefetchWindow(2, 3, { ahead: 5, behind: 5 })).toEqual([2, 1, 0])
  })

  it('handles an empty list', () => {
    expect(prefetchWindow(0, 0)).toEqual([])
  })
})

describe('estimateRenderMs', () => {
  it('matches the measured cost of a 3s clip', () => {
    // 60ms fixed + 120ms/audio-second = 420ms, measured 406ms on real captures.
    expect(estimateRenderMs(1, 3, 1)).toBeCloseTo(420, 0)
  })

  it('divides across the worker pool', () => {
    expect(estimateRenderMs(100, 3, 4)).toBeCloseTo(estimateRenderMs(100, 3, 1) / 4, 5)
  })

  it('shows why the 12s preview clip is unusable for sweeping', () => {
    expect(estimateRenderMs(1, 12, 1)).toBeGreaterThan(1400)
    expect(estimateRenderMs(1, 3, 1)).toBeLessThan(500)
  })

  it('is zero for an empty scope and never negative', () => {
    expect(estimateRenderMs(0, 3)).toBe(0)
    expect(estimateRenderMs(-5, 3)).toBe(0)
    expect(estimateRenderMs(10, -1)).toBeGreaterThanOrEqual(0)
  })
})

describe('formatDuration', () => {
  it('reads naturally across the ranges a real scope hits', () => {
    expect(formatDuration(400)).toBe('under a second')
    expect(formatDuration(13_000)).toBe('about 13 s')
    expect(formatDuration(170_000)).toBe('about 3 min')
    expect(formatDuration(3_900_000)).toMatch(/^about 1 h/)
  })
})
