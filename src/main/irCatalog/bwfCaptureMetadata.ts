/**
 * Parses IR Lab's own embedded capture metadata out of a WAV's BWF `bext` chunk fields (read by
 * wavHeader.ts's parseWavHeader, from the same 64KB buffer the scan already has in hand — no extra
 * I/O). Format confirmed against the ir-lab repo itself (WavIO.cpp's `buildBwavMetadata`,
 * documented in that repo's docs/ir-lab-manager-shared-catalog-schema.md): Description holds
 * "Key: value | Key: value | ..." pairs, blank fields omitted, in order Cabinet, Speaker,
 * Microphone, Position, CaptureType, MicADistance, Notes — though this parser splits on "|" and
 * reads each "Key: value" pair independently, so the order IR Lab writes them in doesn't actually
 * matter here. Originator is always the literal string "IR Lab".
 *
 * Only ONE of the 22 fields the 2026-08-26 metadata model added — MicADistance — was added to this
 * bext summary; the other 21 (speakerPosition, modeledMicrophone, presetKind, every other per-mic
 * field, all 7 Project-level fields) are deliberately database/analysis.json-only. bext's
 * Description is a hard, fixed 256-byte field (confirmed in JUCE's own BWAVChunk struct) that
 * silently truncates past that — see ir-lab's own docs/ir-lab-manager-shared-catalog-schema.md.
 * Never treat this as a complete capture record.
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
  /** Combined into one token in the source, e.g. "3.50in" — split back into value+unit here. */
  micADistance?: number
  micADistanceUnit?: string
}

/** Plain string Description keys, mapped to our own field names. MicADistance is handled
 * separately below since its value needs numeric parsing, not a straight string copy. */
const KEY_TO_FIELD: Record<string, keyof Omit<BwfCaptureMetadata, 'micADistance' | 'micADistanceUnit'>> = {
  Cabinet: 'cabinet',
  Speaker: 'speaker',
  Microphone: 'microphone',
  Position: 'position',
  Notes: 'notes',
  CaptureType: 'captureType'
}

/** "3.50in" / "3.5cm" -> { value: 3.5, unit: 'in' }. Returns null for anything that doesn't match
 * IR Lab's own format (WavIO.cpp: `juce::String(value, 2) + unit`, unit always "in" or "cm"). */
function parseMicADistanceToken(token: string): { value: number; unit: string } | null {
  const match = /^([\d.]+)(in|cm)$/i.exec(token.trim())
  if (!match) return null
  const value = parseFloat(match[1])
  if (!Number.isFinite(value)) return null
  return { value, unit: match[2].toLowerCase() }
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
    if (!value) continue

    if (key === 'MicADistance') {
      const parsed = parseMicADistanceToken(value)
      if (parsed) {
        fields.micADistance = parsed.value
        fields.micADistanceUnit = parsed.unit
      }
      continue
    }

    const field = KEY_TO_FIELD[key]
    if (field) fields[field] = value
  }
  return Object.keys(fields).length > 0 ? fields : null
}
