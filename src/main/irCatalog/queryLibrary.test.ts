import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { createSchema } from './schema'
import { queryItems, countItems, setFavorite, setRating, listFacetOptions, listNumericFacetOptions } from './queryLibrary'
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

  it('sort: name defaults to path order, direction reverses it, unknown key falls back', () => {
    const db = new DatabaseSync(':memory:')
    createSchema(db)
    seed(db) // relative_path: 'Marshall 412 SM57.wav', 'OwnHammer V30 - Blend.wav', 'plain.wav'

    const asc = queryItems(db, { offset: 0, limit: 10 }).map((r) => r.relative_path)
    expect(asc).toEqual([
      'Marshall 412 SM57.wav',
      'OwnHammer V30 - Blend.wav',
      'plain.wav'
    ])
    expect(queryItems(db, { sort: 'name', sortDir: 'asc', offset: 0, limit: 10 }).map((r) => r.relative_path)).toEqual(asc)
    expect(queryItems(db, { sort: 'name', sortDir: 'desc', offset: 0, limit: 10 }).map((r) => r.relative_path)).toEqual(
      [...asc].reverse()
    )
    // an unrecognised key is ignored, not injected — still path order
    expect(
      queryItems(db, { sort: 'name; DROP TABLE item', offset: 0, limit: 10 }).map((r) => r.relative_path)
    ).toEqual(asc)

    db.close()
  })

  it('sort: favorite puts favorited rows first when descending', () => {
    const db = new DatabaseSync(':memory:')
    createSchema(db)
    const { itemIds } = seed(db)
    setFavorite(db, itemIds[2], true) // 'plain.wav', last in path order

    const rows = queryItems(db, { sort: 'favorite', sortDir: 'desc', offset: 0, limit: 10 })
    expect(rows[0].id).toBe(itemIds[2])
    // the rest stay in path order behind it
    expect(rows.slice(1).map((r) => r.relative_path)).toEqual([
      'Marshall 412 SM57.wav',
      'OwnHammer V30 - Blend.wav'
    ])

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

  it('facet filters (manufacturer/cabinet/speaker/microphone) narrow to an exact value, including folder-inherited ones', () => {
    const db = new DatabaseSync(':memory:')
    createSchema(db)
    const now = new Date().toISOString()
    const rootId = (
      db
        .prepare(`INSERT INTO library_root (path, label, watch_mode, created_at) VALUES ('/lib3','Lib3','manual',?) RETURNING id`)
        .get(now) as { id: number }
    ).id
    const folder = (
      db.prepare(`INSERT INTO folder (library_root_id, parent_id, relative_path) VALUES (?, NULL, 'F') RETURNING id`).get(rootId) as {
        id: number
      }
    ).id

    const insertItem = (id: string, relPath: string): void => {
      db.prepare(
        `INSERT INTO item (id, kind, library_root_id, folder_id, relative_path, display_name, indexed_at, last_seen_at)
         VALUES (?, 'ir', ?, ?, ?, ?, ?, ?)`
      ).run(id, rootId, folder, relPath, relPath, now, now)
    }
    insertItem('item-direct', 'F/marshall.wav')
    insertItem('item-inherited', 'F/other.wav')
    insertItem('item-fender', 'F/fender.wav')

    // Item-level manufacturer on one item.
    db.prepare(`INSERT INTO ir_item (item_id, manufacturer) VALUES ('item-direct', 'Marshall')`).run()
    db.prepare(`INSERT INTO ir_item (item_id, manufacturer) VALUES ('item-fender', 'Fender')`).run()
    // Folder-level (inherited) manufacturer for the folder-only item, via folder_metadata_effective
    // directly — this is the resolved table queryLibrary's COALESCE actually reads, same as the
    // real setFolderMetadata cascade would populate.
    db.prepare(`INSERT INTO ir_item (item_id) VALUES ('item-inherited')`).run()
    db.prepare(
      `INSERT INTO folder_metadata_effective (folder_id, field, value, source) VALUES (?, 'manufacturer', 'Marshall', 'user_entered')`
    ).run(folder)

    const marshallOnly = queryItems(db, { manufacturer: 'Marshall', offset: 0, limit: 10 })
    expect(marshallOnly.map((r) => r.id).sort()).toEqual(['item-direct', 'item-inherited'].sort())
    expect(countItems(db, { manufacturer: 'Marshall' })).toBe(2)

    const fenderOnly = queryItems(db, { manufacturer: 'Fender', offset: 0, limit: 10 })
    expect(fenderOnly.map((r) => r.id)).toEqual(['item-fender'])

    db.close()
  })

  it('an array facet value ORs its members — the filter bar\'s multiselect checklist', () => {
    const db = new DatabaseSync(':memory:')
    createSchema(db)
    seed(db)
    db.prepare(`INSERT INTO ir_item (item_id, manufacturer) VALUES ('id-Marshall 412 SM57.wav', 'Marshall')`).run()
    db.prepare(`INSERT INTO ir_item (item_id, manufacturer) VALUES ('id-OwnHammer V30 - Blend.wav', 'OwnHammer')`).run()
    db.prepare(`INSERT INTO ir_item (item_id, manufacturer) VALUES ('id-plain.wav', 'Fender')`).run()

    const twoMakers = queryItems(db, { manufacturer: ['Marshall', 'OwnHammer'], offset: 0, limit: 10 })
    expect(twoMakers.map((r) => r.display_name).sort()).toEqual(['Marshall 412 SM57.wav', 'OwnHammer V30 - Blend.wav'])
    expect(countItems(db, { manufacturer: ['Marshall', 'OwnHammer'] })).toBe(2)

    // An empty array must behave like "no filter applied", not "match nothing" — an empty
    // multiselect checklist (nothing checked) means the filter isn't active.
    expect(countItems(db, { manufacturer: [] })).toBe(3)

    db.close()
  })

  it('cabinet/speaker fall back to the owning IR Lab Project when the item itself has no value', () => {
    const db = new DatabaseSync(':memory:')
    createSchema(db)
    const now = new Date().toISOString()
    const rootId = (
      db.prepare(`INSERT INTO library_root (path, label, watch_mode, created_at) VALUES ('/proj','Proj','manual',?) RETURNING id`).get(now) as {
        id: number
      }
    ).id
    const folder = (
      db.prepare(`INSERT INTO folder (library_root_id, parent_id, relative_path) VALUES (?, NULL, 'P') RETURNING id`).get(rootId) as {
        id: number
      }
    ).id
    const insertItem = (id: string, relPath: string): void => {
      db.prepare(
        `INSERT INTO item (id, kind, library_root_id, folder_id, relative_path, display_name, indexed_at, last_seen_at)
         VALUES (?, 'ir', ?, ?, ?, ?, ?, ?)`
      ).run(id, rootId, folder, relPath, relPath, now, now)
    }
    insertItem('blank-item', 'P/blank.wav') // no ir_item row at all
    insertItem('override-item', 'P/override.wav')
    db.prepare(`INSERT INTO ir_item (item_id, cabinet) VALUES ('override-item', 'Different Cab')`).run()

    db.prepare(
      `INSERT INTO collection (id, kind, library_root_id, folder_id, name, cabinet, speaker)
       VALUES ('proj-1', 'ir_project', ?, ?, 'My Project', 'Mesa 4x12', 'V30')`
    ).run(rootId, folder)
    db.prepare(`INSERT INTO collection_item (collection_id, item_id) VALUES ('proj-1', 'blank-item')`).run()
    db.prepare(`INSERT INTO collection_item (collection_id, item_id) VALUES ('proj-1', 'override-item')`).run()

    const rows = queryItems(db, { libraryRootId: rootId, offset: 0, limit: 10 })
    const blank = rows.find((r) => r.id === 'blank-item')!
    const override = rows.find((r) => r.id === 'override-item')!

    expect(blank.cabinet).toBe('Mesa 4x12')
    expect(blank.cabinet_source).toBe('ir_lab_project')
    expect(blank.speaker).toBe('V30')
    // An item's own value always wins over the project's.
    expect(override.cabinet).toBe('Different Cab')

    // Filtering by the project-level value must match the inheriting item too.
    expect(queryItems(db, { libraryRootId: rootId, cabinet: 'Mesa 4x12', offset: 0, limit: 10 }).map((r) => r.id).sort()).toEqual([
      'blank-item'
    ])

    db.close()
  })

  it('listFacetOptions/listNumericFacetOptions report only values actually present, scoped to root/folder', () => {
    const db = new DatabaseSync(':memory:')
    createSchema(db)
    const now = new Date().toISOString()
    const rootA = (
      db.prepare(`INSERT INTO library_root (path, label, watch_mode, created_at) VALUES ('/a','A','manual',?) RETURNING id`).get(now) as {
        id: number
      }
    ).id
    const rootB = (
      db.prepare(`INSERT INTO library_root (path, label, watch_mode, created_at) VALUES ('/b','B','manual',?) RETURNING id`).get(now) as {
        id: number
      }
    ).id
    const insert = (id: string, rootId: number, mic: string | null, sampleRate: number | null): void => {
      db.prepare(
        `INSERT INTO item (id, kind, library_root_id, relative_path, display_name, indexed_at, last_seen_at)
         VALUES (?, 'ir', ?, ?, ?, ?, ?)`
      ).run(id, rootId, id, id, now, now)
      db.prepare(`INSERT INTO ir_item (item_id, microphone, sample_rate) VALUES (?, ?, ?)`).run(id, mic, sampleRate)
    }
    insert('a1', rootA, 'SM57', 44100)
    insert('a2', rootA, 'SM57', 48000)
    insert('a3', rootA, 'R121', 44100)
    insert('b1', rootB, 'U87', 96000)

    const micsInA = listFacetOptions(db, 'microphone', rootA, null)
    expect(micsInA.map((o) => o.value).sort()).toEqual(['R121', 'SM57'])
    expect(micsInA.find((o) => o.value === 'SM57')?.count).toBe(2)
    // 'U87' only exists under root B — the picker must never offer a value with zero matches.
    expect(micsInA.some((o) => o.value === 'U87')).toBe(false)

    const ratesInA = listNumericFacetOptions(db, 'sampleRate', rootA, null)
    expect(ratesInA.map((o) => o.value)).toEqual([44100, 48000])

    db.close()
  })
})
