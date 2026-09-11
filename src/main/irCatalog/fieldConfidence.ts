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
  /** Clears an item-level override — parity backlog item 8. There's no history of what a parser
   * guessed before the user overwrote it (the write above replaces in place), so "restore" can
   * only mean "clear the item-level value and let folder inheritance show through again" —
   * exactly what queryLibrary.ts's browse SELECT already does via
   * `COALESCE(ir_item.field, folder_metadata_effective.value)`. Clearing the source row too (not
   * just the value) is what lets a lower-ranked automated source write again on the next scan;
   * leaving a stale 'user_entered' row there would keep blocking it even after the value is gone. */
  clear(itemId: string, field: string): void
}

export function createIrFieldWriter(db: DatabaseSync): IrFieldWriter {
  const selectSource = db.prepare(`SELECT source FROM ir_item_field_source WHERE item_id = ? AND field = ?`)
  const upsertSource = db.prepare(
    `INSERT INTO ir_item_field_source (item_id, field, source) VALUES (?, ?, ?)
     ON CONFLICT(item_id, field) DO UPDATE SET source = excluded.source`
  )
  return {
    clear(itemId, field) {
      db.prepare(`UPDATE ir_item SET ${field} = NULL WHERE item_id = ?`).run(itemId)
      db.prepare(`DELETE FROM ir_item_field_source WHERE item_id = ? AND field = ?`).run(itemId, field)
    },
    write(itemId, field, value, source) {
      if (!value) return false
      const existing = selectSource.get(itemId, field) as { source: FieldSource } | undefined
      if (existing) {
        // "user_entered is sticky" means sticky against AUTOMATION, not against the user editing
        // their own correction a second time (item 7 — the per-item metadata editor's whole job
        // is letting them do exactly that). Neither existing caller (importLibrary.ts,
        // applyVendorParsers.ts) ever passes source: 'user_entered', so this only changes
        // behavior for the interactive edit path that needed it.
        if (existing.source === 'user_entered' && source !== 'user_entered') return false
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
