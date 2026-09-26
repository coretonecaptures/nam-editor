/**
 * Project Import Preview (ir-library-gpt-audit-2026-09-25's P0 "Project import is scan-led, not
 * project-led") — read-only companion to `labProjectEnrichment.ts`'s `enrichLabProjects`, which
 * writes metadata immediately on every scan with no step where the user sees what's about to
 * change. This computes the exact same field-by-field diff `enrichLabProjects` would apply,
 * without touching the database, so "Preview Project Import…" can show it first.
 *
 * Deliberately scoped to ONE project folder at a time, not the audit's full "scan every project
 * under a root and report matched/missing/new/changed/duplicate/needs-attention counts across all
 * of them" dashboard — that's a materially larger UI (and, per the audit's own P0 write-up, the
 * more speculative "Locate moved project" relink-by-ID flow) than this pass builds. This answers
 * the actual core ask ("let me see what will change before it changes") for the common case —
 * reviewing one project you just imported or re-scanned — without trying to build the whole
 * library-wide report in one pass. Worth extending to a multi-project view later if single-project
 * preview turns out to not be enough in practice.
 *
 * Field list and JSON-reading logic are deliberately NOT shared with `enrichLabProjects`'s own
 * per-item write block — seven or so string fields with the same name in the same order would look
 * shareable, but keeping this read-only computation fully independent means a bug here can never
 * corrupt a write, and vice versa. The two are kept honest against each other by
 * `labProjectEnrichment.test.ts`/this file's own tests both exercising the same real fixture shape.
 */
