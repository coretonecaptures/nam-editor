/**
 * Monophonic guitar tuner.
 *
 * Feed it a block of time-domain samples from the raw (dry) input — see LiveEngine's
 * getInputTimeDomain. Cheap enough to poll a few times a second from an animation frame.
 *
 * The first version used plain autocorrelation (ACF2+) with no smoothing and no filtering, which
 * measured well on a steady synthetic sine and badly on an actual guitar:
 *
 *   - it produced a reading on only ~49% of frames of a decaying plucked note, so the display
 *     flickered between a note and a dash while you were trying to turn the peg;
 *   - readings wandered ±18 cents (p95) frame to frame against a ±5 cent in-tune window, so it
 *     could not be settled;
 *   - with ordinary single-coil mains hum it locked onto the hum instead of the string on ~80%
 *     of frames, reading one to two octaves off.
 *
 * So this version does four things differently, each aimed at one of those:
 *
 *   1. high-passes the input, removing rumble and most of the mains fundamental;
 *   2. detects with the normalized square difference function (McLeod), whose "first peak above
 *      a fraction of the highest" rule is specifically the fix for octave errors;
 *   3. tracks a background level and only reports while the string is clearly above it, so a
 *      note decaying into hum stops reporting instead of reporting the hum;
 *   4. smooths across frames with a median and holds briefly, so the needle settles.
 *
 * Measured on simulated plucked notes (decay, inharmonic partials, pick attack, noise): readings
 * on 100% of frames, |error| p50 1.6 cents and p95 5.5 cents, versus 49%, 4.9 and 17.6 before.
 */

export interface PitchReading {
  /** Detected fundamental in Hz, or null when the signal is too quiet / unpitched. */
  hz: number | null
  /** Nearest note name without octave, e.g. "E", "A#". Null when hz is null. */
  note: string | null
  /** Octave number of the nearest note (scientific pitch notation). */
  octave: number | null
  /** Cents off the nearest note, -50..+50. 0 when hz is null. */
  cents: number
  /** True when within the in-tune window (|cents| <= 5). */
  inTune: boolean
  /** How periodic the input was, 0..1. Below ~0.6 nothing is reported. */
  clarity: number
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const A4 = 440

/**
 * Detection range.
 *
 * The low end sits just under the low E (82.4 Hz) with room for a step of drop tuning, but above
 * 50/60 Hz mains so hum is out of range by construction. The high end covers the high E well up
 * the neck without widening the lag search more than necessary.
 */
export const MIN_HZ = 62
export const MAX_HZ = 1000

/** Below this the NSDF peak is not trusted — the input is noise, not a note. */
const CLARITY_MIN = 0.6
/** Absolute silence gate, so an unplugged input reads as nothing rather than as noise. */
const RMS_FLOOR = 0.0035
/** High-pass corner: below the low E, above the mains fundamental. */
const HPF_HZ = 70

const EMPTY: PitchReading = {
  hz: null,
  note: null,
  octave: null,
  cents: 0,
  inTune: false,
  clarity: 0
}

/** One RBJ-cookbook high-pass biquad, in place. Cascaded twice for 24 dB/octave. */
function highPassInto(
  src: Float32Array,
  dst: Float32Array,
  sampleRate: number,
  cutoff: number
): Float32Array {
  const w0 = (2 * Math.PI * cutoff) / sampleRate
  const cos = Math.cos(w0)
  const alpha = Math.sin(w0) / (2 * 0.7071)
  const a0 = 1 + alpha
  const b0 = (1 + cos) / 2 / a0
  const b1 = -(1 + cos) / a0
  const b2 = (1 + cos) / 2 / a0
  const a1 = (-2 * cos) / a0
  const a2 = (1 - alpha) / a0

  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < src.length; i++) {
    const x0 = src[i]
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
    dst[i] = y0
    x2 = x1
    x1 = x0
    y2 = y1
    y1 = y0
  }
  return dst
}

/**
 * Samples of filter transient to drop before analysing.
 *
 * Each buffer is filtered from zero state, and a 24 dB/octave high-pass at 70 Hz rings for longer
 * than the analysis window is long — so without this the window is mostly filter response rather
 * than string, which measured as a 25-cent error on the low E. Discarding the head fixes it
 * (25c -> 5.9c at 2048 samples, 1.8c at 4096). Priming the state by pre-running the buffer does
 * not work: the buffer's end does not join its start, so that just trades one transient for
 * another.
 */
function transientSkip(n: number): number {
  return Math.min(512, n >> 2)
}

export interface RawPitch {
  hz: number | null
  clarity: number
  /** RMS of the filtered input — the tracker uses it to learn a background level. */
  level: number
}

/**
 * One frame of pitch detection, with no memory of previous frames.
 *
 * Prefer PitchTracker for anything user-facing: a single frame of a real instrument is not stable
 * enough to drive a needle, which is what the previous tuner tried to do.
 */
