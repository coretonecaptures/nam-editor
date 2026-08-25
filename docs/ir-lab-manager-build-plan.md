# IR Lab Manager — build plan

Supersedes `docs/ir-lab-manager-shared-catalog-schema.md` (kept for history; this
doc is the authoritative one going forward). This same file lives in both
`ir-lab` and `nam-editor`, since the two repos build different halves of one
system.

**Revision history.** Written 2026-08-24. Revised the same day after a design
review surfaced a cross-app database coupling problem (section 0/2) plus
several underspecified pieces (folder inheritance cost, reconciliation, FTS5
bulk-load overhead, hash-queue strategy). Revised again after a review that
checked the plan **against the actual `nam-editor` codebase** rather than on
its own terms, which changed several load-bearing assumptions:

- A production IR indexer for this exact scale **already ships** in
  `src/main/index.ts` — the original Phase 1 was aimed at a risk that was
  already retired. See section 2a and the rewritten section 13.
- SQLite needs **no new dependency and no packaging change**: `node:sqlite`
  with FTS5 and WAL is built into the Electron version this app already uses.
  Verified, not assumed — see section 2b.
- The stated FTS5 bulk-load mechanism did not do what it claimed (section 2c).
- Folder-metadata inheritance was ambiguous between snapshot-at-ingest and
  resolve-at-query in a way that reintroduced the O(items) cost it was meant
  to remove; now decided (section 2d).
- A favourites system already exists and the plan silently replaced it;
  now has a migration (section 2e).

Planning only — nothing here has been implemented.

## 0. Repo split — who builds what

| Repo | Visibility | Builds |
|---|---|---|
| `nam-editor` | Public, MIT | The NAM/IR mode-switcher shell, the entire IR Lab Manager catalog/scan/audition/search/parser stack, the tray UI. **Sole owner and sole writer of `catalog.db`** — see section 2's revised design principles. Everything in sections 2-9 below. |
| `ir-lab` (this repo) | Private | The receiving side of the IR Lab handoff only: URL-scheme registration, single-instance forwarding, wiring an incoming request into the existing `reopenSession()`/Blender-slot-population code. **Never opens `catalog.db`, in either direction, ever** — it has no schema dependency on IR Lab Manager at all. Section 10 below. Already private — no new repo needed for this half. |
| (small private config, injected at `nam-editor` build time) | Private | Just the exact URL-scheme name and payload field names/shape. Everything *around* that stays public — the extension point, the "send this JSON to this configured scheme" mechanism, the tray UI — only the specific values are private, so `nam-editor` built from its public source alone works fully, minus "Send to IR Lab" silently no-opping without the private config. |

No third repo. The private half of the connector is small enough to be a
build-time-injected constants file, not a separate codebase.

**Branch strategy.** `nam-editor` is close to putting out a release; this is
a massive, multi-phase addition and must not land on `main` mid-release-prep.
All of this work happens on a dedicated feature branch (e.g.
`feature/ir-lab-manager`) in `nam-editor`, kept separate from whatever ships
next. Do not merge to `main` until the phases in section 11 are complete
through at least Phase 4, and only after an explicit go-ahead — this is not
a fast-follow patch, it's a parallel track. The `ir-lab` side (section 10) is
lower-risk to its own repo's release posture (additive, new URL-scheme
handling, doesn't touch existing capture/audition paths) but should still
land on its own feature branch for the same review-before-merge discipline.

## 1. Product definition

> A free, opt-in-import, audition-first catalog and organizer for impulse
> responses — your own IR Lab captures and third-party/commercial libraries
> alike — built as a second top-level mode inside NAM Lab, sharing its shell
> but not its domain code. Not a file browser. Not an exhaustive scanner of
> everything on disk. The job is: find a handful of IRs fast, hear them
> without leaving the app, and send a short list straight into IR Lab's
> Blender.

Non-goals for v1: acoustic/fingerprint similarity search, non-WAV formats
(`.kipr`/`.syx`/`.wir`), exhaustive eager cataloging of an entire drive.

## 2. Data model

SQLite, WAL mode. One catalog file, `catalog.db`, owned, located, and
**exclusively written by** IR Lab Manager's Electron main process — one
process, one connection. IR Lab is never a writer, and never even opens this
file; see section 4's ingestion model for how IR-Lab-native content gets in.

