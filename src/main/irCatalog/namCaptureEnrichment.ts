/**
 * IR Lab NAM Capture enrichment — a fourth scan pass, sibling to (NOT an extension of)
 * labProjectEnrichment.ts. Runs in the same slot in the scan IPC handler, right after
 * enrichLabProjects. See docs/nam-capture-import-plan-2026-08-29.md §2 and IR Lab's
 * docs/nam_lab_metadata_handoff_2026-08-29.md (both "UPDATE 2026-08-30" sections) for the
 * confirmed data contract, authoritative in ir-lab's NamCaptureStore.cpp.
 *
 * schemaVersion 2 on-disk layout (per project outputRoot):
 *
 *   <project>/_excitations/<stem>-<hash12>-<rate>hz.wav   shared, one per (excitation, rate)
 *   <project>/NAM Captures/
 *       <Capture Name>.wav                24-bit PCM mono, the captured return
 *       <Capture Name>.nam-capture.json   sidecar, SAME BASENAME as the WAV
 *       <Capture Name>.nam-lab-result.json  written ONLY by this app once trained
 *
 * Every WAV is already an ordinary `item` row (importLibrary walks every .wav — the shared
 * excitation lands as kind='ir', which stays as-is). This pass globs *.nam-capture.json in every
 * folder (multiple per folder now — no per-capture subfolder), resolves the DI/return pair from
 * the sidecar's own `excitation` (a RELATIVE path that may start '../', resolved against the
 * sidecar's dir) and `recording` (bare filename) fields, promotes the return item to
 * kind='nam_capture', inserts a bare nam_capture_item row plus the pre-training columns +
 * calibration + suggested-metadata hints, and groups captures into one collection(kind=
 * 'nam_project') per distinct projectId — the JSON's field, never folder nesting depth.
 *
 * Clean break from the v1 per-folder `nam-capture.json` layout (both apps pre-release): only
 * `*.nam-capture.json` sidecars are recognized. This pass never creates or deletes `item` rows.
 */
import type { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readNamLabResult, relinkNamLabResult, type NamLabResult } from './namCaptureResult'

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'])

const SIDECAR_SUFFIX = '.nam-capture.json'

/** nam-capture.json (schemaVersion 2). Every field is absent-safe. */
interface NamCaptureJson {
  schemaVersion?: number
  captureId?: string
  captureName?: string
  createdAt?: string
  captureScope?: string // 'Cabinet' | 'CabOnly' | 'DirectAmp' | 'Device' | 'Software'
  excitation?: string // relative path, may start '../' — resolve against the sidecar's own dir
  recording?: string // bare filename in the sidecar's own dir
  excitationSourceName?: string
  stimulusSha256?: string
  sampleRate?: number
  measuredLatencySamples?: number
  projectId?: string
  projectName?: string
  synthetic?: boolean
  syntheticSourceIrName?: string
  // schemaVersion 2 optional blocks.
  calibration?: {
    inputLevelDbu?: number
    outputLevelDbu?: number
    method?: string
    confidence?: string
    profileName?: string
    calibratedAt?: string
  }
  modelMetadataSuggested?: {
    name?: string
    modeledBy?: string
    gearMake?: string
    gearModel?: string
    gearType?: string
    toneType?: string
  }
}

/** Optional per-project details block (IR Lab's cheap ask #1 in the handoff doc). Read from
 * nam-project.json when present; entirely optional — nothing gates on it. */
interface NamProjectJson {
  cabinet?: string
  speaker?: string
  room?: string
  signalChain?: string
  description?: string
  projectNotes?: string
}

export interface NamCaptureEnrichStats {
  projectsFound: number
  capturesEnriched: number
  syntheticCaptures: number
}

function readJson<T>(absPath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(absPath, 'utf8')) as T
  } catch {
    return null
  }
}

