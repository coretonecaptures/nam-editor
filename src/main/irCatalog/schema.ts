/**
 * IR Lab Manager catalog schema — Phase 1 subset.
 *
 * Full shape is docs/ir-lab-manager-build-plan.md section 2. Phase 1 only exercises
 * library_root / folder / item / item_search (traversal + persistence + FTS5 + query latency,
 * per the plan's Phase 1 scope) — the organization tables (collection, tag, checklist_item, ...)
 * and the NAM/IR-specific detail tables (nam_capture_item, ir_item, ...) are declared here so the
 * schema stays the single source of truth, but nothing writes to them yet; that starts in later
 * phases once vendor parsers (Phase 3) and audition (Phase 4) exist to populate them.
 *
 * item_search triggers are intentionally partial: only `item` is a live source in Phase 1, since
 * nam_capture_item/ir_item aren't populated until parsers exist. Extend the trigger set when that
 * lands, per docs/ir-lab-manager-build-plan.md section 2c/4.
 *
 * CORE_SCHEMA_SQL / DEFERRED_INDEXES_SQL split: root-caused by real measurement
 * (docs/ir-lab-manager-build-plan.md section 12 Phase 1) that the five secondary indexes on
 * `item` plus the FTS5 `item_search` table were the actual bottleneck in a large bulk import —
 * maintaining six B-tree-family structures per row, live, is what turned ~1,600 items/sec into
 * ~90 by 260s on a real 282K-file library. Walking and hashing were both isolated and cleared
 * first (fast and flat at full scale on their own); only removing the DB from the loop entirely
 * reproduced the same decay, and it survived every other fix tried (app-level I/O concurrency,
 * raising libuv's thread pool, excluding the library from AV scanning). `CORE_SCHEMA_SQL` has
 * only the `UNIQUE` constraints bulk import's `ON CONFLICT` upserts actually depend on — those
 * can't be deferred, they're what makes resumability work. Everything deferrable (the five
 * `item` indexes, `item_search`, its live-edit triggers) lives in `DEFERRED_INDEXES_SQL` /
 * `finalizeIndexes`, built once against a static table after bulk import finishes, which is
 * standard practice for bulk-loading SQL databases generally and not specific to this schema.
 */
import type { DatabaseSync } from 'node:sqlite'

export const CORE_SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS library_root (
  id          INTEGER PRIMARY KEY,
  path        TEXT NOT NULL UNIQUE,
  label       TEXT,
  watch_mode  TEXT NOT NULL DEFAULT 'manual' CHECK (watch_mode IN ('manual', 'watched')),
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS folder (
  id               INTEGER PRIMARY KEY,
  library_root_id  INTEGER NOT NULL REFERENCES library_root(id),
  parent_id        INTEGER REFERENCES folder(id),
  relative_path    TEXT NOT NULL,
  notes            TEXT,
  UNIQUE (library_root_id, relative_path)
);
-- idx_folder_parent deferred (DEFERRED_INDEXES_SQL) -- folder count stays in the hundreds even
-- under a huge pack (section 2/2a), so this one's live-maintenance cost was never the bottleneck,
-- but it's deferred anyway for consistency: nothing outside finalizeIndexes needs it mid-import.

CREATE TABLE IF NOT EXISTS folder_metadata (
  folder_id  INTEGER NOT NULL REFERENCES folder(id) ON DELETE CASCADE,
  field      TEXT NOT NULL,
  value      TEXT NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('vendor_documentation', 'user_entered', 'ir_lab_native')),
  PRIMARY KEY (folder_id, field)
);

CREATE TABLE IF NOT EXISTS folder_metadata_effective (
  folder_id  INTEGER NOT NULL REFERENCES folder(id) ON DELETE CASCADE,
  field      TEXT NOT NULL,
  value      TEXT NOT NULL,
  source     TEXT NOT NULL,
  PRIMARY KEY (folder_id, field)
);

