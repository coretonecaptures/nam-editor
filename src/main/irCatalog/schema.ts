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
  pedal_settings    TEXT, amp_switches TEXT,
  -- Pre-training facts, written by namCaptureEnrichment.ts straight from IR Lab's own
  -- nam-capture.json (confirmed against NamCaptureStore.h/.cpp; see
  -- docs/nam-capture-import-plan-2026-08-29.md §2). Everything above this line is post-training
  -- metadata that only the trainer-completion path or the manual/Excel workflow ever fills;
  -- everything below is known the moment the capture folder is scanned. The importer inserts a
  -- bare row (item_id only) per capture so training-completion code has a row to UPDATE, and
  -- fills these columns in the same pass.
  capture_id                TEXT,    -- nam-capture.json captureId (stable, survives a rename)
  capture_name              TEXT,    -- captureName
  project_id                TEXT,    -- projectId — the grouping key, never folder nesting depth
  capture_scope             TEXT,    -- 'Cabinet' | 'Device' | 'Software'
  sample_rate               REAL,
  measured_latency_samples  INTEGER,
  -- Stored verbatim; NEVER silently equated with a real capture. Every downstream consumer
  -- (queue-for-training default exclusion, the UI's visible flag) checks this explicitly.
  synthetic                 INTEGER,
  synthetic_source_ir_name  TEXT,
  created_at                TEXT,
  -- Resolved absolute paths from the JSON's own excitation/recording filename fields — never
  -- assume the literal names excitation.wav/recording.wav. These are what make each capture's
  -- DI/return pairing unambiguous for the per-capture trainer-queue path (plan §4).
  excitation_path           TEXT,
  recording_path            TEXT
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
  is_true_stereo  INTEGER,
  -- Read from each file's own WAV header during the scan (wavHeader.ts, parsed out of the buffer
  -- quickHash already reads -- no extra I/O). These are MEASURED facts about the bytes on disk,
  -- not descriptive guesses, so unlike manufacturer/cabinet/speaker/microphone they carry no
  -- ir_item_field_source confidence row: there is nothing to be more or less sure about.
  bit_depth        INTEGER,
  channels         INTEGER,
  duration_seconds REAL,
  audio_format     TEXT,
  -- Pre-rendered search text for the format above (wavHeader.ts's wavSearchText). Stored rather
  -- than assembled in finalizeIndexes' SQL so the indexed spelling always matches what the UI
  -- shows -- see that function's own comment for the bug that motivated it.
  audio_search     TEXT,
  -- Added 2026-08-26 per ir-lab's docs/metadata-model-plan-2026-08-26.md (CaptureMetadata,
  -- confirmed against the real source, not the handoff doc's own wording -- see
  -- labProjectEnrichment.ts's header comment). Every column below is nullable/blank-default, same
  -- as the fields above; most sessions leave most of these empty. speaker_position/
  -- modeled_microphone/preset_kind have no fixed choice list in IR Lab (free text / auto-populated);
  -- the mic_*_type/pattern/zone columns DO have one, but this schema stores whatever string IR Lab
  -- wrote rather than re-enforcing its own choice list.
  speaker_position            TEXT, -- which driver in a multi-speaker cab (free text)
  modeled_microphone          TEXT, -- Townsend Sphere case: virtual mic modeled from 'microphone'
  preset_kind                 TEXT, -- auto-populated: "Cab IR" / "Short Reverb IR" / etc. -- NOT
                                     -- the same axis as capture_type (method) above
  mic_a_type                  TEXT, -- Dynamic / Ribbon / Condenser / Other
  mic_a_polar_pattern         TEXT, -- Cardioid / Supercardioid / Hypercardioid / Figure-8 / Omni / Variable / Other
  mic_a_target_zone           TEXT, -- Cap Center / Cap Edge / Cap Edge-Seam / Cone Middle / Cone Edge-Surround / Off-Cone / Other
  mic_a_distance              REAL, -- NULL/0 = unset
  mic_a_distance_unit         TEXT, -- "in" or "cm"
  mic_a_axis_angle_deg        REAL, -- 0-90; on/off-axis is derived at display time, never stored separately
  mic_a_signal_chain_override TEXT, -- blank = uses the owning collection's signal_chain
  mic_a_notes                 TEXT,
  mic_b_type                  TEXT,
  mic_b_polar_pattern         TEXT,
  mic_b_target_zone           TEXT,
  mic_b_distance              REAL,
  mic_b_distance_unit         TEXT,
  mic_b_axis_angle_deg        REAL,
  mic_b_signal_chain_override TEXT,
  mic_b_notes                 TEXT
  -- Mic A's MODEL is 'microphone' above; Mic B's MODEL is IR Lab's own
  -- ProcessingRecipe::multiMicBlendNameRight, which this schema does not carry
  -- (ProcessingRecipe stays out of the database entirely, per design principle 6 in
  -- ir-lab-manager-shared-catalog-schema.md) -- so Mic B's model name is only ever visible by
  -- opening the session's own analysis.json. mic_b_* columns above are meaningless/blank whenever
  -- the capture didn't actually use a real multi-mic blend.
);