export function enrichNamCaptures(db: DatabaseSync, libraryRootId: number): NamCaptureEnrichStats {
  const root = db.prepare(`SELECT path FROM library_root WHERE id = ?`).get(libraryRootId) as { path: string } | undefined
  if (!root) return { projectsFound: 0, capturesEnriched: 0, syntheticCaptures: 0 }

  const folders = db
    .prepare(`SELECT id, relative_path FROM folder WHERE library_root_id = ?`)
    .all(libraryRootId) as Array<{ id: number; relative_path: string }>

  const findItemByRelativePath = db.prepare(`SELECT id FROM item WHERE library_root_id = ? AND relative_path = ?`)
  const setItemKind = db.prepare(`UPDATE item SET kind = 'nam_capture' WHERE id = ?`)
  const ensureNamCaptureItem = db.prepare(`INSERT OR IGNORE INTO nam_capture_item (item_id) VALUES (?)`)
  // Two-part update: the first group is an always-synced mirror of IR Lab's sidecar; the second
  // group is the *effective* (user-editable) metadata, default-filled from the sidecar only
  // while still NULL (COALESCE keeps a user edit; a fresh row gets the suggestion/calibration).
  const updateNamCaptureFacts = db.prepare(
    `UPDATE nam_capture_item SET
       capture_id = ?, capture_name = ?, project_id = ?, capture_scope = ?, sample_rate = ?,
       measured_latency_samples = ?, synthetic = ?, synthetic_source_ir_name = ?, created_at = ?,
       excitation_path = ?, recording_path = ?, excitation_source_name = ?, stimulus_sha256 = ?,
       calibration_input_dbu = ?, calibration_output_dbu = ?,
       calibration_method = ?, calibration_confidence = ?, calibration_profile_name = ?, calibrated_at = ?,
       suggested_name = ?, suggested_modeled_by = ?, suggested_gear_make = ?, suggested_gear_model = ?,
       suggested_gear_type = ?, suggested_tone_type = ?,
       modeled_by       = COALESCE(modeled_by, ?),
       gear_make        = COALESCE(gear_make, ?),
       gear_model       = COALESCE(gear_model, ?),
       gear_type        = COALESCE(gear_type, ?),
       tone_type        = COALESCE(tone_type, ?),
       input_level_dbu  = COALESCE(input_level_dbu, ?),
       output_level_dbu = COALESCE(output_level_dbu, ?)
     WHERE item_id = ?`
  )
  const findCollectionByProject = db.prepare(
    `SELECT id FROM collection WHERE library_root_id = ? AND kind = 'nam_project' AND naming_template = ?`
  )
  const insertCollection = db.prepare(
    `INSERT INTO collection (
       id, kind, library_root_id, folder_id, name, naming_template, created_at,
       cabinet, speaker, room, signal_chain, description, project_notes
     ) VALUES (?, 'nam_project', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const updateCollectionDetails = db.prepare(
    `UPDATE collection SET name = ?, folder_id = ?, cabinet = ?, speaker = ?, room = ?,
       signal_chain = ?, description = ?, project_notes = ? WHERE id = ?`
  )
  const upsertCollectionItem = db.prepare(
    `INSERT INTO collection_item (collection_id, item_id) VALUES (?, ?)
     ON CONFLICT(collection_id, item_id) DO NOTHING`
  )

  let projectsFound = 0
  let capturesEnriched = 0
  let syntheticCaptures = 0
  // projectId -> collection.id, so N captures sharing a project only touch `collection` once.
  const projectCollectionIds = new Map<string, string>()
  const seenProjectIds = new Set<string>()

  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const str = (v: unknown): string | null => {
    if (typeof v !== 'string') return null
    const t = v.trim()
    return t.length ? t : null
  }

  for (const folder of folders) {
    const absFolderPath = join(root.path, ...folder.relative_path.split('/').filter(Boolean))
    let sidecarNames: string[]
    try {
      sidecarNames = fs.readdirSync(absFolderPath).filter((f) => f.endsWith(SIDECAR_SUFFIX))
    } catch {
      continue // folder vanished mid-scan
    }
    if (sidecarNames.length === 0) continue

    for (const sidecarName of sidecarNames) {
      const capture = readJson<NamCaptureJson>(join(absFolderPath, sidecarName))
      if (!capture) continue

      // recording: bare filename in this same folder. Fall back to the sidecar's own stem
      // (<stem>.nam-capture.json -> <stem>.wav) — IR Lab guarantees they share a basename.
      const recordingName = str(capture.recording) ?? `${sidecarName.slice(0, -SIDECAR_SUFFIX.length)}.wav`
      // excitation: a relative path that may start '../' (into <project>/_excitations/). join()
      // normalizes the '..' against the sidecar's own directory.
      const excitationField = str(capture.excitation)
      const excitationAbs = excitationField ? join(absFolderPath, excitationField) : null
      const recordingAbs = join(absFolderPath, recordingName)

      const recordingRelPath = folder.relative_path ? `${folder.relative_path}/${recordingName}` : recordingName
      const recordingItem = findItemByRelativePath.get(libraryRootId, recordingRelPath) as { id: string } | undefined
      if (!recordingItem) continue // return WAV moved/deleted/never scanned — skip, don't error

      const projectId = str(capture.projectId) ?? `folder:${folder.relative_path}`
      const projectName = str(capture.projectName) ?? 'NAM Capture Project'
      const captureName = str(capture.captureName) ?? recordingName.replace(/\.wav$/i, '')
      const isSynthetic = capture.synthetic === true
      const cal = capture.calibration ?? {}
      const hasHints = capture.modelMetadataSuggested != null
      const hint = capture.modelMetadataSuggested ?? {}

      setItemKind.run(recordingItem.id)
      ensureNamCaptureItem.run(recordingItem.id)
      updateNamCaptureFacts.run(
        str(capture.captureId),
        captureName,
        str(capture.projectId),
        str(capture.captureScope),
        num(capture.sampleRate),
        num(capture.measuredLatencySamples),
        isSynthetic ? 1 : 0,
        str(capture.syntheticSourceIrName),
        str(capture.createdAt),
        excitationAbs,
        recordingAbs,
        str(capture.excitationSourceName),
        str(capture.stimulusSha256),
        // Mirror of the sidecar's calibration block (provenance for the UI). The two dBu numbers
        // also seed the effective input_level_dbu/output_level_dbu below.
        num(cal.inputLevelDbu),
        num(cal.outputLevelDbu),
        str(cal.method),
        str(cal.confidence),
        str(cal.profileName),
        str(cal.calibratedAt),
        // modelMetadataSuggested — the IR Lab hint, verbatim mirror. Written only when the
        // sidecar actually had the block (suggested_name defaults to the capture name, so it
        // can't be the "has hints" signal).
        hasHints ? (str(hint.name) ?? captureName) : null,
        str(hint.modeledBy),
        str(hint.gearMake),
        str(hint.gearModel),
        str(hint.gearType),
        str(hint.toneType),
        // Effective (editable) defaults — COALESCE'd, so these only apply on a fresh row.
        str(hint.modeledBy),
        str(hint.gearMake),
        str(hint.gearModel),
        str(hint.gearType),
        str(hint.toneType),
        num(cal.inputLevelDbu),
        num(cal.outputLevelDbu),
        recordingItem.id
      )
      // Human display name — importLibrary named the item after the WAV file; the capture name
      // is what the tree/list should show (they usually match now, but not guaranteed).
      db.prepare(`UPDATE item SET display_name = ? WHERE id = ?`).run(captureName, recordingItem.id)

      // One collection row per distinct projectId. naming_template carries the raw projectId as
      // the stable lookup key (collection has no dedicated project-id column).
      let collectionId = projectCollectionIds.get(projectId)
      if (!collectionId) {
        collectionId = (findCollectionByProject.get(libraryRootId, projectId) as { id: string } | undefined)?.id
        // nam-project.json (handoff ask #1) was not implemented by IR Lab — project context now
        // arrives via modelMetadataSuggested per capture. Still probe for the file in case that
        // changes; harmless when absent.
        const projectDetails =
          readJson<NamProjectJson>(join(absFolderPath, '..', 'nam-project.json')) ??
          readJson<NamProjectJson>(join(absFolderPath, 'nam-project.json'))
        const detailValues = [
          str(projectDetails?.cabinet),
          str(projectDetails?.speaker),
          str(projectDetails?.room),
          str(projectDetails?.signalChain),
          str(projectDetails?.description),
          str(projectDetails?.projectNotes)
        ] as const
        if (collectionId) {
          updateCollectionDetails.run(projectName, folder.id, ...detailValues, collectionId)
        } else {
          collectionId = randomUUID()
          insertCollection.run(
            collectionId,
            libraryRootId,
            folder.id,
            projectName,
            projectId,
            str(capture.createdAt),
            ...detailValues
          )
        }
        projectCollectionIds.set(projectId, collectionId)
      }

      upsertCollectionItem.run(collectionId, recordingItem.id)

      if (!seenProjectIds.has(projectId)) {
        seenProjectIds.add(projectId)
        projectsFound++
      }
      capturesEnriched++
      if (isSynthetic) syntheticCaptures++
    }
  }

  return { projectsFound, capturesEnriched, syntheticCaptures }
}

/** One NAM Capture, as the "NAM Projects" tree/list needs it. Trained/untrained is derived
 * purely from the presence of nam-lab-result.json in the capture folder — no stored flag. */
export interface NamCaptureSuggestedMetadata {
  name: string | null
  modeledBy: string | null
  gearMake: string | null
  gearModel: string | null
  gearType: string | null
  toneType: string | null
}

export interface NamCaptureCalibration {
  inputLevelDbu: number | null
  outputLevelDbu: number | null
  method: string | null
  confidence: string | null
  profileName: string | null
  calibratedAt: string | null
}

/** The effective, user-editable model metadata for a capture — defaults from `suggested` /
 * `calibration` on first scan, edited via irLibrary:setNamCaptureMetadata, and what training +
 * the .nam seeding actually use. */
export interface NamCaptureEffectiveMetadata {
  modeledBy: string | null
  gearMake: string | null
  gearModel: string | null
  gearType: string | null
  toneType: string | null
  inputLevelDbu: number | null
  outputLevelDbu: number | null
}

/** fs facts about a file on disk, or null when it's missing. */
export interface FileFacts {
  path: string
  bytes: number
  mtimeMs: number
}

export interface NamCaptureRow {
  itemId: string
  captureId: string | null
  captureName: string
  captureScope: string | null
  sampleRate: number | null
  measuredLatencySamples: number | null
  synthetic: boolean
  syntheticSourceIrName: string | null
  createdAt: string | null
  excitationPath: string | null
  excitationSourceName: string | null
  stimulusSha256: string | null
  recordingPath: string | null
  /** dirname of recordingPath — the "NAM Captures/" folder. Kept for "Reveal in Explorer". */
  captureFolderPath: string | null
  /** WAV-header facts for the recording, from its `ir_item` row (survives the kind flip). */
  recordingBitDepth: number | null
  recordingChannels: number | null
  recordingDurationSec: number | null
  audioFormat: string | null
  /** fs stat of the recording WAV — null if it has vanished since the scan. */
  recordingFile: FileFacts | null
  /** schemaVersion 2: any non-empty part of the sidecar's `calibration` block. */
  calibration: NamCaptureCalibration | null
  /** schemaVersion 2: the sidecar's `modelMetadataSuggested` hints (verbatim mirror). */
  suggested: NamCaptureSuggestedMetadata | null
  /** Effective (editable) metadata — what training uses. */
  effective: NamCaptureEffectiveMetadata
  /** true when `effective` diverges from `suggested`/`calibration` (i.e. the user edited it). */
  metadataEdited: boolean
  trained: boolean
  result: NamLabResult | null
  /** fs stat of `result.outputModelPath` — null if the .nam has been moved/renamed/deleted. */
  modelFile: FileFacts | null
  /** true when `result.graphPath` exists on disk. */
  graphExists: boolean
}

export interface NamProjectSummary {
  collectionId: string
  projectId: string
  name: string
  createdAt: string | null
  libraryRootId: number
  folderId: number | null
  captureCount: number
  trainedCount: number
  syntheticCount: number
}

export interface NamProjectDetail extends NamProjectSummary {
  cabinet: string | null
  speaker: string | null
  room: string | null
  signalChain: string | null
  description: string | null
  projectNotes: string | null
  /** Absolute path of the project's `NAM Captures/` folder (for Reveal), or null. */
  namCapturesDir: string | null
  /** Absolute path of the project's `_excitations/` folder, or null. */
  excitationsDir: string | null
  /** Image files found in the project dir and its `NAM Captures/` dir (rig photos, notes). */
  imagePaths: string[]
  captures: NamCaptureRow[]
}

function folderPathFromRecording(recordingPath: string | null): string | null {
  if (!recordingPath) return null
  return recordingPath.replace(/[\\/][^\\/]+$/, '')
}

interface CaptureQueryRow {
  itemId: string
  captureId: string | null
  captureName: string | null
  captureScope: string | null
  sampleRate: number | null
  measuredLatencySamples: number | null
  synthetic: number | null
  syntheticSourceIrName: string | null
  createdAt: string | null
  excitationPath: string | null
  excitationSourceName: string | null
  stimulusSha256: string | null
  recordingPath: string | null
  displayName: string
  recordingBitDepth: number | null
  recordingChannels: number | null
  recordingDurationSec: number | null
  audioFormat: string | null
  calInputDbu: number | null
  calOutputDbu: number | null
  calibrationMethod: string | null
  calibrationConfidence: string | null
  calibrationProfileName: string | null
  calibratedAt: string | null
  suggestedName: string | null
  suggestedModeledBy: string | null
  suggestedGearMake: string | null
  suggestedGearModel: string | null
  suggestedGearType: string | null
  suggestedToneType: string | null
  effModeledBy: string | null
  effGearMake: string | null
  effGearModel: string | null
  effGearType: string | null
  effToneType: string | null
  effInputDbu: number | null
  effOutputDbu: number | null
}

function statFacts(path: string | null): FileFacts | null {
  if (!path) return null
  try {
    const s = fs.statSync(path)
    if (!s.isFile()) return null
    return { path, bytes: s.size, mtimeMs: s.mtimeMs }
  } catch {
    return null
  }
}

function mapCaptureRow(row: CaptureQueryRow): NamCaptureRow {
  // schemaVersion 2: the sidecar is <dir>/<CaptureName>.nam-lab-result.json, keyed off the
  // recording WAV path (no per-capture folder). readNamLabResult derives the sidecar name.
  const result = row.recordingPath ? readNamLabResult(row.recordingPath) : null
  const calibration: NamCaptureCalibration = {
    inputLevelDbu: row.calInputDbu,
    outputLevelDbu: row.calOutputDbu,
    method: row.calibrationMethod,
    confidence: row.calibrationConfidence,
    profileName: row.calibrationProfileName,
    calibratedAt: row.calibratedAt
  }
  const suggested: NamCaptureSuggestedMetadata = {
    name: row.suggestedName,
    modeledBy: row.suggestedModeledBy,
    gearMake: row.suggestedGearMake,
    gearModel: row.suggestedGearModel,
    gearType: row.suggestedGearType,
    toneType: row.suggestedToneType
  }
  const effective: NamCaptureEffectiveMetadata = {
    modeledBy: row.effModeledBy,
    gearMake: row.effGearMake,
    gearModel: row.effGearModel,
    gearType: row.effGearType,
    toneType: row.effToneType,
    inputLevelDbu: row.effInputDbu,
    outputLevelDbu: row.effOutputDbu
  }
  const hasCalibration = Object.values(calibration).some((v) => v != null)
  const hasSuggested = Object.values(suggested).some((v) => v != null)
  const metadataEdited =
    effective.modeledBy !== suggested.modeledBy ||
    effective.gearMake !== suggested.gearMake ||
    effective.gearModel !== suggested.gearModel ||
    effective.gearType !== suggested.gearType ||
    effective.toneType !== suggested.toneType ||
    effective.inputLevelDbu !== calibration.inputLevelDbu ||
    effective.outputLevelDbu !== calibration.outputLevelDbu
  return {
    itemId: row.itemId,
    captureId: row.captureId,
    captureName: row.captureName || row.displayName,
    captureScope: row.captureScope,
    sampleRate: row.sampleRate,
    measuredLatencySamples: row.measuredLatencySamples,
    synthetic: !!row.synthetic,
    syntheticSourceIrName: row.syntheticSourceIrName,
    createdAt: row.createdAt,
    excitationPath: row.excitationPath,
    excitationSourceName: row.excitationSourceName,
    stimulusSha256: row.stimulusSha256,
    recordingPath: row.recordingPath,
    captureFolderPath: folderPathFromRecording(row.recordingPath),
    recordingBitDepth: row.recordingBitDepth,
    recordingChannels: row.recordingChannels,
    recordingDurationSec: row.recordingDurationSec,
    audioFormat: row.audioFormat,
    recordingFile: statFacts(row.recordingPath),
    calibration: hasCalibration ? calibration : null,
    suggested: hasSuggested ? suggested : null,
    effective,
    metadataEdited,
    trained: result != null,
    result,
    modelFile: statFacts(result?.outputModelPath ?? null),
    graphExists: statFacts(result?.graphPath ?? null) != null
  }
}

const CAPTURE_SELECT = `
  SELECT item.id as itemId, item.display_name as displayName,
         nc.capture_id as captureId, nc.capture_name as captureName, nc.capture_scope as captureScope,
         nc.sample_rate as sampleRate, nc.measured_latency_samples as measuredLatencySamples,
         nc.synthetic as synthetic, nc.synthetic_source_ir_name as syntheticSourceIrName,
         nc.created_at as createdAt, nc.excitation_path as excitationPath, nc.recording_path as recordingPath,
         nc.excitation_source_name as excitationSourceName, nc.stimulus_sha256 as stimulusSha256,
         ir.bit_depth as recordingBitDepth, ir.channels as recordingChannels,
         ir.duration_seconds as recordingDurationSec, ir.audio_format as audioFormat,
         nc.calibration_input_dbu as calInputDbu, nc.calibration_output_dbu as calOutputDbu,
         nc.calibration_method as calibrationMethod, nc.calibration_confidence as calibrationConfidence,
         nc.calibration_profile_name as calibrationProfileName, nc.calibrated_at as calibratedAt,
         nc.suggested_name as suggestedName, nc.suggested_modeled_by as suggestedModeledBy,
         nc.suggested_gear_make as suggestedGearMake, nc.suggested_gear_model as suggestedGearModel,
         nc.suggested_gear_type as suggestedGearType, nc.suggested_tone_type as suggestedToneType,
         nc.modeled_by as effModeledBy, nc.gear_make as effGearMake, nc.gear_model as effGearModel,
         nc.gear_type as effGearType, nc.tone_type as effToneType,
         nc.input_level_dbu as effInputDbu, nc.output_level_dbu as effOutputDbu
  FROM collection_item
  JOIN item ON item.id = collection_item.item_id
  LEFT JOIN nam_capture_item nc ON nc.item_id = item.id
  LEFT JOIN ir_item ir ON ir.item_id = item.id
  WHERE collection_item.collection_id = ?
  ORDER BY nc.created_at, item.relative_path
`

/** Backend for the "NAM Projects" left rail — every nam_project collection across every root. */
export function listNamProjects(db: DatabaseSync): NamProjectSummary[] {
  const collections = db
    .prepare(
      `SELECT id, naming_template as projectId, name, created_at as createdAt,
              library_root_id as libraryRootId, folder_id as folderId
       FROM collection WHERE kind = 'nam_project' ORDER BY name`
    )
    .all() as Array<{
    id: string
    projectId: string
    name: string
    createdAt: string | null
    libraryRootId: number
    folderId: number | null
  }>

  const captureStmt = db.prepare(CAPTURE_SELECT)
  return collections.map((c) => {
    const captures = (captureStmt.all(c.id) as unknown as CaptureQueryRow[]).map(mapCaptureRow)
    return {
      collectionId: c.id,
      projectId: c.projectId,
      name: c.name,
      createdAt: c.createdAt,
      libraryRootId: c.libraryRootId,
      folderId: c.folderId,
      captureCount: captures.length,
      trainedCount: captures.filter((x) => x.trained).length,
      syntheticCount: captures.filter((x) => x.synthetic).length
    }
  })
}

/** Backend for the right panel — one project with every capture and its trained/untrained state. */
export function getNamProjectDetail(db: DatabaseSync, collectionId: string): NamProjectDetail | null {
  const c = db
    .prepare(
      `SELECT id, naming_template as projectId, name, created_at as createdAt,
              library_root_id as libraryRootId, folder_id as folderId,
              cabinet, speaker, room, signal_chain as signalChain,
              description, project_notes as projectNotes
       FROM collection WHERE id = ? AND kind = 'nam_project'`
    )
    .get(collectionId) as
    | {
        id: string
        projectId: string
        name: string
        createdAt: string | null
        libraryRootId: number
        folderId: number | null
        cabinet: string | null
        speaker: string | null
        room: string | null
        signalChain: string | null
        description: string | null
        projectNotes: string | null
      }
    | undefined
  if (!c) return null

  const captures = (db.prepare(CAPTURE_SELECT).all(c.id) as unknown as CaptureQueryRow[]).map(mapCaptureRow)

  // The project's own folder is the parent of the "NAM Captures" dir (which is where every
  // capture recording lives). `_excitations` is its sibling.
  const namCapturesDir = captures.map((x) => x.captureFolderPath).find((p): p is string => !!p) ?? null
  const projectDir = namCapturesDir ? dirname(namCapturesDir) : null
  const excitationsDir = projectDir ? join(projectDir, '_excitations') : null

  const imagePaths: string[] = []
  for (const dir of [projectDir, namCapturesDir]) {
    if (!dir) continue
    try {
      for (const name of fs.readdirSync(dir)) {
        const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
        if (IMAGE_EXTS.has(ext)) imagePaths.push(join(dir, name))
      }
    } catch {
      /* dir gone — skip */
    }
  }

  return {
    collectionId: c.id,
    projectId: c.projectId,
    name: c.name,
    createdAt: c.createdAt,
    libraryRootId: c.libraryRootId,
    folderId: c.folderId,
    captureCount: captures.length,
    trainedCount: captures.filter((x) => x.trained).length,
    syntheticCount: captures.filter((x) => x.synthetic).length,
    cabinet: c.cabinet,
    speaker: c.speaker,
    room: c.room,
    signalChain: c.signalChain,
    description: c.description,
    projectNotes: c.projectNotes,
    namCapturesDir,
    excitationsDir: excitationsDir && fs.existsSync(excitationsDir) ? excitationsDir : null,
    imagePaths,
    captures
  }
}

/** Persist an edit to a capture's *effective* (editable) model metadata. Only the keys present
 * in `patch` are written; a key set to '' / null clears it (so a later scan re-defaults it from
 * the IR Lab suggestion). Returns the updated capture row. */
export function setNamCaptureMetadata(
  db: DatabaseSync,
  itemId: string,
  patch: Partial<Pick<NamCaptureEffectiveMetadata, 'modeledBy' | 'gearMake' | 'gearModel' | 'gearType' | 'toneType' | 'inputLevelDbu' | 'outputLevelDbu'>>
): NamCaptureRow | null {
  const col: Record<keyof typeof patch, string> = {
    modeledBy: 'modeled_by',
    gearMake: 'gear_make',
    gearModel: 'gear_model',
    gearType: 'gear_type',
    toneType: 'tone_type',
    inputLevelDbu: 'input_level_dbu',
    outputLevelDbu: 'output_level_dbu'
  }
  const sets: string[] = []
  const vals: Array<string | number | null> = []
  for (const [k, v] of Object.entries(patch) as Array<[keyof typeof patch, unknown]>) {
    sets.push(`${col[k]} = ?`)
    if (k === 'inputLevelDbu' || k === 'outputLevelDbu') {
      vals.push(typeof v === 'number' && Number.isFinite(v) ? v : null)
    } else {
      const s = typeof v === 'string' ? v.trim() : ''
      vals.push(s.length ? s : null)
    }
  }
  if (sets.length === 0) return getNamCaptureRow(db, itemId)
  db.prepare(`UPDATE nam_capture_item SET ${sets.join(', ')} WHERE item_id = ?`).run(...vals, itemId)
  return getNamCaptureRow(db, itemId)
}

/** One capture row by item id (for returning the fresh state after an edit / relink). */
export function getNamCaptureRow(db: DatabaseSync, itemId: string): NamCaptureRow | null {
  const row = db
    .prepare(CAPTURE_SELECT.replace('WHERE collection_item.collection_id = ?', 'WHERE item.id = ?'))
    .get(itemId) as CaptureQueryRow | undefined
  return row ? mapCaptureRow(row) : null
}

/** Point a trained capture's result sidecar at a moved .nam. `recordingPath` identifies the
 * sidecar; `newModelPath` is the file the user picked. Returns the fresh capture row. */
export function relinkNamCaptureModel(db: DatabaseSync, itemId: string, newModelPath: string): NamCaptureRow | null {
  const row = getNamCaptureRow(db, itemId)
  if (!row?.recordingPath) return row
  relinkNamLabResult(row.recordingPath, newModelPath)
  return getNamCaptureRow(db, itemId)
}

/** Best-effort search for a trained model file that has moved: look for `<modelName>.nam` under
 * each root (recursively, shallow-ish), newest first. Returns up to 5 candidate paths. */
export function findNamModelCandidates(modelName: string, roots: string[]): string[] {
  const target = `${modelName}.nam`.toLowerCase()
  const hits: Array<{ path: string; mtimeMs: number }> = []
  const MAX_ENTRIES = 20000
  let seen = 0
  const walk = (dir: string, depth: number): void => {
    if (depth > 6 || seen > MAX_ENTRIES) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (seen++ > MAX_ENTRIES) return
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (!e.name.startsWith('.') && e.name !== 'node_modules') walk(full, depth + 1)
      } else if (e.name.toLowerCase() === target) {
        try {
          hits.push({ path: full, mtimeMs: fs.statSync(full).mtimeMs })
        } catch {
          /* skip */
        }
      }
    }
  }
  for (const r of roots) {
    if (r && fs.existsSync(r)) walk(r, 0)
  }
  return hits.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 5).map((h) => h.path)
}

export interface NamLibraryOverview {
  totalProjects: number
  totalCaptures: number
  trainedCaptures: number
  untrainedCaptures: number
  syntheticCaptures: number
  /** Mean validation ESR across every trained capture that recorded one. null if none. */
  avgTrainedEsr: number | null
  byScope: Array<{ key: string; count: number }>
  bySampleRate: Array<{ key: string; count: number }>
  byArchitecture: Array<{ key: string; count: number }>
  projects: Array<{
    collectionId: string
    name: string
    captureCount: number
    trainedCount: number
    syntheticCount: number
    avgTrainedEsr: number | null
  }>
}

function tally(pairs: Array<string | null | undefined>): Array<{ key: string; count: number }> {
  const m = new Map<string, number>()
  for (const p of pairs) {
    const key = p == null || p === '' ? 'unknown' : String(p)
    m.set(key, (m.get(key) ?? 0) + 1)
  }
  return [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

/**
 * Library-wide NAM Capture coverage — backs the "Overview" panel and the copy-to-clipboard
 * report in NAM Projects mode. Trained state + architecture + ESR come from each capture folder's
 * nam-lab-result.json (read fresh, same as getNamProjectDetail), so this reflects disk truth
 * without a rescan.
 */
export function getNamLibraryOverview(db: DatabaseSync): NamLibraryOverview {
  const collections = db
    .prepare(`SELECT id, name FROM collection WHERE kind = 'nam_project' ORDER BY name`)
    .all() as Array<{ id: string; name: string }>

  const captureStmt = db.prepare(CAPTURE_SELECT)
  const allCaptures: NamCaptureRow[] = []
  const projects: NamLibraryOverview['projects'] = []

  for (const c of collections) {
    const caps = (captureStmt.all(c.id) as unknown as CaptureQueryRow[]).map(mapCaptureRow)
    allCaptures.push(...caps)
    const trainedEsrs = caps.map((x) => x.result?.validationEsr).filter((v): v is number => typeof v === 'number')
    projects.push({
      collectionId: c.id,
      name: c.name,
      captureCount: caps.length,
      trainedCount: caps.filter((x) => x.trained).length,
      syntheticCount: caps.filter((x) => x.synthetic).length,
      avgTrainedEsr: trainedEsrs.length ? trainedEsrs.reduce((a, b) => a + b, 0) / trainedEsrs.length : null
    })
  }

  const allEsrs = allCaptures.map((x) => x.result?.validationEsr).filter((v): v is number => typeof v === 'number')

  return {
    totalProjects: collections.length,
    totalCaptures: allCaptures.length,
    trainedCaptures: allCaptures.filter((x) => x.trained).length,
    untrainedCaptures: allCaptures.filter((x) => !x.trained).length,
    syntheticCaptures: allCaptures.filter((x) => x.synthetic).length,
    avgTrainedEsr: allEsrs.length ? allEsrs.reduce((a, b) => a + b, 0) / allEsrs.length : null,
    byScope: tally(allCaptures.map((x) => x.captureScope)),
    bySampleRate: tally(allCaptures.map((x) => (x.sampleRate != null ? `${x.sampleRate / 1000}k` : null))),
    byArchitecture: tally(allCaptures.map((x) => x.result?.architecture)),
    projects
  }
}
