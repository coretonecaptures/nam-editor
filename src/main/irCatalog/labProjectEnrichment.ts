/**
 * IR Lab Project enrichment (docs/ir-lab-manager-build-plan.md section 8c) — a third pass, same
 * slot as Phase 3's applyVendorParsers, run after importLibrary/finalizeIndexes/applyVendorParsers
 * in the scan IPC handler. Reads the real on-disk layout IR Lab itself writes (confirmed against
 * the actual source this session — SessionStore.h/.cpp, ProjectStore.h/.cpp, Project.h in
 * C:\Users\Admin\ir-lab — not guessed):
 *
 *   <projectFolder>/<deliverable>.wav              -- flat, already a normal `item` row
 *   <projectFolder>/.SessionData/project.json       -- captureIndex: [{ captureId, outputFileName }]
 *   <projectFolder>/.SessionData/<captureId>/session.json                    -- metadata{cabinet,speaker,microphone,position,notes,captureType}
 *   <projectFolder>/.SessionData/<captureId>/captures/<captureId>/analysis.json -- measurement.sampleRate, isStereo, isTrueStereo
 *   <projectFolder>/.SessionData/<captureId>/variants.json                   -- edit-revision history, current/archived flags
 *
 * `.SessionData` is dot-prefixed, so scanWalk.ts already never walks into it — every deliverable
 * `item` row this pass enriches was already correctly selected by the ordinary scan, with zero
 * new file-inclusion logic needed here. This pass only ever adds metadata to items that already
 * exist; it never creates or deletes `item` rows.
 */
import type { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

interface CaptureIndexEntry {
  captureId: string
  outputFileName: string
}

interface ProjectJson {
  id?: string
  name?: string
  createdAt?: string
  captureIndex?: CaptureIndexEntry[]
  // "Project Details" fields, added 2026-08-26 (ir-lab's Project.h/ProjectStore.cpp, confirmed
  // against the real source — see this file's own header comment for why that matters here).
  // Entered once per project; cabinet/speaker fall back to these at query time whenever a
  // capture's own field is blank (queryLibrary.ts's 3-way COALESCE) rather than being copied in.
  cabinet?: string
  speaker?: string
  amplifier?: string
  room?: string
  signalChain?: string
  description?: string
  projectNotes?: string
}

interface SessionJson {
  // CaptureMetadata, written into session.json's "metadata" key (SessionStore.cpp's
  // writeSessionJson/metadataJson — confirmed directly in source, not inferred from the handoff
  // doc's own wording, which describes this as living in analysis.json). The 2026-08-26 additions
  // below are just as blank/absent-safe as the original six: an older session.json with none of
  // them parses fine, every new field simply reads back undefined.
  metadata?: {
    cabinet?: string
    speaker?: string
    microphone?: string
    position?: string
    notes?: string
    captureType?: string
    speakerPosition?: string
    modeledMicrophone?: string
    presetKind?: string
    micATypeName?: string
    micAPolarPattern?: string
    micATargetZone?: string
    micADistance?: number
    micADistanceUnit?: string
    micAAxisAngleDeg?: number
    micASignalChainOverride?: string
    micANotes?: string
    micBTypeName?: string
    micBPolarPattern?: string
    micBTargetZone?: string
    micBDistance?: number
    micBDistanceUnit?: string
    micBAxisAngleDeg?: number
    micBSignalChainOverride?: string
    micBNotes?: string
  }
}

interface AnalysisJson {
  measurement?: { sampleRate?: number }
  isStereo?: boolean
  isTrueStereo?: boolean
}

interface VariantJson {
  id: string
  name?: string
  master?: string
  distribution?: string
  sampleRate?: number
  createdAt?: string
  current?: boolean
  archived?: boolean
}

export interface LabProjectEnrichStats {
  projectsFound: number
  itemsEnriched: number
}

function readJson<T>(absPath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8')) as T
  } catch {
    return null
  }
}

/** Every field this pass writes is source='ir_lab_native' — the top of the confidence ladder
 * (docs/ir-lab-manager-build-plan.md section 3; applyVendorParsers.ts's RANK map agrees), so it's
 * always safe to write unconditionally EXCEPT over a value the user hand-typed (protected forever,
 * per the ladder's own rule) — matched the same way applyVendorParsers.ts's upsertIrField does. */
