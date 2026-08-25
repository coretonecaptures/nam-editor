import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { createCoreSchema } from './schema'
import { importFolderDocument, listFolderDocuments, deleteFolderDocument } from './folderDocuments'

const tmpDirs: string[] = []
function makeTmpDir(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ir-folderdoc-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function makeFolder(db: DatabaseSync): number {
  const now = new Date().toISOString()
  const rootId = (
    db.prepare(`INSERT INTO library_root (path, label, watch_mode, created_at) VALUES ('/lib','Lib','manual',?) RETURNING id`).get(now) as {
      id: number
    }
  ).id
  return (
    db
      .prepare(`INSERT INTO folder (library_root_id, parent_id, relative_path) VALUES (?, NULL, 'Pack') RETURNING id`)
      .get(rootId) as { id: number }
  ).id
}

describe('folderDocuments', () => {
  it('copies the source file into storage and records it, leaving the original untouched', () => {
    const sourceDir = makeTmpDir()
    const storageDir = join(makeTmpDir(), 'ir-documents')
    const sourcePath = join(sourceDir, 'spec-sheet.pdf')
    fs.writeFileSync(sourcePath, 'fake pdf bytes')

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const folderId = makeFolder(db)

    const row = importFolderDocument(db, folderId, sourcePath, storageDir)

    expect(row.original_filename).toBe('spec-sheet.pdf')
    expect(fs.existsSync(row.stored_path)).toBe(true)
    expect(fs.readFileSync(row.stored_path, 'utf-8')).toBe('fake pdf bytes')
    expect(fs.existsSync(sourcePath)).toBe(true) // original untouched, not moved

    const docs = listFolderDocuments(db, folderId)
    expect(docs).toHaveLength(1)
    expect(docs[0].id).toBe(row.id)

    db.close()
  })

  it('two documents with the same original filename do not collide in storage', () => {
    const sourceDir = makeTmpDir()
    const storageDir = join(makeTmpDir(), 'ir-documents')
    fs.mkdirSync(join(sourceDir, 'a'))
    fs.mkdirSync(join(sourceDir, 'b'))
    fs.writeFileSync(join(sourceDir, 'a', 'readme.pdf'), 'version A')
    fs.writeFileSync(join(sourceDir, 'b', 'readme.pdf'), 'version B')

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const folderId = makeFolder(db)

    const rowA = importFolderDocument(db, folderId, join(sourceDir, 'a', 'readme.pdf'), storageDir)
    const rowB = importFolderDocument(db, folderId, join(sourceDir, 'b', 'readme.pdf'), storageDir)

    expect(rowA.stored_path).not.toBe(rowB.stored_path)
    expect(fs.readFileSync(rowA.stored_path, 'utf-8')).toBe('version A')
    expect(fs.readFileSync(rowB.stored_path, 'utf-8')).toBe('version B')

    db.close()
  })

  it('deleteFolderDocument removes both the DB row and the copied file', () => {
    const sourceDir = makeTmpDir()
    const storageDir = join(makeTmpDir(), 'ir-documents')
    const sourcePath = join(sourceDir, 'spec.pdf')
    fs.writeFileSync(sourcePath, 'x')

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const folderId = makeFolder(db)
    const row = importFolderDocument(db, folderId, sourcePath, storageDir)

    deleteFolderDocument(db, row.id)

    expect(listFolderDocuments(db, folderId)).toHaveLength(0)
    expect(fs.existsSync(row.stored_path)).toBe(false)

    db.close()
  })
})
