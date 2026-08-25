import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { createCoreSchema } from './schema'
import { importFolderDocument } from './folderDocuments'
import { setFolderMetadata } from './folderMetadata'
import { extractVendorDocumentFields } from './vendorDocExtraction'
import { hasFts5 } from './sqliteCapabilities'

const tmpDirs: string[] = []
function makeTmpDir(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ir-docextract-'))
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

describe.skipIf(!hasFts5())('extractVendorDocumentFields', () => {
  it('reads a plain-text spec sheet and writes recognized fields as vendor_documentation', async () => {
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const folderId = makeFolder(db)
    const sourceDir = makeTmpDir()
    const storageDir = join(makeTmpDir(), 'ir-documents')
    const specPath = join(sourceDir, 'spec-sheet.txt')
    fs.writeFileSync(specPath, 'Marshall 1960A cabinet loaded with Vintage 30 speakers, miked with an SM57.')
    importFolderDocument(db, folderId, specPath, storageDir)

    const stats = await extractVendorDocumentFields(db, folderId)
    expect(stats.documentsProcessed).toBe(1)
    expect(stats.fieldsWritten).toBeGreaterThan(0)

    const declared = db
      .prepare(`SELECT field, value, source FROM folder_metadata WHERE folder_id = ? ORDER BY field`)
      .all(folderId) as Array<{ field: string; value: string; source: string }>
    const byField = Object.fromEntries(declared.map((d) => [d.field, d]))
    expect(byField.manufacturer?.value).toBe('Marshall')
    expect(byField.manufacturer?.source).toBe('vendor_documentation')
    expect(byField.microphone?.value).toBe('SM57')
    expect(byField.cabinet).toBeUndefined() // no cabinet vocabulary list — never guessed

    db.close()
  })

  it('never overwrites a field the user already hand-typed', async () => {
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const folderId = makeFolder(db)
    setFolderMetadata(db, folderId, 'manufacturer', 'Fender', 'user_entered')

    const sourceDir = makeTmpDir()
    const storageDir = join(makeTmpDir(), 'ir-documents')
    const specPath = join(sourceDir, 'spec-sheet.txt')
    fs.writeFileSync(specPath, 'Marshall 1960A cabinet with SM57.')
    importFolderDocument(db, folderId, specPath, storageDir)

    await extractVendorDocumentFields(db, folderId)

    const manufacturer = db
      .prepare(`SELECT value, source FROM folder_metadata WHERE folder_id = ? AND field = 'manufacturer'`)
      .get(folderId) as { value: string; source: string }
    expect(manufacturer.value).toBe('Fender')
    expect(manufacturer.source).toBe('user_entered')

    db.close()
  })

  it('actually extracts text from a real PDF (not just txt/csv)', async () => {
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const folderId = makeFolder(db)
    const storageDir = join(makeTmpDir(), 'ir-documents')
    // A real PDF fixture bundled with the pdf-parse package itself — proves the .pdf code path
    // (fs.readFileSync + pdfParse) actually decodes real PDF bytes, not just plain text files.
    const realPdf = join(process.cwd(), 'node_modules', 'pdf-parse', 'test', 'data', '01-valid.pdf')
    importFolderDocument(db, folderId, realPdf, storageDir)

    const stats = await extractVendorDocumentFields(db, folderId)
    expect(stats.documentsProcessed).toBe(1)

    db.close()
  })

  it('a folder with no documents processes zero, writes zero, and never throws', async () => {
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const folderId = makeFolder(db)

    const stats = await extractVendorDocumentFields(db, folderId)
    expect(stats).toEqual({ documentsProcessed: 0, fieldsWritten: 0 })

    db.close()
  })
})
