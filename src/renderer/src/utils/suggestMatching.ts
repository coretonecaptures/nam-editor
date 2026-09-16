import { MetadataSuggestMatchType } from '../types/settings'

/**
 * Shared token/segment-matching core for both metadata-suggestion engines in this app —
 * `metadataSuggest.ts` (NAM mode) and `irMetadataSuggest.ts` (IR mode). Extracted out of the two
 * files, which had copy-pasted these exact functions rather than sharing them (found in a
 * code-review pass, 2026-09-16): both engines' `matchIn`/`matchType` vocabulary already comes from
 * the same `types/settings.ts` types (neither is actually mode-specific in meaning — see
 * `IrMetadataSuggestRule`'s own comment there), so the matching logic underneath them shouldn't
 * have been two independent copies either. Everything mode-SPECIFIC (candidate-text selection,
 * field validation/coercion, dual filename/capture-name logic, scoped rule sets) stays in each
 * engine's own file — only the pure "does this token match this text" core lives here.
 */

/** Lowercases and strips everything but letters/digits — the "ignore separators" normalization
 * every match type falls back to. */
export function compact(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Lowercase alphanumeric "words" out of a text, as a Set for fast whole-token membership tests. */
export function extractTokens(text: string): Set<string> {
  const matches = text.toLowerCase().match(/[a-z0-9]+/g) ?? []
  return new Set(matches)
}

/** Whitespace-split segments, trimmed and filtered — used for "segment N" rule targeting. */
export function extractSegments(text: string): string[] {
  return text.split(/\s+/).map((s) => s.trim()).filter(Boolean)
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

/** "exact" match type: whole-token membership first, then a few escape hatches for tokens that
 * aren't single alphanumeric words (contain a space/hyphen/underscore) or are short enough that a
 * plain substring test would false-positive on part of a longer word (a word-boundary regex for
 * anything <=3 chars). */
export function matchesToken(raw: string, tokens: Set<string>, token: string): boolean {
  const trimmed = token.trim().toLowerCase()
  if (!trimmed) return false
  const compactToken = compact(trimmed)
  if (!compactToken) return false
  if (tokens.has(compactToken)) return true
  const rawLower = raw.toLowerCase()
  if (trimmed.includes(' ') || trimmed.includes('-') || trimmed.includes('_')) {
    return rawLower.includes(trimmed) || compact(rawLower).includes(compactToken)
  }
  if (compactToken.length <= 3) {
    const boundary = new RegExp(`(^|[^a-z0-9])${compactToken}([^a-z0-9]|$)`, 'i')
    return boundary.test(rawLower)
  }
  return rawLower.includes(trimmed) || compact(rawLower).includes(compactToken)
}

export interface MatchResult {
  matched: boolean
  extractedValue?: string
  extractedMatch?: string
}

/** Dispatches on a rule's `matchType`. `prefix_value` is the one type that extracts a value out of
 * the matched text (e.g. a number following a unit-like prefix) rather than just returning
 * matched/not-matched — used by templates' `{value}`/`{match}` substitutions. */
export function matchByType(raw: string, tokens: Set<string>, token: string, matchType: MetadataSuggestMatchType): MatchResult {
  const trimmed = token.trim()
  const rawLower = raw.toLowerCase()
  const trimmedLower = trimmed.toLowerCase()
  const compactToken = compact(trimmedLower)
  const compactRaw = compact(rawLower)
  if (!trimmed) return { matched: false }

  switch (matchType) {
    case 'contains':
      return { matched: rawLower.includes(trimmedLower) || compactRaw.includes(compactToken) }
    case 'starts_with':
      return { matched: rawLower.startsWith(trimmedLower) || compactRaw.startsWith(compactToken) }
    case 'ends_with':
      return { matched: rawLower.endsWith(trimmedLower) || compactRaw.endsWith(compactToken) }
    case 'prefix_value': {
      const escaped = escapeRegExp(trimmed)
      const regex = new RegExp(`(^|[^a-z0-9])(${escaped})([0-9]+(?:\\.[0-9]+)?)($|[^a-z0-9])`, 'i')
      const match = raw.match(regex)
      if (!match) return { matched: false }
      return { matched: true, extractedValue: match[3], extractedMatch: `${match[2]}${match[3]}` }
    }
    case 'exact':
    default:
      return { matched: matchesToken(raw, tokens, trimmed) }
  }
}
