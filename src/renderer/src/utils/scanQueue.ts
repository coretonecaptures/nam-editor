/**
 * Scan mode prefetch policy — pure, so the scheduling can be tested without audio or workers.
 *
 * Every capture must be rendered through the WASM model before it can be heard. Measured cost is
 * ~60 ms fixed plus ~120 ms per audio-second, so a 3 s scan clip is ~406 ms. That is far too slow
 * to start when the user presses a row; it has to already be done. Hence a pool rendering ahead
 * of wherever the user is looking.
 *
 * Sweeps run forward, so prefetch is deliberately asymmetric: mostly ahead, a little behind for
 * the very common "that one — go back" correction.
 */

export interface PrefetchPlan {
  /** Indices to start rendering now, in priority order. */
  start: number[]
  /** Cached indices safe to drop, least useful first. */
  evict: number[]
}

export interface PrefetchOptions {
  /** How far ahead of the cursor to keep rendered. */
  ahead?: number
  /** How far behind, for going back one. */
  behind?: number
  /** Renders allowed in flight at once — the worker pool size. */
  concurrency?: number
  /** Max rendered clips held in memory. */
  capacity?: number
}

const DEFAULTS: Required<PrefetchOptions> = {
  ahead: 8,
  behind: 2,
  concurrency: 4,
  capacity: 48
}

/**
 * Indices around `cursor`, nearest first, ahead prioritised over behind.
 *
 * The cursor itself comes first: if the user jumps somewhere cold, the thing they are pointing at
 * must be rendered before anything speculative.
 */
export function prefetchWindow(
  cursor: number,
  total: number,
  options: PrefetchOptions = {}
): number[] {
  const { ahead, behind } = { ...DEFAULTS, ...options }
  if (total <= 0) return []
  const clamp = (i: number): boolean => i >= 0 && i < total
  const out: number[] = []
  if (clamp(cursor)) out.push(cursor)
  for (let d = 1; d <= Math.max(ahead, behind); d++) {
    if (d <= ahead && clamp(cursor + d)) out.push(cursor + d)
    if (d <= behind && clamp(cursor - d)) out.push(cursor - d)
  }
  return out
}

/**
 * What to render next and what to drop.
 *
 * `done` and `inFlight` are passed in rather than held here so the caller keeps one source of
 * truth for cache state — a second copy inside the planner would inevitably drift from it.
 */
export function planPrefetch(
  cursor: number,
  total: number,
  done: ReadonlySet<number>,
  inFlight: ReadonlySet<number>,
  options: PrefetchOptions = {}
): PrefetchPlan {
  const opts = { ...DEFAULTS, ...options }
  const want = prefetchWindow(cursor, total, opts)

  const free = Math.max(0, opts.concurrency - inFlight.size)
  const start = want.filter((i) => !done.has(i) && !inFlight.has(i)).slice(0, free)

  // Evict by distance from the cursor, furthest first, and never evict anything still wanted -
  // dropping a clip we are about to need again would cause an audible stall on the next press.
  const keep = new Set(want)
  const evict =
    done.size <= opts.capacity
      ? []
      : [...done]
          .filter((i) => !keep.has(i) && !inFlight.has(i))
          .sort((a, b) => Math.abs(b - cursor) - Math.abs(a - cursor))
          .slice(0, done.size - opts.capacity)

  return { start, evict }
}

/**
 * Estimated wall-clock for rendering `count` captures, in ms.
 *
 * Measured on real captures: ~60 ms fixed model load/reset, ~120 ms per audio-second. Used to
 * warn before a big scope, since the cost scales with how much the user selected.
 */
export function estimateRenderMs(
  count: number,
  clipSeconds: number,
  concurrency = DEFAULTS.concurrency
): number {
  const per = 60 + 120 * Math.max(0, clipSeconds)
  return (Math.max(0, count) * per) / Math.max(1, concurrency)
}

/** "about 2 min", "about 25 s" — for the pre-scan warning. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return 'under a second'
  const s = Math.round(ms / 1000)
  if (s < 90) return `about ${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `about ${m} min`
  const h = Math.floor(m / 60)
  return `about ${h} h ${m % 60} min`
}