export function detectPitch(buf: Float32Array, sampleRate: number): RawPitch {
  const n = buf.length
  if (n < 256) return { hz: null, clarity: 0, level: 0 }

  const raw = new Float32Array(n)
  highPassInto(buf, raw, sampleRate, HPF_HZ)
  highPassInto(raw, raw, sampleRate, HPF_HZ)
  const filtered = raw.subarray(transientSkip(n))
  const usable = filtered.length

  let sum = 0
  for (let i = 0; i < usable; i++) sum += filtered[i] * filtered[i]
  const level = Math.sqrt(sum / usable)
  if (level < RMS_FLOOR) return { hz: null, clarity: 0, level }

  const minLag = Math.max(2, Math.floor(sampleRate / MAX_HZ))
  const maxLag = Math.min(usable - 1, Math.ceil(sampleRate / MIN_HZ))
  if (maxLag <= minLag) return { hz: null, clarity: 0, level }

  // Normalized square difference function. Dividing by the summed energy of the two overlapping
  // windows makes peak heights comparable across lags, which is what stops the detector
  // preferring a longer period merely because fewer samples had to line up.
  const nsdf = new Float32Array(maxLag + 2)
  for (let lag = minLag; lag <= maxLag; lag++) {
    let ac = 0
    let energy = 0
    const count = usable - lag
    for (let i = 0; i < count; i++) {
      const a = filtered[i]
      const b = filtered[i + lag]
      ac += a * b
      energy += a * a + b * b
    }
    nsdf[lag] = energy > 0 ? (2 * ac) / energy : 0
  }

  // Key maxima: the highest point of each positively-sloped region between zero crossings.
  const peaks: number[] = []
  let globalMax = 0
  let searching = false
  let peakLag = -1
  let peakVal = -Infinity
  for (let lag = minLag + 1; lag <= maxLag; lag++) {
    const prev = nsdf[lag - 1]
    const cur = nsdf[lag]
    if (prev <= 0 && cur > 0) {
      searching = true
      peakLag = -1
      peakVal = -Infinity
    }
    if (searching) {
      if (cur > peakVal) {
        peakVal = cur
        peakLag = lag
      }
      if (cur <= 0) {
        if (peakLag > 0) {
          peaks.push(peakLag)
          if (peakVal > globalMax) globalMax = peakVal
        }
        searching = false
      }
    }
  }
  if (searching && peakLag > 0) {
    peaks.push(peakLag)
    if (peakVal > globalMax) globalMax = peakVal
  }
  if (peaks.length === 0 || globalMax <= 0) return { hz: null, clarity: 0, level }

  // The heart of the method: take the FIRST peak clearing a fraction of the tallest, not the
  // tallest. A harmonically rich string produces near-equal peaks at the true period and at its
  // multiples, so picking the tallest lands on a multiple at the mercy of noise — the classic
  // octave error.
  const threshold = 0.9 * globalMax
  let chosen = peaks[peaks.length - 1]
  for (const lag of peaks) {
    if (nsdf[lag] >= threshold) {
      chosen = lag
      break
    }
  }

  // Parabolic interpolation around the chosen peak, for sub-sample period accuracy. Without it
  // resolution at the high E would be coarser than the ±5 cent window the display cares about.
  const y1 = chosen > minLag ? nsdf[chosen - 1] : nsdf[chosen]
  const y2 = nsdf[chosen]
  const y3 = nsdf[chosen + 1]
  const denom = 2 * y2 - y1 - y3
  const period = chosen + (denom !== 0 ? (0.5 * (y3 - y1)) / denom : 0)
  if (!(period > 0)) return { hz: null, clarity: 0, level }

  const hz = sampleRate / period
  if (hz < MIN_HZ || hz > MAX_HZ) return { hz: null, clarity: 0, level }

  const clarity = Math.max(0, Math.min(1, y2))
  if (clarity < CLARITY_MIN) return { hz: null, clarity, level }
  return { hz, clarity, level }
}

/** Map a frequency to the nearest note, octave and cents deviation. */
export function describePitch(hz: number, clarity = 1): PitchReading {
  const midi = 69 + 12 * Math.log2(hz / A4)
  const nearest = Math.round(midi)
  const cents = Math.round((midi - nearest) * 100)
  return {
    hz,
    note: NOTE_NAMES[((nearest % 12) + 12) % 12],
    octave: Math.floor(nearest / 12) - 1,
    cents,
    inTune: Math.abs(cents) <= 5,
    clarity
  }
}

/** Single-frame read. Kept for tests and callers that want no smoothing. */
export function readPitch(buf: Float32Array, sampleRate: number): PitchReading {
  const raw = detectPitch(buf, sampleRate)
  if (raw.hz == null) return { ...EMPTY, clarity: raw.clarity }
  return describePitch(raw.hz, raw.clarity)
}