CREATE TABLE IF NOT EXISTS folder_document (
  id                 INTEGER PRIMARY KEY,
  folder_id          INTEGER NOT NULL REFERENCES folder(id) ON DELETE CASCADE,
  stored_path        TEXT NOT NULL,
  original_filename  TEXT,
  imported_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS item (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('nam_capture', 'ir')),
  library_root_id  INTEGER NOT NULL REFERENCES library_root(id),
  folder_id        INTEGER REFERENCES folder(id),
  relative_path    TEXT NOT NULL,
  display_name     TEXT NOT NULL,
  created_at       TEXT,
  modified_at      TEXT,
  indexed_at       TEXT NOT NULL,
  last_seen_at     TEXT NOT NULL,
  missing_since    TEXT,
  file_size        INTEGER,
  quick_hash       TEXT,
  content_hash     TEXT,
  rating           INTEGER,
  is_favorite      INTEGER NOT NULL DEFAULT 0,
  notes            TEXT,
  UNIQUE (library_root_id, relative_path)
);
-- idx_item_kind/folder/missing/quickhash/hash all deferred (DEFERRED_INDEXES_SQL) -- these five
-- were the measured bottleneck; see this file's header comment.

CREATE TABLE IF NOT EXISTS nam_capture_item (
  item_id           TEXT PRIMARY KEY REFERENCES item(id) ON DELETE CASCADE,
  modeled_by        TEXT, gear_type TEXT, gear_make TEXT, gear_model TEXT,
  tone_type         TEXT, input_level_dbu REAL, output_level_dbu REAL,
  trained_epochs    INTEGER, preset_name TEXT, loudness REAL, gain REAL,
  architecture      TEXT, mics TEXT, cabinet TEXT, cabinet_config TEXT,
  amp_channel       TEXT, boost_pedal TEXT, amp_settings TEXT,
  pedal_settings    TEXT, amp_switches TEXT
);

CREATE TABLE IF NOT EXISTS ir_item (
  item_id         TEXT PRIMARY KEY REFERENCES item(id) ON DELETE CASCADE,
  capture_id      TEXT UNIQUE,
  manufacturer    TEXT,
  cabinet         TEXT,
  speaker         TEXT,
  microphone      TEXT,
  position        TEXT,
  capture_type    TEXT,
  sample_rate     REAL,
  is_reverb       INTEGER,
  is_stereo       INTEGER,
  is_true_stereo  INTEGER
);

CREATE TABLE IF NOT EXISTS ir_item_field_source (
  item_id  TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  field    TEXT NOT NULL,
  source   TEXT NOT NULL CHECK (source IN (
              'ir_lab_native', 'vendor_documentation', 'vendor_parser',
              'filename_inferred', 'user_entered')),
  PRIMARY KEY (item_id, field)
);

CREATE TABLE IF NOT EXISTS ir_derivative_variant (
  id             TEXT PRIMARY KEY,
  item_id        TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  relative_path  TEXT NOT NULL,
  sample_rate    REAL,
  created_at     TEXT,
  is_current     INTEGER NOT NULL DEFAULT 0,
  is_archived    INTEGER NOT NULL DEFAULT 0
);
-- idx_variant_item deferred (DEFERRED_INDEXES_SQL) -- not written to until Phase 3+ anyway.

