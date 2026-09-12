/**
 * The coverage planner (audit idea 1 / backlog step 10) — "your other four cabs all have an R121
 * as well, this one doesn't." Groups the library into rigs (a resolved cabinet+speaker pair),
 * finds which (microphone, mic position) combinations exist across the whole library, and for
 * each rig reports which of those combos are missing — only when at least 2 OTHER rigs already
 * have it, so a one-off capture elsewhere doesn't read as "everyone else has this."
 *
 * Deliberately reuses queryItems() rather than a second, parallel SQL resolution of cabinet/
 * speaker: those values already go through a 3-way COALESCE (item -> ir_lab_project collection ->
 * folder_metadata_effective, see queryLibrary.ts's own header) and a second implementation here
 * could silently disagree with what the browse view shows for the same item. No fixed vocabulary
 * exists for any of cabinet/speaker/microphone/position on either app's side (confirmed against
 * ir-lab's own Domain.h) — matching is exact, case-insensitive string equality after trim, same as
 * every other facet filter in this app. "SM-57" and "SM57" will not match each other.
 */
import type { DatabaseSync } from 'node:sqlite'
import { queryItems } from './queryLibrary'

const COVERAGE_ROW_CAP = 250_000
const MIN_OTHER_RIGS_FOR_GAP = 2

export interface CoverageCombo {
  microphone: string
  position: string
}

export interface CoverageGap extends CoverageCombo {
  presentInOtherRigCount: number
}

export interface CoverageRig {
  cabinet: string
  speaker: string
  combosPresent: CoverageCombo[]
  gaps: CoverageGap[]
  /** IR Lab's real project id (collection.naming_template, falling back to this app's own
   * collection.id only when no real id was ever captured — see labProjectEnrichment.ts) — what
   * irLibrarySendProjectToIrLab actually needs. Null when this rig has no linked IR Lab project
   * at all (cabinet/speaker resolved purely from a folder default), in which case there is
   * nothing valid to send and the UI should show the gap as informational text only. */
  targetProjectId: string | null
  targetProjectName: string | null
}

