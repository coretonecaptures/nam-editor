/**
 * RedWirez structural parser — docs/ir-lab-manager-build-plan.md section 6, item 2. Defunct
 * vendor, large installed back-catalog, no future updates to track (per the plan).
 *
 * Real structure, checked against a real library during Phase 3:
 * `.../{CabFamily folder, e.g. "Ampeg SVT 810..."}/BIGBox/{rate} KHz-{bits}bit/{CabCode}/
 * {MicName}/{CabCode}-{MicCode}-{Position}.wav` (e.g. `SVT810-D112-Cap-0in.wav`). Filename is a
 * hyphen-separated `{cab}-{mic}-{position...}` triplet (position itself can contain further
 * hyphens, e.g. "CapEdge-0in") sitting under a sample-rate-labeled folder — that folder is the
 * recognizer's structural signal, since the filename shape alone isn't unique enough to trust
 * without it.
 */
import type { VendorParser, ParsedIrFields } from './types'
import { matchManufacturer } from './genericVocabulary'

const SAMPLE_RATE_FOLDER = /\d+(\.\d+)?\s*KHz/i
const CAB_MIC_POSITION = /^([A-Za-z0-9]+)-([A-Za-z0-9]+)-(.+)$/

export const redwirezParser: VendorParser = {
  id: 'redwirez',
  recognizes(folderPath: string, siblingFiles: string[]): boolean {
    if (!SAMPLE_RATE_FOLDER.test(folderPath)) return false
    return siblingFiles.some((name) => CAB_MIC_POSITION.test(name.replace(/\.wav$/i, '')))
  },
  parse(filePath: string, folderPath: string): ParsedIrFields {
    const base = (filePath.split(/[\\/]/).pop() ?? filePath).replace(/\.wav$/i, '')
    const match = base.match(CAB_MIC_POSITION)
    if (!match) return {}

    const fields: ParsedIrFields = {
      cabinet: match[1],
      microphone: match[2],
      position: match[3]
    }
    const manufacturer = matchManufacturer(folderPath)
    if (manufacturer) fields.manufacturer = manufacturer

    return fields
  }
}