CREATE TABLE IF NOT EXISTS collection (
  id                    TEXT PRIMARY KEY,
  kind                  TEXT NOT NULL CHECK (kind IN ('ir_project', 'nam_pack', 'nam_bundle', 'release', 'tray')),
  parent_id             TEXT REFERENCES collection(id),
  library_root_id       INTEGER REFERENCES library_root(id),
  name                  TEXT NOT NULL,
  output_relative_path  TEXT,
  naming_template       TEXT,
  created_at            TEXT,
  last_used_at          TEXT,
  is_builtin            INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS collection_item (
  collection_id     TEXT NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
  item_id           TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  output_file_name  TEXT,
  included          INTEGER NOT NULL DEFAULT 1,
  override_name     TEXT,
  position          INTEGER,
  PRIMARY KEY (collection_id, item_id)
);

CREATE TABLE IF NOT EXISTS tag (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS item_tag (
  item_id  TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);

CREATE TABLE IF NOT EXISTS checklist_item (
  id              TEXT PRIMARY KEY,
  collection_id   TEXT NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
  target_key      TEXT,
  label           TEXT NOT NULL,
  completed       INTEGER NOT NULL DEFAULT 0,
  completed_date  TEXT,
  notes           TEXT,
  position        INTEGER
);

CREATE TABLE IF NOT EXISTS delivery_target (
  id             TEXT PRIMARY KEY,
  collection_id  TEXT NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
  target_key     TEXT NOT NULL,
  label TEXT, title TEXT, subtitle TEXT, description TEXT,
  target_date TEXT, live_date TEXT,
  UNIQUE (collection_id, target_key)
);

CREATE TABLE IF NOT EXISTS delivery_matrix_row (
  id                   TEXT PRIMARY KEY,
  collection_id        TEXT NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
  item_id              TEXT REFERENCES item(id),
  captured_name_hint   TEXT,
  include_targets      TEXT NOT NULL DEFAULT '[]',
  alt_names            TEXT,
  position             INTEGER
);

CREATE TABLE IF NOT EXISTS asset_file (
  id             INTEGER PRIMARY KEY,
  item_id        TEXT REFERENCES item(id) ON DELETE CASCADE,
  collection_id  TEXT REFERENCES collection(id) ON DELETE CASCADE,
  folder_id      INTEGER REFERENCES folder(id) ON DELETE CASCADE,
  role           TEXT NOT NULL,
  relative_path  TEXT,
  cache_path     TEXT,
  source_mtime   TEXT,
  CHECK ((item_id IS NOT NULL) + (collection_id IS NOT NULL) + (folder_id IS NOT NULL) = 1)
);
-- idx_asset_item/collection/folder deferred (DEFERRED_INDEXES_SQL) -- not written to until
-- Phase 3+ (folder documents/cover art) anyway.
`

/**
 * Indexes and FTS5, deferred out of CORE_SCHEMA_SQL and built once after bulk import instead of
 * maintained live per-row. See this file's header comment for why.
 */
export const DEFERRED_INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_folder_parent ON folder(parent_id);

CREATE INDEX IF NOT EXISTS idx_item_kind      ON item(kind);
CREATE INDEX IF NOT EXISTS idx_item_folder    ON item(folder_id);
CREATE INDEX IF NOT EXISTS idx_item_missing   ON item(missing_since) WHERE missing_since IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_item_quickhash ON item(quick_hash) WHERE quick_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_item_hash      ON item(content_hash) WHERE content_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_variant_item ON ir_derivative_variant(item_id);

CREATE INDEX IF NOT EXISTS idx_asset_item       ON asset_file(item_id);
CREATE INDEX IF NOT EXISTS idx_asset_collection ON asset_file(collection_id);
CREATE INDEX IF NOT EXISTS idx_asset_folder     ON asset_file(folder_id);

CREATE VIRTUAL TABLE IF NOT EXISTS item_search USING fts5(
  item_id UNINDEXED,
  display_name, notes, manufacturer, cabinet, speaker, microphone,
  mics, tone_type, gear_make, gear_model
);
`

/**
 * Live-edit trigger: keeps item_search in sync for single-row inserts/updates once the catalog is
 * past its initial bulk import (a scan-detected new file, a user edit). References item_search,
 * so this can only be applied after DEFERRED_INDEXES_SQL has created that table — see
 * `finalizeIndexes` below, which is the only place this should normally be called from.
 */
export const ITEM_SEARCH_TRIGGERS_SQL = `
CREATE TRIGGER IF NOT EXISTS item_search_ai AFTER INSERT ON item BEGIN
  INSERT INTO item_search (item_id, display_name, notes) VALUES (new.id, new.display_name, new.notes);
END;

CREATE TRIGGER IF NOT EXISTS item_search_au AFTER UPDATE OF display_name, notes ON item BEGIN
  DELETE FROM item_search WHERE item_id = old.id;
  INSERT INTO item_search (item_id, display_name, notes) VALUES (new.id, new.display_name, new.notes);
END;

CREATE TRIGGER IF NOT EXISTS item_search_ad AFTER DELETE ON item BEGIN
  DELETE FROM item_search WHERE item_id = old.id;
END;
`

export const DROP_ITEM_SEARCH_TRIGGERS_SQL = `
DROP TRIGGER IF EXISTS item_search_ai;
DROP TRIGGER IF EXISTS item_search_au;
DROP TRIGGER IF EXISTS item_search_ad;
`

/** Only the tables and the UNIQUE constraints bulk import's ON CONFLICT upserts depend on. */
export function createCoreSchema(db: DatabaseSync): void {
  db.exec(CORE_SCHEMA_SQL)
}

export function itemSearchTableExists(db: DatabaseSync): boolean {
  const row = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'item_search'`).get()
  return row !== undefined
}

/**
 * Builds everything CORE_SCHEMA_SQL deferred: the five item indexes, item_search (FTS5),
 * populated in one bulk pass from whatever's already in `item` (LEFT JOINed against `ir_item`,
 * if any rows exist there yet — see below), then the live-edit triggers. See this file's header
 * comment for why building these live per-row during import was the actual Phase 1 bottleneck.
 *
 * Idempotent and cheap (a single DELETE + INSERT...SELECT, not per-row) — call it after EVERY
 * call to importLibrary(), not just the first: that function never populates item_search itself,
 * even on a re-scan against an already-finalized catalog, since its trigger-dropping wrapper
 * (withoutLiveSearchTriggers) disables the live triggers for the whole call by design.
 *
 * Also call it again after vendor parsing (Phase 3's applyVendorParsers) populates ir_item's
 * manufacturer/cabinet/speaker/microphone — this join is what makes those fields searchable at
 * all; without a second call, search only ever covers display_name. Known gap, not yet fixed:
 * the live-edit triggers (ITEM_SEARCH_TRIGGERS_SQL) only fire on `item` INSERT/UPDATE, not on an
 * `ir_item` field edit, so a future single-item metadata edit won't refresh search live — only
 * the next bulk finalizeIndexes() call will pick it up.
 */
export function finalizeIndexes(db: DatabaseSync): void {
  db.exec(DEFERRED_INDEXES_SQL)
  db.exec(`DELETE FROM item_search`)
  db.exec(`
    INSERT INTO item_search (item_id, display_name, notes, manufacturer, cabinet, speaker, microphone)
    SELECT item.id, item.display_name, item.notes, ir_item.manufacturer, ir_item.cabinet, ir_item.speaker, ir_item.microphone
    FROM item LEFT JOIN ir_item ON ir_item.item_id = item.id
  `)
  db.exec(ITEM_SEARCH_TRIGGERS_SQL)
}

/** Full schema immediately, indexes and all — for tests and other non-bulk-import callers. */
export function createSchema(db: DatabaseSync): void {
  createCoreSchema(db)
  finalizeIndexes(db)
}

/**
 * Runs `fn` with item_search triggers removed for the duration, then restores them — for a
 * re-scan against an already-finalized catalog (item_search + triggers already exist), so a large
 * batch of upserts doesn't pay live per-row trigger cost. A no-op wrapper (just runs `fn`) when
 * item_search doesn't exist yet, since there's nothing to drop/restore during a catalog's first
 * bulk import (see importLibrary.ts, which calls finalizeIndexes separately once that's done).
 *
 * Awaits `fn`'s result before restoring — the triggers must stay dropped for the whole async
 * import, not just until `fn` returns its (pending) promise.
 */
export async function withoutLiveSearchTriggers<T>(db: DatabaseSync, fn: () => T | Promise<T>): Promise<T> {
  if (!itemSearchTableExists(db)) return await fn()
  db.exec(DROP_ITEM_SEARCH_TRIGGERS_SQL)
  try {
    return await fn()
  } finally {
    db.exec(ITEM_SEARCH_TRIGGERS_SQL)
  }
}
