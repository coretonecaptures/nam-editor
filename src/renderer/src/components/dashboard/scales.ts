/**
 * Pure scale / hit-testing helpers for the dashboard plots.
 *
 * Deliberately separate from Charts.tsx: that file contains JSX, which means a plain vitest run
 * can't import it without a JSX transform. Keeping this math in a .ts module makes it directly
 * unit-testable (see Charts.test.ts) and keeps pure functions out of a component file.
 *
 * Charts.tsx re-exports everything here, so existing call sites are unaffected.
 */

/* ─── Scale helpers ──────────────────────────────────────────────────────────────
   Extracted from EsrCurve, which computed all of this inline. Shared so ToneGrid (and any future
   plot) gets identical domain padding and tick behaviour instead of a second implementation. */

/**
 * Min/max of `values` with headroom added on both ends, so marks never sit on the axis.
 *
 * Returns a non-degenerate range even for a single value or an empty array — a zero-width domain
 * would make every scale divide by zero and stack every point on one pixel.
 */
export function paddedDomain(values: number[], frac = 0.06): [number, number] {
  const finite = values.filter((v) => Number.isFinite(v))
  if (finite.length === 0) return [0, 1]
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  if (min === max) {
    const nudge = Math.abs(min) > 1e-9 ? Math.abs(min) * frac : 0.5
    return [min - nudge, max + nudge]
  }
  const pad = (max - min) * frac
  return [min - pad, max + pad]
}

/** Map a value from `domain` into `range`. `log` uses log10 and clamps at a small epsilon. */
export function makeScale(
  domain: [number, number],
  range: [number, number],
  log = false
): (value: number) => number {
  const t = (v: number) => (log ? Math.log10(Math.max(v, 1e-9)) : v)
  const lo = t(domain[0])
  const hi = t(domain[1])
  const span = hi - lo || 1
  return (value: number) => range[0] + ((t(value) - lo) / span) * (range[1] - range[0])
}

/** Round tick values spanning [lo, hi]. Log mode returns decade-ish steps within range. */
export function niceTicks(lo: number, hi: number, count = 4, log = false): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) return []
  if (log) {
    return [0.0001, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1].filter((t) => t >= lo && t <= hi)
  }
  const raw = (hi - lo) / Math.max(1, count)
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10
  const first = Math.ceil(lo / step) * step
  const out: number[] = []
  for (let v = first; v <= hi + step * 1e-9; v += step) {
    // Re-round to kill float drift like 0.30000000000000004.
    out.push(Number(v.toFixed(10)))
  }
  return out
}

export interface PlottedPoint {
  id: string
  /** Pixel position, already scaled. */
  px: number
  py: number
}

/**
 * Nearest point to (x, y) within `hitRadius` pixels, or null.
 *
 * Deliberately shared by hover and click so the two can never disagree about what's under the
 * cursor. A linear scan is well under a millisecond even at a few thousand points.
 */
export function nearestPoint<T extends PlottedPoint>(
  points: T[],
  x: number,
  y: number,
  hitRadius = 14
): T | null {
  let best: T | null = null
  let bestDistSq = hitRadius * hitRadius
  for (const point of points) {
    const dx = point.px - x
    const dy = point.py - y
    const distSq = dx * dx + dy * dy
    if (distSq <= bestDistSq) {
      bestDistSq = distSq
      best = point
    }
  }
  return best
}

/**
 * Continuous cool→hot ramp for a normalized 0..1 value (sky → green → yellow → orange → red).
 *
 * Lifted out of FolderDashboard's D1GainStrip so the saturation strip and the Tone Map colour
 * identical values identically.
 */
export function gainRamp(t: number): string {
  const stops: Array<[number, number, number]> = [
    [56, 189, 248],
    [34, 197, 94],
    [234, 179, 8],
    [249, 115, 22],
    [239, 68, 68]
  ]
  const clamped = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0))
  const scaled = clamped * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(scaled))
  const f = scaled - i
  const [r1, g1, b1] = stops[i]
  const [r2, g2, b2] = stops[i + 1]
  return `rgb(${Math.round(r1 + (r2 - r1) * f)}, ${Math.round(g1 + (g2 - g1) * f)}, ${Math.round(b1 + (b2 - b1) * f)})`
}
