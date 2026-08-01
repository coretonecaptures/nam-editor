import { describe, it, expect } from 'vitest'
import { gainRamp, makeScale, nearestPoint, niceTicks, paddedDomain } from './scales'

describe('paddedDomain', () => {
  it('adds headroom on both ends so marks never sit on the axis', () => {
    const [lo, hi] = paddedDomain([0, 10], 0.1)
    expect(lo).toBeCloseTo(-1, 6)
    expect(hi).toBeCloseTo(11, 6)
  })

  it('never returns a zero-width domain for a single value', () => {
    // A zero span would make every scale divide by zero and stack all points on one pixel.
    const [lo, hi] = paddedDomain([0.5])
    expect(hi).toBeGreaterThan(lo)
  })

  it('handles a single value of exactly zero', () => {
    const [lo, hi] = paddedDomain([0])
    expect(hi).toBeGreaterThan(lo)
    expect(Number.isFinite(lo)).toBe(true)
  })

  it('falls back to a usable range for empty input', () => {
    expect(paddedDomain([])).toEqual([0, 1])
  })

  it('ignores non-finite values', () => {
    const [lo, hi] = paddedDomain([1, NaN, Infinity, 3], 0)
    expect(lo).toBeCloseTo(1, 6)
    expect(hi).toBeCloseTo(3, 6)
  })

  it('covers the real measured saturation range', () => {
    const [lo, hi] = paddedDomain([0.126, 0.741, 0.928])
    expect(lo).toBeLessThan(0.126)
    expect(hi).toBeGreaterThan(0.928)
  })
})

describe('makeScale', () => {
  it('maps domain ends onto range ends', () => {
    const scale = makeScale([0, 1], [0, 100])
    expect(scale(0)).toBeCloseTo(0, 6)
    expect(scale(1)).toBeCloseTo(100, 6)
    expect(scale(0.5)).toBeCloseTo(50, 6)
  })

  it('supports an inverted range, as SVG y axes need', () => {
    const scale = makeScale([0, 1], [100, 0])
    expect(scale(0)).toBeCloseTo(100, 6)
    expect(scale(1)).toBeCloseTo(0, 6)
  })

  it('maps logarithmically when asked', () => {
    const scale = makeScale([0.001, 0.1], [0, 100], true)
    expect(scale(0.001)).toBeCloseTo(0, 6)
    expect(scale(0.1)).toBeCloseTo(100, 6)
    // 0.01 is the geometric midpoint of 0.001..0.1
    expect(scale(0.01)).toBeCloseTo(50, 6)
  })

  it('does not divide by zero on a degenerate domain', () => {
    const scale = makeScale([2, 2], [0, 100])
    expect(Number.isFinite(scale(2))).toBe(true)
  })
})

describe('niceTicks', () => {
  it('returns round values inside the range', () => {
    const ticks = niceTicks(0, 1, 5)
    expect(ticks.length).toBeGreaterThan(2)
    for (const t of ticks) {
      expect(t).toBeGreaterThanOrEqual(0)
      expect(t).toBeLessThanOrEqual(1)
    }
  })

  it('does not emit float-drift values', () => {
    for (const t of niceTicks(0, 1, 5)) {
      expect(String(t).length).toBeLessThan(8)
    }
  })

  it('returns empty for a degenerate or non-finite range', () => {
    expect(niceTicks(1, 1)).toEqual([])
    expect(niceTicks(NaN, 1)).toEqual([])
  })

  it('returns decade-ish steps in log mode, all within range', () => {
    const ticks = niceTicks(0.001, 0.1, 4, true)
    expect(ticks.length).toBeGreaterThan(0)
    for (const t of ticks) {
      expect(t).toBeGreaterThanOrEqual(0.001)
      expect(t).toBeLessThanOrEqual(0.1)
    }
  })
})

describe('nearestPoint', () => {
  const points = [
    { id: 'a', px: 10, py: 10 },
    { id: 'b', px: 50, py: 50 },
    { id: 'c', px: 100, py: 12 }
  ]

  it('finds the closest point within the hit radius', () => {
    expect(nearestPoint(points, 12, 11, 14)?.id).toBe('a')
    expect(nearestPoint(points, 52, 48, 14)?.id).toBe('b')
  })

  it('returns null beyond the hit radius', () => {
    // Without this, clicking empty space would play whatever happened to be nearest.
    expect(nearestPoint(points, 300, 300, 14)).toBeNull()
  })

  it('picks the genuinely nearest when two are in range', () => {
    const close = [
      { id: 'near', px: 100, py: 100 },
      { id: 'far', px: 108, py: 100 }
    ]
    expect(nearestPoint(close, 101, 100, 20)?.id).toBe('near')
  })

  it('treats the radius as inclusive at its edge', () => {
    expect(nearestPoint([{ id: 'edge', px: 0, py: 0 }], 10, 0, 10)?.id).toBe('edge')
  })

  it('handles an empty point set', () => {
    expect(nearestPoint([], 0, 0)).toBeNull()
  })
})

describe('gainRamp', () => {
  it('runs cool at 0 and hot at 1', () => {
    expect(gainRamp(0)).toBe('rgb(56, 189, 248)')
    expect(gainRamp(1)).toBe('rgb(239, 68, 68)')
  })

  it('clamps out-of-range and non-finite input instead of producing NaN colours', () => {
    expect(gainRamp(-5)).toBe(gainRamp(0))
    expect(gainRamp(5)).toBe(gainRamp(1))
    expect(gainRamp(NaN)).toBe(gainRamp(0))
  })

  it('always returns a parseable rgb() string', () => {
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const match = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(gainRamp(t))
      expect(match, String(t)).not.toBeNull()
      for (const channel of match!.slice(1)) {
        expect(Number(channel)).toBeGreaterThanOrEqual(0)
        expect(Number(channel)).toBeLessThanOrEqual(255)
      }
    }
  })
})