```sql
PRAGMA journal_mode = WAL;

-- ---- Roots & folders --------------------------------------------------

CREATE TABLE library_root (
  id          INTEGER PRIMARY KEY,
  path        TEXT NOT NULL UNIQUE,
  label       TEXT,
  -- 'manual': scan on demand / on a schedule. 'watched': also react to
  -- filesystem-change events (chokidar), for a "finished exports" root you
  -- want picked up automatically -- see section 4's IR Lab watch case.
  watch_mode  TEXT NOT NULL DEFAULT 'manual' CHECK (watch_mode IN ('manual', 'watched')),
  created_at  TEXT NOT NULL
);

-- One row per unique folder encountered under a root, whether or not the
-- user has ever touched it -- created lazily by the scanner, top-down, the
-- first time an item is found inside it (or a parent needs to exist for one
-- that was). parent_id is a real edge, not a derived path-prefix -- ancestor
-- walks for inheritance (section 4) need to be O(folder depth) via a join,
-- not a per-item string-prefix scan, since a real vendor pack has hundreds
-- of folders but hundreds of thousands of items.
CREATE TABLE folder (
  id               INTEGER PRIMARY KEY,
  library_root_id  INTEGER NOT NULL REFERENCES library_root(id),
  parent_id        INTEGER REFERENCES folder(id),
  relative_path    TEXT NOT NULL,       -- '' for the root itself
  notes            TEXT,
  UNIQUE (library_root_id, relative_path)
);
CREATE INDEX idx_folder_parent ON folder(parent_id);

-- Facts a folder declares for everything under it -- e.g. "this whole
-- OwnHammer pack folder is a Marshall 412". One row per (folder, field); a
-- child folder's own row for the same field overrides an ancestor's.
CREATE TABLE folder_metadata (
  folder_id  INTEGER NOT NULL REFERENCES folder(id) ON DELETE CASCADE,
  field      TEXT NOT NULL,             -- 'manufacturer' | 'cabinet' | 'speaker' | ...
  value      TEXT NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('vendor_documentation', 'user_entered', 'ir_lab_native')),
  PRIMARY KEY (folder_id, field)
);

-- Resolved-and-cached inheritance result for a folder: the effective value
-- of each field after walking parent_id to the root, nearest ancestor wins.
-- Computed ONCE per folder, on folder creation and whenever that folder's
-- OR any ancestor's folder_metadata changes -- never recomputed per item.
-- An item just reads its own folder_id's row here directly (O(1)) instead
-- of walking anything at ingest time. Folders number in the hundreds even
-- under a 226K-file pack, so this cache is cheap to keep warm.
CREATE TABLE folder_metadata_effective (
  folder_id  INTEGER NOT NULL REFERENCES folder(id) ON DELETE CASCADE,
  field      TEXT NOT NULL,
  value      TEXT NOT NULL,
  source     TEXT NOT NULL,
  PRIMARY KEY (folder_id, field)
);

-- Imported vendor info sheets (PDF/TXT/CSV), linked permanently to the
-- folder they describe. The file itself is copied into IR Lab Manager's own
-- app-support storage (not left depending on the vendor's folder staying
-- put) -- this is the one place IR Lab Manager DOES own a copy of a file,
-- because it's documentation about the library, not the audio content itself.
CREATE TABLE folder_document (
  id                 INTEGER PRIMARY KEY,
  folder_id          INTEGER NOT NULL REFERENCES folder(id) ON DELETE CASCADE,
  stored_path        TEXT NOT NULL,     -- inside IR Lab Manager's own storage
  original_filename  TEXT,
  imported_at        TEXT NOT NULL
);

-- ---- Items --------------------------------------------------------------

-- Polymorphic core row: one NAM file OR one IR (yours or a vendor's).
CREATE TABLE item (
  id               TEXT PRIMARY KEY,    -- UUID, assigned once, never derived from path
  kind             TEXT NOT NULL CHECK (kind IN ('nam_capture', 'ir')),
  library_root_id  INTEGER NOT NULL REFERENCES library_root(id),
  folder_id        INTEGER REFERENCES folder(id),
  relative_path    TEXT NOT NULL,
  display_name     TEXT NOT NULL,
  created_at       TEXT,
  modified_at      TEXT,
  indexed_at       TEXT NOT NULL,
  last_seen_at     TEXT NOT NULL,
  missing_since    TEXT,                -- NULL while resolvable
  file_size        INTEGER,             -- read at scan time, free; also gates reconciliation tier 2 (section 5)
  quick_hash       TEXT,                -- size + first/last 64KB, computed inline at scan time; see section 4
  content_hash     TEXT,                -- full-file hash, background queue, NULL until reached; see section 4
  rating           INTEGER,             -- 1-5, independent of...
  is_favorite      INTEGER NOT NULL DEFAULT 0,  -- ...this: a binary flag, different concept
  notes            TEXT,
  UNIQUE (library_root_id, relative_path)
);
CREATE INDEX idx_item_kind       ON item(kind);
CREATE INDEX idx_item_folder     ON item(folder_id);
CREATE INDEX idx_item_missing    ON item(missing_since) WHERE missing_since IS NOT NULL;
CREATE INDEX idx_item_quickhash  ON item(quick_hash) WHERE quick_hash IS NOT NULL;
CREATE INDEX idx_item_hash       ON item(content_hash) WHERE content_hash IS NOT NULL;

CREATE TABLE nam_capture_item (
  item_id           TEXT PRIMARY KEY REFERENCES item(id) ON DELETE CASCADE,
  modeled_by        TEXT, gear_type TEXT, gear_make TEXT, gear_model TEXT,
  tone_type         TEXT, input_level_dbu REAL, output_level_dbu REAL,
  trained_epochs    INTEGER, preset_name TEXT, loudness REAL, gain REAL,
  architecture      TEXT, mics TEXT, cabinet TEXT, cabinet_config TEXT,
  amp_channel       TEXT, boost_pedal TEXT, amp_settings TEXT,
  pedal_settings    TEXT, amp_switches TEXT
  -- nl_comments/nl_about -> item.notes; nl_rating -> item.rating
);

-- Unified IR metadata for BOTH IR-Lab-native and third-party IRs. Origin is
-- a provenance tag (ir_item_field_source below), not a structural fork.
-- is_stereo is read from the WAV's own header channel count at scan time --
-- true for ANY multi-channel file regardless of source, not vendor-specific.
-- is_true_stereo is IR Lab's own 4-channel LL/LR/RL/RR matrix convention;
-- no third-party vendor uses it, so it is only ever set true when read from
-- an IR-Lab-native analysis.json, and stays NULL/false for every vendor item.
CREATE TABLE ir_item (
  item_id         TEXT PRIMARY KEY REFERENCES item(id) ON DELETE CASCADE,
  capture_id      TEXT UNIQUE,          -- IR Lab's own captureId, read from analysis.json; NULL for third-party
  manufacturer    TEXT,
  cabinet         TEXT,
  speaker         TEXT,
  microphone      TEXT,
  position        TEXT,
  capture_type    TEXT,                 -- "Hardware" / "Software", IR-Lab-native only
  sample_rate     REAL,
  is_reverb       INTEGER,
  is_stereo       INTEGER,
  is_true_stereo  INTEGER
);

-- Per-field confidence/provenance for ir_item's descriptive columns. The
-- ladder, highest confidence first: ir_lab_native (read from IR Lab's own
-- analysis.json, by IR Lab Manager's scanner -- IR Lab itself never writes
-- here) > vendor_documentation (an imported info sheet) > vendor_parser (a
-- structural recognizer, e.g. the Ownhammer path shape) > filename_inferred
-- (generic gear-vocabulary token match) > user_entered (hand-typed, trusted
-- absolutely once set). A field with no row here has no known source --
-- blank, not guessed.
CREATE TABLE ir_item_field_source (
  item_id  TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  field    TEXT NOT NULL,
  source   TEXT NOT NULL CHECK (source IN (
              'ir_lab_native', 'vendor_documentation', 'vendor_parser',
              'filename_inferred', 'user_entered')),
  PRIMARY KEY (item_id, field)
);

-- IR Lab's existing DerivativeVariant concept (src/session/SessionStore.h).
-- Populated by IR Lab Manager's scanner parsing an IR-Lab-native session's
-- own analysis.json -- IR Lab itself never writes into this table directly.
CREATE TABLE ir_derivative_variant (
  id             TEXT PRIMARY KEY,      -- DerivativeVariant::id, unchanged
  item_id        TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  relative_path  TEXT NOT NULL,
  sample_rate    REAL,
  created_at     TEXT,
  is_current     INTEGER NOT NULL DEFAULT 0,
  is_archived    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_variant_item ON ir_derivative_variant(item_id);

-- ---- Organization --------------------------------------------------------

-- Generalizes IR Lab's Project, NAM Lab's Pack, NAM Lab's Bundle, and a
-- future release/device-group concept.
CREATE TABLE collection (
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

-- Membership, ID-keyed, never path-keyed.
CREATE TABLE collection_item (
  collection_id     TEXT NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
  item_id           TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  output_file_name  TEXT,
  included          INTEGER NOT NULL DEFAULT 1,
  override_name     TEXT,
  position          INTEGER,            -- also doubles as the tray's slot order (0-7)
  PRIMARY KEY (collection_id, item_id)
);

CREATE TABLE tag (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE
);
CREATE TABLE item_tag (
  item_id  TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);

CREATE TABLE checklist_item (
  id              TEXT PRIMARY KEY,
  collection_id   TEXT NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
  target_key      TEXT,
  label           TEXT NOT NULL,
  completed       INTEGER NOT NULL DEFAULT 0,
  completed_date  TEXT,
  notes           TEXT,
  position        INTEGER
);

CREATE TABLE delivery_target (
  id             TEXT PRIMARY KEY,
  collection_id  TEXT NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
  target_key     TEXT NOT NULL,
  label TEXT, title TEXT, subtitle TEXT, description TEXT,
  target_date TEXT, live_date TEXT,
  UNIQUE (collection_id, target_key)
);

CREATE TABLE delivery_matrix_row (
  id                   TEXT PRIMARY KEY,
  collection_id        TEXT NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
  item_id              TEXT REFERENCES item(id),
  captured_name_hint   TEXT,
  include_targets      TEXT NOT NULL DEFAULT '[]',  -- JSON array of target_key
  alt_names            TEXT,             -- JSON object: target_key -> override name
  position             INTEGER
);

-- Cover images, waveform-thumbnail cache pointers -- owner is exactly one
-- of item / collection / folder.
CREATE TABLE asset_file (
  id             INTEGER PRIMARY KEY,
  item_id        TEXT REFERENCES item(id) ON DELETE CASCADE,
  collection_id  TEXT REFERENCES collection(id) ON DELETE CASCADE,
  folder_id      INTEGER REFERENCES folder(id) ON DELETE CASCADE,
  role           TEXT NOT NULL,          -- 'cover_photo' | 'waveform_thumbnail' | ...
  relative_path  TEXT,                   -- a real file inside a library root
  cache_path     TEXT,                   -- a generated, disposable cache file
  source_mtime   TEXT,
  CHECK ((item_id IS NOT NULL) + (collection_id IS NOT NULL) + (folder_id IS NOT NULL) = 1)
);
CREATE INDEX idx_asset_item       ON asset_file(item_id);
CREATE INDEX idx_asset_collection ON asset_file(collection_id);
CREATE INDEX idx_asset_folder     ON asset_file(folder_id);

-- Populated by triggers on item/nam_capture_item/ir_item insert/update
-- ONLY outside of bulk import. During a batched import, triggers are
-- disabled and rows are inserted directly into item_search inside the same
-- batch transactions instead (see section 2c -- 'rebuild' does NOT work
-- here, since this is a standalone table, not an external-content one).
-- Per-row triggers during a 200K+-row import would triple write volume
-- (three source tables, one search index write each) at exactly the moment
-- throughput is being stress-tested; see section 12 Phase 1, where this
-- gets measured, not assumed.
CREATE VIRTUAL TABLE item_search USING fts5(
  item_id UNINDEXED,
  display_name, notes, manufacturer, cabinet, speaker, microphone,
  mics, tone_type, gear_make, gear_model
);
```

