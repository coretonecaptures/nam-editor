/**
 * Runs the vendor parser chain over items in the catalog, writing ir_item + per-field provenance
 * (ir_item_field_source) per the confidence ladder (docs/ir-lab-manager-build-plan.md section 3).
 *
 * Structural parsers (Ownhammer, RedWirez) get first refusal per folder — cached per folder_id so
 * `recognizes()` runs once per folder, not once per file, since it only needs the sibling file
 * list. The generic vocabulary fallback always runs afterward too, to fill in whatever fields the
 * structural match didn't set (e.g. Ownhammer's parser never guesses `manufacturer`) — it only
 * ever fills gaps, never downgrades a field a structural parser already set.
 */
import type { DatabaseSync } from 'node:sqlite'
import type { VendorParser, ParsedIrFields } from './types'
import { ownhammerParser } from './ownhammer'
import { redwirezParser } from './redwirez'
import { genericVocabularyParser } from './genericVocabulary'

const STRUCTURAL_PARSERS: VendorParser[] = [ownhammerParser, redwirezParser]

/** Lower is more trustworthy. user_entered is handled separately (see upsertIrField) — it's not
 * "rank 5 loses to everything," it's "never overwritten by anything, ever," per the plan's
 * explicit callout in section 3. */
const RANK: Record<string, number> = {
  ir_lab_native: 1,
  vendor_documentation: 2,
  vendor_parser: 3,
  filename_inferred: 4
}

export interface VendorParseStats {
  itemsProcessed: number
  fieldsWritten: number
}

export function applyVendorParsers(db: DatabaseSync, libraryRootId: number): VendorParseStats {
  const items = db
    .prepare(
      `SELECT id, relative_path, folder_id FROM item WHERE library_root_id = ? AND kind = 'ir'`
    )
    .all(libraryRootId) as Array<{ id: string; relative_path: string; folder_id: number | null }>

  // folder_id -> sibling WAV filenames (just the basenames), built once per folder rather than
  // re-querying per item.
  const siblingsByFolder = new Map<number | null, string[]>()
  for (const item of items) {
    const list = siblingsByFolder.get(item.folder_id) ?? []
    list.push(item.relative_path.slice(item.relative_path.lastIndexOf('/') + 1))
    siblingsByFolder.set(item.folder_id, list)
  }

  // folder_id -> the structural parser that recognized it (or null if none did), decided once.
  const structuralByFolder = new Map<number | null, VendorParser | null>()

  const ensureIrItem = db.prepare(`INSERT OR IGNORE INTO ir_item (item_id) VALUES (?)`)
  const selectSource = db.prepare(`SELECT source FROM ir_item_field_source WHERE item_id = ? AND field = ?`)
  const upsertSource = db.prepare(
    `INSERT INTO ir_item_field_source (item_id, field, source) VALUES (?, ?, ?)
     ON CONFLICT(item_id, field) DO UPDATE SET source = excluded.source`
  )

  let fieldsWritten = 0

  const upsertIrField = (itemId: string, field: keyof ParsedIrFields, value: string, source: string): void => {
    const existing = selectSource.get(itemId, field) as { source: string } | undefined
    if (existing) {
      if (existing.source === 'user_entered') return
      if (RANK[source] > RANK[existing.source]) return // would downgrade — refuse
    }
    db.prepare(`UPDATE ir_item SET ${field} = ? WHERE item_id = ?`).run(value, itemId)
    upsertSource.run(itemId, field, source)
    fieldsWritten++
  }

  const writeFields = (itemId: string, fields: ParsedIrFields, source: string): void => {
    for (const [field, value] of Object.entries(fields) as Array<[keyof ParsedIrFields, string | undefined]>) {
      if (value) upsertIrField(itemId, field, value, source)
    }
  }

  for (const item of items) {
    ensureIrItem.run(item.id)

    const siblings = siblingsByFolder.get(item.folder_id) ?? []
    const folderPath = item.relative_path.slice(0, item.relative_path.lastIndexOf('/'))

    if (!structuralByFolder.has(item.folder_id)) {
      const match = STRUCTURAL_PARSERS.find((p) => p.recognizes(folderPath, siblings)) ?? null
      structuralByFolder.set(item.folder_id, match)
    }
    const structural = structuralByFolder.get(item.folder_id) ?? null

    if (structural) {
      writeFields(item.id, structural.parse(item.relative_path, folderPath), 'vendor_parser')
    }
    writeFields(item.id, genericVocabularyParser.parse(item.relative_path, folderPath), 'filename_inferred')
  }

  return { itemsProcessed: items.length, fieldsWritten }
}
