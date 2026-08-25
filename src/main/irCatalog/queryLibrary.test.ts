import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { createSchema } from './schema'
import { queryItems, countItems, setFavorite, setRating } from './queryLibrary'
import { hasFts5 } from './sqliteCapabilities'

function seed(db: DatabaseSync): { rootId: number; itemIds: string[] } {
  const now = new Date().toISOString()
  const rootId = (
    db
      .prepare(`INSERT INTO library_root (path, label, watch_mode, created_at) VALUES ('/lib', 'Lib', 'manual', ?) RETURNING id`)
      .get(now) as { id: number }
  ).id
  const names = ['Marshall 412 SM57.wav', "OwnHammer V30 - Blend.wav", 'plain.wav']
  const ids: string[] = []
  for (const name of names) {
    const id = `id-${name}`
    db.prepare(
      `INSERT INTO item (id, kind, library_root_id, relative_path, display_name, indexed_at, last_seen_at)
       VALUES (?, 'ir', ?, ?, ?, ?, ?)`
    ).run(id, rootId, name, name, now, now)
    db.prepare(`INSERT INTO item_search (item_id, display_name) VALUES (?, ?)`).run(id, name)
    ids.push(id)
  }
  return { rootId, itemIds: ids }
}

describe.skipIf(!hasFts5())('queryLibrary', () => {
  it('search tolerates punctuation that would otherwise be invalid FTS5 syntax', () => {
    const db = new DatabaseSync(':memory:')
    createSchema(db)
    seed(db)

    // A bare hyphen/colon/paren is FTS5 query syntax; typed as part of a filename it must not throw.
    expect(() => queryItems(db, { search: 'V30 - Blend', offset: 0, limit: 10 })).not.toThrow()
    const results = queryItems(db, { search: 'V30 - Blend', offset: 0, limit: 10 })
    expect(results.map((r) => r.display_name)).toContain('OwnHammer V30 - Blend.wav')

    db.close()
  })

  it('prefix-matches partial typed tokens', () => {
    const db = new DatabaseSync(':memory:')
    createSchema(db)
    seed(db)

    const results = queryItems(db, { search: 'Marsh', offset: 0, limit: 10 })
    expect(results.map((r) => r.display_name)).toEqual(['Marshall 412 SM57.wav'])

    db.close()
  })

  it('countItems matches queryItems row count for the same filter', () => {
    const db = new DatabaseSync(':memory:')
    createSchema(db)
    const { rootId } = seed(db)

    expect(countItems(db, { libraryRootId: rootId })).toBe(3)
    expect(countItems(db, { search: 'SM57' })).toBe(1)

    db.close()
  })

  it('setFavorite and setRating update the target row only', () => {
    const db = new DatabaseSync(':memory:')
    createSchema(db)
    const { itemIds } = seed(db)

    setFavorite(db, itemIds[0], true)
    setRating(db, itemIds[0], 4)

    const rows = queryItems(db, { offset: 0, limit: 10 })
    const target = rows.find((r) => r.id === itemIds[0])!
    const other = rows.find((r) => r.id === itemIds[1])!
    expect(target.is_favorite).toBe(1)
    expect(target.rating).toBe(4)
    expect(other.is_favorite).toBe(0)
    expect(other.rating).toBeNull()

    db.close()
  })

  it('folderId scopes results to that folder and its descendants, not siblings', () => {
    const db = new DatabaseSync(':memory:')
    createSchema(db)
    const now = new Date().toISOString()
    const rootId = (
      db
        .prepare(`INSERT INTO library_root (path, label, watch_mode, created_at) VALUES ('/lib2','Lib2','manual',?) RETURNING id`)
        .get(now) as { id: number }
    ).id
    const pack = (
      db.prepare(`INSERT INTO folder (library_root_id, parent_id, relative_path) VALUES (?, NULL, 'Pack') RETURNING id`).get(rootId) as {
        id: number
      }
    ).id
    const sub = (
      db
        .prepare(`INSERT INTO folder (library_root_id, parent_id, relative_path) VALUES (?, ?, 'Pack/Sub') RETURNING id`)
        .get(rootId, pack) as { id: number }
    ).id
    const other = (
      db.prepare(`INSERT INTO folder (library_root_id, parent_id, relative_path) VALUES (?, NULL, 'Other') RETURNING id`).get(rootId) as {
        id: number
      }
    ).id

    const insertItem = (folderId: number, relPath: string): void => {
      db.prepare(
        `INSERT INTO item (id, kind, library_root_id, folder_id, relative_path, display_name, indexed_at, last_seen_at)
         VALUES (?, 'ir', ?, ?, ?, ?, ?, ?)`
      ).run(`id-${relPath}`, rootId, folderId, relPath, relPath, now, now)
    }
    insertItem(pack, 'Pack/direct.wav')
    insertItem(sub, 'Pack/Sub/nested.wav')
    insertItem(other, 'Other/unrelated.wav')

    const scoped = queryItems(db, { folderId: pack, offset: 0, limit: 10 })
    expect(scoped.map((r) => r.relative_path).sort()).toEqual(['Pack/Sub/nested.wav', 'Pack/direct.wav'])
    expect(countItems(db, { folderId: pack })).toBe(2)

    db.close()
  })
})