**Design principles:** files stay on disk, the DB never holds audio; identity
is a UUID, never a path; **`catalog.db` has exactly one writer, ever — IR Lab
Manager's own main process.** IR Lab is not a second writer and is never
opened as a database at all by IR Lab; it only ever produces plain files
(`analysis.json` and the WAVs themselves) that IR Lab Manager's scanner reads
like any other library content. This removes, rather than manages, the
schema-version-skew, concurrent-writer, and cross-app-sandbox-path questions
a shared-write design would otherwise require answering. The DB is
authoritative for IR Lab Manager's own data, disposable and rebuildable by
rescan, never the only copy of anything.

## 2a. There is already a production traversal/index for this exact scale

`src/main/index.ts` (~line 6332, "Cabinet IR index") already walks and indexes
IR libraries at the scale this plan targets, and its own comments carry real
measurements against your library:

- Recursive walk (not the 2-level `scanWavLibrary`, which "reached 198 of
  492,718 files" on a real vendor library) — symlink-cycle guarded via
  `realpath` + a `seen` set, skips `__MACOSX`/dotfiles/`._` resource forks.
- **492,718 files**, indexed as one concatenated UTF-8 byte buffer plus a
  `Uint32Array` offset table. The obvious shape — one JS object per entry with
  `{name, path, rel, haystack}` string fields — was tried and **measured at
  443MB of heap** on that library; that's why it isn't objects.
- AND-of-substrings search across whitespace-separated tokens, filename-match
  outranks folder-match, monotonic result-narrowing cache (a longer query
  reuses the previous query's matches instead of rescanning), byte-level
  case-insensitive substring search with no per-search lowercase copy.
- Shipping end to end: IPC (`player:indexIrLibrary`, `player:searchIrLibrary`,
  `player:browseIrLibrary`) → preload → `IrPicker.tsx` (493 lines), used today
  by the Cab/Delay/Reverb IR pickers.

This means the traversal risk the original Phase 1 was written to de-risk is
already retired in production. What is genuinely unproven — and what the
revised Phase 1 (section 13) now targets instead — is the half this index
doesn't do at all: **persisting** ~500K rows in SQLite and querying them
through FTS5 + facets at interactive speed. The 443MB datapoint above is a
warning about that, not reassurance: naive per-row overhead bites in SQLite
too if row/column choices are careless, even though SQLite's on-disk B-tree
storage doesn't carry V8's per-string object header cost.

**Open decision, must be made before Phase 1 code:** does `catalog.db`
*replace* the in-memory `IrIndex` for the pickers (one index to maintain,
`IrPicker.tsx` re-pointed at `irLibrary:query`), or do the two coexist
(catalog for the new IR mode, existing index left alone for the pickers)?
Coexistence means two independent full traversals of the same half-million
files living in the same process — the worst outcome — so the default
assumption going in is **replace**, with `IrPicker.tsx`'s existing UX and
ranking behavior preserved by having `irLibrary:query` implement equivalent
ranking, not by keeping the byte-index around as a second source of truth.

## 2b. Storage engine: `node:sqlite`, not `better-sqlite3` — no new native dependency

Checked, not assumed, against this app's actual Electron build:

```
NODE 24.18.0  ELECTRON 41.10.3
node:sqlite AVAILABLE -> DatabaseSync, StatementSync, Session, constants, backup
SQLITE 3.53.1
FTS5 OK
WAL OK
```

Every runtime dependency this app ships today is pure JS — there are no
native modules anywhere in the current dependency tree. CI builds a
`--universal` (arm64+x64 merged) macOS DMG under `hardenedRuntime: true` with
notarization (`.github/workflows/release.yml`). Introducing `better-sqlite3`
would mean per-architecture native binaries inside that universal merge,
individually signed under hardened runtime, plus `electron-rebuild` in local
dev, plus a new failure surface across all three CI platforms — at v1.0.0,
for a feature this large.

`node:sqlite` is built into the Node version Electron 41 embeds, includes
FTS5 and WAL as verified above, and requires zero new dependencies or
packaging changes. **This is the default storage engine for the whole plan.**
`better-sqlite3` is not adopted unless Phase 1 (section 13) measures a
concrete need `node:sqlite` can't meet — none is anticipated, but it's a
fallback, not a coin flip.

**Dev-environment caveat, found building Phase 1's harness:** FTS5 support is
not guaranteed by `node:sqlite` generally — it depends on how that particular
Node build's SQLite amalgamation was compiled. Electron 41.10.3's embedded
build has it (SQLite 3.53.1, verified above). The plain Node.js this repo's
own `devDependencies.electron`-adjacent tooling runs under for `vitest`
(Node 22.13.0, SQLite 3.47.2) does **not** compile FTS5 in — `CREATE VIRTUAL
TABLE ... USING fts5(...)` fails there with `no such module: fts5`. This
doesn't affect production (the catalog only ever runs inside Electron's main
process, per this section's single-writer design), but it means any
standalone script or test touching this schema must run under Electron's own
Node build, not plain `node`/`tsx`/default `vitest`. The fix used throughout
this codebase from here on: `ELECTRON_RUN_AS_NODE=1` runs a plain script
under Electron's Node/V8/SQLite without opening an app window — see
`scripts/test-electron.js` (`npm run test:electron`) and the usage comment at
the top of `src/main/irCatalog/benchmark.ts`. FTS5-dependent specs
self-detect this (`src/main/irCatalog/sqliteCapabilities.ts`) and skip with a
pointer to `test:electron` rather than failing `npm test` for everyone.

## 2c. FTS5 bulk-load correction

The original text called `INSERT INTO item_search(item_search) VALUES('rebuild')`
the bulk-load path. That doesn't work as described: `rebuild` re-derives an
FTS5 index from a linked table's *content* (an `external content` table) — it
has nothing to rebuild *from* when `item_search` is a standalone table sourced
by triggers from three separate tables, which is what section 2's schema
declares. `rebuild` after the fact re-indexes rows already inserted; it does
not populate them.

Actual bulk-load approach: keep the standalone `item_search` table, **disable
its triggers during batched import**, insert directly into `item_search`
inside the same 2,000–5,000-row transactions as `item`/`nam_capture_item`/
`ir_item`, then re-enable triggers for live single-item edits afterward. This
is one extra insert per batch, not a magic rebuild — Phase 1 measures its
actual cost (section 13).

## 2d. Folder-metadata inheritance: resolve-at-query, not snapshot-at-ingest

`folder_metadata_effective` fixed the *cost* of inheritance (O(folders), not
O(items)) but left the *semantics* ambiguous: does an item's row in `ir_item`
get inherited values copied in at ingest time, or does a query join out to
`folder_metadata_effective` live? Copy-at-ingest silently reintroduces the
O(items) problem through the back door — a user tagging a vendor pack's
folder *after* import (the single most common real workflow: import first,
label the pack once, in bulk) would require rewriting every item row under
that folder to pick up the new value.

**Decision: resolve-at-query.** `ir_item`/`nam_capture_item` never store
inherited values. A query that needs a field checks its own row first
(non-null wins — this is where `user_entered`/`vendor_parser`/etc. at the
item level already live), and only falls back to a join against
`folder_metadata_effective` on `item.folder_id` when the item-level field is
null. `folder_metadata_effective` being pre-resolved per folder (section 2,
already fixed) is what keeps this join O(1) per row instead of a walk.

Cascade invalidation, previously unstated: when a folder's own
`folder_metadata` changes, `folder_metadata_effective` must be recomputed for
that folder **and every descendant** (a folder's effective value can override
what it inherits, but only for fields it doesn't declare itself — a
descendant with no override needs its cache refreshed too). This is a
recursive walk over `folder.parent_id` scoped to the changed folder's subtree
— cheap at folder-count scale (hundreds, even under a 226K-file pack), same
reasoning as the original per-folder fix, just applied on write instead of
assumed to be a single row.

## 2e. Existing favourites/recents system — migrate, don't orphan

`src/renderer/src/utils/irLibrary.ts` already implements favourites and
recents for the Cab/Delay/Reverb IR pickers, in `localStorage`, keyed by
**absolute path**, namespaced per picker `kind`. It already carries a
one-time migration (`migrateLegacyOnce`) from an earlier bug where all three
pickers shared one unnamespaced list. The original plan's `item.is_favorite`
/ `item.rating` columns, keyed by UUID, would silently strand every favourite
a user has already set — either a duplicate, disconnected favourites system
per picker, or (worse) an apparent data loss on upgrade.

**Decision:** on first scan of a library root, for each `localStorage` entry
under `nam-player-ir-favorites-{kind}` / `nam-player-ir-recents-{kind}` whose
`path` resolves to an indexed `item.relative_path` under that root, set
`item.is_favorite = 1` (favourites) and seed `last_seen_at`-adjacent recency
(recents) on the matching row, then leave the `localStorage` keys in place
(read-only, unmigrated-away) rather than deleting them — the existing Cab/
Delay/Reverb pickers keep working unchanged against `localStorage` either way,
since they aren't being rewritten to read from `catalog.db` in this plan.
This is one-directional (localStorage → catalog) and per-root, run once per
root at first scan, not a live sync.

## 3. Confidence ladder (drives both ingestion and the UI)

Highest to lowest, per field, per item:

1. `ir_lab_native` — read by IR Lab Manager's scanner directly from IR Lab's own `analysis.json`
2. `vendor_documentation` — from an imported, folder-linked info sheet
3. `vendor_parser` — a structural recognizer matched the path shape (Ownhammer, RedWirez)
4. `filename_inferred` — a known-gear-term dictionary matched a token in the filename/path
5. `user_entered` — hand-typed; always wins, never gets overwritten by a rescan

The UI shows this per field (a small badge, not a modal) so a parsed guess is
never presented as fact. A user edit on any field always sets `user_entered`
and is permanent until the user changes it again — rescans never clobber it.

## 4. Ingestion

- **Opt-in only.** Adding a `library_root` is an explicit action ("Add a folder to your library"). No unprompted scanning of `~/Documents` or anywhere else.
- **Multi-root, no canonical parent.** Any number of `library_root` rows, each independent — the Plex model. A root can be a whole vendor library (`Impulse Responses/Ownhammer`) or a narrow "just my finished exports" folder.
- **IR Lab's own root(s) are `watch_mode = 'watched'`**, pointed at finished-output locations only (a Project's `outputRoot`, "Named Exports") — never IR Lab's internal `.SessionData`/staging tree. IR Lab Manager's scanner treats a discovered session exactly like any other WAV, then additionally reads its neighboring `analysis.json` (when present) to populate `ir_item`/`ir_derivative_variant` at `ir_lab_native` confidence. **IR Lab never writes any of this itself** — see section 2's revised design principles.
- **Scanner is batched and resumable.** Transactions of ~2,000-5,000 rows, progress reported to the UI, cancelable mid-scan. FTS5 triggers are disabled for the duration; `item_search` rows are inserted directly inside the same batch transactions instead (section 2c), not rebuilt afterward. This is non-negotiable at the scale a real vendor pack represents (Ownhammer alone: 226K files in one import) — validate this in isolation before any UI work (see Phase 1, section 12, below).
- **Folder metadata inheritance resolves once per folder, not per item — and at query time, not ingest time.** When a folder's own `folder_metadata` changes (or a new folder is created), recompute `folder_metadata_effective` for that folder **and its whole descendant subtree** by walking `parent_id` (nearest ancestor wins) — a cheap operation at folder-count scale (hundreds, even under a huge pack). Items never store inherited values (section 2d) — a query falls back from its own row to a join against its `folder_id`'s already-resolved `folder_metadata_effective` row; no per-item ancestor walk, ever, and no per-item rewrite when a folder gets tagged after import.
- **Two-tier hashing: cheap at scan time, expensive in the background.** `file_size` and `quick_hash` (size + a hash of the first and last 64KB — enough to distinguish files without reading the whole thing) are computed **inline during the scan itself**; this is a handful of small reads per file, not the hundreds of GB a full-content hash of a 500K-file library would mean, and it's what makes reconciliation tier 2 (section 5) precise instead of a coincidence-of-size guess. `content_hash` (full-file) is the expensive one and stays a background job, queued after `quick_hash` narrows candidates, explicitly allowed to lag behind a huge import indefinitely — nothing in browse, search, or audition depends on it being complete, only exact-duplicate detection and the highest-confidence relink tier do (see reconciliation below). Show a plain progress counter ("342,000 / 495,000 fully hashed"), not a completion promise. Runs on a background worker pool in the main process, following the existing `scanRenderPool.ts` pattern (renderer-side today, for render-ahead audio work) as a model to imitate — not code to import as-is, since this pool does main-process file I/O, not renderer audio rendering.

## 5. Reconciliation & move detection

- A scan that can't resolve a previously-indexed `relative_path` sets `missing_since`; the row is never deleted.
- A scan that finds a file it hasn't indexed before, before creating a new `item` row, checks it against currently-missing items in this order:
  1. **Exact `content_hash` match** (only possible once the background hash queue has reached that item) → silently relink: update the existing row's `relative_path`/`folder_id`, clear `missing_since`, keep the same `item.id` — every rating/tag/collection membership survives untouched.
  2. **Exact `quick_hash` match** (size + first/last-64KB hash, computed inline at scan time — available immediately, no queue wait) → silently relink, same as tier 1. A `quick_hash` collision on real audio content is vanishingly unlikely; this is not the weak signal filename+size is.
  3. **Same filename + same file size, different folder, no `quick_hash` match** → surfaced to the user as a suggested relink, never auto-merged. This tier exists for the case a file's bytes actually changed (re-exported, re-rendered) but a human would still recognize it as "the same IR." **Gated on parent-folder-name similarity** (e.g. Jaro-Winkler or a shared-token check against the old and new immediate parent folder names) before surfacing at all — plain filename+size alone is not a usable signal at vendor-pack scale, where thousands of files across a library are named e.g. `SM57.wav` at byte-identical sizes (same sample rate, same length) with no relationship to each other. Without this gate, tier 3 is a flood of meaningless suggestions, not a feature.
  4. **No match** → genuinely new item; the old row stays `missing_since`-flagged, waiting for the bulk reconcile/repair UI (Lightroom-style "N items missing, relink or remove?") already scoped for later.
- Two apps running at once was a real question worth asking, and the answer falls out of section 2's single-writer fix: there is no shared write target anymore. IR Lab writing its own `analysis.json` while IR Lab Manager's watcher independently notices and re-scans that one file is the only interaction between the two processes, and IR Lab already writes that file, not IR Lab Manager.

## 6. Vendor parsers

Pluggable, not hardcoded into scan logic. Interface shape:

```ts
interface VendorParser {
  id: string                          // 'ownhammer', 'redwirez', ...
  // Cheap check: does this folder's shape look like this vendor's convention?
  recognizes(folderPath: string, siblingFiles: string[]): boolean
  // Extract facts for one file, given the recognized folder context.
  parse(filePath: string, folderPath: string): Partial<IrFields>
}
```

Build order, by measured payoff (Ownhammer + RedWirez = 87% of a real large
library by file count):

1. **Ownhammer** — `Pack/{SampleRate}/{Cab}/{MicOrBlend}.wav`
2. **RedWirez** — `Family/{Cab • Speaker}/{BoxSize}/{Rate-Depth}/{Combo}/{Mic+Preamp}/{name}.wav` (note: defunct vendor, but a large installed back-catalog — worth building for exactly that reason, no future updates to track)
3. **Generic filename-vocabulary fallback** — not vendor-specific at all. A dictionary of known terms (mic model numbers: 57/58/121/421/441/906/414; speaker names: Greenback/V30/G12H/G12M; cabinet brands: Marshall/Mesa/Orange/Bogner/ENGL/...) matched as whole tokens against any filename or path segment, regardless of recognized vendor. This is what handles `Marshall Handwired Greenback G12 SM57.wav` with zero vendor-specific code. Ship this one early — it's the parser that covers everything the structural ones don't.

Users should eventually be able to add their own vocabulary terms (extends
the same dictionary the generic fallback matches against) — not a v1
requirement, but the dictionary should be a plain data file from day one so
this is additive later, not a rewrite.

## 7. Search

- SQLite FTS5 (`item_search`, defined above) for text search across name/notes/all descriptive fields.
- Faceted filtering as a secondary, click-to-narrow UI layer on top of the same indexed columns (not raw LIKE scans) — cabinet/speaker/mic/manufacturer as clickable chips.
- Every result row shows its confidence tier inline (small dot/badge per matched field), per section 3.

## 8. Audition

Two modes only — no third "audition a big batch automatically" mode; see the
ear-fatigue reasoning already agreed on.

**Quick audition** — adapted from NAM Lab's existing engine, not built new:
- Port `useAudition.ts`'s render-ahead pool, bounded clip cache (currently 64 clips / 5s each), and the generation-counter fix for overlapping playback.
- Port `audioGraph.ts`'s `applyCabinetIr()` as the actual convolution step.
- Drop the NAM WASM model worklet entirely — this workflow is DI → `ConvolverNode` against the selected IR → out. Strictly simpler than what's already shipped and running for NAM captures.
- Bind to arrow-key navigation through the current filtered result list, plus click.

**A/B** — hold exactly two candidates, instant toggle between them, no queue beyond two. This is the one "compare" primitive worth building; anything beyond it fights the same fatigue problem a full batch-audition feature would.

## 9. The tray → Send to IR Lab

- A `collection` row with `kind = 'tray'`, max 8 `collection_item` rows (matches `LiveAuditionEngine::blendPreviewSlotCount = 8` in `ir-lab/src/audio/LiveAuditionEngine.h:340` exactly — not an arbitrary UI limit).
- Add/remove from the tray is a deliberate action, not a side effect of auditioning — auditioning and collecting are two different verbs.
- "Send to IR Lab" is the only place the private connector code runs (public side): build the payload (tray's ordered item paths + display names — plain paths, resolved read-only from the catalog at the moment of sending, not a DB handle passed anywhere), then call the injected, build-time-private `sendToIrLab(payload)` function. In a self-built (non-official) `nam-editor` build with no private config injected, this function is a documented no-op — the button can even be visible, it just explains "not available in this build."

## 10. UI shell — NAM Lab mode switcher

- Top-level mode switch: **NAM** | **IR**, persisted per-window like any other view preference.
- IR mode is its own route tree, its own top-level state slice, its own components directory (e.g. `src/renderer/src/components/ir/`) — touches existing NAM screens for exactly one thing: the crossover hook (audition an IR against whatever NAM capture is currently open in NAM mode), which should be a narrow, explicit prop/event, not a shared global store.
- New IPC channels needed in `src/main/index.ts` (additive to the existing list in `nam-editor/CLAUDE.md`): `irLibrary:addRoot`, `irLibrary:scan` (progress-reporting, cancelable), `irLibrary:query` (paginated), `irLibrary:updateFolderMetadata`, `irLibrary:importDocument`, `irLibrary:readAudio` (for the audition engine to decode), `irLibrary:sendToIrLab` (wraps the private connector call).

## 11. IR Lab's side (private, built in this repo) — has no database code at all

- Custom URL scheme registration (e.g. `irlab://`), platform handler registration at install time.
- Single-instance enforcement: `moreThanOneInstanceAllowed()` returns false; `anotherInstanceStarted(commandLine)` parses the incoming URL.
- Payload → action mapping. The payload from IR Lab Manager is self-contained (file paths, display names, or a `captureId` IR Lab resolves through its own existing `SessionStore`/`ProjectStore` — never through `catalog.db`, which this app has no knowledge of):
  - `irlab://session/<captureId>` → resolve via `SessionStore`, call the existing `reopenSession()` → `loadSessionIntoReview(..., showWorkbench=true)` path (`MainComponent.cpp:4799`) — no new loading logic.
  - `irlab://blend?items=<path1,path2,...path8>` → resolve each path, populate Blender's library slots (up to the existing 8-slot cap), switch to the Blender workspace.
  - `irlab://project/<projectId>/capture?preset=<name>` → select the project, jump to Capture, pre-apply the preset.
- **Interruption policy**: if a capture or live audition is active when a handoff arrives, confirm before discarding — do not silently interrupt in-progress work.
- Depends on nothing from `nam-editor` except the documented payload shape (which is the one thing that stays private, matching section 0's table) — no shared file, no shared schema, no shared process.

## 12. Phased build order

1. **SQLite persistence + query stress test, standalone, no UI.** The traversal half of this is already proven in production (section 2a) — `buildIrIndex`'s walk already handles a 492,718-file library. Phase 1 does **not** rebuild that; it reuses the same traversal (refactored to a shared function if needed) and feeds it into `node:sqlite` (section 2b) instead of the byte-buffer index, resolving the section 2a open decision (replace vs. coexist — default is replace) as part of doing this. What actually gets measured, against the real ~525K-file `Impulse Responses` folder:
   - Insert throughput in batched transactions (2,000–5,000 rows), including `quick_hash` computed inline per file (section 4).
   - `item_search` FTS5 insert cost per batch with triggers disabled (section 2c's corrected bulk-load approach) vs. the same import with triggers left on — is disabling them worth the added code path, or is the difference noise at this scale?
   - Resulting `catalog.db` file size on disk.
   - Paginated, faceted query latency against the finished catalog (the thing Phase 2 depends on) — not just import speed.
   - Resumability: cancel mid-import, restart, confirm no duplicate/corrupt rows.
   - How far the background `content_hash` queue (section 4) lags behind a huge import, and whether `quick_hash` alone (available immediately) is sufficient for Phase 2/5's needs in the meantime.
   
   This is the one genuinely unproven risk — everything else in this plan is proven-elsewhere or straightforward. Do not proceed past this until it holds up.

   **Results, measured against the real ~525K-file library — initial run did NOT hold up (fix
   below resolved it).**
   The harness (`src/main/irCatalog/`) was built and run for real. Two things it proved cleanly,
   and one it disproved:

   - **Query latency is a non-issue.** Against a partial catalog of 109,343 already-imported
     items: paginated browse 0.4–10.5ms, FTS5 search 0.9–1.2ms, all well under anything a UI
     needs to feel instant. `catalog.db` sized at ~936 bytes/item including the FTS5 index
     (89.0MB + 13.8MB WAL for 109,343 items), projecting to roughly ~480MB for the full library —
     entirely reasonable. This part of the plan is validated and needs no rework.
   - **Import throughput collapses at real scale, and it is not `quick_hash`'s fault.** The first
     ~2,600-file batch ran at ~1,600 items/sec; by 20 minutes in (109,343 of ~525,000 files, ~21%)
     the sustained rate had fallen to ~47–100 items/sec and was still dropping — a run stopped
     early rather than let it continue for a projected 2–3+ hours, since the deceleration itself
     was the more actionable thing to understand, not the wall-clock total. CPU usage over that
     window was ~7% of one core — this is I/O-wait-bound, not hash-compute-bound. Isolating
     `quick_hash`'s own cost on a smaller folder (Choptones, 7,640 files) confirms it: 1,641
     items/sec walking+stat-only vs. 1,344 items/sec with `quick_hash` computed inline — an ~18%
     hit, nowhere near the ~16x collapse seen at full-library scale.
   - **Root cause, not yet fixed:** `importLibrary.ts`'s scan loop does every file's I/O
     (`realpath`, `readdir`, `stat`, `open`, two positional `read`s, `close`) **fully serially,
     one file at a time, with zero concurrency** — nothing pipelines while one file's syscalls are
     in flight. At small/cached scale (Choptones) that's masked by the OS page cache and short
     total runtime. At real scale, real per-syscall latency through the Windows filesystem stack
     — plausibly compounded by realtime antivirus scanning intercepting each newly-opened file —
     pays its full round-trip cost per file with nothing overlapped, and the effect compounds as
     the unique-file working set grows past whatever stays cheap. 7% CPU utilization means there
     is enormous room to parallelize I/O-bound work that today runs with none.

   **Follow-up: root cause isolated to the SQLite write path — no AV exclusion, no user
   security tradeoff needed.** Four things were tried and measured against the real library,
   in order of elimination:

   1. *App-level bounded concurrency* (`mapPool`, concurrency 32, on both `scanWalk.ts`'s
      per-file `stat` and `importLibrary.ts`'s `quick_hash`) — **no meaningful change** against
      `Ownhammer` (282,041 files): same decay shape, ~3,645 items/sec first batch down to
      ~90 items/sec by 293.7s (55,600 files).
   2. *libuv thread pool size* (`fs.promises` calls funnel through a pool that defaults to 4
      threads regardless of app-level concurrency) — raised to 64 with the same code, same
      folder. **No meaningful change** — 288.1s vs. 293.7s, ~2%, noise.
   3. *Windows Defender real-time-scan exclusion* — added `F:\Impulse Responses` to Defender's
      exclusion list and re-ran identical code. **No meaningful change** — 188.9s at 43,855 files
      vs. 178.7-178.9s before, if anything marginally worse. **This rules the AV theory out**, and
      cleanly: it isn't just "the exclusion didn't help," a separate pure-filesystem test (below)
      proves no scanning backlog could exist in the first place. **No AV exclusion is needed or
      recommended to ship this feature** — that would have been an unnecessary security tradeoff
      to ask users to make for a bug that was never in their AV settings.
   4. *Split walk/hash/DB apart entirely, no database involved in the first two:*
      - **Pure walk + `stat`, zero hashing, zero SQLite:** all 282,041 files in **5.9 seconds**,
        sustained ~48,700 items/sec, zero deceleration. The filesystem layer is not the problem,
        at any scale tested.
      - **Walk + `quick_hash`, zero SQLite:** all 282,041 files in **23.6 seconds**, sustained
        ~12,000-15,000 items/sec (a mild, stable dip from an initial ~15,400/s, not a collapse).
        `quick_hash` is not the problem either.

   **Conclusion: the SQLite write path was the bottleneck** — batched inserts across `item`,
   `item_search` (FTS5), and five indexes on `item`, with cost growing as the table reached
   hundreds of thousands of rows. This matched the classic B-tree/index-maintenance-cost pattern
   exactly (a hypothesis worth taking seriously precisely because it's the standard explanation
   for "fast at first, progressively slower" on any SQL engine, this one included). Confirmed
   directly with a fourth isolation test: walk + DB-insert-only (indexes/FTS5 live, no hashing)
   reproduced the identical decay curve (52,658 files at 193.8s, matching the earlier runs almost
   exactly), while pure walk (5.9s/282K files) and walk+hash (23.6s/282K files) stayed fast and
   flat. That fully separated the DB layer as the sole cause.

   **Fix applied and confirmed — Phase 1's throughput question is now RESOLVED, not just
   root-caused.** `schema.ts` now splits `CORE_SCHEMA_SQL` (tables plus only the `UNIQUE`
   constraints bulk import's `ON CONFLICT` upserts require — these can't be deferred without
   breaking resumability) from `DEFERRED_INDEXES_SQL` (the five `item` indexes, `item_search`
   FTS5, and its live-edit triggers). A new `finalizeIndexes(db)` builds everything deferred in
   one bulk pass — standard practice for bulk-loading SQL databases generally, not specific to
   this schema. `importLibrary.ts` no longer touches `item_search` during the bulk pass at all;
   callers call `finalizeIndexes()` once after every import (first run or re-scan alike).

   Re-ran the full real benchmark against the same `Ownhammer` folder (282,041 files) used
   throughout this investigation, fix applied:

   | | Before | After |
   |---|---|---|
   | Full import | Collapsed to ~90-100 items/sec, 2-3+ hrs projected, never completed in testing | **313.1s total, flat ~901 items/sec throughout** |
   | Rate, start → end | ~3,645/s → ~90/s (a ~40x collapse) | ~941/s → ~873/s (flat, not a decay) |
   | Index + FTS5 build | Paid incrementally per row — this was the entire problem | **1.2s, one bulk pass, all 282,041 rows** |
   | `catalog.db` size | — | 191.1 MB + 39.4 MB WAL |
   | Query latency | 0.4-10.5ms (already fine) | 0.2ms browse, 1.4ms FTS5 search — still excellent |

   **This deferred-index/FTS5-after-bulk-import pattern (`createCoreSchema` + `finalizeIndexes`)
   is now the established design** for the real Phase 2+ importer, not just this benchmark
   harness — any future schema change that adds a table/index touched during bulk import should
   go through the same core/deferred split rather than being added to `CORE_SCHEMA_SQL` directly.
   **Phase 1 is done for traversal, persistence, and import throughput** — all validated against
   the real library — **but not fully for its own stated measurement list.** Its bullet points
   above include "how far the background `content_hash` queue lags behind a huge import" — that
   queue (section 4's second paragraph: full-file hash, computed lazily after `quick_hash`) was
   never built, so that specific measurement never happened. Only `quick_hash` (inline, size +
   first/last 64KB) exists in code today; the `content_hash` column and its index
   (`idx_item_hash`) are declared in the schema and sit empty. Nothing currently depends on it
   being populated — browse/search/favorite/rating all work without it, by design — but Phase 5's
   reconciliation (section 5) has a tier that assumes it exists, and that tier isn't built either
   (see Phase 5 below; reconciliation was always scheduled there, not skipped early from Phase 1).
2. **Read-only virtualized browse + search** — **done, with gaps tracked below.** Shipped: the
   NAM|IR mode toggle (`AppRoot.tsx`), "Add Library Folder" → scan with live progress
   (`irLibrary:scan`/`irLibrary:scanProgress`), a dependency-free virtualized list over a sparse
   paginated dataset (`components/ir/VirtualList.tsx` — necessary at Phase 1's proven ~282K-row
   scale, holds only the visible range in memory), debounced FTS5 search with input sanitized
   into a safe quoted/prefix-matched query (`queryLibrary.ts`), favorite toggle and 1-5 star
   rating (`irLibrary:setFavorite`/`setRating`).

   **Explicitly NOT done, tracked here rather than left implicit:**
   - **Confidence badges** — deliberate, not an oversight: they show per-field provenance on
     `ir_item` (section 3), and nothing populates `ir_item` until Phase 3's vendor parsers exist.
     Documented inline in `IrModeShell.tsx`.
   - **Faceted filter chips** (cabinet/speaker/mic/manufacturer, section 7) — same reason as
     badges (no `ir_item` data yet), but unlike badges this wasn't called out until asked; only
     free-text search was built. Revisit once Phase 3 lands.
   - **Cancelable scan** — section 10's IPC list describes `irLibrary:scan` as
     "progress-reporting, cancelable." Only the progress-reporting half was built; there is no
     cancel button and no cancellation token threaded through `importLibrary()`. A started scan
     runs to completion.
   - **Favourites/recents migration** (section 2e) — designed (one-directional, `localStorage` →
     `item.is_favorite`, per library root at first scan) but never implemented. The existing
     Cab/Delay/Reverb picker favourites (`utils/irLibrary.ts`) and the new IR-mode catalog
     favourites are two disconnected systems right now.
   - **NAM-capture ingestion** — `item.kind` is hardcoded to `'ir'` in `importLibrary.ts`; nothing
     scans or catalogs `.nam` captures through this pipeline yet, even though `item` and
     `nam_capture_item` are both already shaped for it. IR mode is IR-only in practice today.
   - **Folder-tree navigation** — not actually in this plan at all (see section 13's new open
     decision on this) — Phase 2 shipped flat list/search only, per section 1's stated non-goal
     ("Not a file browser"), not as an oversight, but that's a product call worth confirming
     rather than assuming.
3. **Vendor parsers** — **done**, built in the order the plan specifies (generic vocabulary
   first, then Ownhammer, then RedWirez). `src/main/irCatalog/vendorParsers/`.

   The plan's original path-shape sketches for Ownhammer/RedWirez didn't match reality — checked
   directly against a real library rather than assumed. Real Ownhammer nests deeper and
   inconsistently pack-to-pack (`1012 GIBS/Atomic/1012 GIBS/V10/Mics/OH 1012 GIBS V10 121-00.wav`,
   not `Pack/{SampleRate}/{Cab}/{Mic}.wav`), so `ownhammer.ts` parses the filename shape
   (`OH {cab tokens} {speaker code} {mic code}[-position].wav`) rather than folder depth. Real
   RedWirez is `.../{cab family}/BIGBox/{rate} KHz-{bits}bit/{cab}/{mic}/{cab}-{mic}-{position}.wav`
   — `redwirez.ts` recognizes via the sample-rate-labeled folder + hyphenated filename together,
   since the filename shape alone isn't distinctive enough to trust.

   Validated against real data, not just synthetic fixtures — ran against a real 15,204-file
   Ownhammer pack and a real 10,539-file RedWirez pack:
   - Ownhammer: microphone 91.4%, cabinet 100%, speaker 51.0% (correctly null for blend files
     like `V10+V30` — deliberately not guessed), manufacturer 0% (expected: cab-only packs don't
     encode amp brand).
   - RedWirez: microphone 92.9%, cabinet 88.9%, speaker 0% (expected: RedWirez doesn't separate
     cabinet from speaker the way this schema does), manufacturer 48.2%.

   Found and fixed one real bug live, from the Ownhammer run: the generic vocabulary parser was
   matching "V30" as a standalone term inside the blend filename "V30+V10", silently overriding
   Ownhammer's own deliberate refusal to guess a speaker for blends — `+` wasn't being treated as
   a real token boundary. Fixed by excluding `+` from the matcher's boundary character class, with
   a regression test. Also extended the vocabulary (`vocabulary.ts`) with terms found missing
   during real-data validation (AKG D12 — distinct from D112 — plus M380/TC30/e602/PR40/Hartke).

   Per-field confidence writing (`applyVendorParsers.ts`) respects the ladder (section 3):
   `user_entered` is never overwritten by any parser, structural `vendor_parser` results are
   never downgraded by the generic `filename_inferred` pass, and the generic pass still fills
   whatever fields a structural match left blank (e.g. `manufacturer`, which `ownhammer.ts` never
   sets). Wired into `irLibrary:scan` (`irLibraryIpc.ts`): runs after the first `finalizeIndexes()`
   call, followed by a second `finalizeIndexes()` so the newly-parsed fields are actually
   searchable — this also fixed a latent Phase 2 bug where `item_search`'s manufacturer/cabinet/
   speaker/microphone FTS5 columns were declared but never populated by anything, so search never
   actually covered them even before Phase 3. Confidence badges (Phase 2's flagged gap) now show
   real data in `IrModeShell.tsx`. Faceted filter chips (section 7) remain unbuilt — badges show
   per-row provenance, but there's still no click-to-narrow-by-field UI.
4. **Quick audition**, ported from NAM Lab per section 8.
5. **Folder notes + vendor document import**, with inheritance (section 2's `folder_metadata`/`folder_metadata_effective`/`folder_document`) and reconciliation (section 5) — reconciliation is fully designed already (section 5's four confidence tiers) but zero code exists yet; a moved/renamed file today just becomes a new row, with the old one sitting `missing_since`-flagged forever with no relink path, until this phase builds it. Its top tier also depends on the `content_hash` background queue, which Phase 1 didn't build either (see Phase 1 above) — build that first if this phase starts before it exists.
6. **Tray + IR Lab handoff** (sections 9 and 11, built together since they're two halves of one feature) — this is the point where the private connector piece is actually needed; everything before it ships fully functional without it.
7. **A/B audition, tags, collections beyond the tray** — polish layer, no new architecture.

Deferred, explicitly out of scope until requested: acoustic/fingerprint
similarity search, non-WAV formats, user-customizable parser definitions.

## 13. Open, non-blocking decisions

- Exact IR Lab license enforcement point/timing — the user has already noted this can land before final release, independent of this plan.
- Whether IR mode ships free indefinitely or some future piece becomes paid — doesn't change anything built here; only changes what gets injected into the private connector config later.
- **Folder-tree navigation (raised during Phase 2 build, not yet decided).** NAM Lab's own left
  panel has a `FolderTree` component; IR mode currently has none — Phase 2 shipped flat
  list/search only. That was a deliberate read of section 1's non-goal ("Not a file browser"),
  reasonable at real vendor-pack depth (Ownhammer nests 3 levels, RedWirez 5+) and at
  Phase 1's proven ~282K-row scale, where tree-browsing that deep is arguably worse than search.
  But it was never explicitly confirmed with the user before building — it's a real product
  decision, not a foregone one. If a tree view is wanted (e.g. as a secondary navigation mode
  alongside search, useful right after adding a new vendor pack to see what's actually in it),
  the data already supports it — `folder.parent_id` is a real tree edge (section 2) — so it's an
  additive UI feature, not a schema change, whichever phase it lands in.
