import { describe, it, expect } from 'vitest'
import {
  PEAK_CEILING,
  PEAK_FALLBACK_TARGET,
  TARGET_LOUDNESS_DB,
  base64ToArrayBuffer,
  computePlaybackGain,
  normalizeRendered,
  peakOf,
} from './playerAudio'

/** Build a buffer whose peak is exactly `peak`. */
function bufferWithPeak(peak: number, length = 64): Float32Array {
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) out[i] = Math.sin((i / length) * Math.PI * 2) * peak
  // Guarantee the exact peak is present regardless of sampling.
  out[0] = peak
  return out
}

describe('peakOf', () => {
  it('finds the largest absolute value', () => {
    expect(peakOf(new Float32Array([0.1, -0.8, 0.3]))).toBeCloseTo(0.8)
  })

  it('returns 0 for silence and for an empty buffer', () => {
    expect(peakOf(new Float32Array([0, 0, 0]))).toBe(0)
    expect(peakOf(new Float32Array(0))).toBe(0)
  })

  it('ignores non-finite samples rather than returning NaN/Infinity', () => {
    expect(peakOf(new Float32Array([0.5, NaN, Infinity, -0.2]))).toBeCloseTo(0.5)
  })
})

describe('computePlaybackGain', () => {
  describe('with loudness metadata', () => {
    it('scales a quiet model up toward the target loudness', () => {
      // 20dB below target -> 10x gain, before any peak limiting.
      const samples = bufferWithPeak(0.01)
      const gain = computePlaybackGain(samples, TARGET_LOUDNESS_DB - 20)
      expect(gain).toBeCloseTo(10, 4)
    })

    it('scales a loud model down toward the target loudness', () => {
      const samples = bufferWithPeak(0.05)
      const gain = computePlaybackGain(samples, TARGET_LOUDNESS_DB + 20)
      expect(gain).toBeCloseTo(0.1, 4)
    })

    it('leaves a model already at target loudness alone', () => {
      const samples = bufferWithPeak(0.1)
      expect(computePlaybackGain(samples, TARGET_LOUDNESS_DB)).toBeCloseTo(1, 6)
    })
  })

  describe('without loudness metadata', () => {
    it('normalizes the measured peak to the fallback target', () => {
      const samples = bufferWithPeak(0.35)
      const gain = computePlaybackGain(samples, null)
      expect(peakOf(samples) * gain).toBeCloseTo(PEAK_FALLBACK_TARGET, 5)
    })

    it('brings a hot buffer down, not up', () => {
      const samples = bufferWithPeak(8)
      expect(computePlaybackGain(samples, null)).toBeLessThan(1)
    })

    it('treats a non-finite loudness value as missing metadata', () => {
      const samples = bufferWithPeak(0.35)
      const viaNaN = computePlaybackGain(samples, NaN)
      const viaNull = computePlaybackGain(samples, null)
      expect(viaNaN).toBeCloseTo(viaNull, 6)
    })
  })

  describe('safety limiting', () => {
    // The case that motivated all of this: wavenet_a2_max.nam renders a peak of ~10.0 from a
    // 0.25-amplitude input. Played raw that is violently loud and clips hard.
    it('tames the real-world ~10.0 peak A2 case to within the ceiling', () => {
      const samples = bufferWithPeak(10.0)
      const gain = computePlaybackGain(samples, -20)
      expect(peakOf(samples) * gain).toBeLessThanOrEqual(PEAK_CEILING + 1e-6)
    })

    it('never exceeds the ceiling across a wide range of peaks and loudness values', () => {
      for (const peak of [0.001, 0.1, 1, 10, 100]) {
        for (const loudness of [null, -60, -20, -18, 0, 40]) {
          const samples = bufferWithPeak(peak)
          const gain = computePlaybackGain(samples, loudness)
          expect(peakOf(samples) * gain).toBeLessThanOrEqual(PEAK_CEILING + 1e-6)
        }
      }
    })

    it('does not attenuate quiet material that is already under the ceiling', () => {
      const samples = bufferWithPeak(0.02)
      // 6dB of boost requested; well under the ceiling, so it should be applied in full.
      const gain = computePlaybackGain(samples, TARGET_LOUDNESS_DB - 6)
      expect(gain).toBeCloseTo(Math.pow(10, 6 * 0.05), 4)
    })
  })

  it('returns unity for pure silence instead of dividing by zero', () => {
    expect(computePlaybackGain(new Float32Array(32), null)).toBe(1)
    expect(computePlaybackGain(new Float32Array(32), -20)).toBe(1)
  })
})

describe('normalizeRendered', () => {
  it('does not mutate the input buffer', () => {
    const samples = bufferWithPeak(5)
    const before = Float32Array.from(samples)
    normalizeRendered(samples, -20)
    expect(Array.from(samples)).toEqual(Array.from(before))
  })

  it('returns a buffer of the same length', () => {
    const samples = bufferWithPeak(0.5, 128)
    expect(normalizeRendered(samples, null)).toHaveLength(128)
  })

  it('keeps output within the peak ceiling', () => {
    const samples = bufferWithPeak(12)
    expect(peakOf(normalizeRendered(samples, -20))).toBeLessThanOrEqual(PEAK_CEILING + 1e-6)
  })

  it('preserves waveform shape (scaling only)', () => {
    const samples = new Float32Array([0.1, -0.2, 0.4, -0.05])
    const out = normalizeRendered(samples, null)
    const ratio = out[0] / samples[0]
    for (let i = 0; i < samples.length; i++) {
      expect(out[i]).toBeCloseTo(samples[i] * ratio, 5)
    }
  })

  it('zeroes non-finite samples so one NaN cannot poison the buffer', () => {
    const samples = new Float32Array([0.5, NaN, -0.5, Infinity])
    const out = normalizeRendered(samples, null)
    expect(out.every((v) => Number.isFinite(v))).toBe(true)
    expect(out[1]).toBe(0)
    expect(out[3]).toBe(0)
    expect(Math.abs(out[0])).toBeGreaterThan(0)
  })

  it('handles an empty buffer', () => {
    expect(normalizeRendered(new Float32Array(0), null)).toHaveLength(0)
  })

  it('leaves silence silent', () => {
    const out = normalizeRendered(new Float32Array(16), -20)
    expect(out.every((v) => v === 0)).toBe(true)
  })
})

describe('base64ToArrayBuffer', () => {
  it('round-trips bytes', () => {
    const original = new Uint8Array([0, 1, 127, 128, 255, 42])
    const base64 = Buffer.from(original).toString('base64')
    expect(Array.from(new Uint8Array(base64ToArrayBuffer(base64)))).toEqual(Array.from(original))
  })

  it('decodes text payloads (how .nam JSON arrives over IPC)', () => {
    const json = '{"architecture":"WaveNet"}'
    const decoded = base64ToArrayBuffer(Buffer.from(json, 'utf8').toString('base64'))
    expect(new TextDecoder().decode(decoded)).toBe(json)
  })

  it('handles an empty payload', () => {
    expect(base64ToArrayBuffer('').byteLength).toBe(0)
  })
})
