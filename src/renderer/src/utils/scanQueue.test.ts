import { describe, it, expect } from 'vitest'
import { estimateRenderMs, formatDuration, planPrefetch, prefetchWindow } from './scanQueue'

const S = (...n: number[]): Set<number> => new Set(n)

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

describe('planPrefetch', () => {
  it('starts no more than the pool can run', () => {
    const { start } = planPrefetch(0, 100, S(), S(), { concurrency: 3 })
    expect(start).toHaveLength(3)
  })

  it('accounts for renders already running', () => {
    const { start } = planPrefetch(0, 100, S(), S(0, 1), { concurrency: 3 })
    expect(start).toHaveLength(1)
    expect(start).not.toContain(0)
    expect(start).not.toContain(1)
  })

  it('never re-renders something already cached', () => {
    const { start } = planPrefetch(0, 100, S(0, 1, 2), S(), { concurrency: 4 })
    expect(start.some((i) => [0, 1, 2].includes(i))).toBe(false)
  })

  it('starts nothing when the pool is full', () => {
    expect(planPrefetch(0, 100, S(), S(0, 1, 2, 3), { concurrency: 4 }).start).toEqual([])
  })

  it('evicts nothing until over capacity', () => {
    const done = S(...Array.from({ length: 10 }, (_, i) => i))
    expect(planPrefetch(0, 100, done, S(), { capacity: 10 }).evict).toEqual([])
  })

  it('evicts the furthest from the cursor first', () => {
    const done = S(...Array.from({ length: 12 }, (_, i) => i * 10)) // 0,10,...,110
    const { evict } = planPrefetch(0, 200, done, S(), { capacity: 10, ahead: 1, behind: 0 })
    expect(evict).toHaveLength(2)
    expect(evict[0]).toBe(110)
  })

  it('never evicts something inside the prefetch window', () => {
    // Dropping a clip we are about to need again would stall audibly on the next press.
    const done = S(...Array.from({ length: 30 }, (_, i) => i))
    const { evict } = planPrefetch(5, 100, done, S(), { capacity: 4, ahead: 8, behind: 2 })
    const want = new Set(prefetchWindow(5, 100, { ahead: 8, behind: 2 }))
    expect(evict.some((i) => want.has(i))).toBe(false)
  })

  it('never evicts something still rendering', () => {
    const done = S(...Array.from({ length: 20 }, (_, i) => i + 50))
    const { evict } = planPrefetch(0, 100, done, S(60, 61), { capacity: 2 })
    expect(evict).not.toContain(60)
    expect(evict).not.toContain(61)
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
