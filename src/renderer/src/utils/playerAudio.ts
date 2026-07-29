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
