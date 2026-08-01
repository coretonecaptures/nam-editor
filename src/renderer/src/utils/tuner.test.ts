import { describe, it, expect } from 'vitest'
import { detectFundamental, readPitch } from './tuner'

const RATE = 48000

/** A steady tone, optionally with harmonics so it resembles a plucked string rather than a sine. */
function tone(hz: number, amplitude = 0.5, harmonics = 0, length = 2048): Float32Array {
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    let v = Math.sin((2 * Math.PI * hz * i) / RATE)
    for (let h = 2; h <= harmonics + 1; h++) {
      v += Math.sin((2 * Math.PI * hz * h * i) / RATE) / h
    }
    out[i] = (v / (1 + harmonics * 0.5)) * amplitude
  }
  return out
}

// Standard tuning, the frequencies this is actually for.
const STRINGS: Array<[string, number, string, number]> = [
  ['low E', 82.41, 'E', 2],
  ['A', 110.0, 'A', 2],
  ['D', 146.83, 'D', 3],
  ['G', 196.0, 'G', 3],
  ['B', 246.94, 'B', 3],
  ['high E', 329.63, 'E', 4]
]

describe('detectFundamental', () => {
  it('detects each open string within a few cents', () => {
    for (const [name, hz] of STRINGS) {
      const detected = detectFundamental(tone(hz), RATE)
      expect(detected, name).not.toBeNull()
      // Within ~1% — comfortably finer than the ±50 cent display range.
      expect(Math.abs(detected! - hz) / hz, name).toBeLessThan(0.01)
    }
  })

  it('locks to the fundamental, not a harmonic, on a harmonically rich note', () => {
    // A real guitar string is far from a pure sine; octave errors are the classic failure here.
    const detected = detectFundamental(tone(110, 0.5, 4), RATE)
    expect(detected).not.toBeNull()
    expect(Math.abs(detected! - 110) / 110).toBeLessThan(0.02)
  })

  it('returns null for silence rather than inventing a note', () => {
    expect(detectFundamental(new Float32Array(2048), RATE)).toBeNull()
  })

  it('returns null below the noise floor', () => {
    expect(detectFundamental(tone(110, 0.001), RATE)).toBeNull()
  })
})

describe('readPitch', () => {
  it('names the note and octave for each open string', () => {
    for (const [label, hz, note, octave] of STRINGS) {
      const reading = readPitch(tone(hz), RATE)
      expect(reading.note, label).toBe(note)
      expect(reading.octave, label).toBe(octave)
    }
  })

  it('reads in tune at concert A', () => {
    const reading = readPitch(tone(440), RATE)
    expect(reading.note).toBe('A')
    expect(reading.octave).toBe(4)
    expect(Math.abs(reading.cents)).toBeLessThanOrEqual(5)
    expect(reading.inTune).toBe(true)
  })

  it('reports sharp and flat with the correct sign', () => {
    // ~+31 cents and ~-31 cents off A440.
    const sharp = readPitch(tone(448), RATE)
    const flat = readPitch(tone(432), RATE)
    expect(sharp.cents).toBeGreaterThan(10)
    expect(flat.cents).toBeLessThan(-10)
    expect(sharp.inTune).toBe(false)
    expect(flat.inTune).toBe(false)
  })

  it('keeps cents inside the ±50 display range', () => {
    // Beyond ±50 the nearest note changes, so the needle must never run off its scale.
    for (let hz = 80; hz <= 400; hz += 3.7) {
      const reading = readPitch(tone(hz), RATE)
      if (reading.hz === null) continue
      expect(reading.cents, `${hz}Hz`).toBeGreaterThanOrEqual(-50)
      expect(reading.cents, `${hz}Hz`).toBeLessThanOrEqual(50)
    }
  })

  it('reports nothing for silence, so the tuner shows a dash rather than a stale note', () => {
    const reading = readPitch(new Float32Array(2048), RATE)
    expect(reading.hz).toBeNull()
    expect(reading.note).toBeNull()
    expect(reading.inTune).toBe(false)
  })

  it('does not crash on an empty buffer', () => {
    expect(() => readPitch(new Float32Array(0), RATE)).not.toThrow()
  })
})
