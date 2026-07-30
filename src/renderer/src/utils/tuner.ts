/**
 * Monophonic guitar tuner: autocorrelation pitch detection + nearest-note mapping.
 *
 * NEW util for the redesigned Live panel. Feed it a block of time-domain samples from the raw
 * (dry) input — see the LiveEngine patch in the handoff README (getInputTimeDomain). Runs cheaply
 * enough to poll from an animation frame.
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
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const A4 = 440

/** Root-mean-square amplitude of a buffer. */
function rms(buf: Float32Array): number {
  let sum = 0
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
  return Math.sqrt(sum / buf.length)
}

/**
 * Autocorrelation-based fundamental detection (ACF2+). Robust for a plucked guitar string in
 * the ~70-400 Hz range and cheap. Returns null below a noise-floor RMS so silence doesn't read
 * as a bogus note.
 */
export function detectFundamental(buf: Float32Array, sampleRate: number): number | null {
  if (rms(buf) < 0.01) return null

  // Trim leading/trailing samples below 20% of peak — tightens the correlation window.
  const size = buf.length
  const thresh = 0.2
  let start = 0
  let end = size - 1
  for (let i = 0; i < size / 2; i++) if (Math.abs(buf[i]) > thresh) { start = i; break }
  for (let i = 1; i < size / 2; i++) if (Math.abs(buf[size - i]) > thresh) { end = size - i; break }
  const trimmed = buf.subarray(start, end)
  const n = trimmed.length
  if (n < 2) return null

  const c = new Float32Array(n)
  for (let lag = 0; lag < n; lag++) {
    let sum = 0
    for (let i = 0; i < n - lag; i++) sum += trimmed[i] * trimmed[i + lag]
    c[lag] = sum
  }

  // Skip the zero-lag peak, find the first trough, then the max after it.
  let d = 0
  while (d < n - 1 && c[d] > c[d + 1]) d++
  let maxPos = -1
  let maxVal = -Infinity
  for (let i = d; i < n; i++) if (c[i] > maxVal) { maxVal = c[i]; maxPos = i }
  if (maxPos <= 0) return null

  // Parabolic interpolation around the peak for sub-sample accuracy.
  const x1 = c[maxPos - 1] ?? c[maxPos]
  const x2 = c[maxPos]
  const x3 = c[maxPos + 1] ?? c[maxPos]
  const a = (x1 + x3 - 2 * x2) / 2
  const b = (x3 - x1) / 2
  const period = a ? maxPos - b / (2 * a) : maxPos

  const hz = sampleRate / period
  if (hz < 40 || hz > 1200) return null
  return hz
}

/** Map a frequency to the nearest note + cents deviation. */
export function readPitch(buf: Float32Array, sampleRate: number): PitchReading {
  const hz = detectFundamental(buf, sampleRate)
  if (hz == null) return { hz: null, note: null, octave: null, cents: 0, inTune: false }

  const midi = 69 + 12 * Math.log2(hz / A4)
  const nearest = Math.round(midi)
  const cents = Math.round((midi - nearest) * 100)
  const note = NOTE_NAMES[((nearest % 12) + 12) % 12]
  const octave = Math.floor(nearest / 12) - 1
  return { hz, note, octave, cents, inTune: Math.abs(cents) <= 5 }
}