function makeIrFieldWriter(db: DatabaseSync): (itemId: string, field: string, value: string | null | undefined) => void {
  const selectSource = db.prepare(`SELECT source FROM ir_item_field_source WHERE item_id = ? AND field = ?`)
  const upsertSource = db.prepare(
    `INSERT INTO ir_item_field_source (item_id, field, source) VALUES (?, ?, 'ir_lab_native')
     ON CONFLICT(item_id, field) DO UPDATE SET source = excluded.source`
  )
  return (itemId, field, value) => {
    if (!value) return
    const existing = selectSource.get(itemId, field) as { source: string } | undefined
    if (existing?.source === 'user_entered') return
    db.prepare(`UPDATE ir_item SET ${field} = ? WHERE item_id = ?`).run(value, itemId)
    upsertSource.run(itemId, field)
  }
}

export function enrichLabProjects(db: DatabaseSync, libraryRootId: number): LabProjectEnrichStats {
  const root = db.prepare(`SELECT path FROM library_root WHERE id = ?`).get(libraryRootId) as { path: string } | undefined
  if (!root) return { projectsFound: 0, itemsEnriched: 0 }

  const folders = db
    .prepare(`SELECT id, relative_path FROM folder WHERE library_root_id = ?`)
    .all(libraryRootId) as Array<{ id: number; relative_path: string }>

  const ensureIrItem = db.prepare(`INSERT OR IGNORE INTO ir_item (item_id) VALUES (?)`)
  const writeField = makeIrFieldWriter(db)
  const findCollectionByFolder = db.prepare(
    `SELECT id FROM collection WHERE folder_id = ? AND kind = 'ir_project'`
  )
  const insertCollection = db.prepare(
    `INSERT INTO collection (
       id, kind, library_root_id, folder_id, name, created_at,
       cabinet, speaker, amplifier, room, signal_chain, description, project_notes
     ) VALUES (?, 'ir_project', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  // Always re-applied from project.json on every scan — there's no NAM Lab Manager UI yet that
  // hand-edits a Project's own details, so unlike ir_item's confidence ladder there's nothing to
  // protect from being overwritten here.
  const updateCollectionDetails = db.prepare(
    `UPDATE collection SET name = ?, cabinet = ?, speaker = ?, amplifier = ?, room = ?,
       signal_chain = ?, description = ?, project_notes = ? WHERE id = ?`
  )
  const findItemByRelativePath = db.prepare(
    `SELECT id FROM item WHERE library_root_id = ? AND relative_path = ?`
  )
  const upsertCollectionItem = db.prepare(
    `INSERT INTO collection_item (collection_id, item_id) VALUES (?, ?)
     ON CONFLICT(collection_id, item_id) DO NOTHING`
  )
  const upsertVariant = db.prepare(
    `INSERT INTO ir_derivative_variant (id, item_id, name, relative_path, sample_rate, created_at, is_current, is_archived)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       item_id = excluded.item_id, name = excluded.name, relative_path = excluded.relative_path,
       sample_rate = excluded.sample_rate, created_at = excluded.created_at,
       is_current = excluded.is_current, is_archived = excluded.is_archived`
  )

  let projectsFound = 0
  let itemsEnriched = 0

  for (const folder of folders) {
    const absFolderPath = join(root.path, ...folder.relative_path.split('/').filter(Boolean))
    const sessionDataDir = join(absFolderPath, '.SessionData')
    const projectJsonPath = join(sessionDataDir, 'project.json')
    if (!fs.existsSync(projectJsonPath)) continue

    const project = readJson<ProjectJson>(projectJsonPath)
    if (!project) continue
    projectsFound++

    const projectDetails = [
      project.cabinet || null,
      project.speaker || null,
      project.amplifier || null,
      project.room || null,
      project.signalChain || null,
      project.description || null,
      project.projectNotes || null
    ] as const

    let collectionId = (findCollectionByFolder.get(folder.id) as { id: string } | undefined)?.id
    if (collectionId) {
      updateCollectionDetails.run(project.name ?? 'IR Lab Project', ...projectDetails, collectionId)
    } else {
      collectionId = randomUUID()
      insertCollection.run(
        collectionId,
        libraryRootId,
        folder.id,
        project.name ?? 'IR Lab Project',
        project.createdAt ?? null,
        ...projectDetails
      )
    }

    for (const entry of project.captureIndex ?? []) {
      const itemRelativePath = folder.relative_path ? `${folder.relative_path}/${entry.outputFileName}` : entry.outputFileName
      const item = findItemByRelativePath.get(libraryRootId, itemRelativePath) as { id: string } | undefined
      if (!item) continue // deliverable moved/deleted/never scanned — skip, don't error

      const captureDir = join(sessionDataDir, entry.captureId)
      const session = readJson<SessionJson>(join(captureDir, 'session.json'))
      const analysis = readJson<AnalysisJson>(join(captureDir, 'captures', entry.captureId, 'analysis.json'))
      const variants = readJson<VariantJson[]>(join(captureDir, 'variants.json')) ?? []

      ensureIrItem.run(item.id)
      db.prepare(`UPDATE ir_item SET capture_id = ? WHERE item_id = ? AND capture_id IS NULL`).run(entry.captureId, item.id)

      const meta = session?.metadata
      writeField(item.id, 'cabinet', meta?.cabinet)
      writeField(item.id, 'speaker', meta?.speaker)
      writeField(item.id, 'microphone', meta?.microphone)
      writeField(item.id, 'position', meta?.position)
      writeField(item.id, 'capture_type', meta?.captureType)
      // 2026-08-26 CaptureMetadata additions — same writeField() ladder writer as the six fields
      // above, so each gets its own ir_item_field_source row (source='ir_lab_native'). Nothing
      // else in this app ever guesses these fields, so there's no competing writer to rank
      // against in practice, but tracking the source costs nothing and keeps every string field
      // on ir_item consistent about where its value came from.
      writeField(item.id, 'speaker_position', meta?.speakerPosition)
      writeField(item.id, 'modeled_microphone', meta?.modeledMicrophone)
      writeField(item.id, 'preset_kind', meta?.presetKind)
      writeField(item.id, 'mic_a_type', meta?.micATypeName)
      writeField(item.id, 'mic_a_polar_pattern', meta?.micAPolarPattern)
      writeField(item.id, 'mic_a_target_zone', meta?.micATargetZone)
      writeField(item.id, 'mic_a_distance_unit', meta?.micADistanceUnit)
      writeField(item.id, 'mic_a_signal_chain_override', meta?.micASignalChainOverride)
      writeField(item.id, 'mic_a_notes', meta?.micANotes)
      // Mic B: the handoff doc's own recommended gate ("check
      // ProcessingRecipe.multiMicBlendWeightRight > 0.01 before treating Mic B data as present")
      // can't be implemented here — confirmed against the real source
      // (session/ProcessingRecipe.h/SessionStore.cpp's recipeJson()) that multiMicBlendWeightRight
      // is never actually serialized into analysis.json at all; it only exists as in-memory state
      // during a live capture. On disk, "the field is non-blank" is the only signal available, so
      // that's what writeField already does (skip when falsy) — a stale/default Mic B value could
      // theoretically still land here on a non-blend capture, which is a known limitation, not an
      // oversight.
      writeField(item.id, 'mic_b_type', meta?.micBTypeName)
      writeField(item.id, 'mic_b_polar_pattern', meta?.micBPolarPattern)
      writeField(item.id, 'mic_b_target_zone', meta?.micBTargetZone)
      writeField(item.id, 'mic_b_distance_unit', meta?.micBDistanceUnit)
      writeField(item.id, 'mic_b_signal_chain_override', meta?.micBSignalChainOverride)
      writeField(item.id, 'mic_b_notes', meta?.micBNotes)
      if (meta?.notes) db.prepare(`UPDATE item SET notes = ? WHERE id = ?`).run(meta.notes, item.id)
      // Numeric fields, written directly (writeField's writer only handles strings). A distance of
      // exactly 0 means "unset" per Domain.h's own comment, so it's skipped like any other blank
      // value; axis angle has no such convention (0 deg is a legitimate on-axis measurement), so
      // it's written whenever the key is present in the JSON at all, not gated on truthiness.
      if (meta?.micADistance) db.prepare(`UPDATE ir_item SET mic_a_distance = ? WHERE item_id = ?`).run(meta.micADistance, item.id)
      if (meta?.micAAxisAngleDeg !== undefined) {
        db.prepare(`UPDATE ir_item SET mic_a_axis_angle_deg = ? WHERE item_id = ?`).run(meta.micAAxisAngleDeg, item.id)
      }
      if (meta?.micBDistance) db.prepare(`UPDATE ir_item SET mic_b_distance = ? WHERE item_id = ?`).run(meta.micBDistance, item.id)
      if (meta?.micBAxisAngleDeg !== undefined) {
        db.prepare(`UPDATE ir_item SET mic_b_axis_angle_deg = ? WHERE item_id = ?`).run(meta.micBAxisAngleDeg, item.id)
      }

      if (analysis) {
        db.prepare(
          `UPDATE ir_item SET sample_rate = COALESCE(?, sample_rate), is_stereo = ?, is_true_stereo = ? WHERE item_id = ?`
        ).run(analysis.measurement?.sampleRate ?? null, analysis.isStereo ? 1 : 0, analysis.isTrueStereo ? 1 : 0, item.id)
      }

      for (const variant of variants) {
        const relPath = variant.distribution || variant.master
        if (!relPath) continue
        upsertVariant.run(
          variant.id,
          item.id,
          variant.name ?? variant.id,
          relPath,
          variant.sampleRate ?? null,
          variant.createdAt ?? null,
          variant.current ? 1 : 0,
          variant.archived ? 1 : 0
        )
      }

      upsertCollectionItem.run(collectionId, item.id)
      itemsEnriched++
    }
  }

  return { projectsFound, itemsEnriched }
}

/** One mic slot's structured detail (the mic_a_ and mic_b_ prefixed columns) — undefined fields
 * render as "not entered" rather than a fixed placeholder value. */
export interface ProjectDetailMic {
  type: string | null
  polarPattern: string | null
  targetZone: string | null
  distance: number | null
  distanceUnit: string | null
  axisAngleDeg: number | null
  signalChainOverride: string | null
  notes: string | null
}

export interface ProjectDetail {
  id: string
  name: string
  createdAt: string | null
  // "Project Details" fields (2026-08-26) — entered once, shared by every capture below.
  cabinet: string | null
  speaker: string | null
  amplifier: string | null
  room: string | null
  signalChain: string | null
  description: string | null
  projectNotes: string | null
  items: Array<{
    itemId: string
    displayName: string
    captureId: string | null
    cabinet: string | null
    speaker: string | null
    microphone: string | null
    position: string | null
    captureType: string | null
    sampleRate: number | null
    isStereo: boolean
    isTrueStereo: boolean
    // 2026-08-26 CaptureMetadata additions.
    speakerPosition: string | null
    modeledMicrophone: string | null
    presetKind: string | null
    micA: ProjectDetailMic
    micB: ProjectDetailMic
    variants: Array<{ id: string; name: string; isCurrent: boolean; isArchived: boolean; createdAt: string | null }>
  }>
}

/** Backend for the right panel's "Project" tab (plan section 8c/6) — one folder is at most one
 * ir_project collection (enrichLabProjects upserts by folder_id), so this is a straightforward
 * join rather than a search. */
export function getProjectDetailForFolder(db: DatabaseSync, folderId: number): ProjectDetail | null {
  const collection = db
    .prepare(
      `SELECT id, name, created_at, cabinet, speaker, amplifier, room, signal_chain, description, project_notes
       FROM collection WHERE folder_id = ? AND kind = 'ir_project'`
    )
    .get(folderId) as
    | {
        id: string
        name: string
        created_at: string | null
        cabinet: string | null
        speaker: string | null
        amplifier: string | null
        room: string | null
        signal_chain: string | null
        description: string | null
        project_notes: string | null
      }
    | undefined
  if (!collection) return null

  const items = db
    .prepare(
      `SELECT item.id as itemId, item.display_name as displayName, ir_item.capture_id as captureId,
              ir_item.cabinet as cabinet, ir_item.speaker as speaker, ir_item.microphone as microphone,
              ir_item.position as position, ir_item.capture_type as captureType, ir_item.sample_rate as sampleRate,
              ir_item.is_stereo as isStereo, ir_item.is_true_stereo as isTrueStereo,
              ir_item.speaker_position as speakerPosition, ir_item.modeled_microphone as modeledMicrophone,
              ir_item.preset_kind as presetKind,
              ir_item.mic_a_type as micAType, ir_item.mic_a_polar_pattern as micAPolarPattern,
              ir_item.mic_a_target_zone as micATargetZone, ir_item.mic_a_distance as micADistance,
              ir_item.mic_a_distance_unit as micADistanceUnit, ir_item.mic_a_axis_angle_deg as micAAxisAngleDeg,
              ir_item.mic_a_signal_chain_override as micASignalChainOverride, ir_item.mic_a_notes as micANotes,
              ir_item.mic_b_type as micBType, ir_item.mic_b_polar_pattern as micBPolarPattern,
              ir_item.mic_b_target_zone as micBTargetZone, ir_item.mic_b_distance as micBDistance,
              ir_item.mic_b_distance_unit as micBDistanceUnit, ir_item.mic_b_axis_angle_deg as micBAxisAngleDeg,
              ir_item.mic_b_signal_chain_override as micBSignalChainOverride, ir_item.mic_b_notes as micBNotes
       FROM collection_item
       JOIN item ON item.id = collection_item.item_id
       LEFT JOIN ir_item ON ir_item.item_id = item.id
       WHERE collection_item.collection_id = ?
       ORDER BY item.relative_path`
    )
    .all(collection.id) as Array<{
    itemId: string
    displayName: string
    captureId: string | null
    cabinet: string | null
    speaker: string | null
    microphone: string | null
    position: string | null
    captureType: string | null
    sampleRate: number | null
    isStereo: number | null
    isTrueStereo: number | null
    speakerPosition: string | null
    modeledMicrophone: string | null
    presetKind: string | null
    micAType: string | null
    micAPolarPattern: string | null
    micATargetZone: string | null
    micADistance: number | null
    micADistanceUnit: string | null
    micAAxisAngleDeg: number | null
    micASignalChainOverride: string | null
    micANotes: string | null
    micBType: string | null
    micBPolarPattern: string | null
    micBTargetZone: string | null
    micBDistance: number | null
    micBDistanceUnit: string | null
    micBAxisAngleDeg: number | null
    micBSignalChainOverride: string | null
    micBNotes: string | null
  }>

  const variantsByItem = db
    .prepare(
      `SELECT item_id as itemId, id, name, is_current as isCurrent, is_archived as isArchived, created_at as createdAt
       FROM ir_derivative_variant WHERE item_id IN (SELECT item_id FROM collection_item WHERE collection_id = ?)
       ORDER BY created_at DESC`
    )
    .all(collection.id) as Array<{
    itemId: string
    id: string
    name: string
    isCurrent: number
    isArchived: number
    createdAt: string | null
  }>
  const variantMap = new Map<string, ProjectDetail['items'][number]['variants']>()
  for (const v of variantsByItem) {
    const list = variantMap.get(v.itemId) ?? []
    list.push({ id: v.id, name: v.name, isCurrent: !!v.isCurrent, isArchived: !!v.isArchived, createdAt: v.createdAt })
    variantMap.set(v.itemId, list)
  }

  return {
    id: collection.id,
    name: collection.name,
    createdAt: collection.created_at,
    cabinet: collection.cabinet,
    speaker: collection.speaker,
    amplifier: collection.amplifier,
    room: collection.room,
    signalChain: collection.signal_chain,
    description: collection.description,
    projectNotes: collection.project_notes,
    items: items.map((row) => ({
      itemId: row.itemId,
      displayName: row.displayName,
      captureId: row.captureId,
      cabinet: row.cabinet,
      speaker: row.speaker,
      microphone: row.microphone,
      position: row.position,
      captureType: row.captureType,
      sampleRate: row.sampleRate,
      isStereo: !!row.isStereo,
      isTrueStereo: !!row.isTrueStereo,
      speakerPosition: row.speakerPosition,
      modeledMicrophone: row.modeledMicrophone,
      presetKind: row.presetKind,
      micA: {
        type: row.micAType,
        polarPattern: row.micAPolarPattern,
        targetZone: row.micATargetZone,
        distance: row.micADistance,
        distanceUnit: row.micADistanceUnit,
        axisAngleDeg: row.micAAxisAngleDeg,
        signalChainOverride: row.micASignalChainOverride,
        notes: row.micANotes
      },
      micB: {
        type: row.micBType,
        polarPattern: row.micBPolarPattern,
        targetZone: row.micBTargetZone,
        distance: row.micBDistance,
        distanceUnit: row.micBDistanceUnit,
        axisAngleDeg: row.micBAxisAngleDeg,
        signalChainOverride: row.micBSignalChainOverride,
        notes: row.micBNotes
      },
      variants: variantMap.get(row.itemId) ?? []
    }))
  }
}
