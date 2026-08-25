import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { createCoreSchema } from './schema'
import { listFolders } from './folderMetadata'
import { hasFts5 } from './sqliteCapabilities'

describe.skipIf(!hasFts5())('createCoreSchema migrations', () => {
  it('adds collection.folder_id to an existing catalog.db that predates that column, without erroring', () => {
    const db = new DatabaseSync(':memory:')
    // Simulate a real, already-populated catalog.db from before collection.folder_id existed --
    // this is exactly what broke the folder tree ("no such column: collection.folder_id") the
    // first time listFolders()'s new EXISTS check ran against a pre-existing database.
    db.exec(`
      CREATE TABLE library_root (id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, label TEXT, watch_mode TEXT NOT NULL DEFAULT 'manual', created_at TEXT NOT NULL);
      CREATE TABLE folder (id INTEGER PRIMARY KEY, library_root_id INTEGER NOT NULL, parent_id INTEGER, relative_path TEXT NOT NULL, notes TEXT, UNIQUE (library_root_id, relative_path));
      CREATE TABLE item (id TEXT PRIMARY KEY, kind TEXT, library_root_id INTEGER NOT NULL, folder_id INTEGER, relative_path TEXT NOT NULL, display_name TEXT NOT NULL, indexed_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, UNIQUE (library_root_id, relative_path));
      CREATE TABLE collection (id TEXT PRIMARY KEY, kind TEXT NOT NULL, parent_id TEXT, library_root_id INTEGER, name TEXT NOT NULL, output_relative_path TEXT, naming_template TEXT, created_at TEXT, last_used_at TEXT, is_builtin INTEGER NOT NULL DEFAULT 0);
    `)
    db.prepare(`INSERT INTO library_root (id, path, created_at) VALUES (1, 'C:\\fake', '2026-01-01')`).run()
    db.prepare(`INSERT INTO folder (id, library_root_id, parent_id, relative_path) VALUES (1, 1, NULL, '')`).run()

    // Re-running createCoreSchema (as getDb() does on every app open) must migrate the existing
    // collection table in place, not throw and not silently skip.
    createCoreSchema(db)

    const columns = db.prepare(`PRAGMA table_info(collection)`).all() as Array<{ name: string }>
    expect(columns.some((c) => c.name === 'folder_id')).toBe(true)

    expect(() => listFolders(db, 1)).not.toThrow()
    const folders = listFolders(db, 1)
    expect(folders).toHaveLength(1)
    expect(folders[0].is_lab_project).toBe(0)

    db.close()
  })

  it('a brand-new database already has collection.folder_id from CORE_SCHEMA_SQL directly', () => {
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const columns = db.prepare(`PRAGMA table_info(collection)`).all() as Array<{ name: string }>
    expect(columns.some((c) => c.name === 'folder_id')).toBe(true)
    db.close()
  })
})
