/**
 * IR Lab NAM Capture enrichment — a fourth scan pass, sibling to (NOT an extension of)
 * labProjectEnrichment.ts. Runs in the same slot in the scan IPC handler, right after
 * enrichLabProjects. See docs/nam-capture-import-plan-2026-08-29.md §2 and IR Lab's
 * docs/nam_lab_metadata_handoff_2026-08-29.md for the confirmed data contract.
 *
 * IR Lab writes one flat folder per capture (no nesting):
 *
 *   <project.outputRoot>/<sanitizedName>-<captureId>/
 *       excitation.wav      -- 32-bit float mono DI/reference
 *       recording.wav        -- 32-bit float mono captured return, same sample count
 *       nam-capture.json      -- the metadata below
 *       nam-lab-result.json   -- written ONLY by this app once trained (namCaptureResult.ts)
 *
 * excitation.wav / recording.wav are ordinary `item` rows already (importLibrary walks every
 * .wav). This pass finds the capture folder by its `nam-capture.json`, resolves the DI/return
 * pair from the JSON's OWN filename fields (never assumes the literal names), promotes the
 * return item to kind='nam_capture', inserts a bare nam_capture_item row plus the pre-training
 * columns, and groups captures into one collection(kind='nam_project') per distinct projectId —
 * grouped by the JSON's field, never by folder nesting depth.
 *
 * This pass never creates or deletes `item` rows; like enrichLabProjects it only annotates rows
 * the ordinary scan already produced. nam-capture.json itself is not a .wav, so scanWalk never
 * touched it and there is no item-inclusion logic to add here.
 */
