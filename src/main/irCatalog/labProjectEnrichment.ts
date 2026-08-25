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
}

interface SessionJson {
  metadata?: {
    cabinet?: string
    speaker?: string
    microphone?: string
    position?: string
    notes?: string
    captureType?: string
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
    `INSERT INTO collection (id, kind, library_root_id, folder_id, name, created_at)
     VALUES (?, 'ir_project', ?, ?, ?, ?)`
  )
  const updateCollectionName = db.prepare(`UPDATE collection SET name = ? WHERE id = ?`)
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

    let collectionId = (findCollectionByFolder.get(folder.id) as { id: string } | undefined)?.id
    if (collectionId) {
      updateCollectionName.run(project.name ?? 'IR Lab Project', collectionId)
    } else {
      collectionId = randomUUID()
      insertCollection.run(collectionId, libraryRootId, folder.id, project.name ?? 'IR Lab Project', project.createdAt ?? null)
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
      if (meta?.notes) db.prepare(`UPDATE item SET notes = ? WHERE id = ?`).run(meta.notes, item.id)

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

export interface ProjectDetail {
  id: string
  name: string
  createdAt: string | null
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
    variants: Array<{ id: string; name: string; isCurrent: boolean; isArchived: boolean; createdAt: string | null }>
  }>
}

/** Backend for the right panel's "Project" tab (plan section 8c/6) — one folder is at most one
 * ir_project collection (enrichLabProjects upserts by folder_id), so this is a straightforward
 * join rather than a search. */
export function getProjectDetailForFolder(db: DatabaseSync, folderId: number): ProjectDetail | null {
  const collection = db
    .prepare(`SELECT id, name, created_at FROM collection WHERE folder_id = ? AND kind = 'ir_project'`)
    .get(folderId) as { id: string; name: string; created_at: string | null } | undefined
  if (!collection) return null

  const items = db
    .prepare(
      `SELECT item.id as itemId, item.display_name as displayName, ir_item.capture_id as captureId,
              ir_item.cabinet as cabinet, ir_item.speaker as speaker, ir_item.microphone as microphone,
              ir_item.position as position, ir_item.capture_type as captureType, ir_item.sample_rate as sampleRate,
              ir_item.is_stereo as isStereo, ir_item.is_true_stereo as isTrueStereo
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
      variants: variantMap.get(row.itemId) ?? []
    }))
  }
}
