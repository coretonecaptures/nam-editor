/**
 * Shared confidence-ladder writer for ir_item's descriptive fields (manufacturer/cabinet/speaker/
 * microphone/position/capture_type) — docs/ir-lab-manager-build-plan.md section 3. Extracted out
 * of applyVendorParsers.ts (where this lived as a private closure) so a new source can reuse the
 * exact "never overwrite user_entered, never downgrade a higher-ranked field" rule instead of
 * re-implementing it: importLibrary.ts's embedded-WAV-metadata write (source ir_lab_embedded) uses
 * the same writer applyVendorParsers.ts does for vendor_parser/filename_inferred.
 *
 * labProjectEnrichment.ts's own writer deliberately does NOT use this — ir_lab_native is always
 * the top rank, so it can just overwrite unconditionally (except over user_entered) without a
 * RANK lookup at all; see that file's own comment.
 */
import type { DatabaseSync } from 'node:sqlite'

export type FieldSource =
  | 'ir_lab_native'
  | 'ir_lab_embedded'
  | 'vendor_documentation'
  | 'vendor_parser'
  | 'filename_inferred'
  | 'user_entered'

/** Lower is more trustworthy. user_entered has no rank here — it's not "loses to everything above
 * it," it's "never overwritten by anything, ever," handled as a separate check below. */
export const FIELD_SOURCE_RANK: Record<Exclude<FieldSource, 'user_entered'>, number> = {
  ir_lab_native: 1,
  ir_lab_embedded: 2,
  vendor_documentation: 3,
  vendor_parser: 4,
  filename_inferred: 5
}

export interface IrFieldWriter {
  /** Returns true if the field was actually written; false if refused (already user_entered, or
   * already held by a source ranked equal-or-higher than the one being offered). */
  write(itemId: string, field: string, value: string | null | undefined, source: FieldSource): boolean
}

export function createIrFieldWriter(db: DatabaseSync): IrFieldWriter {
  const selectSource = db.prepare(`SELECT source FROM ir_item_field_source WHERE item_id = ? AND field = ?`)
  const upsertSource = db.prepare(
    `INSERT INTO ir_item_field_source (item_id, field, source) VALUES (?, ?, ?)
     ON CONFLICT(item_id, field) DO UPDATE SET source = excluded.source`
  )
  return {
    write(itemId, field, value, source) {
      if (!value) return false
      const existing = selectSource.get(itemId, field) as { source: FieldSource } | undefined
      if (existing) {
        if (existing.source === 'user_entered') return false
        if (source !== 'user_entered' && FIELD_SOURCE_RANK[source] > FIELD_SOURCE_RANK[existing.source as Exclude<FieldSource, 'user_entered'>]) {
          return false
        }
      }
      db.prepare(`UPDATE ir_item SET ${field} = ? WHERE item_id = ?`).run(value, itemId)
      upsertSource.run(itemId, field, source)
      return true
    }
  }
}