import type { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import { join, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readNamLabResult, type NamLabResult } from './namCaptureResult'

/** nam-capture.json — the subset this importer reads. Every field is absent-safe: an older
 * schemaVersion with fewer keys parses fine, missing keys read back undefined. */
interface NamCaptureJson {
  schemaVersion?: number
  captureId?: string
  captureName?: string
  createdAt?: string
  captureScope?: string // 'Cabinet' | 'Device' | 'Software'
  excitation?: string // explicit filename — resolve from this, never assume "excitation.wav"
  recording?: string // explicit filename — resolve from this, never assume "recording.wav"
  excitationSourceName?: string
  stimulusSha256?: string
  sampleRate?: number
  measuredLatencySamples?: number
  projectId?: string
  projectName?: string
  synthetic?: boolean
  syntheticSourceIrName?: string
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
  const updateNamCaptureFacts = db.prepare(
    `UPDATE nam_capture_item SET
       capture_id = ?, capture_name = ?, project_id = ?, capture_scope = ?, sample_rate = ?,
       measured_latency_samples = ?, synthetic = ?, synthetic_source_ir_name = ?, created_at = ?,
       excitation_path = ?, recording_path = ?
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

  for (const folder of folders) {
    const absFolderPath = join(root.path, ...folder.relative_path.split('/').filter(Boolean))
    const captureJsonPath = join(absFolderPath, 'nam-capture.json')
    if (!fs.existsSync(captureJsonPath)) continue

    const capture = readJson<NamCaptureJson>(captureJsonPath)
    if (!capture) continue

    // Resolve the DI/return pair from the JSON's own filename fields. Fall back to the
    // conventional names only when a field is missing (older schemaVersion), never in place of
    // a field that's present.
    const excitationName = capture.excitation || 'excitation.wav'
    const recordingName = capture.recording || 'recording.wav'
    const excitationAbs = join(absFolderPath, excitationName)
    const recordingAbs = join(absFolderPath, recordingName)

    const recordingRelPath = folder.relative_path ? `${folder.relative_path}/${recordingName}` : recordingName
    const recordingItem = findItemByRelativePath.get(libraryRootId, recordingRelPath) as { id: string } | undefined
    if (!recordingItem) continue // return WAV moved/deleted/never scanned — skip, don't error

    const projectId = capture.projectId || `folder:${folder.relative_path}`
    const projectName = capture.projectName || 'NAM Capture Project'
    const isSynthetic = capture.synthetic === true

    setItemKind.run(recordingItem.id)
    ensureNamCaptureItem.run(recordingItem.id)
    updateNamCaptureFacts.run(
      capture.captureId ?? null,
      capture.captureName ?? basename(absFolderPath),
      capture.projectId ?? null,
      capture.captureScope ?? null,
      capture.sampleRate ?? null,
      Number.isFinite(capture.measuredLatencySamples) ? capture.measuredLatencySamples ?? null : null,
      isSynthetic ? 1 : 0,
      capture.syntheticSourceIrName ?? null,
      capture.createdAt ?? null,
      excitationAbs,
      recordingAbs,
      recordingItem.id
    )
    // Give the row a stable, human display name even when importLibrary named the item
    // "recording.wav" — the capture's own name is far more useful in the tree/list.
    db.prepare(`UPDATE item SET display_name = ? WHERE id = ?`).run(
      capture.captureName ?? basename(absFolderPath),
      recordingItem.id
    )

    // One collection row per distinct projectId. naming_template carries the raw projectId as
    // the stable lookup key (collection has no dedicated project-id column and adding one is out
    // of scope here); `name` is the display string.
    let collectionId = projectCollectionIds.get(projectId)
    if (!collectionId) {
      collectionId = (findCollectionByProject.get(libraryRootId, projectId) as { id: string } | undefined)?.id
      const projectDetails = readJson<NamProjectJson>(join(absFolderPath, '..', 'nam-project.json')) ??
        readJson<NamProjectJson>(join(absFolderPath, 'nam-project.json'))
      const detailValues = [
        projectDetails?.cabinet || null,
        projectDetails?.speaker || null,
        projectDetails?.room || null,
        projectDetails?.signalChain || null,
        projectDetails?.description || null,
        projectDetails?.projectNotes || null
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
          capture.createdAt ?? null,
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

  return { projectsFound, capturesEnriched, syntheticCaptures }
}

/** One NAM Capture, as the "NAM Projects" tree/list needs it. Trained/untrained is derived
 * purely from the presence of nam-lab-result.json in the capture folder — no stored flag. */
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
  recordingPath: string | null
  captureFolderPath: string | null
  trained: boolean
  result: NamLabResult | null
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
  captures: NamCaptureRow[]
}

function folderPathFromRecording(recordingPath: string | null): string | null {
  if (!recordingPath) return null
  return recordingPath.replace(/[\\/][^\\/]+$/, '')
}

function mapCaptureRow(row: {
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
  recordingPath: string | null
  displayName: string
}): NamCaptureRow {
  const captureFolderPath = folderPathFromRecording(row.recordingPath)
  const result = captureFolderPath ? readNamLabResult(captureFolderPath) : null
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
    recordingPath: row.recordingPath,
    captureFolderPath,
    trained: result != null,
    result
  }
}

const CAPTURE_SELECT = `
  SELECT item.id as itemId, item.display_name as displayName,
         nc.capture_id as captureId, nc.capture_name as captureName, nc.capture_scope as captureScope,
         nc.sample_rate as sampleRate, nc.measured_latency_samples as measuredLatencySamples,
         nc.synthetic as synthetic, nc.synthetic_source_ir_name as syntheticSourceIrName,
         nc.created_at as createdAt, nc.excitation_path as excitationPath, nc.recording_path as recordingPath
  FROM collection_item
  JOIN item ON item.id = collection_item.item_id
  LEFT JOIN nam_capture_item nc ON nc.item_id = item.id
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
    const captures = (captureStmt.all(c.id) as Parameters<typeof mapCaptureRow>[0][]).map(mapCaptureRow)
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

  const captures = (db.prepare(CAPTURE_SELECT).all(c.id) as Parameters<typeof mapCaptureRow>[0][]).map(mapCaptureRow)
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
    captures
  }
}
