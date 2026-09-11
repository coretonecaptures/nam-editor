import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { createCoreSchema, finalizeIndexes } from './schema'
import { importLibrary } from './importLibrary'
import { applyVendorParsers } from './vendorParsers/applyVendorParsers'
import { previewLibraryCleanup, runLibraryCleanup } from './libraryCleanup'
import { hasFts5 } from './sqliteCapabilities'

const tmpDirs: string[] = []
function makeTmpDir(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ir-cleanup-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function itemIdFor(db: DatabaseSync, suffix: string): string {
  return (db.prepare(`SELECT id FROM item WHERE relative_path LIKE ?`).get(`%${suffix}`) as { id: string }).id
}

describe.skipIf(!hasFts5())('previewLibraryCleanup / runLibraryCleanup', () => {
  it('computes a new path from resolved facts and flags nothing as needing review when every token resolves', async () => {
    const root = makeTmpDir()
    fs.writeFileSync(join(root, 'Marshall 412 SM57.wav'), 'x'.repeat(500))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)
    applyVendorParsers(db, stats.libraryRootId)

    const preview = previewLibraryCleanup(db, {
      libraryRootId: stats.libraryRootId,
      folderId: null,
      structureTemplate: '{manufacturer}/{microphone}'
    })

    expect(preview.rows).toHaveLength(1)
    expect(preview.rows[0].needsReview).toBe(false)
    expect(preview.rows[0].newRelativePath).toBe('Marshall/SM57/Marshall 412 SM57.wav')
    expect(preview.readyCount).toBe(1)
    expect(preview.needsReviewCount).toBe(0)
  })

  it('flags an item as needing review when a referenced token has no value, and does not move it', async () => {
    const root = makeTmpDir()
    // A filename the vendor parser won't recognize at all -- no manufacturer/mic gets parsed.
    fs.writeFileSync(join(root, 'unlabeled_file_001.wav'), 'x'.repeat(500))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)
    applyVendorParsers(db, stats.libraryRootId)

    const preview = previewLibraryCleanup(db, {
      libraryRootId: stats.libraryRootId,
      folderId: null,
      structureTemplate: '{manufacturer}/{microphone}'
    })

    expect(preview.rows[0].needsReview).toBe(true)
    expect(preview.rows[0].missingTokens).toEqual(expect.arrayContaining(['manufacturer', 'microphone']))

    const itemId = itemIdFor(db, 'unlabeled_file_001.wav')
    const result = await runLibraryCleanup(db, { libraryRootId: stats.libraryRootId, folderId: null }, preview.rows, 'move')
    expect(result.moved).toBe(0) // needs-review items are never actioned
    const row = db.prepare(`SELECT relative_path as relativePath FROM item WHERE id = ?`).get(itemId) as { relativePath: string }
    expect(row.relativePath).toBe('unlabeled_file_001.wav') // untouched
  })

  it('a literal (token-free) template segment is a valid destination, not flagged as needing review', async () => {
    const root = makeTmpDir()
    fs.writeFileSync(join(root, 'anything.wav'), 'x'.repeat(500))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)

    const preview = previewLibraryCleanup(db, { libraryRootId: stats.libraryRootId, folderId: null, structureTemplate: 'Sorted/Misc' })
    expect(preview.rows[0].needsReview).toBe(false)
    expect(preview.rows[0].newRelativePath).toBe('Sorted/Misc/anything.wav')
  })

  it('runLibraryCleanup (move) actually relocates ready items and groups by destination folder', async () => {
    const root = makeTmpDir()
    fs.writeFileSync(join(root, 'Marshall 412 SM57.wav'), 'x'.repeat(500))
    fs.writeFileSync(join(root, 'Marshall 412 MD421.wav'), 'y'.repeat(500))
    fs.writeFileSync(join(root, 'Fender Deluxe SM57.wav'), 'z'.repeat(500))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)
    applyVendorParsers(db, stats.libraryRootId)

    const preview = previewLibraryCleanup(db, { libraryRootId: stats.libraryRootId, folderId: null, structureTemplate: '{manufacturer}' })
    const result = await runLibraryCleanup(db, { libraryRootId: stats.libraryRootId, folderId: null }, preview.rows, 'move')

    expect(result.failed).toEqual([])
    expect(result.moved).toBe(preview.readyCount)
    expect(fs.existsSync(join(root, 'Marshall', 'Marshall 412 SM57.wav'))).toBe(true)
    expect(fs.existsSync(join(root, 'Marshall', 'Marshall 412 MD421.wav'))).toBe(true)
    expect(fs.existsSync(join(root, 'Fender', 'Fender Deluxe SM57.wav'))).toBe(true)
    expect(fs.existsSync(join(root, 'Marshall 412 SM57.wav'))).toBe(false) // moved, not copied
  })

  it('runLibraryCleanup (copy) leaves the source in place and creates a new catalog row', async () => {
    const root = makeTmpDir()
    fs.writeFileSync(join(root, 'Marshall 412 SM57.wav'), 'x'.repeat(500))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)
    applyVendorParsers(db, stats.libraryRootId)

    const preview = previewLibraryCleanup(db, { libraryRootId: stats.libraryRootId, folderId: null, structureTemplate: '{manufacturer}' })
    const result = await runLibraryCleanup(db, { libraryRootId: stats.libraryRootId, folderId: null }, preview.rows, 'copy')

    expect(result.copied).toBe(1)
    expect(fs.existsSync(join(root, 'Marshall 412 SM57.wav'))).toBe(true) // source untouched
    expect(fs.existsSync(join(root, 'Marshall', 'Marshall 412 SM57.wav'))).toBe(true) // the copy
    const rowCount = (db.prepare(`SELECT COUNT(*) as n FROM item`).get() as { n: number }).n
    expect(rowCount).toBe(2)
  })

  it('an item already at its computed destination is reported unchanged, not moved', async () => {
    const root = makeTmpDir()
    fs.mkdirSync(join(root, 'Sorted'), { recursive: true })
    fs.writeFileSync(join(root, 'Sorted', 'anything.wav'), 'x'.repeat(500))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)

    const preview = previewLibraryCleanup(db, { libraryRootId: stats.libraryRootId, folderId: null, structureTemplate: 'Sorted' })
    expect(preview.unchangedCount).toBe(1)
    expect(preview.readyCount).toBe(0)
    expect(preview.rows[0].newRelativePath).toBeNull()
  })

  it('applies the exact rows passed in, not a fresh recompute — a metadata edit after preview does not silently change what runs', async () => {
    const root = makeTmpDir()
    fs.writeFileSync(join(root, 'Marshall 412 SM57.wav'), 'x'.repeat(500))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)
    applyVendorParsers(db, stats.libraryRootId)

    const preview = previewLibraryCleanup(db, { libraryRootId: stats.libraryRootId, folderId: null, structureTemplate: '{manufacturer}' })
    const itemId = itemIdFor(db, 'Marshall 412 SM57.wav')
    // Simulate a metadata edit landing in the gap between preview and Run.
    db.prepare(`UPDATE ir_item SET manufacturer = 'Changed' WHERE item_id = ?`).run(itemId)

    await runLibraryCleanup(db, { libraryRootId: stats.libraryRootId, folderId: null }, preview.rows, 'move')
    // Moved to the path computed AT PREVIEW TIME ("Marshall"), not recomputed against the edit.
    expect(fs.existsSync(join(root, 'Marshall', 'Marshall 412 SM57.wav'))).toBe(true)
    expect(fs.existsSync(join(root, 'Changed', 'Marshall 412 SM57.wav'))).toBe(false)
  })

  it('resolves the library root from a folderId, so a folder-scoped selection needs no separate root lookup', async () => {
    const root = makeTmpDir()
    fs.mkdirSync(join(root, 'PackA'), { recursive: true })
    fs.writeFileSync(join(root, 'PackA', 'Marshall 412 SM57.wav'), 'x'.repeat(500))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)
    applyVendorParsers(db, stats.libraryRootId)

    const packAId = (db.prepare(`SELECT id FROM folder WHERE relative_path = 'PackA'`).get() as { id: number }).id
    // libraryRootId deliberately omitted (null) -- only folderId is given, matching a folder-
    // scoped selection in the UI that never separately tracked which root the folder is under.
    const preview = previewLibraryCleanup(db, { libraryRootId: null, folderId: packAId, structureTemplate: '{manufacturer}' })
    expect(preview.rows).toHaveLength(1)

    const result = await runLibraryCleanup(db, { libraryRootId: null, folderId: packAId }, preview.rows, 'move')
    expect(result.moved).toBe(1)
    expect(fs.existsSync(join(root, 'Marshall', 'Marshall 412 SM57.wav'))).toBe(true)
  })
})