CREATE TABLE IF NOT EXISTS ir_item_field_source (
  item_id  TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  field    TEXT NOT NULL,
  -- 'ir_lab_embedded' = read from a WAV's own BWF bext chunk (bwfCaptureMetadata.ts) rather than
  -- IR Lab's live session database -- see fieldConfidence.ts for where it sits in the ladder.
  source   TEXT NOT NULL CHECK (source IN (
              'ir_lab_native', 'ir_lab_embedded', 'vendor_documentation', 'vendor_parser',
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
  kind                  TEXT NOT NULL CHECK (kind IN ('ir_project', 'nam_project', 'nam_pack', 'nam_bundle', 'release', 'tray')),
  parent_id             TEXT REFERENCES collection(id),
  library_root_id       INTEGER REFERENCES library_root(id),
  -- Anchors an 'ir_project' collection to the folder IR Lab wrote it into
  -- (the folder holding that Project's .SessionData/project.json) -- lets
  -- "is this folder an IR Lab Project" be derived (EXISTS against this
  -- column) rather than a separate stored flag that could drift out of
  -- sync. NULL for every other collection kind.
  folder_id             INTEGER REFERENCES folder(id),
  name                  TEXT NOT NULL,
  output_relative_path  TEXT,
  naming_template       TEXT,
  created_at            TEXT,
  last_used_at          TEXT,
  is_builtin            INTEGER NOT NULL DEFAULT 0,
  -- Added 2026-08-26, meaningful only where kind = 'ir_project' -- IR Lab's "Project Details"
  -- screen, entered once and shared by every capture in the project. A blank ir_item.cabinet/
  -- speaker means that capture displays/searches as THIS row's cabinet/speaker instead -- a
  -- display-time fallback (queryLibrary.ts's browse SELECT/facetClause), never copy-on-write, so
  -- this is read at query time rather than flattened into ir_item.
  cabinet               TEXT,
  speaker               TEXT,
  amplifier             TEXT, -- no per-capture override exists anywhere -- this is the only value
  room                  TEXT, -- e.g. "Iso Booth" -- free text, no per-capture override either
  signal_chain          TEXT, -- e.g. "Apollo x6 -> Neve 1073" -- mic_a/b_signal_chain_override
                                -- on ir_item take precedence per-mic when non-blank
  description           TEXT, -- short, one-line
  project_notes         TEXT  -- free-form, distinct from any item's own notes
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
  mics, tone_type, gear_make, gear_model,
  -- Technical format as searchable text ("44.1k 24-bit mono"), so typing "24-bit" or "96k" in the
  -- search box finds those files. Populated in finalizeIndexes from ir_item's WAV-header columns.
  audio,
  -- Added 2026-08-26 alongside ir_item's new columns. cabinet/speaker above already carry the
  -- collection-fallback value (finalizeIndexes' own COALESCE), so a search for a project-level
  -- cabinet name finds every capture that inherited it, not only ones that repeated it verbatim.
  speaker_position, modeled_microphone, preset_kind, amplifier, room
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

/** Drops the FTS5 index and its triggers together — used by runMigrations when the index's column
 * set is stale (FTS5 columns can't be ALTERed). Triggers must go first: they reference the table. */
const ITEM_SEARCH_DROP_SQL = `
${DROP_ITEM_SEARCH_TRIGGERS_SQL}
DROP TABLE IF EXISTS item_search;
`

/**
 * `CREATE TABLE IF NOT EXISTS` (CORE_SCHEMA_SQL, above) only ever creates a table's FIRST version —
 * an existing catalog.db from before a column was added keeps the old shape forever, silently
 * throwing "no such column" the first time new code queries it (this broke the folder tree the
 * first time it ran against a real, already-populated catalog.db: listFolders()'s EXISTS check
 * against `collection.folder_id` errored on a `collection` table created before that column
 * existed). Small, additive, `ADD COLUMN`-only migrations belong here, run every time the DB opens
 * — checked via `PRAGMA table_info` so this is a no-op once a column already exists, cheap even on
 * a huge catalog since it never touches `item`.
 */
function runMigrations(db: DatabaseSync): void {
  const collectionColumns = db.prepare(`PRAGMA table_info(collection)`).all() as Array<{ name: string }>
  if (collectionColumns.length > 0 && !collectionColumns.some((c) => c.name === 'folder_id')) {
    db.exec(`ALTER TABLE collection ADD COLUMN folder_id INTEGER REFERENCES folder(id)`)
  }
  // IR Lab's 2026-08-26 Project Details fields (cabinet/speaker/amplifier/room/signal_chain/
  // description/project_notes) — meaningful only for kind='ir_project' rows.
  if (collectionColumns.length > 0) {
    const have = new Set(collectionColumns.map((c) => c.name))
    for (const name of ['cabinet', 'speaker', 'amplifier', 'room', 'signal_chain', 'description', 'project_notes'] as const) {
      if (!have.has(name)) db.exec(`ALTER TABLE collection ADD COLUMN ${name} TEXT`)
    }
  }

  // WAV header columns (see ir_item's own comment). Added per-column so a database that already
  // has some of them isn't an error.
  const irItemColumns = db.prepare(`PRAGMA table_info(ir_item)`).all() as Array<{ name: string }>
  if (irItemColumns.length > 0) {
    const have = new Set(irItemColumns.map((c) => c.name))
    for (const [name, type] of [
      ['bit_depth', 'INTEGER'],
      ['channels', 'INTEGER'],
      ['duration_seconds', 'REAL'],
      ['audio_format', 'TEXT'],
      ['audio_search', 'TEXT'],
      // IR Lab's 2026-08-26 CaptureMetadata fields (see ir_item's own CREATE TABLE comment).
      ['speaker_position', 'TEXT'],
      ['modeled_microphone', 'TEXT'],
      ['preset_kind', 'TEXT'],
      ['mic_a_type', 'TEXT'],
      ['mic_a_polar_pattern', 'TEXT'],
      ['mic_a_target_zone', 'TEXT'],
      ['mic_a_distance', 'REAL'],
      ['mic_a_distance_unit', 'TEXT'],
      ['mic_a_axis_angle_deg', 'REAL'],
      ['mic_a_signal_chain_override', 'TEXT'],
      ['mic_a_notes', 'TEXT'],
      ['mic_b_type', 'TEXT'],
      ['mic_b_polar_pattern', 'TEXT'],
      ['mic_b_target_zone', 'TEXT'],
      ['mic_b_distance', 'REAL'],
      ['mic_b_distance_unit', 'TEXT'],
      ['mic_b_axis_angle_deg', 'REAL'],
      ['mic_b_signal_chain_override', 'TEXT'],
      ['mic_b_notes', 'TEXT']
    ] as const) {
      if (!have.has(name)) db.exec(`ALTER TABLE ir_item ADD COLUMN ${name} ${type}`)
    }
  }

  // item_search gained an `audio` column so "44.1k", "24-bit" and "stereo" are typeable in the
  // search box. An FTS5 virtual table's columns are fixed at creation, so an existing index built
  // before that column can't be ALTERed into shape — it's dropped here instead. Nothing is lost:
  // it holds no source data, only a derived index, and getDb()'s `if (!itemSearchTableExists)`
  // check rebuilds and repopulates it from item/ir_item on this very same open.
  const searchColumns = db.prepare(`PRAGMA table_info(item_search)`).all() as Array<{ name: string }>
  if (searchColumns.length > 0 && !searchColumns.some((c) => c.name === 'audio')) {
    db.exec(ITEM_SEARCH_DROP_SQL)
  } else if (searchColumns.length > 0 && !searchColumns.some((c) => c.name === 'speaker_position')) {
    // Same rebuild, for the 2026-08-26 metadata model's 5 new search columns.
    db.exec(ITEM_SEARCH_DROP_SQL)
  }

  // ir_item_field_source's `source` CHECK constraint predates 'ir_lab_embedded' (WAV bext-chunk
  // metadata). A CHECK can't be ALTERed in SQLite, so a table built before it is rebuilt: renamed
  // aside, recreated with the wider CHECK, its rows copied across, the old one dropped. Detected
  // by sniffing the stored CREATE TABLE text rather than trying an insert and catching the
  // constraint failure.
  const fieldSourceSql = (
    db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'ir_item_field_source'`).get() as
      | { sql: string }
      | undefined
  )?.sql
  if (fieldSourceSql && !fieldSourceSql.includes('ir_lab_embedded')) {
    db.exec(`
      ALTER TABLE ir_item_field_source RENAME TO ir_item_field_source_old;
      CREATE TABLE ir_item_field_source (
        item_id  TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
        field    TEXT NOT NULL,
        source   TEXT NOT NULL CHECK (source IN (
                    'ir_lab_native', 'ir_lab_embedded', 'vendor_documentation', 'vendor_parser',
                    'filename_inferred', 'user_entered')),
        PRIMARY KEY (item_id, field)
      );
      INSERT INTO ir_item_field_source SELECT * FROM ir_item_field_source_old;
      DROP TABLE ir_item_field_source_old;
    `)
  }

  // nam_capture_item's pre-training columns (namCaptureEnrichment.ts / IR Lab NAM Capture import,
  // docs/nam-capture-import-plan-2026-08-29.md §2). Added per-column so a DB that already has
  // some of them isn't an error — same discipline as the ir_item block above.
  const namCaptureColumns = db.prepare(`PRAGMA table_info(nam_capture_item)`).all() as Array<{ name: string }>
  if (namCaptureColumns.length > 0) {
    const have = new Set(namCaptureColumns.map((c) => c.name))
    for (const [name, type] of [
      ['capture_id', 'TEXT'],
      ['capture_name', 'TEXT'],
      ['project_id', 'TEXT'],
      ['capture_scope', 'TEXT'],
      ['sample_rate', 'REAL'],
      ['measured_latency_samples', 'INTEGER'],
      ['synthetic', 'INTEGER'],
      ['synthetic_source_ir_name', 'TEXT'],
      ['created_at', 'TEXT'],
      ['excitation_path', 'TEXT'],
      ['recording_path', 'TEXT']
    ] as const) {
      if (!have.has(name)) db.exec(`ALTER TABLE nam_capture_item ADD COLUMN ${name} ${type}`)
    }
  }

  // collection.kind's CHECK predates 'nam_project' (IR Lab NAM Capture projects — plan §2). A
  // CHECK can't be ALTERed in SQLite, so a table built before it is rebuilt: renamed aside,
  // recreated with the widened CHECK, rows copied across (ids preserved, so every inbound FK
  // stays valid), the old one dropped. foreign_keys is toggled off for the swap so the rename
  // doesn't cascade into collection_item/checklist_item/etc. Detected by sniffing the stored
  // CREATE TABLE text, same technique as the ir_item_field_source rebuild above.
  const collectionSql = (
    db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'collection'`).get() as
      | { sql: string }
      | undefined
  )?.sql
  if (collectionSql && !collectionSql.includes('nam_project')) {
    const newBody = collectionSql
      .slice(collectionSql.indexOf('(') + 1, collectionSql.lastIndexOf(')'))
      .replace(
        `CHECK (kind IN ('ir_project', 'nam_pack', 'nam_bundle', 'release', 'tray'))`,
        `CHECK (kind IN ('ir_project', 'nam_project', 'nam_pack', 'nam_bundle', 'release', 'tray'))`
      )
    const oldCols = (db.prepare(`PRAGMA table_info(collection)`).all() as Array<{ name: string }>)
      .map((c) => c.name)
      .join(', ')
    // No explicit BEGIN — runMigrations is called outside any transaction (getDb / the tests),
    // and the other rebuilds in this function are bare db.exec too. foreign_keys OFF stops the
    // RENAME from cascading into collection_item / checklist_item / delivery_* / asset_file;
    // ids are copied unchanged so every one of those inbound references still resolves after.
    db.exec('PRAGMA foreign_keys = OFF')
    db.exec(`
      ALTER TABLE collection RENAME TO collection_old;
      CREATE TABLE collection (${newBody});
      INSERT INTO collection (${oldCols}) SELECT ${oldCols} FROM collection_old;
      DROP TABLE collection_old;
    `)
    db.exec('PRAGMA foreign_keys = ON')
  }
}

/** Only the tables and the UNIQUE constraints bulk import's ON CONFLICT upserts depend on. */
export function createCoreSchema(db: DatabaseSync): void {
  db.exec(CORE_SCHEMA_SQL)
  runMigrations(db)
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
  // `audio` is copied straight from ir_item.audio_search, which importLibrary rendered in
  // TypeScript (wavHeader.ts's wavSearchText). An earlier version assembled that string in SQL
  // here instead and got it subtly wrong — SQLite's integer division produced "96.0k" for 96000,
  // which FTS5 tokenizes as `96` + `0k`, so searching "96k" matched nothing. Caught by this
  // feature's own end-to-end test before it shipped.
  // cabinet/speaker fall back to the owning ir_project collection's own value when the capture's
  // own field is blank (2026-08-26 metadata model — a project-level cabinet/speaker, entered once,
  // is meant to make every capture in that project searchable by it, not just ones that repeated
  // it verbatim). amplifier/room have no per-capture field at all, so they're straight from the
  // collection. proj is a correlated subquery rather than a JOIN so an item that somehow belonged
  // to more than one collection can't fan out into duplicate item_search rows.
  db.exec(`
    INSERT INTO item_search (
      item_id, display_name, notes, manufacturer, cabinet, speaker, microphone, audio,
      speaker_position, modeled_microphone, preset_kind, amplifier, room
    )
    SELECT item.id, item.display_name, item.notes,
           ir_item.manufacturer,
           COALESCE(ir_item.cabinet, proj.cabinet),
           COALESCE(ir_item.speaker, proj.speaker),
           ir_item.microphone,
           ir_item.audio_search,
           ir_item.speaker_position, ir_item.modeled_microphone, ir_item.preset_kind,
           proj.amplifier, proj.room
    FROM item
    LEFT JOIN ir_item ON ir_item.item_id = item.id
    LEFT JOIN (
      -- GROUP BY guards against an item somehow belonging to more than one ir_project collection
      -- (not something enrichLabProjects itself would ever do, but not schema-enforced either) --
      -- without it, a fan-out here would duplicate that item's item_search row.
      SELECT collection_item.item_id as item_id, MAX(collection.cabinet) as cabinet,
             MAX(collection.speaker) as speaker, MAX(collection.amplifier) as amplifier,
             MAX(collection.room) as room
      FROM collection_item JOIN collection ON collection.id = collection_item.collection_id
      WHERE collection.kind = 'ir_project'
      GROUP BY collection_item.item_id
    ) proj ON proj.item_id = item.id
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
