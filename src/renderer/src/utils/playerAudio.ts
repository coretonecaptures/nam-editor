/**
 * Pure audio helpers for the offline tone preview player.
 *
 * Kept separate from PlayerPanel so the level math can be unit tested without a DOM, an
 * AudioContext, or the WASM module. Getting this wrong is not a cosmetic bug — see
 * normalizeRendered below.
 */

/** Playback level the shipping NAM plugin normalizes models to. */
export const TARGET_LOUDNESS_DB = -18

/**
 * Peak ceiling applied after normalization. Slightly below 1.0 so the result can't clip when
 * converted to a 32-bit float AudioBuffer.
 */
export const PEAK_CEILING = 0.99

/** Target peak used when a model reports no loudness and we normalize by measured peak. */
export const PEAK_FALLBACK_TARGET = 0.7

/** Sample rate NAM models are trained at, used when a .nam doesn't declare one. */
export const DEFAULT_MODEL_SAMPLE_RATE = 48000

/**
 * Read the sample rate a model expects from its .nam JSON.
 *
 * This matters for tone, not just resampling hygiene: a model's receptive field and internal
 * filter coefficients are fixed at its training rate, so running a 48k model on 44.1k audio
 * shifts its whole frequency response. Real captures declare `sample_rate: 48000`; older or
 * hand-built files may omit it, in which case NAM's own default applies.
 */
export function readModelSampleRate(modelJson: string): number {
  try {
    const parsed = JSON.parse(modelJson) as { sample_rate?: unknown }
    const rate = parsed.sample_rate
    if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) return rate
  } catch {
    // Malformed JSON is the model loader's problem to report, not ours.
  }
  return DEFAULT_MODEL_SAMPLE_RATE
}

/**
 * Pick the start offset of the most energetic window of `windowSamples` length.
 *
 * Rendering the *head* of a DI file is a trap: real DI tracks routinely open with silence, a
 * count-in, or a quiet intro. One real case — an 84s "Dry Guitar.wav" whose first 12s measured
 * -41.8 dBFS peak / -66.4 dBFS RMS against -2.6 / -22.0 for the whole file. Feeding that to a
 * high-gain model produces near-silence AND no saturation, which reads to the user as "quiet,
 * and the amp has no gain" — not as "you picked a silent part of the file".
 *
 * Uses a coarse hop rather than every sample: we only need roughly the right region, and this
 * runs on up to several minutes of audio.
 */
export function findLoudestWindowStart(
  samples: Float32Array,
  windowSamples: number,
  hopSamples = 4096
): number {
  if (samples.length <= windowSamples) return 0

  const hop = Math.max(1, Math.floor(hopSamples))
  // Prefix sums of squares let each window's energy be an O(1) lookup instead of O(window).
  const buckets = Math.ceil(samples.length / hop)
  const cumulative = new Float64Array(buckets + 1)
  for (let b = 0; b < buckets; b++) {
    const start = b * hop
    const end = Math.min(samples.length, start + hop)
    let sum = 0
    for (let i = start; i < end; i++) {
      const v = samples[i]
      if (Number.isFinite(v)) sum += v * v
    }
    cumulative[b + 1] = cumulative[b] + sum
  }

  const windowBuckets = Math.max(1, Math.floor(windowSamples / hop))
  let bestStartBucket = 0
  let bestEnergy = -1
  for (let b = 0; b + windowBuckets <= buckets; b++) {
    const energy = cumulative[b + windowBuckets] - cumulative[b]
    if (energy > bestEnergy) {
      bestEnergy = energy
      bestStartBucket = b
    }
  }

  // Clamp so the window never runs past the end of the buffer.
  return Math.min(bestStartBucket * hop, samples.length - windowSamples)
}

/**
 * One-pole DC blocking high-pass, matching the shipping NAM plugin's output stage.
 *
 * High-gain models clip asymmetrically and can leave a DC offset, which wastes headroom and
 * muddies the low end. Upstream's real-time module applies the same filter with a 10Hz corner.
 * Mutates `samples` in place.
 */
export function applyDcBlocker(samples: Float32Array, sampleRate: number): void {
  const cutoffHz = 10
  const coefficient = 1 - (2 * Math.PI * cutoffHz) / sampleRate
  let previousInput = 0
  let previousOutput = 0
  for (let i = 0; i < samples.length; i++) {
    const input = samples[i]
    const output = input - previousInput + coefficient * previousOutput
    samples[i] = output
    previousInput = input
    previousOutput = output
  }
}

/** Decode a base64 payload (as returned by the readFileBinary IPC) into an ArrayBuffer. */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

/** Largest absolute sample value in a buffer. Ignores non-finite samples. */
export function peakOf(samples: Float32Array): number {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i])
    if (Number.isFinite(abs) && abs > peak) peak = abs
  }
  return peak
}

/**
 * Compute the playback gain for a rendered buffer.
 *
 * NAM model output is NOT normalized. A real A2 model in our test set renders a peak of ~10.0
 * from a 0.25-amplitude input — playing that raw would be violently loud and clip hard. So:
 *
 *   - When the model reports its own loudness, scale to TARGET_LOUDNESS_DB, matching how the
 *     real plugin normalizes.
 *   - When it doesn't (several real models carry no loudness metadata), fall back to scaling
 *     the measured peak to PEAK_FALLBACK_TARGET.
 *   - Either way, hard-limit the result to PEAK_CEILING. A wrong or extreme loudness value must
 *     never be able to produce a damaging level.
 */
export function computePlaybackGain(samples: Float32Array, loudnessDb: number | null): number {
  const peak = peakOf(samples)
  if (peak === 0) return 1

  let gain: number
  if (loudnessDb !== null && Number.isFinite(loudnessDb)) {
    gain = Math.pow(10, (TARGET_LOUDNESS_DB - loudnessDb) * 0.05)
  } else {
    gain = PEAK_FALLBACK_TARGET / peak
  }

  // Safety net — applies to both paths.
  const peakAfter = peak * gain
  if (peakAfter > PEAK_CEILING) gain *= PEAK_CEILING / peakAfter

  return gain
}

/**
 * Scale rendered model output to a safe, consistent playback level.
 *
 * Returns a new buffer; the input is not mutated. Non-finite samples are zeroed so a single NaN
 * can't silence or corrupt an entire AudioBuffer.
 */
export function normalizeRendered(
  samples: Float32Array,
  loudnessDb: number | null
): Float32Array<ArrayBuffer> {
  const gain = computePlaybackGain(samples, loudnessDb)
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i] * gain
    out[i] = Number.isFinite(v) ? v : 0
  }
  return out
}
