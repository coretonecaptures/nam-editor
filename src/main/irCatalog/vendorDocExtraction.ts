/**
 * Vendor document field extraction — closes the `folder_document` TODO (docs/
 * ir-lab-manager-build-plan.md section 2's table comment): importing a vendor PDF/CSV/TXT
 * previously only stored and linked the file, never read anything out of it. This runs the text
 * through the SAME generic gear-vocabulary matcher the filename parser already uses
 * (`genericVocabularyParser` — manufacturer/speaker/microphone term lists), so a value found in a
 * spec sheet gets exactly the same recognition logic as one found in a filename, just applied to
 * different text. Writes at `folder_metadata`'s `vendor_documentation` source — the confidence
 * ladder's mid tier (below `user_entered`, above nothing at the folder level, since
 * `folder_metadata` doesn't carry `vendor_parser`/`filename_inferred` at all, only per-item
 * `ir_item_field_source` does).
 *
 * Deliberately NOT an AI/vision extraction pass (that's Gear Locker's own pending TODO for image/
 * PDF spec sheets, a distinct, heavier dependency this project doesn't have wired up) — this is
 * plain text extraction plus the same pattern matching Phase 3 already ships, reused rather than
 * reinvented. `cabinet` is never written here: there is no cabinet vocabulary list (only
 * manufacturer/speaker/microphone — see vocabulary.ts), so a document is never guessed to name a
 * specific cabinet model; that gap already exists in the filename parser and isn't new here.
 */
import * as fs from 'node:fs'
import { extname } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
// Import the inner implementation directly, NOT the package's top-level `index.js` — that entry
// point has a long-standing bug (isDebugMode = !module.parent) that self-runs a test read of a
// fixture file the moment it's loaded through anything other than a plain CommonJS require from a
// direct parent (ESM interop / bundlers / test runners all trip it), throwing ENOENT immediately.
// `lib/pdf-parse.js` is the real implementation with none of that top-level debug code.
import pdfParse from 'pdf-parse/lib/pdf-parse.js'
import { genericVocabularyParser } from './vendorParsers/genericVocabulary'
import { listFolderDocuments } from './folderDocuments'
import { setFolderMetadata } from './folderMetadata'

export interface DocExtractionStats {
  documentsProcessed: number
  fieldsWritten: number
}

async function extractText(storedPath: string): Promise<string | null> {
  const ext = extname(storedPath).toLowerCase()
  try {
    if (ext === '.pdf') {
      const buffer = fs.readFileSync(storedPath)
      const result = await pdfParse(buffer)
      return result.text
    }
    if (ext === '.csv' || ext === '.txt') {
      return fs.readFileSync(storedPath, 'utf8')
    }
  } catch {
    // Corrupt/unreadable file — skip it, don't fail the whole folder's extraction over one bad doc.
    return null
  }
  return null
}

/** field -> current declared source for this folder, or null if nothing declared yet. Guards
 * against overwriting a user's own hand-typed folder field — `setFolderMetadata`'s own
 * `ON CONFLICT DO UPDATE` has no such guard built in (it's also the write path the Pack Info UI
 * uses for a deliberate user edit, where unconditional overwrite is exactly correct), so the
 * caller doing an AUTOMATED write is responsible for checking first. */
function declaredSource(db: DatabaseSync, folderId: number, field: string): string | null {
  const row = db.prepare(`SELECT source FROM folder_metadata WHERE folder_id = ? AND field = ?`).get(folderId, field) as
    | { source: string }
    | undefined
  return row?.source ?? null
}

/** Runs every vendor document already imported into `folderId` through the generic vocabulary
 * matcher, writing any manufacturer/speaker/microphone terms found as folder-level
 * `vendor_documentation`-sourced fields (inherited by every item in the folder and below, per the
 * existing folder_metadata cascade) — never overwriting a field the user already hand-typed. */
export async function extractVendorDocumentFields(db: DatabaseSync, folderId: number): Promise<DocExtractionStats> {
  const documents = listFolderDocuments(db, folderId)
  let documentsProcessed = 0
  let fieldsWritten = 0

  for (const doc of documents) {
    const text = await extractText(doc.stored_path)
    if (!text) continue
    documentsProcessed++

    const fields = genericVocabularyParser.parse(text, '')
    for (const [field, value] of Object.entries(fields) as Array<[keyof typeof fields, string | undefined]>) {
      if (!value || field === 'cabinet' || field === 'position') continue
      if (declaredSource(db, folderId, field) === 'user_entered') continue
      setFolderMetadata(db, folderId, field, value, 'vendor_documentation')
      fieldsWritten++
    }
  }

  return { documentsProcessed, fieldsWritten }
}
