import { describe, it, expect } from 'vitest'
import {
  TRIM_TAIL_PADDING_SEC,
  findImpulseEnd,
  impulseSeconds,
  trimImpulse,
  type ImpulseResponse
} from './impulseTrim'

const RATE = 48000

/** A decaying impulse followed by digital silence — the shape of a real reverb file. */
function paddedImpulse(audioSec: number, totalSec: number, peak = 0.5, channels = 1): ImpulseResponse {
  const total = Math.round(totalSec * RATE)
  const audio = Math.round(audioSec * RATE)
  return {
    channels: Array.from({ length: channels }, () => {
      const data = new Float32Array(total)
      for (let i = 0; i < audio; i++) {
        data[i] = peak * Math.exp((-6 * i) / audio) * Math.sin(i / 7)
      }
      return data
    }),
    sampleRate: RATE
  }
}

describe('findImpulseEnd', () => {
  it('finds the end of the audio, not the end of the file', () => {
    const ir = paddedImpulse(2, 10)
    const end = findImpulseEnd(ir.channels, RATE)
    expect(end / RATE).toBeGreaterThan(1)
    expect(end / RATE).toBeLessThan(2.5)
  })

  it('is relative to the impulse peak, so quiet and loud captures trim alike', () => {
    const loud = findImpulseEnd(paddedImpulse(2, 10, 0.9).channels, RATE)
    const quiet = findImpulseEnd(paddedImpulse(2, 10, 0.05).channels, RATE)
    expect(Math.abs(loud - quiet) / RATE).toBeLessThan(0.1)
  })

  it('trims to the longest channel, never clipping the other side', () => {
    // A stereo impulse whose right side rings longer than its left.
    const short = paddedImpulse(1, 10).channels[0]
    const long = paddedImpulse(3, 10).channels[0]
    const end = findImpulseEnd([short, long], RATE)
    expect(end / RATE).toBeGreaterThan(2.5)
  })

  it('returns 0 for pure silence rather than a bogus length', () => {
    expect(findImpulseEnd([new Float32Array(1000)], RATE)).toBe(0)
  })

  it('leaves padding after the last audible sample so the cut lands in silence', () => {
    const data = new Float32Array(RATE)
    data[0] = 1
    const end = findImpulseEnd([data], RATE)
    expect(end).toBeGreaterThanOrEqual(Math.round(TRIM_TAIL_PADDING_SEC * RATE))
  })
})

describe('trimImpulse', () => {
  it('cuts the silent padding a real reverb file is mostly made of', () => {
    // Proportions taken from the measured BigSky set: ~11s of audio in a 61s file.
    const ir = paddedImpulse(11, 61)
    const trimmed = trimImpulse(ir)
    expect(impulseSeconds(trimmed)).toBeLessThan(13)
    expect(impulseSeconds(trimmed)).toBeGreaterThan(10)
  })

  it('keeps every channel the same length, as a convolver requires', () => {
    const ir = paddedImpulse(2, 10, 0.5, 2)
    const trimmed = trimImpulse(ir)
    expect(trimmed.channels).toHaveLength(2)
    expect(trimmed.channels[0].length).toBe(trimmed.channels[1].length)
  })

  it('returns a short cabinet impulse untouched rather than copying it', () => {
    const cab: ImpulseResponse = {
      channels: [Float32Array.from({ length: 4096 }, (_, i) => Math.exp(-i / 400))],
      sampleRate: RATE
    }
    expect(trimImpulse(cab).channels[0]).toBe(cab.channels[0])
  })

  it('leaves an all-silent impulse alone instead of reducing it to nothing', () => {
    const silent: ImpulseResponse = { channels: [new Float32Array(1000)], sampleRate: RATE }
    expect(trimImpulse(silent)).toBe(silent)
  })

  it('does not crash on an empty impulse', () => {
    const empty: ImpulseResponse = { channels: [], sampleRate: RATE }
    expect(() => trimImpulse(empty)).not.toThrow()
    expect(impulseSeconds(empty)).toBe(0)
  })
})