function normalize(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function getCoverageMatrix(db: DatabaseSync, scope: { libraryRootId?: number | null } = {}): CoverageRig[] {
  const rows = queryItems(db, { ...scope, offset: 0, limit: COVERAGE_ROW_CAP })

  // Which ir_project collection (if any) owns each item — a separate, plain join rather than
  // extending queryItems' own cabinet/speaker fallback subquery, since that one intentionally
  // collapses to a single MAX() per item and isn't meant to carry an attributable collection id.
  const itemProjects = new Map<string, { collectionId: string; namingTemplate: string | null; createdAt: string | null }>()
  const projectRows = db
    .prepare(
      `SELECT collection_item.item_id as itemId, collection.id as collectionId,
              collection.naming_template as namingTemplate, collection.created_at as createdAt
       FROM collection_item
       JOIN collection ON collection.id = collection_item.collection_id
       WHERE collection.kind = 'ir_project'`
    )
    .all() as Array<{ itemId: string; collectionId: string; namingTemplate: string | null; createdAt: string | null }>
  for (const row of projectRows) itemProjects.set(row.itemId, row)
  // One entry per distinct collection (projectRows has one row per item, so many duplicates of
  // the same collection) — used for the tie-break below and to resolve the real send-to-IR-Lab id.
  const collectionsById = new Map<string, { namingTemplate: string | null; createdAt: string | null }>()
  for (const row of projectRows) {
    if (!collectionsById.has(row.collectionId)) collectionsById.set(row.collectionId, row)
  }

  interface RigAccum {
    cabinet: string
    speaker: string
    combos: Set<string>
    comboDisplay: Map<string, CoverageCombo>
    projectItemCounts: Map<string, number>
  }
  const rigs = new Map<string, RigAccum>()
  const comboRigSets = new Map<string, Set<string>>()

  for (const row of rows) {
    const cabinet = normalize(row.cabinet)
    const speaker = normalize(row.speaker)
    if (!cabinet || !speaker) continue // Can't attribute this item to a rig without both.
    const rigKey = `${cabinet.toLowerCase()}||${speaker.toLowerCase()}`
    let rig = rigs.get(rigKey)
    if (!rig) {
      rig = { cabinet, speaker, combos: new Set(), comboDisplay: new Map(), projectItemCounts: new Map() }
      rigs.set(rigKey, rig)
    }

    const project = itemProjects.get(row.id)
    if (project) {
      rig.projectItemCounts.set(project.collectionId, (rig.projectItemCounts.get(project.collectionId) ?? 0) + 1)
    }

    const microphone = normalize(row.microphone)
    const position = normalize(row.mic_a_target_zone) ?? normalize(row.mic_b_target_zone)
    if (!microphone || !position) continue // Nothing to compare this item's mic placement against.
    const comboKey = `${microphone.toLowerCase()}||${position.toLowerCase()}`
    rig.combos.add(comboKey)
    if (!rig.comboDisplay.has(comboKey)) rig.comboDisplay.set(comboKey, { microphone, position })

    let comboRigs = comboRigSets.get(comboKey)
    if (!comboRigs) {
      comboRigs = new Set()
      comboRigSets.set(comboKey, comboRigs)
    }
    comboRigs.add(rigKey)
  }

  // Every combo that shows up anywhere, with its display form (first-seen casing) — needed to
  // report gaps for combos a rig has zero items of.
  const comboDisplayGlobal = new Map<string, CoverageCombo>()
  for (const rig of rigs.values()) for (const [key, combo] of rig.comboDisplay) if (!comboDisplayGlobal.has(key)) comboDisplayGlobal.set(key, combo)

  const result: CoverageRig[] = []
  for (const [rigKey, rig] of rigs) {
    const gaps: CoverageGap[] = []
    for (const [comboKey, comboRigs] of comboRigSets) {
      if (rig.combos.has(comboKey)) continue
      const otherRigCount = comboRigs.size // rig itself is never in this set, since it doesn't have the combo
      if (otherRigCount >= MIN_OTHER_RIGS_FOR_GAP) {
        const combo = comboDisplayGlobal.get(comboKey)!
        gaps.push({ ...combo, presentInOtherRigCount: otherRigCount })
      }
    }
    gaps.sort((a, b) => b.presentInOtherRigCount - a.presentInOtherRigCount)

    // Pick the ir_project collection owning the most of this rig's items (most items = most
    // "authoritative" home for this rig); ties broken by most recently created.
    let targetCollectionId: string | null = null
    let bestCount = -1
    for (const [collectionId, count] of rig.projectItemCounts) {
      if (count > bestCount) {
        bestCount = count
        targetCollectionId = collectionId
      } else if (count === bestCount && targetCollectionId) {
        const current = collectionsById.get(targetCollectionId)
        const candidate = collectionsById.get(collectionId)
        if (candidate?.createdAt && (!current?.createdAt || candidate.createdAt > current.createdAt)) {
          targetCollectionId = collectionId
        }
      }
    }
    const targetCollection = targetCollectionId ? collectionsById.get(targetCollectionId) : undefined
    const targetProjectName = targetCollectionId
      ? ((db.prepare(`SELECT name FROM collection WHERE id = ?`).get(targetCollectionId) as { name: string } | undefined)?.name ?? null)
      : null

    result.push({
      cabinet: rig.cabinet,
      speaker: rig.speaker,
      combosPresent: [...rig.comboDisplay.values()],
      gaps,
      // Prefer IR Lab's real project id (naming_template — see labProjectEnrichment.ts); an
      // already-scanned library from before that fix falls back to this app's own collection.id,
      // same as today's behavior, rather than losing the link entirely.
      targetProjectId: targetCollectionId ? (targetCollection?.namingTemplate || targetCollectionId) : null,
      targetProjectName
    })
  }

  result.sort((a, b) => b.gaps.length - a.gaps.length || a.cabinet.localeCompare(b.cabinet))
  return result
}
