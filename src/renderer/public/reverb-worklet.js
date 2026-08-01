/**
 * Algorithmic plate/room reverb — Freeverb, on the audio thread.
 *
 * WHY THIS EXISTS ALONGSIDE CONVOLUTION
 * -------------------------------------
 * Convolution can only reproduce a LINEAR, TIME-INVARIANT system. Most "reverb IR" packs are not
 * that: captures of Strymon BigSky patches such as Shimmer (pitch shifting), Chorale (formant
 * shifting), Bloom and Swell (envelope-driven) and everything under Nonlinear are, by their own
 * names, neither linear nor time-invariant. Convolving with them yields a frozen smear of the
 * patch rather than the patch — the "space, then a huge blooming tunnel" that a real BigSky never
 * makes. No amount of care in the convolution path fixes that; it is a property of the maths.
 *
 * So this is the reverb for when you want a reverb, and convolution is for genuine room, hall and
 * plate impulses, where its accuracy is unbeatable.
 *
 * THE ALGORITHM
 * -------------
 * Freeverb, by Jezar at Dreampoint — released to the public domain and the most widely reused
 * reverb design there is. Eight parallel damped comb filters build the tail, four series allpass
 * filters smear it into diffusion, and the whole thing runs per channel with the comb lengths
 * offset between left and right to open out the stereo image.
 *
 * Written in plain JS rather than WASM deliberately: it is a handful of multiply-adds per sample
 * with no allocation in the audio callback, which V8 handles comfortably, and it keeps the build
 * free of another native artefact.
 *
 * Tunings are Jezar's originals, in samples at 44.1kHz, scaled for the running sample rate so the
 * room does not change size when the device does.
 */

const COMB_TUNING = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]
const ALLPASS_TUNING = [556, 441, 341, 225]
/** Right-channel offset. This is what makes the two sides decorrelate into a stereo field. */
const STEREO_SPREAD = 23
const TUNING_RATE = 44100

// Jezar's scaling constants. They map the 0..1 user controls onto the ranges the filters
// actually behave over, and are not arbitrary — roomsize below ~0.7 stops sustaining at all.
const FIXED_GAIN = 0.015
const SCALE_DAMP = 0.4
const SCALE_ROOM = 0.28
const OFFSET_ROOM = 0.7

/** One damped comb filter: a delay line whose feedback is lowpassed, so highs decay first. */
class Comb {
  constructor(size) {
    this.buffer = new Float32Array(size)
    this.index = 0
    this.filterStore = 0
    this.feedback = 0.5
    this.damp1 = 0.5
    this.damp2 = 0.5
  }
  setDamp(value) {
    this.damp1 = value
    this.damp2 = 1 - value
  }
  process(input) {
    const output = this.buffer[this.index]
    // One-pole lowpass in the feedback path — the reason a tail gets darker as it dies away
    // instead of ringing bright forever.
    this.filterStore = output * this.damp2 + this.filterStore * this.damp1
    this.buffer[this.index] = input + this.filterStore * this.feedback
    if (++this.index >= this.buffer.length) this.index = 0
    return output
  }
  mute() {
    this.buffer.fill(0)
    this.filterStore = 0
  }
}

/** Schroeder allpass: flat magnitude, scrambled phase. Diffusion without colouration. */
class Allpass {
  constructor(size) {
    this.buffer = new Float32Array(size)
    this.index = 0
    this.feedback = 0.5
  }
  process(input) {
    const bufout = this.buffer[this.index]
    const output = -input + bufout
    this.buffer[this.index] = input + bufout * this.feedback
    if (++this.index >= this.buffer.length) this.index = 0
    return output
  }
  mute() {
    this.buffer.fill(0)
  }
}

class FreeverbProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    const scale = sampleRate / TUNING_RATE
    const size = (n) => Math.max(4, Math.round(n * scale))

    this.combsL = COMB_TUNING.map((t) => new Comb(size(t)))
    this.combsR = COMB_TUNING.map((t) => new Comb(size(t + STEREO_SPREAD)))
    this.allpassL = ALLPASS_TUNING.map((t) => new Allpass(size(t)))
    this.allpassR = ALLPASS_TUNING.map((t) => new Allpass(size(t + STEREO_SPREAD)))

    this.roomSize = 0.72
    this.damping = 0.5
    this.width = 1
    this.applyRoom()
    this.applyDamp()

    this.port.onmessage = (event) => {
      const data = event.data || {}
      if (data.type === 'params') {
        if (typeof data.roomSize === 'number') {
          this.roomSize = Math.max(0, Math.min(1, data.roomSize))
          this.applyRoom()
        }
        if (typeof data.damping === 'number') {
          this.damping = Math.max(0, Math.min(1, data.damping))
          this.applyDamp()
        }
        if (typeof data.width === 'number') this.width = Math.max(0, Math.min(1, data.width))
      } else if (data.type === 'mute') {
        for (const c of this.combsL) c.mute()
        for (const c of this.combsR) c.mute()
        for (const a of this.allpassL) a.mute()
        for (const a of this.allpassR) a.mute()
      }
    }
  }

  applyRoom() {
    const feedback = this.roomSize * SCALE_ROOM + OFFSET_ROOM
    for (const c of this.combsL) c.feedback = feedback
    for (const c of this.combsR) c.feedback = feedback
  }

  applyDamp() {
    const damp = this.damping * SCALE_DAMP
    for (const c of this.combsL) c.setDamp(damp)
    for (const c of this.combsR) c.setDamp(damp)
  }

  /**
   * Emits 100% wet. Dry/wet balance is a GainNode's job in the graph outside, which keeps the mix
   * automatable and means this never has to know the dry signal's level.
   */
  process(inputs, outputs) {
    const input = inputs[0]
    const output = outputs[0]
    if (!output || output.length === 0) return true

    const outL = output[0]
    const outR = output.length > 1 ? output[1] : null
    const frames = outL.length

    // A disconnected input arrives as an empty array; render silence rather than bailing, so the
    // tail continues to decay instead of freezing when the source stops.
    const inL = input && input.length > 0 ? input[0] : null
    const inR = input && input.length > 1 ? input[1] : inL

    const wet1 = this.width / 2 + 0.5
    const wet2 = (1 - this.width) / 2

    for (let i = 0; i < frames; i++) {
      const l = inL ? inL[i] : 0
      const r = inR ? inR[i] : l
      const mono = (l + r) * FIXED_GAIN

      let accL = 0
      let accR = 0
      for (let c = 0; c < this.combsL.length; c++) {
        accL += this.combsL[c].process(mono)
        accR += this.combsR[c].process(mono)
      }
      for (let a = 0; a < this.allpassL.length; a++) {
        accL = this.allpassL[a].process(accL)
        accR = this.allpassR[a].process(accR)
      }

      // Cross-blending by width: at 1 the sides stay separate, at 0 they collapse to mono.
      outL[i] = accL * wet1 + accR * wet2
      if (outR) outR[i] = accR * wet1 + accL * wet2
    }

    return true
  }
}

registerProcessor('freeverb', FreeverbProcessor)
