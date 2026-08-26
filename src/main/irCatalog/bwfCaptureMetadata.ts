/**
 * Parses IR Lab's own embedded capture metadata out of a WAV's BWF `bext` chunk fields (read by
 * wavHeader.ts's parseWavHeader, from the same 64KB buffer the scan already has in hand — no extra
 * I/O). Format confirmed against the ir-lab repo itself (WavIO.cpp's `buildBwavMetadata`,
 * documented in that repo's docs/ir-lab-manager-shared-catalog-schema.md): Description holds
 * "Key: value | Key: value | ..." pairs in a fixed order (Cabinet, Speaker, Microphone, Position,
 * Notes, CaptureType), blank fields omitted; Originator is always the literal string "IR Lab".
 *
 * This is opt-in on IR Lab's side and off by default, so its absence on any given WAV means
 * nothing — most files in the wild won't have it, either because the setting was off or the file
 * predates the feature (landed 2026-08-26). Never treat a missing/unparseable chunk as an error.
 */

export interface BwfCaptureMetadata {
  cabinet?: string
  speaker?: string
  microphone?: string
  position?: string
  notes?: string
  captureType?: string
}

/** Description keys, in the fixed order IR Lab writes them, mapped to our own field names. */
const KEY_TO_FIELD: Record<string, keyof BwfCaptureMetadata> = {
  Cabinet: 'cabinet',
  Speaker: 'speaker',
  Microphone: 'microphone',
  Position: 'position',
  Notes: 'notes',
  CaptureType: 'captureType'
}

/**
 * Returns null unless `originator` is exactly "IR Lab" — the doc's own "cheap way to tell an IR
 * Lab export apart from a WAV tagged by something else without parsing Description at all." A WAV
 * bext-tagged by some other tool would otherwise have its Description text misread as these
 * specific fields.
 */
export function parseBwfCaptureMetadata(description: string | null, originator: string | null): BwfCaptureMetadata | null {
  if (originator !== 'IR Lab') return null
  if (!description) return null

  const fields: BwfCaptureMetadata = {}
  for (const part of description.split('|')) {
    const colon = part.indexOf(':')
    if (colon === -1) continue
    const key = part.slice(0, colon).trim()
    const value = part.slice(colon + 1).trim()
    const field = KEY_TO_FIELD[key]
    if (field && value) fields[field] = value
  }
  return Object.keys(fields).length > 0 ? fields : null
}
