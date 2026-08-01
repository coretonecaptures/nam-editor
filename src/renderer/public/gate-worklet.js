/**
 * Noise gate for the live input, ported from Neural Amp Modeler.
 *
 * ── ATTRIBUTION ──────────────────────────────────────────────────────────────
 * Ported from AudioDSPTools `dsp/NoiseGate.cpp` / `dsp/NoiseGate.h`
 * (https://github.com/sdatkinson/AudioDSPTools), which carries:
 *
 *   MIT License — Copyright (c) 2023 Steven Atkinson
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this software
 *   and associated documentation files (the "Software"), to deal in the Software without
 *   restriction, including without limitation the rights to use, copy, modify, merge, publish,
 *   distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
 *   Software is furnished to do so, subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in all copies or
 *   substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
 *   BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 *   NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 *   DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * MIT is permissive but not public domain — the notice above is the condition of reuse, and a
 * port is a derivative work, so it travels with this file. Do not remove it.
 *
 * ── WHY PORT RATHER THAN WRITE ONE ───────────────────────────────────────────
 * A gate is a few dozen lines and easy to write badly. This one is what NAM users already have on
 * their captures, so a hand-rolled substitute would gate the same guitar differently from the
 * plugin they compare against. Two details below are specifically NAM's and are the reason it
 * feels the way it does:
 *
 *  - Reduction is QUADRATIC in how far below threshold the level sits, not a hard switch. That is
 *    what makes it an expander that eases in rather than a gate that slams.
 *  - The state machine moves the reduction toward its target by AT MOST half the remaining
 *    distance per sample, bounded by the open/close rates. That damping is why fast attack times
 *    do not chatter on a decaying note.
 *
 * ── PLACEMENT ────────────────────────────────────────────────────────────────
 * This runs on the RAW INPUT, before the model. Gating after a high-gain model means gating noise
 * the model has already amplified and compressed, which chatters and breathes.
 */

const MINIMUM_LOUDNESS_DB = -120.0
const MINIMUM_LOUDNESS_POWER = Math.pow(10.0, MINIMUM_LOUDNESS_DB / 10.0)

const STATE_MOVING = 0
const STATE_HOLDING = 1

function levelToDb(level) {
  return 10.0 * Math.log10(level)
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

class GateProcessor extends AudioWorkletProcessor {
  constructor() {
    super()

    // NAM's defaults. `time` is the level detector's half-life, not an attack.
    this.enabled = false
    this.threshold = -60.0 // dB
    this.time = 0.01 // s, level-follower half-life
    this.ratio = 0.1 // dB reduction per dB below threshold, squared
    this.openTime = 0.005 // s
    this.holdTime = 0.05 // s
    this.closeTime = 0.05 // s

    this.level = MINIMUM_LOUDNESS_POWER
    this.state = STATE_MOVING
    this.lastGainReductionDB = this.maxGainReduction()
    this.timeHeld = 0.0

    this.port.onmessage = (event) => {
      const d = event.data || {}
      if (d.type !== 'params') return
      if (typeof d.enabled === 'boolean') this.enabled = d.enabled
      if (typeof d.threshold === 'number') this.threshold = d.threshold
      if (typeof d.openTime === 'number') this.openTime = Math.max(0.0001, d.openTime)
      if (typeof d.holdTime === 'number') this.holdTime = Math.max(0, d.holdTime)
      if (typeof d.closeTime === 'number') this.closeTime = Math.max(0.0001, d.closeTime)
      if (typeof d.ratio === 'number') this.ratio = Math.max(0.001, d.ratio)
    }
  }

  /** Quadratic below threshold, flat above. NAM's `_GetGainReduction`. */
  gainReduction(levelDB) {
    const d = levelDB - this.threshold
    return levelDB < this.threshold ? -this.ratio * d * d : 0.0
  }

  maxGainReduction() {
    return this.gainReduction(MINIMUM_LOUDNESS_DB)
  }

  process(inputs, outputs) {
    const input = inputs[0]
    const output = outputs[0]
    if (!output || output.length === 0) return true

    const inCh = input && input.length > 0 ? input[0] : null
    const out = output[0]
    const frames = out.length

    if (!inCh) {
      out.fill(0)
      return true
    }
    if (!this.enabled) {
      out.set(inCh)
      return true
    }

    const alpha = Math.pow(0.5, 1.0 / (this.time * sampleRate))
    const beta = 1.0 - alpha
    const dt = 1.0 / sampleRate
    const maxReduction = this.maxGainReduction()
    // Per-sample travel allowed while opening (positive) and closing (negative).
    const dOpen = -maxReduction / this.openTime * dt
    const dClose = maxReduction / this.closeTime * dt

    for (let s = 0; s < frames; s++) {
      const x = inCh[s]
      this.level = clamp(alpha * this.level + beta * (x * x), MINIMUM_LOUDNESS_POWER, 1000.0)
      const levelDB = levelToDb(this.level)

      if (this.state === STATE_HOLDING) {
        this.lastGainReductionDB = 0.0
        if (levelDB < this.threshold) {
          this.timeHeld += dt
          if (this.timeHeld >= this.holdTime) this.state = STATE_MOVING
        } else {
          this.timeHeld = 0.0
        }
      } else {
        const target = this.gainReduction(levelDB)
        if (target > this.lastGainReductionDB) {
          // Half the remaining distance per sample, capped by the open rate. The halving is the
          // damping that stops fast attacks chattering.
          const dGain = clamp(0.5 * (target - this.lastGainReductionDB), 0.0, dOpen)
          this.lastGainReductionDB += dGain
          if (this.lastGainReductionDB >= 0.0) {
            this.lastGainReductionDB = 0.0
            this.state = STATE_HOLDING
            this.timeHeld = 0.0
          }
        } else if (target < this.lastGainReductionDB) {
          const dGain = clamp(0.5 * (target - this.lastGainReductionDB), dClose, 0.0)
          this.lastGainReductionDB += dGain
          if (this.lastGainReductionDB < maxReduction) this.lastGainReductionDB = maxReduction
        }
      }

      // NAM splits trigger and gain into separate nodes so a sidechain can drive another signal;
      // here there is only ever one path, so the reduction is applied inline.
      out[s] = x * Math.pow(10.0, this.lastGainReductionDB / 20.0)
    }

    return true
  }
}

registerProcessor('nam-gate', GateProcessor)
