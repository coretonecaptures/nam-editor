/**
 * Generic filename-vocabulary fallback — docs/ir-lab-manager-build-plan.md section 6, item 3.
 * Not vendor-specific: matches known gear terms as whole tokens against the folder trail +
 * filename, regardless of whether a structural vendor parser also recognizes this file. This is
 * what handles e.g. "Marshall Handwired Greenback G12 SM57.wav" with zero vendor-specific code,
 * and — per real-library inspection during Phase 3 — is also what covers the many packs whose
 * folder layout doesn't match either structural parser's assumptions.
 *
 * `recognizes` always returns true: this parser has no folder-shape precondition, it just tries
 * to match tokens wherever it's asked. It's registered last in the parser chain (see
 * applyVendorParsers.ts) precisely because of that — a structural parser gets first refusal.
 */
import type { VendorParser, ParsedIrFields } from './types'
import { MICROPHONE_TERMS, SPEAKER_TERMS, MANUFACTURER_TERMS } from './vocabulary'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * One compiled matcher per vocabulary list, longest terms first so "G12T-75" wins over a shorter
 * term that happens to be its prefix. Built once at module load, not per file.
 *
 * `+` is deliberately excluded from the set of characters that count as alphanumeric-adjacent
 * (i.e. it's treated as NOT a valid boundary) — found live, against a real Ownhammer pack: a
 * blend file like "OH 1012 GIBS V30+V10 121-00.wav" has "V30" flanked by a `+`, which a plain
 * `[A-Za-z0-9]` boundary check accepts as a legitimate word edge. That let this parser silently
 * reintroduce a speaker guess Ownhammer's own structural parser deliberately left blank for
 * exactly this blend case (see ownhammer.ts). `+` specifically marks a blend/compound token in
 * this domain, not a word separator, so a term flanked by it isn't a whole, standalone match.
 */
function buildMatcher(terms: string[]): RegExp {
  const sorted = [...terms].sort((a, b) => b.length - a.length)
  const alternation = sorted.map(escapeRegExp).join('|')
  return new RegExp(`(?<![A-Za-z0-9+])(${alternation})(?![A-Za-z0-9+])`, 'i')
}

const microphoneMatcher = buildMatcher(MICROPHONE_TERMS)
const speakerMatcher = buildMatcher(SPEAKER_TERMS)
const manufacturerMatcher = buildMatcher(MANUFACTURER_TERMS)

/** Exported standalone for structural parsers (e.g. redwirez.ts) that want just the
 * manufacturer-brand guess from an ancestor folder name, without pulling in the whole parser. */
export function matchManufacturer(haystack: string): string | undefined {
  return haystack.match(manufacturerMatcher)?.[1]
}

export const genericVocabularyParser: VendorParser = {
  id: 'generic_vocabulary',
  recognizes(): boolean {
    return true
  },
  parse(filePath: string, folderPath: string): ParsedIrFields {
    const haystack = `${folderPath} ${filePath}`
    const fields: ParsedIrFields = {}

    const micMatch = haystack.match(microphoneMatcher)
    if (micMatch) fields.microphone = micMatch[1]

    const speakerMatch = haystack.match(speakerMatcher)
    if (speakerMatch) fields.speaker = speakerMatch[1]

    const manufacturerMatch = haystack.match(manufacturerMatcher)
    if (manufacturerMatch) fields.manufacturer = manufacturerMatch[1]

    return fields
  }
}
