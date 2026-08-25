import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { createCoreSchema, finalizeIndexes } from './schema'
import { importLibrary } from './importLibrary'
import { runContentHashQueue } from './contentHash'
import { reconcileMissingItems } from './reconciliation'
import { hasFts5 } from './sqliteCapabilities'

const tmpDirs: string[] = []
function makeTmpDir(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ir-reconcile-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

async function rescanAndFinalize(db: DatabaseSync, root: string) {
  await importLibrary(db, root, 'test-root')
  finalizeIndexes(db)
}

describe.skipIf(!hasFts5())('reconcileMissingItems', () => {
  it('relinks a renamed/moved file via exact quick_hash match, preserving the original item id', async () => {
    const root = makeTmpDir()
    fs.mkdirSync(join(root, 'OldPack'), { recursive: true })
    fs.writeFileSync(join(root, 'OldPack', 'SM57.wav'), 'x'.repeat(5000))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root')
    finalizeIndexes(db)

    const original = db.prepare(`SELECT id FROM item`).get() as { id: string }
    db.prepare(`UPDATE item SET rating = 5, is_favorite = 1 WHERE id = ?`).run(original.id)

    // Move: same bytes, new folder + new filename.
    fs.mkdirSync(join(root, 'NewPack'), { recursive: true })
    fs.renameSync(join(root, 'OldPack', 'SM57.wav'), join(root, 'NewPack', 'SM57-renamed.wav'))
    await rescanAndFinalize(db, root)

    const beforeCount = (db.prepare(`SELECT COUNT(*) c FROM item`).get() as { c: number }).c
    expect(beforeCount).toBe(2) // old (missing) + new (freshly inserted) rows exist right now

    const result = reconcileMissingItems(db, stats.libraryRootId)
    expect(result.relinked).toBe(1)
    expect(result.suggestions).toHaveLength(0)

    const afterCount = (db.prepare(`SELECT COUNT(*) c FROM item`).get() as { c: number }).c
    expect(afterCount).toBe(1) // duplicate merged away

    const row = db.prepare(`SELECT * FROM item WHERE id = ?`).get(original.id) as any
    expect(row.relative_path).toBe('NewPack/SM57-renamed.wav')
    expect(row.missing_since).toBeNull()
    expect(row.rating).toBe(5) // preserved from the original row, not the fresh duplicate
    expect(row.is_favorite).toBe(1)

    db.close()
  })

  it('relinks via content_hash when quick_hash is unavailable and content_hash has been computed', async () => {
    const root = makeTmpDir()
    fs.mkdirSync(join(root, 'OldPack'), { recursive: true })
    fs.writeFileSync(join(root, 'OldPack', 'SM57.wav'), 'y'.repeat(5000))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)
    await runContentHashQueue(db, stats.libraryRootId)

    fs.mkdirSync(join(root, 'NewPack'), { recursive: true })
    fs.renameSync(join(root, 'OldPack', 'SM57.wav'), join(root, 'NewPack', 'SM57-renamed.wav'))
    await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)
    await runContentHashQueue(db, stats.libraryRootId)

    const result = reconcileMissingItems(db, stats.libraryRootId)
    expect(result.relinked).toBe(1)

    db.close()
  })

  it('suggests (never auto-merges) a same-name/same-size file in a similarly-named folder when hashes do not match', async () => {
    const root = makeTmpDir()
    fs.mkdirSync(join(root, 'Ownhammer 412'), { recursive: true })
    fs.writeFileSync(join(root, 'Ownhammer 412', 'SM57.wav'), 'z'.repeat(5000))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)

    // Different bytes (re-rendered), same name/size, folder name shares a token ("Ownhammer 412").
    fs.mkdirSync(join(root, 'Ownhammer 412 v2'), { recursive: true })
    fs.rmSync(join(root, 'Ownhammer 412', 'SM57.wav'))
    fs.writeFileSync(join(root, 'Ownhammer 412 v2', 'SM57.wav'), 'w'.repeat(5000))
    await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)

    const result = reconcileMissingItems(db, stats.libraryRootId)
    expect(result.relinked).toBe(0)
    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0].candidatePath).toBe('Ownhammer 412 v2/SM57.wav')

    // Nothing merged — both rows still exist independently.
    const count = (db.prepare(`SELECT COUNT(*) c FROM item`).get() as { c: number }).c
    expect(count).toBe(2)

    db.close()
  })

  it('does not suggest a same-name/same-size file in an unrelated folder (the flood case)', async () => {
    const root = makeTmpDir()
    fs.mkdirSync(join(root, 'PackA'), { recursive: true })
    fs.mkdirSync(join(root, 'PackB'), { recursive: true })
    fs.writeFileSync(join(root, 'PackA', 'SM57.wav'), 'p'.repeat(5000))
    fs.writeFileSync(join(root, 'PackB', 'SM57.wav'), 'q'.repeat(5000)) // same name/size, different bytes, unrelated folder

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)

    fs.rmSync(join(root, 'PackA', 'SM57.wav'))
    await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)

    const result = reconcileMissingItems(db, stats.libraryRootId)
    expect(result.relinked).toBe(0)
    expect(result.suggestions).toHaveLength(0)

    db.close()
  })
})
