/**
 * York Audio structural parser — same idiom as `ownhammer.ts` (filename-shape-driven, not folder
 * depth: checked directly against a real York Audio library, e.g. `F:\Impulse Responses\York
 * Audio`, where pack folder naming varies — "York Audio - 5153 412 VH20", "York Audio FDMN 412
 * M25-V30 V1.00", "YA MES 212 V30 limited version" — but every actual WAV filename is consistently
 * `YA {cab tokens...} {mic code}[{variant letter}]-{position}[ {take}].wav`, or
 * `YA {cab tokens...} Mix {label}.wav` for a blend.
 *
 * Real examples this was built against:
 *   YA 5153 412 VH20 121-1.wav
 *   YA 5153 412 VH20 421m-OA 2.wav
 *   YA 5153 412 VH20 57m-1 .wav          (stray trailing space before .wav — real vendor sloppiness)
 *   YA 5153 412 VH20 Mix 01.wav
 *
 * Deliberately does NOT decode the cab-code tokens (e.g. "5153", "MES", "MRSH") into a real
 * manufacturer/model — some are guessable (MES -> Mesa Boogie, MRSH -> Marshall) but others aren't
 * confidently ("KW"? "ZILA"? "5153" as a standalone number could mean several things), and mixing
 * confident-with-unconfident guesses in one field is worse than storing the whole cab-code sequence
 * raw and letting `manufacturer` stay unset — exactly the same call `ownhammer.ts` already makes
 * for its own cab tokens (see that file's own `cabinet = cabTokens.join(' ')`). Position codes
 * (OA/CE/CNT/CN/CNE and friends) are stored raw for the same reason — several look interpretable
 * but the exact intended meaning isn't confirmed against York's own documentation yet.
 *
 * Microphone codes ARE translated, but only the handful that are genuinely unambiguous shorthand
 * across the entire IR industry, not York-specific guesses — see MIC_CODES below. A trailing
 * variant letter on the code (the "m"/"v" in "421m"/"421v") is stripped before lookup rather than
 * interpreted — its exact meaning (capsule variant? mount type?) isn't confirmed, so this maps both
 * to the same base mic rather than asserting a difference that might be wrong.
 */
import type { VendorParser, ParsedIrFields } from './types'

const YA_FILENAME = /^YA\s+(.+)\.wav$/i

/** Mic-model shorthand this parser will confidently translate — restricted to codes that are
 * genuinely unambiguous, universal industry shorthand for cab-mic'ing (the same codes OwnHammer/
 * RedWirez packs and most other vendors use identically), not a York-specific guess. Confirmed by
 * running this parser against the REAL, WHOLE library (`F:\Impulse Responses\York Audio`,
 * 16,875 files, zero crashes, 88% get a microphone value) and cross-checking the resulting raw
 * code frequency table against known mic-industry shorthand, not guessed from one sample folder.
 * Extend this table as more are confirmed — codes seen in real filenames but NOT confidently
 * identified, deliberately left OUT rather than guessed (MIC_AND_POSITION below still extracts
 * them as the raw code): "313" (546x), "184" (180x), "E22"/"N22" (180x/144x), "4119" (138x), "T49"
 * (96x), "52" (60x), "F47" (168x), "M69" (216x), "H75" (folded into cabinet — see file header). */
const MIC_CODES: Record<string, string> = {
  '57': 'Shure SM57',
  'SM7': 'Shure SM7',
  '121': 'Royer R-121',
  '160': 'beyerdynamic M160',
  '421': 'Sennheiser MD421',
  '441': 'Sennheiser MD441',
  '67': 'Neumann U67',
  'U67': 'Neumann U67',
  '87': 'Neumann U87',
  'U87': 'Neumann U87',
  '47': 'Neumann U47',
  'U47': 'Neumann U47',
  '414': 'AKG C414',
  '112': 'AKG D112',
  '906': 'Sennheiser e906',
  '58': 'Shure SM58',
  'i5': 'Audix i5',
  'M88': 'beyerdynamic M88'
}

/** A speaker code token — same `V{digits}` Celestion-Vintage-series shorthand `ownhammer.ts`
 * already recognizes ("V30", "V20", "V10"). York cab-token sequences that don't end in one of
 * these (e.g. "VH20", which isn't the same code despite looking similar) stay part of the opaque
 * cabinet string rather than being misparsed as a speaker code. */
const SPEAKER_CODE = /^V\d{2,3}$/i

/** Trailing `{mic code}{optional variant letter}-{position}` — e.g. "421m-OA", "57m-1", "160-CNT",
 * "U47-3", "SM7-CE", "M69v-OA". The code itself may lead with up to two letters (U47, SM7) or be
 * bare digits (421, 57) — either way followed optionally by a single lowercase variant letter
 * (unconfirmed meaning — see the file header) immediately before the hyphen. */
const MIC_AND_POSITION = /^([A-Za-z]{0,2}\d{1,4})[a-z]?-([A-Za-z0-9]+)$/i

export const yorkParser: VendorParser = {
  id: 'york_audio',
  recognizes(_folderPath: string, siblingFiles: string[]): boolean {
    return siblingFiles.some((name) => YA_FILENAME.test(name))
  },
  parse(filePath: string): ParsedIrFields {
    const base = filePath.split(/[\\/]/).pop() ?? filePath
    const match = base.match(YA_FILENAME)
    if (!match) return {}

    // Trim first: real packs contain files with a stray trailing space before ".wav"
    // ("57m-1 .wav") that would otherwise survive into the last token.
    const body = match[1].trim()
    const tokens = body.split(/\s+/)
    if (tokens.length < 2) return {}

    const fields: ParsedIrFields = {}

    // Blend/mix file — no single mic to report, same "don't guess a blend" call ownhammer.ts
    // makes for its own "+"-joined speaker blends.
    const mixIndex = tokens.findIndex((t) => t.toLowerCase() === 'mix')
    if (mixIndex !== -1) {
      const cabTokens = tokens.slice(0, mixIndex)
      if (cabTokens.length > 0) fields.cabinet = cabTokens.join(' ')
      return fields
    }

    // The mic+position token is the last one that actually matches the shape — real files
    // sometimes carry one more trailing token after it (a take number, e.g. "OA 2"), which gets
    // appended onto position rather than dropped.
    const micPosIndex = tokens.findIndex((t) => MIC_AND_POSITION.test(t))
    if (micPosIndex === -1) return {}

    const micPosMatch = tokens[micPosIndex].match(MIC_AND_POSITION) as RegExpMatchArray
    const micCode = micPosMatch[1]
    const positionCode = micPosMatch[2]
    const trailing = tokens.slice(micPosIndex + 1).join(' ')
    fields.position = trailing ? `${positionCode} ${trailing}` : positionCode
    fields.microphone = MIC_CODES[micCode] ?? micCode

    let cabTokens = tokens.slice(0, micPosIndex)
    if (cabTokens.length > 0 && SPEAKER_CODE.test(cabTokens[cabTokens.length - 1])) {
      fields.speaker = cabTokens[cabTokens.length - 1]
      cabTokens = cabTokens.slice(0, -1)
    }
    if (cabTokens.length > 0) fields.cabinet = cabTokens.join(' ')

    return fields
  }
}
