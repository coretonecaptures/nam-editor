/**
 * Ownhammer structural parser — docs/ir-lab-manager-build-plan.md section 6, item 1.
 *
 * The plan's original sketch (`Pack/{SampleRate}/{Cab}/{MicOrBlend}.wav`) doesn't match real
 * Ownhammer packs, checked directly against a real library during Phase 3: actual nesting is
 * deeper and inconsistent pack-to-pack (e.g.
 * `1012 GIBS/Atomic/1012 GIBS/V10/Mics/OH 1012 GIBS V10 121-00.wav`), but the FILENAME shape is
 * consistent: `OH {pack/cab tokens...} {speaker code} {mic code}[-position].wav`. This parser
 * relies on the filename, not the folder depth, for exactly that reason.
 */
import type { VendorParser, ParsedIrFields } from './types'

const OH_FILENAME = /^OH\s+(.+)\.wav$/i
/** Trailing "{mic code}" or "{mic code}-{position}" — mic codes are short alnum (e.g. "121",
 * "160"); position is either two digits (a swept mic position) or a word (EDGE/FRED/CAP/CONE). */
const MIC_AND_POSITION = /^([A-Za-z0-9]{2,4})(?:-([A-Za-z0-9]+))?$/
/** A speaker code token — Ownhammer packs mark blends with "+" ("V10+V30"); those aren't a
 * single speaker, so left unset rather than guessed. */
const SPEAKER_CODE = /^V\d+$/i

export const ownhammerParser: VendorParser = {
  id: 'ownhammer',
  recognizes(_folderPath: string, siblingFiles: string[]): boolean {
    return siblingFiles.some((name) => OH_FILENAME.test(name))
  },
  parse(filePath: string): ParsedIrFields {
    const base = filePath.split(/[\\/]/).pop() ?? filePath
    const match = base.match(OH_FILENAME)
    if (!match) return {}

    const tokens = match[1].trim().split(/\s+/)
    if (tokens.length < 2) return {}

    const fields: ParsedIrFields = {}
    const last = tokens[tokens.length - 1]
    const micMatch = last.match(MIC_AND_POSITION)

    let cabTokens = tokens
    if (micMatch) {
      fields.microphone = micMatch[1]
      if (micMatch[2]) fields.position = micMatch[2]
      cabTokens = tokens.slice(0, -1)
    }

    if (cabTokens.length > 0 && SPEAKER_CODE.test(cabTokens[cabTokens.length - 1])) {
      fields.speaker = cabTokens[cabTokens.length - 1]
      cabTokens = cabTokens.slice(0, -1)
    }

    if (cabTokens.length > 0) fields.cabinet = cabTokens.join(' ')

    return fields
  }
}