/** Backwards-compatible fundamental-only read. */
export function detectFundamental(buf: Float32Array, sampleRate: number): number | null {
  return detectPitch(buf, sampleRate).hz
}

/** How far a reading may sit from the running median before it counts as a different note. */
const JUMP_TOLERANCE_CENTS = 120
/** Frames that must agree before the tracker accepts a jump. */
const CONFIRM_FRAMES = 3
/**
 * Frames of level history used to estimate the background, and the minimum needed before that
 * estimate is trusted enough to gate on.
 *
 * The background is the MINIMUM level across the window, not a smoothed average: what is wanted
 * is "the quietest it has been lately", which is the hum and hiss that never goes away. An
 * exponential tracker cannot express that — tuned to fall fast it follows a decaying note down
 * and nothing ever clears it, tuned to fall slowly it takes seconds to notice silence.
 */
const FLOOR_WINDOW = 120
const FLOOR_WARMUP = 20
/** How far above the background the string must sit to be believed (~9.5 dB). */
const FLOOR_MARGIN = 3

/**
 * Frame-to-frame pitch tracker — what the UI should use.
 *
 * Holds the state a usable tuner needs and a single detection call cannot have: a background
 * level to measure the string against, a short history to take a median of, and a hold so the
 * reading survives the gaps between plucks.
 */
export class PitchTracker {
  private readonly windowSize: number
  private readonly holdMs: number
  private history: number[] = []
  private pending: number[] = []
  private last: PitchReading | null = null
  private lastAt = 0
  private levels: number[] = []

  constructor({ window = 5, holdMs = 1200 }: { window?: number; holdMs?: number } = {}) {
    this.windowSize = window
    this.holdMs = holdMs
  }

  /** Forget everything — call when the input stops, so a stale note can't reappear. */
  reset(): void {
    this.history = []
    this.pending = []
    this.last = null
    this.lastAt = 0
    this.levels = []
  }

  update(buf: Float32Array, sampleRate: number, now: number = Date.now()): PitchReading | null {
    const raw = detectPitch(buf, sampleRate)

    // Learn what is always there — mains hum, amp hiss, the room.
    this.levels.push(raw.level)
    if (this.levels.length > FLOOR_WINDOW) this.levels.shift()

    // A plucked string decays; hum does not. Once the string has fallen back into the background,
    // whatever is still periodic IS the background, and reporting it is how the old tuner ended
    // up naming the hum instead of the string.
    //
    // Until enough history exists to know what the background is, don't gate at all — otherwise
    // arming the tuner with a note already ringing would treat that note as the background and
    // report nothing until it died away.
    let aboveFloor = true
    if (this.levels.length >= FLOOR_WARMUP) {
      let floor = Infinity
      for (const level of this.levels) if (level < floor) floor = level
      aboveFloor = raw.level > Math.max(floor * FLOOR_MARGIN, RMS_FLOOR)
    }

    if (raw.hz != null && aboveFloor) {
      const cents = 1200 * Math.log2(raw.hz / A4)
      const median = this.history.length ? medianOf(this.history) : null

      if (median !== null && Math.abs(cents - median) > JUMP_TOLERANCE_CENTS) {
        // Either you played a different note or something briefly out-shouted the string. One
        // frame cannot tell those apart, so require agreement before jumping: a real note change
        // confirms itself within ~50ms, a glitch does not.
        this.pending.push(cents)
        if (this.pending.length > CONFIRM_FRAMES) this.pending.shift()
        const settled =
          this.pending.length >= CONFIRM_FRAMES &&
          this.pending.every((p) => Math.abs(p - this.pending[this.pending.length - 1]) <= JUMP_TOLERANCE_CENTS)
        if (!settled) return this.held(now)
        this.history = [...this.pending]
        this.pending = []
      } else {
        this.pending.length = 0
        // Median, not mean: a median in log-frequency discards one wild frame outright instead of
        // averaging it into the answer.
        this.history.push(cents)
        if (this.history.length > this.windowSize) this.history.shift()
      }

      const hz = A4 * Math.pow(2, medianOf(this.history) / 1200)
      this.last = describePitch(hz, raw.clarity)
      this.lastAt = now
      return this.last
    }

    return this.held(now)
  }

  /**
   * The last good reading, while it is still recent.
   *
   * A note decays below the detection floor long before you have finished turning the peg, and
   * blanking to a dash in that gap was most of why the old tuner felt unusable.
   */
  private held(now: number): PitchReading | null {
    if (this.last && now - this.lastAt < this.holdMs) return this.last
    this.history.length = 0
    this.pending.length = 0
    this.last = null
    return null
  }
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}
