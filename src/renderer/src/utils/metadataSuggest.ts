import { GEAR_TYPES, NamFile, TONE_TYPES } from '../types/nam'
import {
  METADATA_SUGGEST_FIELD_OPTIONS,
  MetadataSuggestField,
  MetadataSuggestMatchType,
  MetadataSuggestRule,
  MetadataSuggestScopedRuleSet,
} from '../types/settings'

export interface MetadataSuggestion {
  id: string
  field: MetadataSuggestField
  label: string
  value: string | number
  reason: string
  overwriteExisting: boolean
  currentValue?: string | number
}

export interface MetadataSuggestionMatch {
  file: NamFile
  suggestions: MetadataSuggestion[]
}

const METADATA_SUGGEST_FIELD_LABELS: Record<MetadataSuggestField, string> = Object.fromEntries(
  METADATA_SUGGEST_FIELD_OPTIONS.map((option) => [option.value, option.label])
) as Record<MetadataSuggestField, string>

const TONE_KEYWORDS: Record<typeof TONE_TYPES[number], string[]> = {
  clean: ['clean'],
  crunch: ['crunch'],
  hi_gain: ['highgain', 'hi-gain', 'higain', 'high-gain'],
  fuzz: ['fuzz'],
  overdrive: ['overdrive', 'od', 'edge', 'drive'],
  distortion: ['distortion', 'dist'],
  other: [],
}

function detectToneType(baseName: string): typeof TONE_TYPES[number] | null {
  const lower = baseName.replace(/\s+/g, '').toLowerCase()
  let best: { tone: typeof TONE_TYPES[number]; index: number } | null = null
  for (const [tone, keywords] of Object.entries(TONE_KEYWORDS) as [typeof TONE_TYPES[number], string[]][]) {
    for (const keyword of keywords) {
      const index = lower.lastIndexOf(keyword)
      if (index !== -1 && (best === null || index > best.index)) {
        best = { tone, index }
      }
    }
  }
  return best?.tone ?? null
}

function extractTokens(text: string): Set<string> {
  const matches = text.toLowerCase().match(/[a-z0-9]+/g) ?? []
  return new Set(matches)
}

function extractFilenameSegments(text: string): string[] {
  return text
    .split(/\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function compact(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/')
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

function matchByType(raw: string, tokens: Set<string>, token: string, matchType: MetadataSuggestMatchType): { matched: boolean; extractedValue?: string; extractedMatch?: string } {
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
      return {
        matched: true,
        extractedValue: match[3],
        extractedMatch: `${match[2]}${match[3]}`,
      }
    }
    case 'exact':
    default:
      return { matched: matchesToken(raw, tokens, trimmed) }
  }
}

function isBlankValue(value: unknown): boolean {
  return value == null || (typeof value === 'string' && value.trim() === '')
}

function normalizedComparableValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  return String(value).trim()
}

function parseOverwriteOnlyValues(value: string): Set<string> {
  return new Set(
    value
      .split(',')
      .map((item) => normalizedComparableValue(item).toLowerCase())
      .filter(Boolean)
  )
}

function isValidRuleValue(field: MetadataSuggestField, value: string): boolean {
  if (field === 'gear_type') return (GEAR_TYPES as readonly string[]).includes(value)
  if (field === 'tone_type') return (TONE_TYPES as readonly string[]).includes(value)
  if (field === 'input_level_dbu' || field === 'output_level_dbu' || field === 'nb_trained_epochs') {
    return value.trim() !== '' && !Number.isNaN(Number(value))
  }
  return true
}

function coerceRuleValue(field: MetadataSuggestField, value: string): string | number {
  if (field === 'input_level_dbu' || field === 'output_level_dbu' || field === 'nb_trained_epochs') {
    return Number(value)
  }
  return value
}

function buildSuggestionId(filePath: string, field: MetadataSuggestField): string {
  return `${filePath}::${field}`
}

