/**
 * Delay parameter handling.
 *
 * setDelay clamps and stores before it touches any audio node, so this exercises the real method
 * with no AudioContext — the clamping is the part that must not be got wrong, because feedback at
 * or above unity is a runaway loop going straight into headphones.
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_CHORUS,
  DEFAULT_DELAY,
  DEFAULT_EQ,
  DEFAULT_REVERB,
  LiveEngine,
  MAX_DELAY_SECONDS,
  EQ_BASS_HZ,
  EQ_MAX_DB,
  EQ_MID_HZ,
  EQ_TREBLE_HZ,
  MAX_FEEDBACK,
  REVERB_EQ_MAX_DB,
  REVERB_HIGH_SHELF_HZ,
  REVERB_LOW_SHELF_HZ
} from './liveEngine'

function engine(): LiveEngine {
  return new LiveEngine()
}

describe('setDelay', () => {
  it('starts fully dry, so arming live never adds an effect you did not ask for', () => {
    expect(DEFAULT_DELAY.mix).toBe(0)
    expect(engine().delay).toEqual(DEFAULT_DELAY)
  })

  it('applies a partial update without disturbing the other parameters', () => {
    const e = engine()
    e.setDelay({ mix: 0.4 })
    expect(e.delay.mix).toBeCloseTo(0.4)
    expect(e.delay.timeMs).toBe(DEFAULT_DELAY.timeMs)
    expect(e.delay.feedback).toBe(DEFAULT_DELAY.feedback)
  })

  it('caps feedback below unity — at 1.0 the loop never decays', () => {
    const e = engine()
    e.setDelay({ feedback: 5 })
    expect(e.delay.feedback).toBe(MAX_FEEDBACK)
    expect(e.delay.feedback).toBeLessThan(1)
  })

  it('clamps mix to 0..1', () => {
    const e = engine()
    e.setDelay({ mix: 9 })
    expect(e.delay.mix).toBe(1)
    e.setDelay({ mix: -3 })
    expect(e.delay.mix).toBe(0)
  })

  it('keeps the delay time inside the allocated delay line', () => {
    const e = engine()
    e.setDelay({ timeMs: 999_999 })
    expect(e.delay.timeMs).toBeLessThanOrEqual(MAX_DELAY_SECONDS * 1000)
    e.setDelay({ timeMs: 0 })
    expect(e.delay.timeMs).toBeGreaterThan(0)
  })

  it('keeps the tone control inside audible range', () => {
    const e = engine()
    e.setDelay({ toneHz: 0 })
    expect(e.delay.toneHz).toBeGreaterThanOrEqual(200)
    e.setDelay({ toneHz: 200_000 })
    expect(e.delay.toneHz).toBeLessThanOrEqual(20000)
  })

  it('bounds the ratio so the right tap cannot collapse to zero or run past the line', () => {
    const e = engine()
    e.setDelay({ ratio: 0 })
    expect(e.delay.ratio).toBeGreaterThan(0)
    e.setDelay({ ratio: 50 })
    expect(e.delay.ratio).toBeLessThanOrEqual(2)
  })

  it('returns a copy, so callers cannot mutate engine state through the getter', () => {
    const e = engine()
    const snapshot = e.delay
    snapshot.mix = 1
    expect(e.delay.mix).toBe(DEFAULT_DELAY.mix)
  })
})

describe('setReverbMix', () => {
  it('clamps to 0..1', () => {
    const e = engine()
    e.setReverbMix(4)
    expect(e.reverbMixValue).toBe(1)
    e.setReverbMix(-1)
    expect(e.reverbMixValue).toBe(0)
  })
})

describe('setReverb', () => {
  it('starts off and on the plate, not on convolution', () => {
    // Convolution needs an impulse the user has not chosen yet, so it cannot be the default.
    expect(DEFAULT_REVERB.enabled).toBe(false)
    expect(DEFAULT_REVERB.mode).toBe('plate')
  })

  it('clamps every 0..1 control', () => {
    const e = engine()
    e.setReverb({ mix: 9, roomSize: -1, damping: 4, width: 77 })
    expect(e.reverb.mix).toBe(1)
    expect(e.reverb.roomSize).toBe(0)
    expect(e.reverb.damping).toBe(1)
    expect(e.reverb.width).toBe(1)
  })

  it('applies a partial update without losing the rest', () => {
    const e = engine()
    e.setReverb({ enabled: true, mode: 'convolution' })
    expect(e.reverb.enabled).toBe(true)
    expect(e.reverb.mode).toBe('convolution')
    expect(e.reverb.roomSize).toBe(DEFAULT_REVERB.roomSize)
  })

  it('returns a copy rather than the live object', () => {
    const e = engine()
    const snapshot = e.reverb
    snapshot.mix = 1
    expect(e.reverb.mix).toBe(DEFAULT_REVERB.mix)
  })
})

describe('setChorus', () => {
  it('is off by default', () => {
    expect(DEFAULT_CHORUS.enabled).toBe(false)
  })

  it('clamps depth and rate to sane musical ranges', () => {
    const e = engine()
    e.setChorus({ depthMs: 500 })
    expect(e.chorus.depthMs).toBeLessThanOrEqual(20)
    e.setChorus({ rateHz: 0 })
    expect(e.chorus.rateHz).toBeGreaterThan(0)
    e.setChorus({ rateHz: 100 })
    expect(e.chorus.rateHz).toBeLessThanOrEqual(8)
  })

  it('clamps mix to 0..1', () => {
    const e = engine()
    e.setChorus({ mix: -5 })
    expect(e.chorus.mix).toBe(0)
    e.setChorus({ mix: 5 })
    expect(e.chorus.mix).toBe(1)
  })
})

describe('delay enable', () => {
  it('is off by default, so arming live adds no effect you did not ask for', () => {
    expect(DEFAULT_DELAY.enabled).toBe(false)
  })
})

describe('reverb tone controls', () => {
  it('defaults to a gentle low cut, which is almost always wanted', () => {
    expect(DEFAULT_REVERB.lowDb).toBeLessThan(0)
    expect(DEFAULT_REVERB.highDb).toBe(0)
  })

  it('uses the standard mud and air corner frequencies', () => {
    // 200-400Hz is where a tail turns to mud; air lives above ~4kHz.
    expect(REVERB_LOW_SHELF_HZ).toBeGreaterThanOrEqual(200)
    expect(REVERB_LOW_SHELF_HZ).toBeLessThanOrEqual(400)
    expect(REVERB_HIGH_SHELF_HZ).toBeGreaterThanOrEqual(3000)
  })

  it('clamps shelf gain in both directions', () => {
    const e = engine()
    e.setReverb({ lowDb: -100, highDb: 100 })
    expect(e.reverb.lowDb).toBe(-REVERB_EQ_MAX_DB)
    expect(e.reverb.highDb).toBe(REVERB_EQ_MAX_DB)
  })

  it('allows both cut and boost on each shelf', () => {
    const e = engine()
    e.setReverb({ lowDb: 6, highDb: -6 })
    expect(e.reverb.lowDb).toBe(6)
    expect(e.reverb.highDb).toBe(-6)
  })
})

describe('ping-pong', () => {
  it('defaults on — the stereo behaviour is the reason the delay was built this way', () => {
    expect(DEFAULT_DELAY.pingPong).toBe(true)
  })

  it('toggles without disturbing the other delay settings', () => {
    const e = engine()
    e.setDelay({ timeMs: 500, feedback: 0.5, pingPong: false })
    expect(e.delay.pingPong).toBe(false)
    expect(e.delay.timeMs).toBe(500)
    expect(e.delay.feedback).toBeCloseTo(0.5)
    e.setDelay({ pingPong: true })
    expect(e.delay.pingPong).toBe(true)
    expect(e.delay.timeMs).toBe(500)
  })
})

describe('setEq', () => {
  it('is off and flat by default', () => {
    expect(DEFAULT_EQ.enabled).toBe(false)
    expect(DEFAULT_EQ.bassDb).toBe(0)
    expect(DEFAULT_EQ.midDb).toBe(0)
    expect(DEFAULT_EQ.trebleDb).toBe(0)
  })

  it('clamps every band in both directions', () => {
    const e = engine()
    e.setEq({ bassDb: 100, midDb: -100, trebleDb: 50 })
    expect(e.eq.bassDb).toBe(EQ_MAX_DB)
    expect(e.eq.midDb).toBe(-EQ_MAX_DB)
    expect(e.eq.trebleDb).toBe(EQ_MAX_DB)
  })

  it('keeps band settings when disabled, so re-enabling restores the same curve', () => {
    const e = engine()
    e.setEq({ enabled: true, bassDb: 4 })
    e.setEq({ enabled: false })
    expect(e.eq.bassDb).toBe(4)
    e.setEq({ enabled: true })
    expect(e.eq.bassDb).toBe(4)
  })

  it('uses conventional tone-stack centres', () => {
    expect(EQ_BASS_HZ).toBeLessThan(200)
    expect(EQ_MID_HZ).toBeGreaterThan(300)
    expect(EQ_MID_HZ).toBeLessThan(1200)
    expect(EQ_TREBLE_HZ).toBeGreaterThan(2000)
  })
})