import type { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { readJson, type ProjectJson, type SessionJson, type CaptureIndexEntry } from './labProjectEnrichment'

interface StringFieldSpec {
  field: string
  label: string
  get: (meta: SessionJson['metadata']) => string | undefined
}

const STRING_FIELDS: StringFieldSpec[] = [
  { field: 'cabinet', label: 'Cabinet', get: (m) => m?.cabinet },
  { field: 'speaker', label: 'Speaker', get: (m) => m?.speaker },
  { field: 'microphone', label: 'Microphone', get: (m) => m?.microphone },
  { field: 'position', label: 'Position', get: (m) => m?.position },
  { field: 'capture_type', label: 'Capture Type', get: (m) => m?.captureType },
  { field: 'speaker_position', label: 'Speaker Position', get: (m) => m?.speakerPosition },
  { field: 'modeled_microphone', label: 'Modeled Microphone', get: (m) => m?.modeledMicrophone },
  { field: 'preset_kind', label: 'Preset Kind', get: (m) => m?.presetKind },
  { field: 'mic_a_type', label: 'Mic A Type', get: (m) => m?.micATypeName },
  { field: 'mic_a_polar_pattern', label: 'Mic A Polar Pattern', get: (m) => m?.micAPolarPattern },
  { field: 'mic_a_target_zone', label: 'Mic A Target Zone', get: (m) => m?.micATargetZone },
  { field: 'mic_a_distance_unit', label: 'Mic A Distance Unit', get: (m) => m?.micADistanceUnit },
  { field: 'mic_a_signal_chain_override', label: 'Mic A Signal Chain', get: (m) => m?.micASignalChainOverride },
  { field: 'mic_a_notes', label: 'Mic A Notes', get: (m) => m?.micANotes },
  { field: 'mic_b_type', label: 'Mic B Type', get: (m) => m?.micBTypeName },
  { field: 'mic_b_polar_pattern', label: 'Mic B Polar Pattern', get: (m) => m?.micBPolarPattern },
  { field: 'mic_b_target_zone', label: 'Mic B Target Zone', get: (m) => m?.micBTargetZone },
  { field: 'mic_b_distance_unit', label: 'Mic B Distance Unit', get: (m) => m?.micBDistanceUnit },
  { field: 'mic_b_signal_chain_override', label: 'Mic B Signal Chain', get: (m) => m?.micBSignalChainOverride },
  { field: 'mic_b_notes', label: 'Mic B Notes', get: (m) => m?.micBNotes },
  { field: 'reverb_unit_make', label: 'Reverb Unit Make', get: (m) => m?.reverbUnitMake },
  { field: 'reverb_unit_model', label: 'Reverb Unit Model', get: (m) => m?.reverbUnitModel },
  { field: 'reverb_preset_name', label: 'Reverb Preset Name', get: (m) => m?.reverbPresetName },
  { field: 'reverb_space_type', label: 'Reverb Space Type', get: (m) => m?.reverbSpaceType },
  { field: 'reverb_capture_mode', label: 'Reverb Capture Mode', get: (m) => m?.reverbCaptureMode },
  { field: 'reverb_source_signal_type', label: 'Reverb Source Signal', get: (m) => m?.reverbSourceSignalType }
]
/** `notes` lives on `item`, not `ir_item` — kept out of STRING_FIELDS (which all read from
 * ir_item below) and handled as its own case, mirroring how `enrichLabProjects`'s own writer
 * special-cases it via `irFieldTargetTable`. */
const NOTES_LABEL = 'Notes'

export interface ProjectImportFieldChange {
  field: string
  label: string
  currentValue: string | null
  newValue: string
  /** True when this field is currently `user_entered` — enrichLabProjects will refuse to
   * overwrite it, so Apply will skip this field even though session.json disagrees. Shown, not
   * hidden, so the preview never silently omits a real difference. */
  blockedByUserEdit: boolean
}

export interface ProjectImportCapturePreview {
  itemId: string
  displayName: string
  captureId: string
  changes: ProjectImportFieldChange[]
}

export interface ProjectImportPreview {
  folderId: number
  libraryRootId: number
  projectName: string
  irLabProjectId: string | null
  /** captureIndex entries whose deliverable file isn't in the catalog yet (moved, deleted, or
   * never scanned) — nothing to preview for these, listed so the gap is visible rather than
   * silently dropped the way enrichLabProjects itself already does. */
  missingCaptureNames: string[]
  captures: ProjectImportCapturePreview[]
  changedFieldCount: number
}

function currentFieldSources(db: DatabaseSync, itemId: string): Map<string, string> {
  const rows = db.prepare(`SELECT field, source FROM ir_item_field_source WHERE item_id = ?`).all(itemId) as Array<{
    field: string
    source: string
  }>
  return new Map(rows.map((r) => [r.field, r.source]))
}

/** Computes the diff `enrichLabProjects` would apply for one project folder, without writing
 * anything. Returns null when the folder isn't (or is no longer) an IR Lab Project folder — same
 * "no .SessionData/project.json" test `enrichLabProjects` itself uses to skip a folder. */
export function previewProjectImport(db: DatabaseSync, folderId: number): ProjectImportPreview | null {
  const folder = db.prepare(`SELECT library_root_id as libraryRootId, relative_path as relativePath FROM folder WHERE id = ?`).get(folderId) as
    | { libraryRootId: number; relativePath: string }
    | undefined
  if (!folder) return null
  const root = db.prepare(`SELECT path FROM library_root WHERE id = ?`).get(folder.libraryRootId) as { path: string } | undefined
  if (!root) return null

  const absFolderPath = join(root.path, ...folder.relativePath.split('/').filter(Boolean))
  const sessionDataDir = join(absFolderPath, '.SessionData')
  const projectJsonPath = join(sessionDataDir, 'project.json')
  if (!fs.existsSync(projectJsonPath)) return null
  const project = readJson<ProjectJson>(projectJsonPath)
  if (!project) return null

  const findItemByRelativePath = db.prepare(`SELECT id, display_name as displayName FROM item WHERE library_root_id = ? AND relative_path = ?`)
  const currentIrItemRow = db.prepare(`SELECT * FROM ir_item WHERE item_id = ?`)
  const currentNotes = db.prepare(`SELECT notes FROM item WHERE id = ?`)

  const captures: ProjectImportCapturePreview[] = []
  const missingCaptureNames: string[] = []
  let changedFieldCount = 0

  for (const entry of (project.captureIndex ?? []) as CaptureIndexEntry[]) {
    const itemRelativePath = folder.relativePath ? `${folder.relativePath}/${entry.outputFileName}` : entry.outputFileName
    const item = findItemByRelativePath.get(folder.libraryRootId, itemRelativePath) as { id: string; displayName: string } | undefined
    if (!item) {
      missingCaptureNames.push(entry.outputFileName)
      continue
    }

    const captureDir = join(sessionDataDir, entry.captureId)
    const session = readJson<SessionJson>(join(captureDir, 'session.json'))
    const meta = session?.metadata
    if (!meta) {
      captures.push({ itemId: item.id, displayName: item.displayName, captureId: entry.captureId, changes: [] })
      continue
    }

    const currentRow = (currentIrItemRow.get(item.id) as Record<string, unknown> | undefined) ?? {}
    const sources = currentFieldSources(db, item.id)
    const changes: ProjectImportFieldChange[] = []

    const considerField = (field: string, label: string, newValue: string | undefined, currentValue: string | null): void => {
      if (!newValue) return // enrichLabProjects' own writer skips falsy values the same way
      if (newValue === (currentValue ?? '')) return // no actual change
      const blockedByUserEdit = sources.get(field) === 'user_entered'
      changes.push({ field, label, currentValue, newValue, blockedByUserEdit })
      if (!blockedByUserEdit) changedFieldCount++
    }

    for (const spec of STRING_FIELDS) {
      considerField(spec.field, spec.label, spec.get(meta), (currentRow[spec.field] as string | null) ?? null)
    }
    const currentNotesRow = currentNotes.get(item.id) as { notes: string | null } | undefined
    considerField('notes', NOTES_LABEL, meta.notes, currentNotesRow?.notes ?? null)

    captures.push({ itemId: item.id, displayName: item.displayName, captureId: entry.captureId, changes })
  }

  return {
    folderId,
    libraryRootId: folder.libraryRootId,
    projectName: project.name ?? 'IR Lab Project',
    irLabProjectId: project.id ?? null,
    missingCaptureNames,
    captures,
    changedFieldCount
  }
}
