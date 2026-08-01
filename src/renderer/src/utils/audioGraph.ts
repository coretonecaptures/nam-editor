/**
 * Offline audio helpers shared by the player and the Tone Map's auditioning.
 *
 * Extracted from `PlayerPanel` so both paths run captures through the *same* graph. They used to
 * diverge: auditions skipped the cabinet IR entirely, so an amp-only capture sounded harsh and
 * fizzy in the map and correct in the player — the same file, two different sounds, with nothing
 * on screen to explain why.
 */

export async function resampleTo(
  samples: Float32Array,
  sourceRate: number,
  targetRate: number
): Promise<Float32Array<ArrayBuffer>> {
  const copy = new Float32Array(samples.length)
  copy.set(samples)
  if (sourceRate === targetRate || samples.length === 0) return copy

  const targetLength = Math.max(1, Math.round((samples.length * targetRate) / sourceRate))
  const offline = new OfflineAudioContext(1, targetLength, targetRate)
  const sourceBuffer = offline.createBuffer(1, samples.length, sourceRate)
  sourceBuffer.copyToChannel(copy, 0)
  const node = offline.createBufferSource()
  node.buffer = sourceBuffer
  node.connect(offline.destination)
  node.start()
  const resampled = await offline.startRendering()
  const out = new Float32Array(resampled.length)
  resampled.copyFromChannel(out, 0)
  return out
}

/**
 * Convolve with a cabinet impulse response, mixing wet against dry.
 *
 * Parallel wet/dry gains rather than a single convolver, so `mix` can be anything between the raw
 * capture and a fully cab'd one.
 */
export async function applyCabinetIr(
  samples: Float32Array,
  sampleRate: number,
  irSamples: Float32Array,
  irSampleRate: number,
  mix: number
): Promise<Float32Array<ArrayBuffer>> {
  const wet = Math.max(0, Math.min(1, mix))
  const dry = 1 - wet
  if (samples.length === 0 || irSamples.length === 0 || wet === 0) {
    const passthrough = new Float32Array(samples.length)
    passthrough.set(samples)
    return passthrough
  }

  const offline = new OfflineAudioContext(1, samples.length + irSamples.length, sampleRate)
  const dryBuffer = offline.createBuffer(1, samples.length, sampleRate)
  dryBuffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0)
  const source = offline.createBufferSource()
  source.buffer = dryBuffer

  const irAtGraphRate = await resampleTo(irSamples, irSampleRate, sampleRate)
  const irBuffer = offline.createBuffer(1, irAtGraphRate.length, sampleRate)
  irBuffer.copyToChannel(irAtGraphRate, 0)

  const convolver = offline.createConvolver()
  convolver.normalize = false
  convolver.buffer = irBuffer

  const wetGain = offline.createGain()
  wetGain.gain.value = wet
  const dryGain = offline.createGain()
  dryGain.gain.value = dry

  source.connect(convolver)
  convolver.connect(wetGain)
  wetGain.connect(offline.destination)
  source.connect(dryGain)
  dryGain.connect(offline.destination)

  source.start()
  const rendered = await offline.startRendering()
  const out = new Float32Array(rendered.length)
  rendered.copyFromChannel(out, 0)
  return out
}
