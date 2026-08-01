/**
 * Trimming for convolution impulses.
 *
 * A reverb impulse is nothing like a cabinet impulse, and the difference is not just length. A
 * measured example — a Strymon BigSky set — is 61.13 s, stereo, 44.1 kHz, of which the audio ends
 * around 11 s: roughly 82% of every file is silent padding. Convolving against that padding costs
 * real CPU per block and contributes nothing audible, so the tail is cut where the impulse has
 * decayed past hearing.
 *
 * The threshold is relative to the impulse's own peak rather than absolute, because impulses are
 * captured at wildly different levels (0.197 and 0.501 peak in that same folder).
 */

/** Decay depth below peak at which the tail is considered over. */
export const TRIM_THRESHOLD_DB = -72
/** Kept after the last audible sample so the cut lands in silence, not on a decaying tail. */
export const TRIM_TAIL_PADDING_SEC = 0.05

export interface ImpulseResponse {
  /** One Float32Array per channel. Reverb impulses are usually stereo; cabinets are mono. */
  channels: Float32Array[]
  sampleRate: number
}

/**
 * Index one past the last sample above the threshold, across all channels.
 *
 * Scanning backwards costs nothing on a padded file — it exits within the first few blocks — and
 * scanning ALL channels matters: a stereo impulse can decay at different rates per side, and
 * trimming to the shorter one would clip the other.
 */
export function findImpulseEnd(
  channels: Float32Array[],
  sampleRate: number,
  thresholdDb = TRIM_THRESHOLD_DB
): number {
  let peak = 0
  for (const channel of channels) {
    for (let i = 0; i < channel.length; i++) {
      const v = Math.abs(channel[i])
      if (v > peak) peak = v
    }
  }
  const length = channels[0]?.length ?? 0
  if (peak === 0) return 0

  const threshold = peak * Math.pow(10, thresholdDb / 20)
  let end = 0
  for (const channel of channels) {
    for (let i = channel.length - 1; i >= end; i--) {
      if (Math.abs(channel[i]) > threshold) {
        if (i + 1 > end) end = i + 1
        break
      }
    }
  }
  if (end === 0) return 0

  const padded = end + Math.round(TRIM_TAIL_PADDING_SEC * sampleRate)
  return Math.min(length, padded)
}

/**
 * Drop the inaudible tail.
 *
 * Returns the input untouched when there is nothing worth cutting, so a cabinet impulse — already
 * short and with no padding — is not copied for no reason.
 */
export function trimImpulse(ir: ImpulseResponse, thresholdDb = TRIM_THRESHOLD_DB): ImpulseResponse {
  const length = ir.channels[0]?.length ?? 0
  if (length === 0) return ir
  const end = findImpulseEnd(ir.channels, ir.sampleRate, thresholdDb)
  if (end === 0 || end >= length) return ir
  return {
    channels: ir.channels.map((channel) => channel.slice(0, end)),
    sampleRate: ir.sampleRate
  }
}

/** Seconds of impulse, for reporting how much convolution is actually being done. */
export function impulseSeconds(ir: ImpulseResponse): number {
  const length = ir.channels[0]?.length ?? 0
  return ir.sampleRate > 0 ? length / ir.sampleRate : 0
}
