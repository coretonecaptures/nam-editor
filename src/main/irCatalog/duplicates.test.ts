import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { createCoreSchema, finalizeIndexes } from './schema'
import { importLibrary } from './importLibrary'
import { applyVendorParsers } from './vendorParsers/applyVendorParsers'
import { setFavorite } from './queryLibrary'
import { findDuplicates } from './duplicates'
import { hasFts5 } from './sqliteCapabilities'

const tmpDirs: string[] = []
function makeTmpDir(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ir-duplicates-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

/** Stamps a content_hash directly rather than running the real hasher (contentHash.ts) — this
 * module only reads the column back, so a fixture value is enough and keeps the test fast and
 * independent of the hashing implementation. */
function stampHash(db: DatabaseSync, relativePathSuffix: string, hash: string): void {
  db.prepare(`UPDATE item SET content_hash = ? WHERE relative_path LIKE ?`).run(hash, `%${relativePathSuffix}`)
}

describe.skipIf(!hasFts5())('findDuplicates', () => {
  it('groups items sharing a content_hash, sizes reclaimable bytes off the true duplicate', async () => {
    const root = makeTmpDir()
    fs.mkdirSync(join(root, 'PackA'), { recursive: true })
    fs.mkdirSync(join(root, 'PackB'), { recursive: true })
    // PackA/marshall.wav and PackB/marshall_copy.wav are byte-identical (same content_hash).
    // unique.wav stands alone.
    fs.writeFileSync(join(root, 'PackA', 'marshall.wav'), 'x'.repeat(1000))
    fs.writeFileSync(join(root, 'PackB', 'marshall_copy.wav'), 'x'.repeat(1000))
    fs.writeFileSync(join(root, 'unique.wav'), 'y'.repeat(500))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)

    stampHash(db, 'marshall.wav', 'hash-aaa')
    stampHash(db, 'marshall_copy.wav', 'hash-aaa')
    stampHash(db, 'unique.wav', 'hash-bbb')

    const report = findDuplicates(db, { libraryRootId: stats.libraryRootId })
    expect(report.sets).toHaveLength(1)
    expect(report.sets[0].members).toHaveLength(2)
    expect(report.sets[0].reclaimableBytes).toBe(1000) // (2 - 1) * 1000
    expect(report.totalReclaimableBytes).toBe(1000)
  })

  it('ranks the member with more known metadata first (worth keeping)', async () => {
    const root = makeTmpDir()
    fs.mkdirSync(join(root, 'A'), { recursive: true })
    fs.writeFileSync(join(root, 'A', 'Marshall 412 SM57.wav'), 'x'.repeat(800))
    fs.writeFileSync(join(root, 'renamed_export.wav'), 'x'.repeat(800))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)
    // Only the vendor-parseable name gets manufacturer/cabinet/speaker/microphone filled.
    applyVendorParsers(db, stats.libraryRootId)

    stampHash(db, 'Marshall 412 SM57.wav', 'hash-ccc')
    stampHash(db, 'renamed_export.wav', 'hash-ccc')

    const report = findDuplicates(db, { libraryRootId: stats.libraryRootId })
    expect(report.sets).toHaveLength(1)
    const [best, worst] = report.sets[0].members
    expect(best.relativePath).toContain('Marshall 412 SM57.wav')
    expect(best.metadataCompleteness).toBeGreaterThan(worst.metadataCompleteness)
  })

  it('reports unhashedCount for items never quick-hashed, separately from duplicate sets', async () => {
    const root = makeTmpDir()
    fs.writeFileSync(join(root, 'a.wav'), 'a'.repeat(200))
    fs.writeFileSync(join(root, 'b.wav'), 'b'.repeat(200))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    // skipQuickHash: true -- neither item gets a content_hash, matching a real fast-scan library.
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)

    const report = findDuplicates(db, { libraryRootId: stats.libraryRootId })
    expect(report.sets).toHaveLength(0)
    expect(report.unhashedCount).toBe(2)
  })

  it('excludes favorited/rated status from grouping but carries it through on each member', async () => {
    const root = makeTmpDir()
    fs.writeFileSync(join(root, 'one.wav'), 'z'.repeat(300))
    fs.writeFileSync(join(root, 'two.wav'), 'z'.repeat(300))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)
    stampHash(db, 'one.wav', 'hash-ddd')
    stampHash(db, 'two.wav', 'hash-ddd')

    const oneId = (db.prepare(`SELECT id FROM item WHERE relative_path LIKE '%one.wav'`).get() as { id: string }).id
    setFavorite(db, oneId, true)

    const report = findDuplicates(db, { libraryRootId: stats.libraryRootId })
    const member = report.sets[0].members.find((m) => m.itemId === oneId)
    expect(member?.isFavorite).toBe(true)
  })

  it('scopes to a folder and its subtree when folderId is given', async () => {
    const root = makeTmpDir()
    fs.mkdirSync(join(root, 'InScope'), { recursive: true })
    fs.mkdirSync(join(root, 'OutOfScope'), { recursive: true })
    fs.writeFileSync(join(root, 'InScope', 'a.wav'), 'q'.repeat(400))
    fs.writeFileSync(join(root, 'InScope', 'b.wav'), 'q'.repeat(400))
    fs.writeFileSync(join(root, 'OutOfScope', 'c.wav'), 'q'.repeat(400))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)
    stampHash(db, 'InScope/a.wav', 'hash-eee')
    stampHash(db, 'InScope/b.wav', 'hash-eee')
    stampHash(db, 'OutOfScope/c.wav', 'hash-eee')

    const inScopeFolder = db.prepare(`SELECT id FROM folder WHERE relative_path = 'InScope'`).get() as { id: number }
    const report = findDuplicates(db, { libraryRootId: stats.libraryRootId, folderId: inScopeFolder.id })
    expect(report.sets).toHaveLength(1)
    expect(report.sets[0].members).toHaveLength(2) // OutOfScope's copy is excluded by scope
  })
})
