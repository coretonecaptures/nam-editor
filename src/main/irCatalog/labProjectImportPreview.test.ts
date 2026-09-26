import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { createCoreSchema, finalizeIndexes } from './schema'
import { importLibrary } from './importLibrary'
import { enrichLabProjects } from './labProjectEnrichment'
import { previewProjectImport } from './labProjectImportPreview'
import { hasFts5 } from './sqliteCapabilities'

const tmpDirs: string[] = []
function makeTmpDir(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ir-labproject-preview-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

/** Same real on-disk shape as labProjectEnrichment.test.ts's own fixture (flat capture folder,
 * ir-lab's 2026-08-27 Phase 2 layout) — kept as its own copy rather than imported/shared, since
 * this file intentionally tests the preview computation independently of the writer (see
 * labProjectImportPreview.ts's own header comment on why). */
function makeProjectFixture(sessionOverrides: Record<string, unknown> = {}): { root: string } {
  const root = makeTmpDir()
  const projectDir = join(root, 'Marshall Session')
  const captureId = 'capture-0001'
  const sessionDataDir = join(projectDir, '.SessionData')
  const captureDir = join(sessionDataDir, captureId)
  fs.mkdirSync(projectDir, { recursive: true })
  fs.mkdirSync(captureDir, { recursive: true })

  fs.writeFileSync(join(projectDir, 'Marshall 412 SM57.wav'), 'x'.repeat(2000))

  fs.writeFileSync(
    join(sessionDataDir, 'project.json'),
    JSON.stringify({
      id: 'project-1',
      name: 'Marshall Session',
      createdAt: '2026-08-01T00:00:00.000Z',
      captureIndex: [{ captureId, outputFileName: 'Marshall 412 SM57.wav' }]
    })
  )
  fs.writeFileSync(
    join(captureDir, 'session.json'),
    JSON.stringify({
      metadata: {
        cabinet: 'Marshall 1960A',
        speaker: 'Celestion V30',
        microphone: 'Shure SM57',
        position: 'Cap edge',
        notes: 'Close mic, slight off-axis.',
        captureType: 'Hardware',
        ...sessionOverrides
      }
    })
  )
  fs.writeFileSync(join(captureDir, 'analysis.json'), JSON.stringify({ measurement: { sampleRate: 48000 }, isStereo: false, isTrueStereo: false }))
  fs.writeFileSync(join(captureDir, 'variants.json'), JSON.stringify([]))

  return { root }
}

describe.skipIf(!hasFts5())('previewProjectImport', () => {
  it('reports every session.json field as a change before the project has ever been enriched', async () => {
    const { root } = makeProjectFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)

    const folder = db.prepare(`SELECT id FROM folder WHERE library_root_id = ? AND relative_path = 'Marshall Session'`).get(stats.libraryRootId) as {
      id: number
    }
    const preview = previewProjectImport(db, folder.id)
    expect(preview).not.toBeNull()
    expect(preview!.projectName).toBe('Marshall Session')
    expect(preview!.missingCaptureNames).toEqual([])
    expect(preview!.captures).toHaveLength(1)
    const changesByField = new Map(preview!.captures[0].changes.map((c) => [c.field, c]))
    expect(changesByField.get('cabinet')?.newValue).toBe('Marshall 1960A')
    expect(changesByField.get('cabinet')?.currentValue).toBeNull()
    expect(changesByField.get('notes')?.newValue).toBe('Close mic, slight off-axis.')
    expect(preview!.changedFieldCount).toBe(preview!.captures[0].changes.length)

    db.close()
  })

  it('reports no changes once the project has already been enriched with the same data', async () => {
    const { root } = makeProjectFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)
    enrichLabProjects(db, stats.libraryRootId)

    const folder = db.prepare(`SELECT id FROM folder WHERE library_root_id = ? AND relative_path = 'Marshall Session'`).get(stats.libraryRootId) as {
      id: number
    }
    const preview = previewProjectImport(db, folder.id)
    expect(preview!.changedFieldCount).toBe(0)
    expect(preview!.captures[0].changes).toEqual([])

    db.close()
  })

  it('flags a field changed on disk since the last enrich, and shows the current vs. new value', async () => {
    const { root } = makeProjectFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)
    enrichLabProjects(db, stats.libraryRootId)

    // Simulate IR Lab re-exporting the session with an updated mic position.
    const sessionPath = join(root, 'Marshall Session', '.SessionData', 'capture-0001', 'session.json')
    const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'))
    session.metadata.position = 'Cap center'
    fs.writeFileSync(sessionPath, JSON.stringify(session))

    const folder = db.prepare(`SELECT id FROM folder WHERE library_root_id = ? AND relative_path = 'Marshall Session'`).get(stats.libraryRootId) as {
      id: number
    }
    const preview = previewProjectImport(db, folder.id)
    expect(preview!.changedFieldCount).toBe(1)
    const change = preview!.captures[0].changes[0]
    expect(change.field).toBe('position')
    expect(change.currentValue).toBe('Cap edge')
    expect(change.newValue).toBe('Cap center')
    expect(change.blockedByUserEdit).toBe(false)

    db.close()
  })

  it('marks a field as blocked when the user has hand-edited it, without dropping it from the diff', async () => {
    const { root } = makeProjectFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)
    enrichLabProjects(db, stats.libraryRootId)

    const item = db.prepare(`SELECT id FROM item WHERE relative_path LIKE '%SM57.wav'`).get() as { id: string }
    // A user override, marked 'user_entered' — the confidence ladder's own top rank.
    db.prepare(`UPDATE ir_item SET cabinet = ? WHERE item_id = ?`).run('My Custom Cab', item.id)
    db.prepare(
      `INSERT INTO ir_item_field_source (item_id, field, source) VALUES (?, 'cabinet', 'user_entered')
       ON CONFLICT(item_id, field) DO UPDATE SET source = excluded.source`
    ).run(item.id)

    const folder = db.prepare(`SELECT id FROM folder WHERE library_root_id = ? AND relative_path = 'Marshall Session'`).get(stats.libraryRootId) as {
      id: number
    }
    const preview = previewProjectImport(db, folder.id)
    const cabinetChange = preview!.captures[0].changes.find((c) => c.field === 'cabinet')
    expect(cabinetChange).toBeDefined()
    expect(cabinetChange!.blockedByUserEdit).toBe(true)
    expect(cabinetChange!.currentValue).toBe('My Custom Cab')
    // Blocked changes don't count toward "how many will Apply actually change".
    expect(preview!.changedFieldCount).toBe(0)

    db.close()
  })

  it('returns null for a folder that is not an IR Lab Project', async () => {
    const root = makeTmpDir()
    fs.writeFileSync(join(root, 'plain.wav'), 'x'.repeat(2000))
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)

    const folder = db.prepare(`SELECT id FROM folder WHERE library_root_id = ? AND relative_path = ''`).get(stats.libraryRootId) as { id: number }
    expect(previewProjectImport(db, folder.id)).toBeNull()

    db.close()
  })
})
