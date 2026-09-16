import { IR_METADATA_SUGGEST_FIELD_OPTIONS, IrMetadataSuggestField, IrMetadataSuggestRule, MetadataSuggestMatchType } from '../types/settings'

/**
 * IR filename metadata suggestion engine (parity backlog item 20) — matching/templating core
 * adapted from `utils/metadataSuggest.ts` (NAM mode's rule engine), trimmed for IR's simpler shape:
 * one candidate text (filename) plus folder path, no capture-name/filename dual-candidate logic,
 * no scoped rule sets, no numeric field coercion (every IR field here is a plain string). See
 * `types/settings.ts`'s own comment on `IrMetadataSuggestRule` for why these aren't the same types
 * as NAM's engine.
 */

export interface IrSuggestionTarget {
  itemId: string
  displayName: string
  relativePath: string
  currentValues: Partial<Record<IrMetadataSuggestField, string | null>>
}

export interface IrMetadataSuggestion {
  field: IrMetadataSuggestField
  label: string
  value: string
  reason: string
  overwriteExisting: boolean
  currentValue?: string
}

export interface IrMetadataSuggestionMatch {
  target: IrSuggestionTarget
  suggestions: IrMetadataSuggestion[]
}

const FIELD_LABELS: Record<IrMetadataSuggestField, string> = Object.fromEntries(
  IR_METADATA_SUGGEST_FIELD_OPTIONS.map((o) => [o.value, o.label])
) as Record<IrMetadataSuggestField, string>

function compact(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractTokens(text: string): Set<string> {
  const matches = text.toLowerCase().match(/[a-z0-9]+/g) ?? []
  return new Set(matches)
}

function extractSegments(text: string): string[] {
  return text.split(/\s+/).map((s) => s.trim()).filter(Boolean)
}

function matchesToken(raw: string, tokens: Set<string>, token: string): boolean {
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

interface MatchResult {
  matched: boolean
  extractedValue?: string
  extractedMatch?: string
}

function matchByType(raw: string, tokens: Set<string>, token: string, matchType: MetadataSuggestMatchType): MatchResult {
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

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
}

function baseNameOf(relativePath: string): string {
  const name = relativePath.split('/').pop() ?? relativePath
  return name.replace(/\.wav$/i, '')
}

function folderOf(relativePath: string): string {
  const parts = normalizePath(relativePath).split('/')
  parts.pop()
  return parts.join('/')
}

/** Runs every enabled rule against each target, in order, first-match-per-field wins (same
 * priority-by-order convention NAM's engine uses). Never overwrites a field that already has a
 * value unless the rule says `overwriteExisting`, and never suggests a blank/no-op change. */
export function buildIrMetadataSuggestionMatches(
  targets: IrSuggestionTarget[],
  rules: IrMetadataSuggestRule[]
): IrMetadataSuggestionMatch[] {
  const enabledRules = rules.filter((r) => r.enabled)

  return targets
    .map((target): IrMetadataSuggestionMatch => {
      const baseName = baseNameOf(target.relativePath)
      const folderPath = folderOf(target.relativePath)
      const fileSegments = extractSegments(baseName)
      const fileTokens = extractTokens(baseName)
      const folderTokens = extractTokens(folderPath)
      const suggestions: IrMetadataSuggestion[] = []

      const addSuggestion = (field: IrMetadataSuggestField, value: string, reason: string, overwriteExisting: boolean): void => {
        const trimmedValue = value.trim()
        if (!trimmedValue) return
        const current = target.currentValues[field] ?? null
        const hasCurrent = current != null && current.trim() !== ''
        if (hasCurrent && !overwriteExisting) return
        if (hasCurrent && current!.trim() === trimmedValue) return
        if (suggestions.some((s) => s.field === field)) return // first matching rule wins per field
        suggestions.push({
          field,
          label: FIELD_LABELS[field],
          value: trimmedValue,
          reason,
          overwriteExisting,
          currentValue: hasCurrent ? current!.trim() : undefined
        })
      }

      for (const rule of enabledRules) {
        const token = rule.token.trim()
        const isBlankTokenRule = token.length === 0 // "scope-wide default" — always matches

        const filenameRaw = rule.segmentIndex != null ? fileSegments[rule.segmentIndex - 1] ?? '' : baseName
        const filenameMatch = isBlankTokenRule || !filenameRaw.trim() ? { matched: false } : matchByType(filenameRaw, fileTokens, token, rule.matchType)
        const folderMatch = isBlankTokenRule ? { matched: false } : matchByType(folderPath, folderTokens, token, rule.matchType)

        const matched = isBlankTokenRule
          ? true
          : rule.matchIn === 'filename'
            ? filenameMatch.matched
            : rule.matchIn === 'folder'
              ? folderMatch.matched
              : filenameMatch.matched || folderMatch.matched
        if (!matched) continue

        const selectedMatch = rule.matchIn === 'filename' ? filenameMatch : rule.matchIn === 'folder' ? folderMatch : filenameMatch.matched ? filenameMatch : folderMatch

        const templatedValue = rule.value
          .replace(/\{match\}/gi, selectedMatch.extractedMatch ?? '')
          .replace(/\{value\}/gi, selectedMatch.extractedValue ?? '')
          .trim()
        if (!templatedValue) continue

        const source = isBlankTokenRule
          ? 'scope-wide default rule'
          : rule.segmentIndex != null
            ? `filename segment ${rule.segmentIndex}`
            : rule.matchIn === 'folder'
              ? 'folder path'
              : rule.matchIn === 'either' && folderMatch.matched && !filenameMatch.matched
                ? 'folder path'
                : 'filename'

        addSuggestion(
          rule.field,
          templatedValue,
          rule.overwriteExisting
            ? `Overwrite rule matched "${token || '(always)'}" in ${source}`
            : `Rule matched "${token || '(always)'}" in ${source}`,
          rule.overwriteExisting
        )
      }

      return { target, suggestions }
    })
    .filter((match) => match.suggestions.length > 0)
}
