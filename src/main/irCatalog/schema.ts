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
 */
import type { DatabaseSync } from 'node:sqlite'

export const SCHEMA_SQL = `
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
CREATE INDEX IF NOT EXISTS idx_folder_parent ON folder(parent_id);

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
CREATE INDEX IF NOT EXISTS idx_item_kind      ON item(kind);
CREATE INDEX IF NOT EXISTS idx_item_folder    ON item(folder_id);
CREATE INDEX IF NOT EXISTS idx_item_missing   ON item(missing_since) WHERE missing_since IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_item_quickhash ON item(quick_hash) WHERE quick_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_item_hash      ON item(content_hash) WHERE content_hash IS NOT NULL;

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
CREATE INDEX IF NOT EXISTS idx_variant_item ON ir_derivative_variant(item_id);

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
 * Live-edit trigger: keeps item_search in sync for single-row inserts/updates outside of bulk
 * import. Bulk import (importLibrary.ts) inserts into item_search directly inside its own batch
 * transactions instead, per docs/ir-lab-manager-build-plan.md section 2c — these triggers would
 * triple write volume at exactly the moment bulk-import throughput is being measured, so callers
 * doing a bulk import must NOT apply this DDL until the import finishes (see
 * `withLiveSearchTriggers` below).
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

export function createSchema(db: DatabaseSync): void {
  db.exec(SCHEMA_SQL)
}

/**
 * Runs `fn` with item_search triggers removed for the duration, then restores them.
 *
 * Awaits `fn`'s result before restoring — the triggers must stay dropped for the whole async
 * import, not just until `fn` returns its (pending) promise.
 */
export async function withoutLiveSearchTriggers<T>(db: DatabaseSync, fn: () => T | Promise<T>): Promise<T> {
  db.exec(DROP_ITEM_SEARCH_TRIGGERS_SQL)
  try {
    return await fn()
  } finally {
    db.exec(ITEM_SEARCH_TRIGGERS_SQL)
  }
}
