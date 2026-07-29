import { describe, it, expect } from 'vitest'
import {
  DEFAULT_MODEL_SAMPLE_RATE,
  PEAK_CEILING,
  PEAK_FALLBACK_TARGET,
  TARGET_LOUDNESS_DB,
  GEAR_TYPES_WITH_CAB,
  applyDcBlocker,
  captureNeedsCabIr,
  base64ToArrayBuffer,
  computePlaybackGain,
  findLoudestWindowStart,
  normalizeRendered,
  peakOf,
  readModelSampleRate,
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

describe('findLoudestWindowStart', () => {
  const RATE = 48000

  /** Silence with a loud burst placed at `burstStartSec`. */
  function silenceWithBurst(totalSec: number, burstStartSec: number, burstSec: number) {
    const out = new Float32Array(totalSec * RATE)
    const start = Math.floor(burstStartSec * RATE)
    const end = Math.min(out.length, start + Math.floor(burstSec * RATE))
    for (let i = start; i < end; i++) out[i] = Math.sin(i * 0.05) * 0.8
    return out
  }

  it('returns 0 when the buffer is not longer than the window', () => {
    expect(findLoudestWindowStart(new Float32Array(1000), 1000)).toBe(0)
    expect(findLoudestWindowStart(new Float32Array(500), 1000)).toBe(0)
  })

  // The exact real-world failure: an 84s DI whose first 12s were near-silent, so the preview
  // rendered silence and read as "quiet, and the high-gain amp has no gain".
  it('skips a silent intro and finds audio later in the file', () => {
    const samples = silenceWithBurst(84, 60, 12)
    const start = findLoudestWindowStart(samples, 12 * RATE)
    const startSec = start / RATE
    expect(startSec).toBeGreaterThan(30)
    expect(startSec).toBeLessThanOrEqual(72)
  })

  it('picks the louder of two candidate regions', () => {
    const samples = new Float32Array(30 * RATE)
    for (let i = 2 * RATE; i < 6 * RATE; i++) samples[i] = 0.1   // quiet early
    for (let i = 20 * RATE; i < 24 * RATE; i++) samples[i] = 0.9 // loud late
    const start = findLoudestWindowStart(samples, 4 * RATE)
    expect(start / RATE).toBeGreaterThan(10)
  })

  it('never returns a window that runs past the end of the buffer', () => {
    const samples = silenceWithBurst(20, 18, 5) // burst near the very end
    const windowSamples = 12 * RATE
    const start = findLoudestWindowStart(samples, windowSamples)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(start + windowSamples).toBeLessThanOrEqual(samples.length)
  })

  it('returns 0 for pure silence rather than failing', () => {
    expect(findLoudestWindowStart(new Float32Array(20 * RATE), 4 * RATE)).toBe(0)
  })

  it('tolerates non-finite samples', () => {
    const samples = silenceWithBurst(20, 10, 4)
    samples[0] = NaN
    samples[1] = Infinity
    const start = findLoudestWindowStart(samples, 4 * RATE)
    expect(Number.isFinite(start)).toBe(true)
    expect(start).toBeGreaterThan(0)
  })
})

describe('readModelSampleRate', () => {
  it('reads a declared sample rate', () => {
    expect(readModelSampleRate('{"sample_rate":48000}')).toBe(48000)
    expect(readModelSampleRate('{"sample_rate":44100}')).toBe(44100)
  })

  it('falls back to the NAM default when absent, invalid, or unparseable', () => {
    expect(readModelSampleRate('{"architecture":"WaveNet"}')).toBe(DEFAULT_MODEL_SAMPLE_RATE)
    expect(readModelSampleRate('{"sample_rate":null}')).toBe(DEFAULT_MODEL_SAMPLE_RATE)
    expect(readModelSampleRate('{"sample_rate":"48000"}')).toBe(DEFAULT_MODEL_SAMPLE_RATE)
    expect(readModelSampleRate('{"sample_rate":0}')).toBe(DEFAULT_MODEL_SAMPLE_RATE)
    expect(readModelSampleRate('not json')).toBe(DEFAULT_MODEL_SAMPLE_RATE)
  })
})

describe('applyDcBlocker', () => {
  it('removes a constant DC offset', () => {
    const samples = new Float32Array(48000).fill(0.5)
    applyDcBlocker(samples, 48000)
    // Settles toward zero; check well past the filter's startup.
    expect(Math.abs(samples[samples.length - 1])).toBeLessThan(0.05)
  })

  it('leaves an audio-band tone essentially intact', () => {
    const rate = 48000
    const make = () => {
      const a = new Float32Array(rate)
      for (let i = 0; i < a.length; i++) a[i] = Math.sin((2 * Math.PI * 440 * i) / rate) * 0.5
      return a
    }
    const filtered = make()
    applyDcBlocker(filtered, rate)
    // A 10Hz high-pass must barely touch 440Hz.
    expect(peakOf(filtered)).toBeGreaterThan(0.45)
  })

  it('handles an empty buffer', () => {
    const empty = new Float32Array(0)
    expect(() => applyDcBlocker(empty, 48000)).not.toThrow()
  })
})

describe('captureNeedsCabIr', () => {
  it('is false for captures that already contain a cabinet', () => {
    // Applying an IR to these would put two speakers in series.
    expect(captureNeedsCabIr('amp_cab')).toBe(false)
    expect(captureNeedsCabIr('amp_pedal_cab')).toBe(false)
  })

  it('is true for captures that are raw power-amp/preamp signal', () => {
    expect(captureNeedsCabIr('amp')).toBe(true)
    expect(captureNeedsCabIr('preamp')).toBe(true)
    expect(captureNeedsCabIr('pedal_amp')).toBe(true)
    expect(captureNeedsCabIr('pedal')).toBe(true)
  })

  it('is false when gear_type is unknown or missing', () => {
    // Better to leave an unclassifiable capture alone than to colour it wrongly; the user can
    // still switch the IR on by hand.
    expect(captureNeedsCabIr(null)).toBe(false)
    expect(captureNeedsCabIr(undefined)).toBe(false)
    expect(captureNeedsCabIr('')).toBe(false)
    expect(captureNeedsCabIr('studio')).toBe(true)
  })

  it('agrees with the exported cab-inclusive set', () => {
    for (const gearType of GEAR_TYPES_WITH_CAB) {
      expect(captureNeedsCabIr(gearType)).toBe(false)
    }
  })
})
