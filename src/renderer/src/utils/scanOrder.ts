/**
 * Scan mode: which captures are in scope, and what order to sweep them in.
 *
 * Pure — no audio, no React — so the part that decides what you hear is testable on its own.
 *
 * ## Why not order by gain
 *
 * Measured across a real 3,853-capture library, `metadata.gain` has a median of 0.797 and **79%
 * of captures fall inside 0.55–0.85**. Sorting several hundred captures by a value that flat
 * means consecutive entries differ by ~0.0001, so the "order" is effectively arbitrary and a
 * sweep sounds like random channel-hopping.
 *
 * So the primary key is `tone_type`, which is coarse but genuinely meaningful, and gain only
 * breaks ties inside a bucket. A measured brightness descriptor is the intended replacement —
 * `orderScanFiles` takes an optional key function so that swap costs one argument.
 */
import type { NamFile } from '../types/nam'
import { UNTAGGED_KEY, groupByCreator, groupByMake, isJunkMake, normalizeMakeKey } from './gearMake'

/** Roughly increasing aggression, which is what makes a sweep feel like it travels somewhere. */
export const TONE_SWEEP_ORDER = [
  'clean',
  'crunch',
  'overdrive',
  'distortion',
  'hi_gain',
  'fuzz'
] as const

/** Untagged captures sweep last rather than being dropped — they are a third of some libraries. */
const UNTAGGED_RANK = TONE_SWEEP_ORDER.length

export function toneRank(toneType: string | null | undefined): number {
  if (!toneType) return UNTAGGED_RANK
  const i = TONE_SWEEP_ORDER.indexOf(toneType.trim().toLowerCase() as (typeof TONE_SWEEP_ORDER)[number])
  return i === -1 ? UNTAGGED_RANK : i
}

export interface ScanScope {
  /** Normalized make keys. Empty = no constraint on make. */
  makes: Set<string>
  /** Normalized creator keys. Empty = no constraint. */
  creators: Set<string>
  /** Raw tone_type values, plus UNTAGGED_KEY. Empty = no constraint. */
  tones: Set<string>
}

export function emptyScanScope(): ScanScope {
  return { makes: new Set(), creators: new Set(), tones: new Set() }
}

export function isScopeEmpty(scope: ScanScope): boolean {
  return scope.makes.size === 0 && scope.creators.size === 0 && scope.tones.size === 0
}

/**
 * Must bucket exactly the way `groupByNormalized` does, junk placeholders included.
 *
 * Normalizing alone is not enough: `tz-make` normalizes to a perfectly good-looking `tzmake`
 * key, while the facet list files it under Untagged. Selecting "Untagged" would then match none
 * of the 1,947 `tz-make` captures in a real library — the picker would show a count it could not
 * deliver.
 */
function bucketKey(raw: string | null | undefined): string {
  if (isJunkMake(raw)) return UNTAGGED_KEY
  return normalizeMakeKey(raw) ?? UNTAGGED_KEY
}

function makeKeyOf(file: NamFile): string {
  return bucketKey(file.metadata.gear_make)
}

function creatorKeyOf(file: NamFile): string {
  return bucketKey(file.metadata.modeled_by)
}

function toneKeyOf(file: NamFile): string {
  const t = file.metadata.tone_type
  return t ? t.trim().toLowerCase() : UNTAGGED_KEY
}

/**
 * AND across facet types, OR within one — "Marshall or Mesa, by this maker".
 *
 * This is the user-defined "family": rather than shipping a curated taxonomy, selecting several
 * makes at once IS the family, which stays correct as their library changes.
 */
export function scopeFiles(files: NamFile[], scope: ScanScope): NamFile[] {
  if (isScopeEmpty(scope)) return files
  return files.filter((f) => {
    if (scope.makes.size && !scope.makes.has(makeKeyOf(f))) return false
    if (scope.creators.size && !scope.creators.has(creatorKeyOf(f))) return false
    if (scope.tones.size && !scope.tones.has(toneKeyOf(f))) return false
    return true
  })
}

/** Sort key. Lower sweeps earlier. Exported so a descriptor-based key can replace it wholesale. */
export function defaultScanKey(file: NamFile): [number, number] {
  const gain = file.metadata.gain
  return [toneRank(file.metadata.tone_type), typeof gain === 'number' && Number.isFinite(gain) ? gain : 1]
}

/**
 * Stable sort into sweep order.
 *
 * Ties break on file path so a sweep is reproducible — re-entering scan mode with the same scope
 * must give the same order, or "the third one I heard" stops meaning anything.
 */
export function orderScanFiles(
  files: NamFile[],
  keyOf: (f: NamFile) => number | [number, number] = defaultScanKey
): NamFile[] {
  const keyed = files.map((file) => {
    const k = keyOf(file)
    const pair: [number, number] = typeof k === 'number' ? [k, 0] : k
    return { file, a: pair[0], b: pair[1] }
  })
  keyed.sort((x, y) => x.a - y.a || x.b - y.b || x.file.filePath.localeCompare(y.file.filePath))
  return keyed.map((k) => k.file)
}

export interface ScanFacetOption {
  key: string
  label: string
  count: number
}

function sortFacet(options: ScanFacetOption[]): ScanFacetOption[] {
  // Commonest first, but Untagged always last however many there are - it is a fallback, not a
  // real choice, and a library with 40% untagged would otherwise bury every actual make.
  return options.sort((a, b) => {
    if (a.key === UNTAGGED_KEY) return 1
    if (b.key === UNTAGGED_KEY) return -1
    return b.count - a.count || a.label.localeCompare(b.label)
  })
}

export interface ScanFacets {
  makes: ScanFacetOption[]
  creators: ScanFacetOption[]
  tones: ScanFacetOption[]
}

/** Facet options with counts, computed from whatever is loaded. */
export function buildScanFacets(files: NamFile[]): ScanFacets {
  const fromGroups = (groups: Map<string, { label: string; files: NamFile[] }>): ScanFacetOption[] =>
    sortFacet([...groups].map(([key, g]) => ({ key, label: g.label, count: g.files.length })))

  const toneCounts = new Map<string, number>()
  for (const f of files) {
    const k = toneKeyOf(f)
    toneCounts.set(k, (toneCounts.get(k) ?? 0) + 1)
  }
  const tones = sortFacet(
    [...toneCounts].map(([key, count]) => ({
      key,
      label: key === UNTAGGED_KEY ? 'Untagged' : key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      count
    }))
  )

  return {
    makes: fromGroups(groupByMake(files)),
    creators: fromGroups(groupByCreator(files)),
    tones
  }
}

/** Toggle one facet value, returning a new scope (state stays immutable for React). */
export function toggleScopeValue(
  scope: ScanScope,
  facet: keyof ScanScope,
  key: string
): ScanScope {
  const next: ScanScope = {
    makes: new Set(scope.makes),
    creators: new Set(scope.creators),
    tones: new Set(scope.tones)
  }
  if (next[facet].has(key)) next[facet].delete(key)
  else next[facet].add(key)
  return next
}
