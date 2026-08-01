/**
 * Ordering amps cleanest → heaviest, measured rather than guessed.
 *
 * The Tone Map's Y axis is a list of amps from cleanest at the bottom to heaviest at the top. The
 * obvious implementations are a hand-authored list (goes stale, won't know a user's 54 makes) or an
 * AI ranking (slow, non-reproducible, needs a provider configured).
 *
 * Neither is necessary. `metadata.gain` is not a user tag — NAM computes it from the model's own
 * transfer curve (`nam/models/base.py::_metadata_gain`: "Between 0 and 1, how much gain /
 * compression does the model seem to have?") and it's present on ~99% of real captures. So the
 * mean `gain` of an amp's own captures IS its heaviness, objectively, for free, and it updates
 * itself as captures are added.
 */
import type { NamFile } from '../types/nam'
import { groupByMake, groupByModel, type MakeGroup } from './gearMake'

/**
 * Below this many measured captures, a mean is not a ranking — one capture of a Marshall on its
 * clean channel would file the whole make next to a Fender. Such rows are still shown (hiding a
 * user's gear is worse), but flagged so the UI can mark them as unranked.
 */
export const MIN_CONFIDENT_COUNT = 3

export interface AmpRow extends MakeGroup {
  /** Mean measured gain over captures that report one, or null when none do. */
  meanGain: number | null
  /** How many captures actually contributed to meanGain (not files.length). */
  measuredCount: number
  /** True when too few captures reported gain for the mean to mean anything. */
  lowConfidence: boolean
}

function meanGainOf(files: NamFile[]): { mean: number | null; measuredCount: number } {
  let sum = 0
  let count = 0
  for (const file of files) {
    const gain = file.metadata.gain
    if (typeof gain === 'number' && Number.isFinite(gain)) {
      sum += gain
      count++
    }
  }
  return { mean: count > 0 ? sum / count : null, measuredCount: count }
}

function toRows(groups: Map<string, MakeGroup>): AmpRow[] {
  const rows: AmpRow[] = []
  for (const group of groups.values()) {
    const { mean, measuredCount } = meanGainOf(group.files)
    rows.push({
      ...group,
      meanGain: mean,
      measuredCount,
      lowConfidence: measuredCount < MIN_CONFIDENT_COUNT
    })
  }
  return rows
}

/**
 * Sort rows cleanest-first (so the caller can render bottom-up to put heaviest on top).
 *
 * Rows with no measured gain sort to the END, never to 0. Treating "unknown" as 0 would plant them
 * at the cleanest extreme and silently assert something false about them.
 */
function sortByHeaviness(rows: AmpRow[]): AmpRow[] {
  return [...rows].sort((a, b) => {
    if (a.meanGain === null && b.meanGain === null) {
      // Both unmeasured: bigger groups first, then alphabetical, so ordering is deterministic.
      if (b.files.length !== a.files.length) return b.files.length - a.files.length
      return a.label.localeCompare(b.label)
    }
    if (a.meanGain === null) return 1
    if (b.meanGain === null) return -1
    if (a.meanGain !== b.meanGain) return a.meanGain - b.meanGain
    return a.label.localeCompare(b.label)
  })
}

/**
 * Rank amp makes by measured heaviness, cleanest first.
 *
 * The "Untagged" bucket (placeholder/missing makes) is included like any other row — it's ranked by
 * its own captures' gain, since those measurements are perfectly valid even when the name isn't.
 * Callers can filter it out via `row.junk`.
 */
export function rankAmpsByHeaviness(files: NamFile[]): AmpRow[] {
  return sortByHeaviness(toRows(groupByMake(files)))
}

/** Same ranking, one level down — used when an amp row is expanded into its models. */
export function rankModelsByHeaviness(files: NamFile[]): AmpRow[] {
  return sortByHeaviness(toRows(groupByModel(files)))
}
