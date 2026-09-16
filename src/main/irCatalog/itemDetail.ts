/**
 * Full single-item metadata detail — backend for the docked item detail panel (IR/NAM parity
 * backlog items 7-10's "widen field coverage" follow-up, docs/ir-metadata-full-parity-proposal-
 * 2026-09-13.md's G1/G2). Deliberately a separate single-row query from queryLibrary.ts's browse
 * SELECT rather than widening that one: the browse query runs per visible row at up to a
 * 282K-item scroll scale (schema.ts's own header comment), while the detail panel only ever needs
 * ONE item's full ~30-column record at a time, on selection — a completely different access
 * pattern that doesn't belong sharing the same hot path.
 *
 * Every field here mirrors an `ir_item` column 1:1 (see schema.ts's CREATE TABLE comments for what
 * each one means and where it comes from) plus `item.notes`/`rating`/`is_favorite`, so this is
 * intentionally NOT resolved through folder_metadata_effective the way manufacturer/cabinet/
 * speaker/microphone are on the browse row — this shows exactly what's stored on the item itself,
 * which is what an editor needs to show accurately (folder inheritance is a display/query-time
 * convenience for browsing, not something an edit form should silently blend in).
 */
import type { DatabaseSync } from 'node:sqlite'

const IR_ITEM_TEXT_FIELDS = [
  'manufacturer', 'cabinet', 'speaker', 'microphone', 'position', 'capture_type',
  'speaker_position', 'modeled_microphone', 'preset_kind',
  'mic_a_type', 'mic_a_polar_pattern', 'mic_a_target_zone', 'mic_a_distance_unit',
  'mic_a_signal_chain_override', 'mic_a_notes',
  'mic_b_type', 'mic_b_polar_pattern', 'mic_b_target_zone', 'mic_b_distance_unit',
  'mic_b_signal_chain_override', 'mic_b_notes',
  'reverb_unit_make', 'reverb_unit_model', 'reverb_preset_name', 'reverb_space_type',
  'reverb_capture_mode', 'reverb_source_signal_type'
] as const

export interface ItemDetail {
  id: string
  displayName: string
  relativePath: string
  notes: string | null
  notesSource: string | null
  rating: number | null
  isFavorite: boolean
  isReverb: boolean
  isStereo: boolean
  isTrueStereo: boolean
  fields: Record<(typeof IR_ITEM_TEXT_FIELDS)[number], { value: string | null; source: string | null }>
  micADistance: number | null
  micAAxisAngleDeg: number | null
  micBDistance: number | null
  micBAxisAngleDeg: number | null
  reverbRecommendedWetPercent: number | null
  reverbRecommendedPreDelayMs: number | null
  reverbDecaySeconds: number | null
}

export function getItemDetail(db: DatabaseSync, itemId: string): ItemDetail | null {
  const item = db
    .prepare(
      `SELECT item.id as id, item.display_name as displayName, item.relative_path as relativePath,
              item.notes as notes, item.rating as rating, item.is_favorite as isFavorite,
              ir_item.is_reverb as isReverb, ir_item.is_stereo as isStereo, ir_item.is_true_stereo as isTrueStereo,
              ir_item.mic_a_distance as micADistance, ir_item.mic_a_axis_angle_deg as micAAxisAngleDeg,
              ir_item.mic_b_distance as micBDistance, ir_item.mic_b_axis_angle_deg as micBAxisAngleDeg,
              ir_item.reverb_recommended_wet_percent as reverbRecommendedWetPercent,
              ir_item.reverb_recommended_pre_delay_ms as reverbRecommendedPreDelayMs,
              ir_item.reverb_decay_seconds as reverbDecaySeconds,
              ${IR_ITEM_TEXT_FIELDS.map((f) => `ir_item.${f} as ${f}`).join(', ')}
       FROM item
       LEFT JOIN ir_item ON ir_item.item_id = item.id
       WHERE item.id = ?`
    )
    .get(itemId) as
    | (Record<(typeof IR_ITEM_TEXT_FIELDS)[number], string | null> & {
        id: string
        displayName: string
        relativePath: string
        notes: string | null
        rating: number | null
        isFavorite: number
        isReverb: number | null
        isStereo: number | null
        isTrueStereo: number | null
        micADistance: number | null
        micAAxisAngleDeg: number | null
        micBDistance: number | null
        micBAxisAngleDeg: number | null
        reverbRecommendedWetPercent: number | null
        reverbRecommendedPreDelayMs: number | null
        reverbDecaySeconds: number | null
      })
    | undefined
  if (!item) return null

  const sourceRows = db
    .prepare(`SELECT field, source FROM ir_item_field_source WHERE item_id = ?`)
    .all(itemId) as Array<{ field: string; source: string }>
  const sourceByField = new Map(sourceRows.map((r) => [r.field, r.source]))

  const fields = {} as ItemDetail['fields']
  for (const f of IR_ITEM_TEXT_FIELDS) {
    fields[f] = { value: item[f] ?? null, source: sourceByField.get(f) ?? null }
  }

  return {
    id: item.id,
    displayName: item.displayName,
    relativePath: item.relativePath,
    notes: item.notes,
    notesSource: sourceByField.get('notes') ?? null,
    rating: item.rating,
    isFavorite: !!item.isFavorite,
    isReverb: !!item.isReverb,
    isStereo: !!item.isStereo,
    isTrueStereo: !!item.isTrueStereo,
    fields,
    micADistance: item.micADistance,
    micAAxisAngleDeg: item.micAAxisAngleDeg,
    micBDistance: item.micBDistance,
    micBAxisAngleDeg: item.micBAxisAngleDeg,
    reverbRecommendedWetPercent: item.reverbRecommendedWetPercent,
    reverbRecommendedPreDelayMs: item.reverbRecommendedPreDelayMs,
    reverbDecaySeconds: item.reverbDecaySeconds
  }
}