export function buildMetadataSuggestionMatches(
  scopedFiles: NamFile[],
  rules: MetadataSuggestRule[],
  scopedRuleSets: MetadataSuggestScopedRuleSet[] = []
): MetadataSuggestionMatch[] {
  return scopedFiles.map((file) => {
    const baseName = file.fileName.replace(/\.nam$/i, '')
    const normalizedPath = normalizePath(file.filePath)
    const folderPath = normalizedPath.split('/').slice(0, -1).join('/')
    const folderLabel = folderPath.split('/').slice(-3).join(' / ')
    const fileSegments = extractFilenameSegments(baseName)
    const fileTokens = extractTokens(baseName)
    const folderTokens = extractTokens(folderPath)
    const suggestions: MetadataSuggestion[] = []
    const claimed = new Set<MetadataSuggestField>()
    const APPENDABLE_FIELDS = new Set<MetadataSuggestField>(['nl_amp_settings', 'nl_amp_switches', 'nl_comments'])

    const applicableScopedSets = scopedRuleSets
      .filter((set) => {
        const scopePath = normalizePath(set.scopePath)
        return normalizedPath.startsWith(scopePath + '/')
      })
      .sort((a, b) => normalizePath(b.scopePath).length - normalizePath(a.scopePath).length)

    const shadowedTokens = new Set(
      applicableScopedSets.flatMap((set) =>
        set.rules
          .filter((rule) => rule.enabled)
          .map((rule) => compact(rule.token))
          .filter(Boolean)
      )
    )

    const orderedRules = [
      ...applicableScopedSets.flatMap((set) => set.rules),
      ...rules.filter((rule) => !shadowedTokens.has(compact(rule.token))),
    ]

    const addSuggestion = (
      field: MetadataSuggestField,
      value: string,
      reason: string,
      overwriteExisting = false,
      overwriteOnlyValues = ''
    ) => {
      const currentValue = file.metadata[field]
      if (!overwriteExisting && !isBlankValue(currentValue)) return
      if (!value.trim()) return
      const guardValues = parseOverwriteOnlyValues(overwriteOnlyValues)
      if (overwriteExisting && guardValues.size > 0) {
        const currentComparable = normalizedComparableValue(currentValue).toLowerCase()
        if (!guardValues.has(currentComparable)) return
      }
      if (overwriteExisting && normalizedComparableValue(currentValue) === normalizedComparableValue(coerceRuleValue(field, value))) {
        return
      }
      if (!isValidRuleValue(field, value)) return
      const existing = suggestions.find((suggestion) => suggestion.field === field)
      if (existing) {
        if (!APPENDABLE_FIELDS.has(field) || existing.overwriteExisting || overwriteExisting) return
        const nextParts = new Set(
          String(existing.value)
            .split(/\s*,\s*/)
            .map((part) => part.trim())
            .filter(Boolean)
        )
        if (!nextParts.has(value.trim())) {
          nextParts.add(value.trim())
          existing.value = Array.from(nextParts).join(', ')
          existing.reason = `${existing.reason}; ${reason}`
        }
        return
      }
      claimed.add(field)
      suggestions.push({
        id: buildSuggestionId(file.filePath, field),
        field,
        label: METADATA_SUGGEST_FIELD_LABELS[field],
        value: coerceRuleValue(field, value),
        reason,
        overwriteExisting,
        currentValue: !isBlankValue(currentValue)
          ? (typeof currentValue === 'string' || typeof currentValue === 'number' ? currentValue : String(currentValue))
          : undefined,
      })
    }

    for (const rule of orderedRules) {
      if (!rule.enabled) continue
      const token = rule.token.trim()
      const segmentText = rule.segmentIndex != null ? fileSegments[rule.segmentIndex - 1] ?? '' : ''
      const segmentTokens = rule.segmentIndex != null ? extractTokens(segmentText) : fileTokens

      const isBlankTokenRule = token.length === 0

      const filenameTarget = rule.segmentIndex != null ? segmentText : baseName
      const filenameMatch = isBlankTokenRule ? { matched: false } : matchByType(filenameTarget, segmentTokens, token, rule.matchType)
      const folderMatch = isBlankTokenRule ? { matched: false } : matchByType(folderPath, folderTokens, token, rule.matchType)
      const matchFilename = filenameMatch.matched
      const matchFolder = folderMatch.matched
      const matched = isBlankTokenRule
        ? true
        : rule.matchIn === 'filename'
          ? matchFilename
          : rule.matchIn === 'folder'
            ? matchFolder
            : (matchFilename || matchFolder)

      if (!matched) continue

      const selectedMatch = rule.matchIn === 'filename'
        ? filenameMatch
        : rule.matchIn === 'folder'
          ? folderMatch
          : (filenameMatch.matched ? filenameMatch : folderMatch)

      const templatedValue = rule.value
        .replace(/\{match\}/gi, selectedMatch.extractedMatch ?? '')
        .replace(/\{value\}/gi, selectedMatch.extractedValue ?? '')
        .trim()
      if (!templatedValue) continue

      const source = isBlankTokenRule
        ? 'scope-wide default rule'
        : rule.segmentIndex != null
          ? `filename segment ${rule.segmentIndex}`
        : rule.matchIn === 'filename'
          ? 'filename'
          : rule.matchIn === 'folder'
            ? 'folder path'
            : matchFilename && matchFolder
              ? 'filename and folder path'
              : matchFilename
                ? 'filename'
                : 'folder path'

      addSuggestion(
        rule.field,
        templatedValue,
        rule.overwriteExisting
          ? isBlankTokenRule
            ? 'Overwrite scope-wide default rule'
            : rule.matchType === 'prefix_value'
              ? `Overwrite rule matched ${selectedMatch.extractedMatch ?? `"${token}"`} in ${source}`
              : `Overwrite rule matched token "${token}" in ${source}`
          : isBlankTokenRule
            ? 'Scope-wide default rule'
            : rule.matchType === 'prefix_value'
              ? `Rule matched ${selectedMatch.extractedMatch ?? `"${token}"`} in ${source}`
              : `Rule matched token "${token}" in ${source}`,
        rule.overwriteExisting,
        rule.overwriteOnlyValues
      )
    }

    const detectedTone = detectToneType(baseName)
    if (detectedTone) {
      addSuggestion('tone_type', detectedTone, 'Detected tone type from filename')
    }

    if (matchesToken(baseName, fileTokens, 'di') || matchesToken(folderPath, folderTokens, 'di') || matchesToken(folderPath, folderTokens, 'direct')) {
      addSuggestion('gear_type', 'amp', `Detected DI/direct naming in ${folderLabel ? `folder path (${folderLabel}) or filename` : 'filename'}`)
    }

    return { file, suggestions }
  }).filter((match) => match.suggestions.length > 0)
}
