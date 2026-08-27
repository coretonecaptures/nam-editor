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
--
-- TODO, raised checking a real example (F:\...\Ownhammer\Basketweave GNR\docs\
-- 412-MRBW_GNR-M25_MMMC.pdf): this table is currently store-only -- nothing
-- extracts structured fields FROM the document, so importing one does
-- nothing but keep it handy for a human to read while typing folder_metadata
-- by hand. Two paths, not mutually exclusive:
--   1. Filename-based inference on the document's own filename, reusing the
--      Phase 3 generic-vocabulary pass (genericVocabulary.ts) -- vendor doc
--      filenames encode the same facts WAV filenames do ("412-MRBW_GNR-M25_
--      MMMC.pdf" = cab config/pack/mic codes), no PDF text extraction
--      needed. Cheap, consistent with what's already built.
--   2. Actual PDF content extraction via a vision/document-capable model
--      call (Claude has native PDF support) for prose a filename can't
--      capture ("all cabs miked with an SM57 and R-121..."). Same shape of
--      feature as the Gear Locker project's AI image/PDF spec-extraction
--      TODO -- same solution, reusable pattern. Real dependency: an AI
--      provider key, per-document cost, prompt design. NOT to be built
--      silently inside this backend pass -- an explicit, opt-in feature,
--      most likely built after (1) exists and after the folder-notes UI
--      below gives it somewhere to run from.
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
   - ~~**Faceted filter chips**~~ — **built** (2026-08-25): each row's manufacturer/cabinet/
     speaker/microphone badge is now a toggle button (`IrModeShell.tsx`'s `FieldBadge`), narrowing
     the list to exactly that value via new `QueryOptions.manufacturer/cabinet/speaker/microphone`
     exact-match filters (`queryLibrary.ts`'s `facetClause()` — mirrors the browse SELECT's own
     `COALESCE(ir_item.field, folder_metadata_effective.value)` ladder, so filtering by a
     folder-inherited badge matches the same rows that badge is shown on). At most one active
     value per field (a toggle, not a multi-select facet browser) — active filters show as
     clearable chips below the header.
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
   real data in `IrModeShell.tsx`, and (2026-08-25) are click-to-filter facet chips too — see the
   "built" note above, this is the same feature, not a separate one.
4. **Quick audition** — superseded (2026-08-25) by live audition (section 8b) — see that section,
   not `components/ir/useIrAudition.ts` (deleted). This paragraph is kept for the historical record
   of Phase 4's original approach. It reused directly rather than ported: `playerAudio.ts`'s
   decode/normalize helpers and `audioGraph.ts`'s
   `applyCabinetIr` — the same convolution the player and NAM captures' own audition already run
   through, so an IR heard here sounds like it will everywhere else. Also reused: `useAudition.ts`'s
   generation-counter staleness guard, which that file's own header comment documents fixing a
   real "captures play over each other" bug for — the same race exists here (rapid row-to-row
   navigation), so the same fix applies rather than re-discovering the bug.

   **Deliberately not ported: the render-ahead worker pool.** `useAudition.ts`'s `POOL_SIZE=4`
   pool exists specifically to parallelize the WASM model render (~60-180ms measured, per that
   file's own comment) off the main thread. There's no model render in this workflow — it's an
   offline convolution of a 5s DI clip against a typically-sub-1s IR, cheap enough to render
   on-demand inside a promise without a dedicated pool. This is a stated scope decision, not an
   oversight: if real usage shows the on-demand render is too slow to feel instant, add
   prefetch-ahead then, informed by actual measurement rather than assumed upfront.

   UI: a "Pick DI clip" control (reuses the existing `openAudioFile` dialog, persists the choice
   to `localStorage`), a play/stop button per row, and arrow-key (`ArrowUp`/`ArrowDown`)
   navigation through the current filtered list plus `Escape` to stop, per section 8's spec —
   ignored while a text input has focus so it doesn't fight the search box's own cursor keys.
   **Known rough edge:** arrow-key navigation only auto-plays a row already present in the
   virtualized list's loaded cache; jumping ahead of what's been fetched moves focus silently
   with no play and no retry once that page loads. A/B audition (hold two candidates, instant
   toggle) is explicitly Phase 7, not attempted here.
5. **Backend done — UI not started.** Four backend pieces landed; the folder-notes/vendor-
   document UI this phase was named for did not.

   - **`content_hash` background queue** — closed the Phase 1 gap. `contentHash.ts`: streamed
     (not read-whole-file, quickHash.ts's approach doesn't scale to hundreds-of-MB files),
     bounded concurrency (8, deliberately gentler than scan's 32 — this runs in the background
     while other things may be using the disk), batched updates, per-file failures swallowed
     (a vanished file just stays unhashed, not a queue-crashing error). Started automatically
     after every `irLibrary:scan` resolves, NOT awaited by it — genuinely fire-and-forget,
     guarded against two overlapping runs on the same root.
   - **Missing-file detection** — a real correctness gap `importLibrary.ts` had since Phase 1:
     it upserted files it found but never noticed ones that disappeared. Fixed with a
     `scan_touched` temp table anti-joined against `item` after the walk, not a wall-clock
     timestamp comparison — that was tried first and rejected: two scans finishing within the
     same millisecond compare equal, not less-than, silently missing the detection. Implausible
     between real user-triggered scans, but caught immediately by two back-to-back scans in a
     test, so fixed at the root rather than papered over.
   - **Reconciliation** (section 5) — all four tiers, `reconciliation.ts`, run as a post-scan
     pass (needs the quick_hash/content_hash indexes, which per the Phase 1 fix don't exist
     during the bulk import itself, only after `finalizeIndexes()`). Tier 3's "filename+size,
     gated on folder-name similarity" uses a simpler stand-in than the plan's suggested
     Jaro-Winkler — shared-token overlap between the two paths' immediate parent folder names,
     documented as a deliberate simplification in `reconciliation.ts`, not silently substituted.
     A real order-of-operations bug (updating the surviving row onto the duplicate's path before
     deleting the duplicate — violates the `UNIQUE` constraint, since both rows would briefly
     share one path) was caught by its own test suite before this ever ran for real.
   - **Folder-metadata inheritance** (section 2d's resolve-at-query decision) — `folderMetadata.ts`:
     `setFolderMetadata`/`removeFolderMetadata`, cascading recompute of
     `folder_metadata_effective` down to every descendant (a change three levels up can change
     what a leaf folder inherits even though the leaf's own declarations didn't change — covered
     by a test for exactly that case). `queryLibrary.ts`'s `queryItems` now `COALESCE`s each
     descriptive field against the item's folder's effective value, so a folder-level declaration
     actually shows up in browse/search results — item-level (including Phase 3's vendor-parsed)
     values still always win when present.

   **Folder-notes/vendor-document UI — done, resolving section 13's folder-tree open decision.**
   That decision (raised after Phase 2 shipped flat list/search only) was: build a folder-tree
   side panel, confirmed with the user rather than assumed — both remaining Phase 5 features
   needed a way to address "this folder" and none existed. `components/ir/IrFolderTree.tsx`:
   read-only navigation (a real vendor library's structure comes from disk, not user
   reorganization — deliberately far simpler than NAM Lab's own 1241-line `FolderTree.tsx`, no
   drag/rename/move/context-menus). `components/ir/IrFolderPanel.tsx`: notes (a plain `folder`
   column, separate from the structured/inheritable fields), the four structured fields
   (manufacturer/cabinet/speaker/microphone, always written `user_entered` — a human declaring a
   fact here, not a parser guessing one), and vendor document import/removal
   (`folderDocuments.ts` — copies the source file into `userData/ir-documents`, links it via
   `folder_document`, collision-proofed with a random filename prefix; deletion removes both the
   DB row and the copied file). Wired into `IrModeShell.tsx` as left (tree) / right (panel)
   sidebars around the existing item list.

   **Scope cuts at the time, since closed:**
   - ~~Selecting a folder does not filter the item list~~ — fixed later the same phase:
     `queryItems`/`countItems` take a `folderId` (resolved via `resolveFolderScopeIds`), and
     `IrModeShell.tsx` wires the tree's selection straight into it.
   - ~~The tree only shows the first `library_root`, no root switcher~~ — **built** (2026-08-25),
     then **corrected same day** after real use surfaced two follow-on bugs. First pass: a
     root-select dropdown next to Add Library Folder scoped the folder tree to one root at a
     time. Reported immediately: adding five separate IR Lab Project roots left four of them
     invisible — the tree only ever rendered whichever single root the dropdown had selected, so
     "add 5 roots" meant "see 1 root's folders, plus a dropdown to swap which 1." Fixed by making
     the tree root-agnostic: `IrFolderTree.tsx` now always fetches EVERY root
     (`irLibrary:listAllFolders`, new — same shape as `listFolders` but joined across
     `library_root` with no `WHERE library_root_id = ?`) and wraps them under a single synthetic
     "Library" node once there's more than one root (a lone root skips the wrapper, unchanged from
     before). The root-select dropdown still exists, but now only scopes browse/search — the tree
     itself shows everything unconditionally.

     Second bug, found while building the first fix: a folder tree node was always built from a
     root's own top-level folder row (`relative_path = ''`), but that row's CHILDREN were shown in
     its place, never the row itself — a deliberate choice for vendor packs (skip an extra "click
     to expand the one thing you added" layer, jump straight to the real subfolders). That
     silently broke down for an IR Lab Project specifically: a Project's `outputRoot` is flat, no
     subfolders at all ("Deliberately flat in phase 1" — confirmed in the real ir-lab source,
     section 8c) — so its children array is empty, and the old logic rendered nothing selectable
     for it at all, with no expand arrow and no fallback. Fixed by reusing that root row directly
     as the visible tree node (relabeled with the root's own name) whenever it has no children,
     rather than only ever showing what's beneath it — a flat root is now a real, clickable,
     correctly `is_lab_project`-flagged node; a root with real substructure still skips straight to
     its subfolders as before.
   - **Folders with zero WAVs anywhere under them are now hidden from the tree entirely**
     (`IrFolderTree.tsx`'s `attach()`, same pass as the fix above) — a subfolder that exists only
     to hold a vendor's docs/images/session data, with no audio in it or beneath it, was clutter,
     not a real navigation target.
   - **Investigated directly against real imported Projects** (five real IR Lab Projects: Liquid
     Sonics Seventh Heaven, Strymon Flint, Sunset Sound, TC Triple Delay, Ventris) after a report
     that "the projects have no metadata at all." Confirmed via the real `catalog.db` and the
     real `.SessionData` files on disk: `enrichLabProjects()` IS reading and matching correctly —
     `capture_id`/`sample_rate`/`is_stereo` are populated, every capture is correctly linked into
     its `collection`. The blank cabinet/speaker/microphone/position fields are not an extraction
     bug — IR Lab's own `session.json` really does write those as empty strings
     (`"metadata": {"cabinet": "", "speaker": "", "microphone": "", "position": "", "notes": ""}`)
     for these five, because none of them are cabinet+mic captures at all — they're reverb/delay
     pedal and plugin captures (a Strymon Flint pedal, a TC Triple Delay pedal, a Liquid Sonics
     reverb plugin, etc.), where "cabinet/speaker/microphone" was never a field IR Lab's own UI
     asked the user to fill in. The Project's actual name (`collection.name`, e.g. "Strymon
     Flint") IS captured correctly and shown as the Project tab's header — the empty badges below
     it are accurately reflecting genuinely-empty source data, not a bug. Open question, not yet
     acted on: whether the Project tab should show something more relevant than blank cabinet/
     speaker/mic labels for a non-cabinet capture (e.g. `analysis.json`'s `calibration.deviceName`,
     or simply omitting fields that are empty at the source instead of showing them unset).
   - ~~`folder_document` doesn't extract any fields~~ — **built** (2026-08-25):
     `vendorDocExtraction.ts`'s `extractVendorDocumentFields()` runs every imported PDF/CSV/TXT
     through the SAME `genericVocabularyParser` the filename parser uses (manufacturer/speaker/
     microphone term lists — no cabinet vocabulary exists, so cabinet is never guessed from a
     document either, matching the filename parser's own gap), writing hits as folder-level
     `vendor_documentation`-sourced fields. Runs automatically after every document import, plus a
     manual "Re-extract fields from documents" button in `IrFolderPanel.tsx`. PDF text extraction
     uses the `pdf-parse` package (new dependency) — imported via its `lib/pdf-parse.js` path
     directly, not the package's top-level `index.js`, which has a long-standing bug
     (`isDebugMode = !module.parent`) that self-runs a fixture-file read the moment it's loaded
     through anything other than a plain CJS require from a direct parent (ESM interop, bundlers,
     and test runners all trip it) and throws `ENOENT` immediately — caught by this session's own
     test run before it shipped. Deliberately NOT an AI/vision extraction pass (Gear Locker's own
     pending TODO for image/PDF spec sheets is a distinct, heavier dependency this project doesn't
     have wired up) — plain text extraction plus Phase 3's existing pattern matching, reused.
6. **Tray + IR Lab handoff — done.** Private connector spec confirmed live against the real
   `ir-lab` repo (2026-08-24/25): `irlab://` scheme, `session`/`blend`/`project` routes, plain
   query params sent via `shell.openExternal` — no socket, no shared database, matching section
   0/11's design exactly. `irLabConnector.ts` (public repo) builds these URLs; the actual scheme
   string is injected via `IR_LAB_URL_SCHEME` at build/run time (same pattern this repo already
   uses for `CSC_KEY_PASSWORD`), never hardcoded here. `tray.ts`: an 8-slot `collection`
   (matches `LiveAuditionEngine::blendPreviewSlotCount = 8`, confirmed live, not guessed), wired
   end to end — bottom strip in `IrModeShell.tsx`, right-click "Add/Remove Tray", "Send to IR
   Lab" button.

   Also landed alongside this, in response to live UI feedback and follow-up asks (not originally
   scoped to Phase 6, folded in because they touched the same surface):
   - **Design tokens**: IR mode now uses the app's actual CSS-variable theme tokens
     (`bg-app-bg`/`text-nm-text`/`bg-nm-accent`/etc., `tailwind.config.js`) instead of hardcoded
     Tailwind grays — follows light/dark/accent themes like NAM Lab does, not independently of it.
   - **Folder tree**: collapse-all/expand-all, an in-tree filter (matches + their ancestor chain
     shown, auto-expanded), and per-folder recursive item-count badges — same "totalCount"
     convention as NAM Lab's own `FolderTree.tsx`.
   - **Right-click context menu** on item rows: Reveal in Folder (reuses the existing generic
     `shell:revealFile` channel), Add/Remove Tray, an explicit "More actions coming soon" stub
     rather than inventing menu items that don't do anything.
   - **Both side panels resizable** (tree and folder-metadata panel), matching NAM Lab's own
     `DragHandle` pattern.
   - **Quick filters** (Favorites only / Rated only) in the browse bar — real `WHERE` clauses in
     `queryLibrary.ts`, not a post-fetch JS filter (which would break under pagination — a page
     of raw rows can easily contain zero favorites).
   - **Library Overview**: the right panel's default content when no folder is selected (previously
     just an empty "select a folder" placeholder) — total IRs/folders/favorites/rated/tagged/
     vendor-doc counts, plus two small CSS-bar breakdowns (top manufacturers, top microphones)
     from whatever Phase 3's parsers already populated. Deliberately not a real dashboard — "a
     few graphs for now," per the ask.
   - **Top menu bar** (File/Settings/Help) — File works (Add Library Folder). Settings/Help are
     honest disabled stubs, not fake working buttons: NAM Lab's existing Settings panel is local
     state inside `App.tsx` (~6,000 lines), and sharing it across both modes is a real state-
     lifting refactor, not something to improvise as a side effect of adding a menu bar. Tracked
     as follow-up, not silently skipped.
   - A **Claude Design cohesion review** was requested (screenshots of both modes) before going
     further into new IR-mode-specific UI (folder report, live-blend audition) — so those land
     looking like one product with NAM Lab instead of another disjointed pass.
7. **A/B audition, tags, collections beyond the tray** — polish layer, no new architecture.
8. **In progress (2026-08-24/25 session), against the same live-feedback list that folded into
   Phase 6** — a tabbed right panel (Overview/Pack Info/Gallery/Read Me, mirroring NAM Lab's own
   pack-detail tabs from a supplied screenshot), Overview generalized to work at folder-subtree
   scope (not just whole-library), a "Groups" feature (named, cross-folder tags — the existing but
   previously-unused `tag`/`item_tag` schema tables), Gallery/Read Me tabs reusing NAM Lab's
   already-generic `folder:scanImages`/`scanChildImages`/`readReadme`/`writeReadme` IPC (no new
   backend needed, just a folder's absolute path — see 8a), a stubbed disabled "Build IR Pack..."
   entry, a written (not implemented) plan for live-blend cabinet audition (see 8b), and an
   IR-Lab-Project-vs-vendor-library ingestion design (see 8c). Tray from Phase 6 confirmed still
   matching the "card locker" ask (right-click add/remove, 8-slot cap, Send to IR Lab) — no
   redesign requested once described back to the user.

### 8a. Folder absolute path for Gallery/Read Me

`folderMetadata.ts`'s `getFolderDetail()` needs to additionally return
`absPath` (a `node:path.join(library_root.path, folder.relative_path)`, done
in the main process — the renderer has no `node:path`/`node:fs` access under
`contextIsolation`). Once present, `IrGalleryTab`/`IrReadMeTab` call the
existing generic channels with that path exactly like NAM Lab's own pack
detail panel does — no IR-specific backend work required for either tab.

### 8b. Live cabinet audition (built — single-IR and two-IR blend, both apps)

The single-IR version of this is now built, replacing the earlier Phase 4
mechanism entirely (`useIrAudition.ts` — offline-render-once via
`applyCabinetIr`, loop a static `AudioBuffer` against a picked DI file — was
deleted, not kept alongside). What was actually asked for, once clarified
against a live UI screenshot/discussion: a row's play button should behave
like NAM Lab's own PlayerPanel **Live** mode (real mic/interface input
through an amp capture, continuously, no DI file involved at all) with the
cabinet swapped instead of the amp — not the separate, much simpler
offline-DI mechanism this replaced.

**FINAL SHAPE (2026-08-25): IR mode renders NAM Lab's own `PlayerPanel`.**
Everything between here and the two-IR-blend section below describes an
intermediate version that has since been **deleted**; it is kept only
because the reasoning for deleting it matters.

That intermediate version built IR mode a *parallel* player: a bespoke
`useIrLiveAudition.ts` hook plus an `IrLiveTab.tsx` UI. It did correctly
reuse the `LiveEngine` class itself — but it re-implemented the whole
orchestration layer around it (start/stop lifecycle, device selection, FX
state, meter polling) and shipped a thinner FX UI next to the real one.
Called out directly, and correctly: *"why is this not just an absolute load
of the existing code??? ... we should follow good design principles,
abstraction, reusability ... not copy/paste ... this was the reason im not
building a new app and using nam lab, because all of this work was already
done."*

The correct answer was that NAM Lab already had **three** finished player
views, all of which IR mode wanted: the DI/Preview player, the inline Live
player, and the full-screen Live rig. So IR mode now renders
`PlayerPanel` itself, and gets all three verbatim — including the pop-out
arrow, tuner, RIG presets, the photoreal racks, and the transport.

What made that possible with no state-sharing refactor: **every prop
`PlayerPanel` needs comes from `settings`, and settings are readable from
any renderer tree.** `settings.json` is read synchronously in preload and
exposed as `window.api.initialSettings`, so IR mode reads the same library
paths and FX preset lists NAM mode passes down from `App.tsx` state,
without the two trees needing to share anything.

Built for this:

- `src/renderer/src/utils/loadNamFile.ts` — `loadNamFileForPlayback()`,
  turning the chosen amp-capture path into the `NamFile` `PlayerPanel`
  needs. Deliberately NOT App.tsx's own library-loading path
  (`applyParsedResults`), which also runs the metadata-defaults engine,
  computes `autoFilledFields` and marks files dirty — editing concerns that
  would wrongly imply unsaved changes on a capture nobody is editing.
- Four new optional props on `PlayerPanel`, all omitted by NAM mode so its
  behavior is byte-for-byte unchanged: `cabIrPath` / `onCabIrPathChange`
  (controlled cabinet — IR mode drives the cab from the browse list rather
  than the panel owning it), `titleOverride` (headline the IR being
  auditioned rather than the amp it plays through), and `headerExtra`.
  The controlled/uncontrolled split lives in exactly two lines where
  `irPath`/`setIrPath` are defined; every one of the ~6 downstream call
  sites is untouched.
- `IrModeShell.tsx`: the player REPLACES the right-panel tabs while open,
  the same way `App.tsx` renders `PlayerPanel` in place of the metadata
  editor. Deliberately not keyed by IR — remounting per IR would tear down
  the live engine and re-scan the DI/IR libraries on every click, which is
  exactly what makes stepping through cabinets by ear impossible; the new
  cabinet arrives through `cabIrPath` instead.
- Rows gained **both** of NAM Lab's row buttons, same icons/colors/hover
  treatment as `FileList.tsx`: green play (opens the player) and the pink
  guitar-jack "Play Live" (jumps straight to the full-screen rig via the
  same self-clearing `liveJumpRequest` one-shot protocol NAM mode uses).
- Arrow keys still step the list, and now swap the cabinet as they go when
  the player is open — the actual point of the feature.

Deleted, not kept alongside: `IrLiveTab.tsx`, `useIrLiveAudition.ts`, and
the Live tab in `IrRightPanel.tsx`.

A side effect worth recording: `utils/liveEngineOwner.ts` was added earlier
as a mutex between IR mode's engine and NAM mode's. With the duplicate
engine gone, and `AppRoot.tsx` only ever mounting one mode at a time, there
is now exactly one `PlayerPanel` and therefore one engine **by
construction** — a strictly better outcome than the lock. The module is
kept as a cheap assertion of that invariant, with its header comment
rewritten so it can't be misread as evidence two engines are expected.

**Two-IR blend — now built, in BOTH NAM mode and IR mode:**

`LiveEngine` (`utils/liveEngine.ts`) gained a second cabinet slot:

- `convolverA/wetGainA` (renamed from the original single `convolver`/
  `wetGain`) and new `convolverB/wetGainB`, both summed into the same shared
  `dryGain` — `worklet -> convolverA -> wetGainA -+`, `worklet -> convolverB
  -> wetGainB -+`, `worklet -> dryGain -+`, all three feeding `fxInput`.
- `setIrSlot('A'|'B', ir)` — same fade-out/rebuild/fade-in dance the
  original `setIr()` used, now parameterized by slot; rebuilds both slots
  from `this.irA`/`this.irB` (`wireCabinets()`) so a slot-A change never
  disturbs whatever's loaded in slot B.
- `setBlend(0..1)` — 0 = A only, 1 = B only, in between = crossfaded. A pure
  gain ramp on `wetGainA`/`wetGainB`, no rebuild, so it's instant and
  click-free (unlike an actual IR change in either slot).
- `setIr(ir)` kept as a back-compat alias (`setIrSlot('A', ir)` + blend
  forced to 0) — every pre-existing caller (both apps, before this change)
  keeps working completely unchanged.

**IR mode** (`useIrLiveAudition.ts`, `IrLiveTab.tsx`, `IrModeShell.tsx`):
`playItem(item, slot)` defaults to slot A (a row's plain play button); the
row context menu gained "Audition Live — Slot A" / "— Slot B (blend)"; the
Live tab shows both slots' loaded IR name plus an A/B blend slider. Row
highlighting distinguishes slot A (accent color) from slot B (sky blue).

**NAM mode** (`PlayerPanel.tsx`): a new "Second cabinet (blend) — Live only"
sub-section under the existing Cab IR picker — a second `IrPicker` for slot
B plus the same blend slider, visible only in Live mode (the offline
Preview render still only ever uses slot A/`irPath`, unchanged — blending
in the offline convolution path is a separate, unbuilt piece). Session-only
state (`irBPath`/`irBlend`), deliberately not persisted into rig
presets/snapshots — it's an audition aid layered on top of the saved rig,
not part of it.

**Live audition follow-ups — all three built (2026-08-25):**

1. ~~No gate/EQ/delay/reverb/chorus/device picker~~ — **built, then
   corrected the same day to actually reuse PlayerPanel's real rack UI
   instead of a second, thinner one.** First pass shipped simple on/off
   toggles for gate/EQ/delay/reverb/chorus, applied live via
   `engine.setGate/setEq/setDelay/setReverb/setChorus`. Called out directly
   as the wrong call — "why is this not just an absolute load of the
   existing code???...we should follow good design principles, abstraction,
   reusability...not copy/paste." Corrected: `useIrLiveAudition.ts` now
   holds the SAME full settings objects (`GateSettings`/`EqSettings`/
   `DelaySettings`/`EchoLabSettings`/`ReverbSettings`/`ChorusSettings`)
   `LiveEngine`/`PlayerPanel.tsx` already use, and `IrLiveTab.tsx` renders
   the ACTUAL `Rack500`/`RackDelay`/`RackEchoLab`/`RackReverbTest`
   components `PlayerPanel.tsx`'s Live mode uses — imported directly, not
   reimplemented. This worked with zero changes to `PlayerPanel.tsx` itself
   because those components were already properly decoupled there (plain
   `settings` + `onChange(patch)` props, no `NamFile` dependency) — the
   duplication was entirely in the hook layer around them, not in the racks
   themselves. Input/output device selection
   (`listAudioInputs`/`listAudioOutputs`, same as NAM mode) restarts the
   engine on change (a live device switch needs a fresh `getUserMedia`
   stream, unlike a cabinet or FX setting) — `restartIfRunning()` tears down
   and rebuilds, reloading whatever was in both cabinet slots and the blend
   position first. Real, current gaps: PlayerPanel's floating-window
   pop-outs, named FX presets, and per-effect convolution IR pickers
   (Delay/Reverb convolution mode needs an IR to pick from a library IR
   mode doesn't have wired up yet) are not reused/built here.
2. ~~Cross-tree architecture gap~~ — **built, as a mutex, not a shared
   instance.** New `utils/liveEngineOwner.ts`: a plain module-level
   singleton (`tryAcquireLiveEngine('nam'|'ir-mode')` /
   `releaseLiveEngine(...)`), consulted by both `PlayerPanel.tsx`'s
   `startLive()` and `useIrLiveAudition.ts`'s `start()` before opening a
   `LiveEngine`. If the other mode already holds it, the caller gets an
   honest error ("Live monitoring is already running in NAM mode/IR mode —
   stop it there first") instead of silently opening a second
   `getUserMedia` stream and contending for the same input device. This is
   NOT the "lift `LiveEngine` to a shared owner" fix described here
   previously — that would still need a real state-lifting refactor above
   `AppRoot.tsx` (same shape as the shared-Settings-panel gap), and wasn't
   attempted. The mutex only prevents the two from running at once; it
   doesn't let switching modes keep monitoring uninterrupted the way
   switching cabinets within one mode does. 7 unit tests
   (`liveEngineOwner.test.ts`) cover acquire/release/re-acquire/notify
   semantics directly, no `AudioContext` needed.
3. ~~IR-focused Live tab layout~~ — **built.** `IrLiveTab.tsx` rewritten:
   the two cabinet slots + blend slider are now the top section, large,
   with the play/stop transport and meter directly under them; the amp
   capture picker, device selects, and FX toggles are pushed into a smaller
   secondary strip below. Not literally centered (no specific geometric
   layout rule) — the point was emphasis, and the IR/blend now reads as the
   focal point instead of the capture picker.
4. **Cross-app visual consistency — one gap found and fixed, one identified
   and deliberately not touched yet.** Raised directly: "even the context
   menu looks totally different in IR than in NAM...these are not two apps!
   they are 2 parts of one app." Checked both directly:
   - Context menu: confirmed real — NAM mode's (`FileList.tsx`) used
     `text-sm` with an icon per item and raw Tailwind grays; IR mode's
     (`IrModeShell.tsx`) used `text-xs`, no icons, design tokens. Neither had
     ever been a shared component — every screen in the app built its own
     inline popup. Fixed: new `components/ContextMenu.tsx` — one shell
     (design-token colors, NAM's `text-sm` sizing since it's the more
     established shipped spec, optional icon slot, dividers, a destructive
     variant, self-contained dismiss-on-outside-click/Escape) — `IrModeShell.tsx`
     migrated to it now. **`FileList.tsx`'s own menu (11+ conditional items —
     copy/move/rename/trash/apply-defaults/add-to-group) was deliberately
     NOT migrated in this pass** — real, core, actively-used file-operations
     UI, not a contained swap, and flagged rather than touched without
     confirmation given this session's own established caution around
     high-blast-radius edits to the main app. Follow-up, not forgotten.
   - Tree font: checked and NOT actually different — both `FolderTree.tsx`
     and `IrFolderTree.tsx` use `text-xs`, inheriting the same global
     `body { font-family: var(--font-ui) }` (IBM Plex Sans) either way. No
     literal typeface/size divergence found; the perceived difference was
     most likely the adjacent context-menu inconsistency (icons/sizing/
     colors) above, not the tree rows themselves.

### 8c. IR Lab Projects vs. third-party vendor libraries — ingestion (built)

**Superseded/corrected below** — the version originally written here guessed
`analysis.json`'s shape from an early, partial read of the private repo. It
was wrong on real specifics (there is no top-level `session`+`analysis`
object with a `variants[]` array in one file — metadata is split across
several files under a `.SessionData/` folder). This section was rewritten
after actually reading the ir-lab source
(`C:\Users\Admin\ir-lab`, `SessionStore.h/.cpp`, `ProjectStore.h/.cpp`,
`Project.h`, pulled fresh) and the design below is what got built, not a
plan.

**Real on-disk layout, confirmed from source, not guessed:**

```
<outputRoot>/                              <- what a user points the importer at
  <capture-1>.wav                          <- deliverable, flat (Project.h: "Deliberately flat in phase 1")
  <capture-2>.wav
  .SessionData/                            <- dot-prefixed -> scanWalk.ts already skips this entirely
    project.json                           <- ProjectStore.cpp:477-510: { id, name, createdAt, captureIndex: [{captureId, outputFileName}], ... }
    <captureId>/
      session.json                         <- SessionStore.cpp:665-681: { id, displayName, createdAt, captureIds[], metadata: {cabinet,speaker,microphone,position,notes,captureType} }
      captures/<captureId>/analysis.json   <- SessionStore.cpp:683-737,1543-1622: { captureId, createdAt, measurement: {sampleRate,...}, isStereo, isTrueStereo, ... }
      variants.json                        <- SessionStore.cpp:458-534: [{ id, name, master, distribution, analysis, sampleRate, createdAt, current, archived, ... }]
```

Because `.SessionData` is dot-prefixed, `scanWalk.ts`'s existing directory
skip (`.`-prefixed dirs, line ~80) **already excludes it and everything
under it from a normal scan** — a plain "Add Library Folder" pointed at a
Project's `outputRoot` was already importing exactly the right files (the
flat deliverables) before any of this work started. The only real gap was
metadata: nothing read `.SessionData/` to enrich those already-correct
`item` rows. `variants.json`'s `current`/`archived` map directly onto the
schema's pre-existing `ir_derivative_variant.is_current`/`is_archived`
columns — confirms a capture's variants are edit-revision history of ONE
deliverable, not separate browsable IRs (an open question earlier in this
session, settled by reading the real source rather than guessed).

**Built:**

- `src/main/irCatalog/labProjectEnrichment.ts` — `enrichLabProjects(db,
  libraryRootId)`, a third pass (same slot as Phase 3's `applyVendorParsers`)
  run after every scan. For every folder with `.SessionData/project.json`:
  upserts a `collection(kind='ir_project', folder_id=...)`; for each
  `captureIndex[]` entry, matches the already-imported deliverable `item` by
  filename, reads that capture's `session.json`+`analysis.json`+
  `variants.json`, writes `ir_item`/`ir_item_field_source`
  (`source='ir_lab_native'`, the confidence ladder's top tier — never
  overwritten by a later vendor-parser guess, `applyVendorParsers.ts`'s
  `RANK` map already enforces this) and `ir_derivative_variant` rows, and
  links the item into the Project's `collection_item`. Also exports
  `getProjectDetailForFolder()` for the UI's Project tab.
- `collection.folder_id` — new nullable column (schema.ts), anchoring a
  Project's collection to the folder IR Lab wrote it into; "is this folder a
  Lab Project" is derived (`EXISTS` against this column, never a separate
  stored flag) in both `listFolders()` (folder tree) and `getFolderDetail()`
  (right panel).
- **Duplicate-import guard** — the user's core worry ("same IRs in the IR
  library folder... only look at the ones in the project"). Because
  file-selection was already correct for free, the only real duplication
  risk was two `library_root` rows over overlapping paths. Both scan entry
  points now check (`findContainingRoot()`, `irLibraryIpc.ts`) whether the
  chosen folder is already inside an existing root before creating a new
  one; if so, they rescan the *existing* root's own path instead (cheap,
  idempotent, per Phase 1's benchmarks) rather than registering a second
  root over the same files.
- **Two entry points, one mechanism.** "Add Library Folder" now
  auto-enriches any Project folder anywhere in the tree, no separate action
  needed. A new **"Import IR Lab Project(s)…"** File-menu action
  (`IrMenuBar.tsx`) runs the identical pipeline, then — only when it created
  a genuinely new root (never when the guard above reused an existing one,
  to avoid ever deleting a user's pre-existing generic-scan content) —
  deletes any `item` whose folder isn't a detected Project folder, for the
  case of pointing directly at a folder of Projects and wanting only those.
- **Folder tree colorization** — a small `bg-blue-500` dot badge next to a
  Project folder's icon (`IrFolderTree.tsx`), the exact same idiom NAM Lab's
  own `FolderTree.tsx` already uses for pack-owning folders (confirmed via
  that file, blue-500 already documented there as reserved for this kind of
  "special folder" semantic) — a badge dot, not a recolored icon/label.
- **Project tab** (`IrProjectTab.tsx`) — a fifth right-panel tab, shown only
  when the selected folder is a detected Project, auto-selected on first
  landing on one. Shows the project name/capture count plus, per capture,
  its cabinet/speaker/mic/position/type/sample-rate and variant history
  (current vs. archived) — the one thing not visible anywhere else in the
  UI (the row list's badges only show four fields, no variant history).
- 6 new unit tests (`labProjectEnrichment.test.ts`) against a fixture built
  to the exact confirmed on-disk shape: enrichment correctness, idempotency
  (re-running doesn't duplicate variants/collection_item rows), the
  ladder-priority regression (`applyVendorParsers` run afterward never
  downgrades an `ir_lab_native` field), `is_lab_project` folder detection,
  `getProjectDetailForFolder`'s shape, and confirmation that `.SessionData`
  contents never become `item` rows via the ordinary scan.

Not built: the Project-vs-vendor UI badge on individual row list entries
(the folder-tree dot and the Project tab cover the ask; a per-row badge in
the center list was judged redundant, not requested explicitly). Gallery
tab (8a) already renders for any folder with images, Project or not — no
Project-specific gate needed, matches the original note here.

Deferred, explicitly out of scope until requested: acoustic/fingerprint
similarity search, non-WAV formats, user-customizable parser definitions.

## 12c. Audio format facts from the WAV header (built)

Asked directly: *"can you show some info about the file? do we know that?
like its format...bit rate, length, sample rate, etc"* — and then, once the
answer was no: *"yes we need that info to show/search etc....and we should
be storing in the db"*.

**What we knew before: essentially nothing.** Checked against the real
catalog rather than assumed — 16,902 items, of which only **27** had an
`ir_item` row at all (the IR Lab Project captures, from `analysis.json`).
For the ~16,875 vendor IRs we stored filename, folder, file size, and
name-guessed descriptive fields. No format, sample rate, bit depth, channel
count or length.

**The cost of getting it turned out to be zero.** `quickHash.ts` already
reads the first 64KB of every file during the scan to fingerprint it, and a
WAV header lives in the first few hundred bytes of exactly that buffer. So
`computeQuickHash` now returns `{ hash, header }` — parsing what it already
had in hand — rather than anything doing a second open+read per file, which
at this library's scale would have been a whole extra pass over ~282K files
to learn something already in memory.

Built:

- `src/main/irCatalog/wavHeader.ts` — `parseWavHeader(buf)`. Walks the
  chunk list rather than assuming `fmt ` sits at byte 12: the spec doesn't
  require it and real vendor packs carry LIST/INFO, JUNK or bext chunks
  ahead of it, which a fixed-offset parser silently misreads. Handles
  word-alignment padding, PCM/float/extensible tags, and a declared byte
  rate of zero (falls back to computing it, so duration doesn't become
  NaN). 12 unit tests.
- `ir_item` gained `bit_depth`, `channels`, `duration_seconds`,
  `audio_format` and `audio_search`, plus migrations for each — these are
  MEASURED facts about bytes on disk, so unlike manufacturer/cabinet/
  speaker/microphone they deliberately carry no `ir_item_field_source`
  confidence row; there is nothing to be more or less sure about.
- `importLibrary` writes them per item. This needed `insertItem` to gain
  `RETURNING id`: on a re-scan the `ON CONFLICT` path keeps the row's
  ORIGINAL id, so the freshly generated UUID being passed in is not the id
  in the table, and any child row keyed on `item_id` written with it would
  have been orphaned. Covered by a re-scan test.
- Searchable: `item_search` gained an `audio` column, so "44.1k", "96000",
  "24-bit" and "stereo" are typeable in the search box. FTS5 columns are
  fixed at creation, so `runMigrations` drops a stale index outright and
  `getDb()`'s existing `if (!itemSearchTableExists)` check rebuilds it on
  the same open — nothing is lost, it holds no source data.
- Filterable: `queryLibrary` gained `sampleRate`/`bitDepth`/`channels`
  options, and the row's sample rate and bit depth are click-to-filter.
  Channels/duration are plain text — nobody wants to narrow a library to
  "everything 0.52 seconds long".
- `src/shared/` (new, included by BOTH tsconfigs) holds the pure
  formatters. The main process needs them at scan time to build the search
  text and the renderer needs identical wording to display; duplicating a
  "format a sample rate" helper across the process boundary is exactly how
  the two drift — one showing "44.1k" while the other indexes "44100".

**A bug caught by this feature's own test before it shipped:** the search
text was first assembled in `finalizeIndexes`' SQL, where SQLite's integer
division rendered 96000 as `"96.0k"`. FTS5 tokenizes that as `96` + `0k`,
so searching "96k" matched nothing. Moving the rendering into TypeScript
next to `formatSampleRate` removed the whole class of display/index
mismatch.

Existing catalogs pick all of this up on the next scan; rows imported
before it exist simply have nulls until then.

## 12b. NAM Lab bugs found while bringing its player into IR mode

Found and fixed while studying `PlayerPanel.tsx` to reuse it. Recorded here
because two of the three were pre-existing NAM Lab bugs, not IR-mode ones.

1. **The full-screen live rig was a dead end on Windows** (pre-existing,
   user-reported: *"from the full screen live player i dont know how to get
   back to the main app"*). Two independent causes, both real:
   - The **Collapse** button sat underneath Windows' native window
     controls. The popped-out title bar used `paddingRight: 16`
     unconditionally, but on Windows `titleBarOverlay` (src/main/index.ts)
     draws minimize/maximize/close as OS chrome *above* the web content at
     the top right. `Toolbar.tsx` had already solved exactly this by
     reserving 155px on non-mac; the rig title bar now does the same.
   - **Escape never worked.** That button's tooltip has always read "Back
     to the panel (Esc)", but nothing ever listened for the key — so the
     advertised escape hatch didn't exist either. Now wired, and ignored
     while a text input has focus so it can't swallow a field's own
     Escape-to-cancel.
2. **Literal `—` / `…` rendering as visible text** in the
   second-cabinet (blend) section added earlier in this same session — a
   bug I introduced, visible in the user's own screenshot as "SECOND
   CABINET (BLEND) — LIVE ONLY". Those escapes are not processed
   inside JSX text nodes or attribute strings; they need the real
   characters.

## 12d. Search/filter bar — scoped to the list column, multiselect makers/speakers/mics

Asked directly for "a better search / filter bar above the list view (like
nam lab)... quick filters on sample rate, bit rate, a multiselect list of
all capture makers we have in the library, multiselect on microphones...
and speaker... put it in the list middle area not above the middle/right
bars (like nam lab)".

Two structural changes, not just new controls:

- **Placement.** The search box and quick filters previously lived in the
  full-width header, spanning the folder tree and the right panel too.
  Moved into a new `IrFilterBar.tsx`, rendered inside a `flex-col` that
  wraps ONLY the center list column — matching where NAM Lab's own
  equivalent actually lives (`FileList.tsx`'s search+filter row is inside
  the file list component, not a page-wide header). The Groups dropdown,
  Favorites/Rated toggles and the "Filtered by:" active-chip summary moved
  down into it too, since they're the same category of control.
- **Facets went from single-value to multi-select.** `manufacturer`,
  `speaker` and `microphone` in `queryLibrary.ts`'s `QueryOptions` now
  accept `string | string[]` (an array is OR'd via `IN (...)`); `sampleRate`
  /`bitDepth` likewise accept `number | number[]`. `cabinet` stays
  single-value on purpose — nothing offers a cabinet multiselect, since
  `vocabulary.ts` has no cabinet term list and it's rarely populated (see
  12c's Overview note on the same point). This threads through all three
  IPC-wiring files (`irLibraryIpc.ts`, `preload/index.ts`, `App.tsx`) and
  `IrModeShell.tsx`'s `facets`/`audioFacets` state, which changed from "one
  active value per field, second click clears it" to "toggle membership in
  an array per field."

New backend reads, `listFacetOptions`/`listNumericFacetOptions`
(`queryLibrary.ts`): every distinct value **currently on file** for one
field, scoped to the active root/folder — "what we have in our list, not
all in the world," so a checklist can never offer a value that matches
zero IRs. `IrFilterBar` re-fetches these whenever the root/folder scope
changes or a scan completes (`refreshKey`, the same pattern `IrLibraryOverview`
uses in 12c).

UI: manufacturer/speaker/microphone are checkbox popovers built on the same
shape as NAM Lab's own column chooser (`FileList.tsx`: button opens an
absolutely-positioned checklist with a header and a footer action) rather
than a new picker pattern. Sample rate/bit depth are toggle pills instead
of a popover — a real library typically only has 2-4 distinct rates, so
seeing them all as clickable pills is faster than opening a list to pick
one.

**Bug found and fixed while wiring this up, not by the user this time:**
picking a Group left any active folder/root scope in place. `tag.ts`
documents groups as deliberately cross-folder and cross-root ("put a bunch
of IRs in a named group for recall/filter later, across anywhere in your
library"), but the browse query ANDs `folderId`/`libraryRootId` with
`tagId` — so a group whose item lived outside the currently-selected
folder silently returned zero rows while the Groups menu still showed a
non-zero item count. Reported by the user exactly that way: "i see i have
a group with 1 item, but when i click it, nothing shows in the list."
Fixed by clearing folder/root scope when a group is selected
(`selectTagFilter` in `IrModeShell.tsx`).

irCatalog 97 tests (2 new: multi-value facet OR, `listFacetOptions`/
`listNumericFacetOptions` scoping), renderer 357 tests, build clean.

## 12e. Reading IR Lab's own embedded WAV metadata (BWF bext chunk)

"can you pull down the latest ir-lab from github from here? there was a
feature added to write metadata (optionally) to wav files, for the purpose
of using here". Pulled `C:\Users\Admin\ir-lab` (`main`, fast-forwarded) and
read the two commits that landed it: `870ca7d` (the write) and `f5066b6`
(its own doc, `docs/ir-lab-manager-shared-catalog-schema.md`, written
specifically to tell the other two apps how to treat it) — spec confirmed
from the real diff, not guessed.

**What IR Lab writes** (opt-in, off by default — its absence means
nothing): a standard BWF `bext` chunk via JUCE's
`WavAudioFormat::createBWAVMetadata()`. `Originator` is always the literal
`"IR Lab"`; `Description` holds `"Key: value | Key: value | ..."` pairs, in
order Cabinet/Speaker/Microphone/Position/Notes/CaptureType, blank fields
omitted. Never written to blend exports or the true-stereo pack file — only
single-capture exports.

**What was built here to read it, at zero extra I/O cost** — same
principle as 12c's WAV-header reading: the bext chunk is tiny (~610 bytes
fixed) and sits near the front of the file, so it's already inside the same
64KB buffer `quickHash.ts` reads for every file.

- `wavHeader.ts`'s chunk walk (already looking for `fmt `/`data`) now also
  recognizes `bext` and extracts `Description`/`Originator` at their fixed
  BWF byte offsets, trimmed at the first NUL rather than returning
  fixed-width trailing garbage. Null/null on the ~all files without one.
- `bwfCaptureMetadata.ts` (new): parses those two strings into actual
  fields. Trusts `Originator === 'IR Lab'` as its signal before parsing
  Description at all — the doc's own "cheap way to tell an IR Lab export
  apart from a WAV tagged by something else" — so a foreign tool's bext
  chunk is never misread as capture fields.
- `fieldConfidence.ts` (new): the confidence-ladder writer
  (`applyVendorParsers.ts`'s `upsertIrField`/`RANK` closure) extracted into
  its own module so a new source doesn't reimplement "never overwrite
  user_entered, never downgrade a higher-ranked field." A new rank,
  `ir_lab_embedded`, sits directly below `ir_lab_native` — which is exactly
  the doc's own precedence rule ("prefer the database row when one exists
  and resolves... fall back to the embedded chunk only for a WAV with no
  catalog row"): `ir_lab_native` (from `enrichLabProjects`, a live
  `.SessionData` folder) always outranks it and is never downgraded by it;
  `ir_lab_embedded` in turn outranks `vendor_parser`/`filename_inferred`
  guesses, so a real IR Lab export's own metadata can't be clobbered by a
  filename heuristic running afterward.
- `importLibrary.ts` writes the embedded fields at scan time, right where
  the WAV-header columns are already written from the same buffer:
  cabinet/speaker/microphone/position/capture_type through the ladder
  writer with source `ir_lab_embedded`; `notes` as a plain `item.notes`
  overwrite (no confidence tracking on that column at all — matches
  `labProjectEnrichment.ts`'s own existing convention for the same field).
- `ir_item_field_source.source`'s CHECK constraint gained the new value.
  SQLite can't ALTER a CHECK, so `runMigrations()` detects an existing
  table missing it (by sniffing the stored CREATE TABLE text) and rebuilds
  it: rename aside, recreate with the wider CHECK, copy rows across, drop
  the old one — same technique as `collection.folder_id` and the FTS5
  `item_search` rebuild earlier in this doc, applied to a CHECK instead of
  a column or an FTS5 table.

Not yet done: writing INTO exported WAVs from this side (NAM Lab is a
consumer of IR Lab's captures, not a producer of new ones, so there's no
symmetric "write bext back" need identified yet) — flagged here rather than
silently scoped out.

10 new tests (`wavHeader.test.ts`: bext extraction + NUL-trim;
`bwfCaptureMetadata.test.ts`: field parsing, Originator trust check, blank
fields omitted; `bwfEmbeddedMetadataScan.test.ts`: full scan-to-database
round trip, foreign-Originator rejection, and the "vendor parser can't
downgrade an embedded value" regression). irCatalog 107 tests total,
renderer 357, build clean.

## 12f. IR Lab's 2026-08-26 metadata model — Project Details + per-capture mic detail

"pull down the latest ir lab github" (again) turned up a much bigger change
than the previous pull: a whole new metadata model, with a handoff doc
(`docs/ir-lab-manager-handoff-2026-08-26.md` in the ir-lab repo) written
specifically for whoever picks up IR Lab Manager next. User confirmed scope
directly: "please review and implement to SQL and the IR section for
projects and capture data, both in the WAV and JSON."

**Two structs gained fields, confirmed against the real source (Domain.h,
ProjectStore.cpp, SessionStore.cpp, WavIO.cpp), not just the handoff doc's
own wording** — one correction found this way: the doc describes
CaptureMetadata as living in `analysis.json`; the actual code
(`SessionStore.cpp::writeSessionJson`) puts it in `session.json`'s
`"metadata"` key, same file this app's `labProjectEnrichment.ts` already
read for the original six fields.

- **`Project` (7 new fields, "Project Details" screen):** `cabinet`,
  `speaker`, `amplifier`, `room`, `signalChain`, `description`,
  `projectNotes` — entered once for the whole rig.
- **`CaptureMetadata` (15 new fields):** 3 flat (`speakerPosition`,
  `modeledMicrophone`, `presetKind`) + 16 structured per-mic fields (8 each
  for two fixed slots, Mic A / Mic B — type, polar pattern, target zone,
  distance+unit, axis angle, signal-chain override, notes). Two mic slots
  only, never N — matches ir-lab's real capture engine (no 3+ mic blend
  path anywhere in the codebase).

**Inheritance, not copy-on-write**: `cabinet`/`speaker` exist on both
levels. A blank capture-level value falls back to the project's value at
display/search time — never written back into the capture's own row.
`amplifier`/`room`/`signalChain` exist ONLY on `Project` — no per-capture
override field at all.

### What was built

- **Schema** (`schema.ts`): 19 new `ir_item` columns (the 3 flat + 16 mic
  fields) and 7 new `collection` columns (meaningful only for
  `kind='ir_project'`), plus migrations for both on an existing catalog.db
  (`ALTER TABLE ADD COLUMN`, guarded by `PRAGMA table_info`).
- **The 3-way fallback** (`queryLibrary.ts`): the browse SELECT's cabinet/
  speaker COALESCE now checks `ir_item` first, then the owning
  `ir_project` collection's own value (a correlated, `GROUP BY`-guarded
  subquery, not a JOIN — an item somehow belonging to two collections
  can't fan out into duplicate rows), then IR Lab Manager's own manual
  per-folder default (`folder_metadata_effective`) last. Project comes
  before the folder default because it's the more specific, authoritative
  source for that exact item. `facetClause` (the filter-bar WHERE
  builder) mirrors the same ladder, so filtering by a project-inherited
  badge matches exactly what's displayed. A new synthetic source label,
  `ir_lab_project`, shows in the FieldBadge tooltip when a value came from
  this fallback rather than the item itself.
- **FTS5 search** (`item_search`): gained `speaker_position`,
  `modeled_microphone`, `preset_kind`, `amplifier`, `room` — cabinet/
  speaker already carry the same collection-fallback value, so a search
  for a project-level cabinet name finds every capture that inherited it,
  not only ones that repeated it verbatim. Migration follows the same
  drop-and-rebuild-from-`getDb()` pattern as the earlier `audio` column.
- **Reading the new session.json fields** (`labProjectEnrichment.ts`):
  every flat/mic string field routes through the same `writeField()`
  confidence-ladder writer the original six fields use (source
  `ir_lab_native`) — cheap consistency, since nothing else in this app
  ever guesses these values, so there's no actual competing writer to
  rank against. The two numeric fields per mic (`distance`,
  `axisAngleDeg`) are written directly (the ladder writer only handles
  strings) — `distance` skips a value of exactly 0 (IR Lab's own "unset"
  convention, per `Domain.h`'s comment), `axisAngleDeg` does not (0° is a
  legitimate on-axis measurement, not an absence).
- **Reading the new project.json fields**: `collection.cabinet/speaker/
  amplifier/room/signal_chain/description/project_notes` are re-applied
  from `project.json` on every scan — there's no NAM Lab Manager UI that
  hand-edits a Project's own details yet, so unlike `ir_item`'s ladder
  there's nothing here to protect from being overwritten.
- **Mic B "is this real" gate — a doc gap, not an oversight**: the
  handoff doc recommends checking `ProcessingRecipe.multiMicBlendWeightRight
  > 0.01` before treating Mic B data as present (its fields exist even on
  a plain single-mic capture). Confirmed against the real source
  (`ProcessingRecipe.h`/`SessionStore.cpp`'s `recipeJson()`) that this
  field is **never actually serialized to analysis.json at all** — it's
  in-memory-only during a live capture. On disk, "the field is non-blank"
  is the only signal available, so that's what's used; a stale/default
  Mic B value could in theory still land here on a non-blend capture.
  Documented as a known limitation in `labProjectEnrichment.ts`, not
  silently worked around.
- **bext chunk**: only `MicADistance` was added on IR Lab's side (256-byte
  hard limit — see that repo's own commit `0671c35`), combined
  value+unit as one token (`"MicADistance: 3.50in"`).
  `bwfCaptureMetadata.ts` splits it back into `micADistance`/
  `micADistanceUnit`; `importLibrary.ts` writes it directly (numeric,
  bypasses the string-only ladder writer, same as the JSON-side fields).
- **UI** (`IrProjectTab.tsx`): the Project tab now shows the project-level
  "Rig / Project Details" block (cabinet/speaker/amp/room/chain/
  description/notes) above the per-capture list; each capture shows its
  own speaker position/modeled mic/preset badges plus a collapsible-by-
  content Mic A/Mic B detail block (type/pattern/zone/distance/angle/
  chain/notes) — rendered only when that slot actually has something
  filled in, for the same "meaningless when blank" reason as the backend
  gate above. Capture rows also apply the cabinet/speaker fallback
  locally (`item.cabinet ?? detail.cabinet`) so this tab's own display
  matches what the browse list shows for the same item.

### Known gaps / deliberately not done this pass

- The browse row/`FieldBadge` UI and `IrLibraryOverview`'s manufacturer/
  cabinet/speaker/microphone breakdowns do **not** yet show the 19 new
  capture-level fields or `amplifier`/`room` as filter-bar multiselects —
  scoped out to keep this pass to schema + inheritance + the Project tab,
  per the explicit choice made when this was scoped ("Full schema +
  inheritance + UI" was chosen over a UI-only or bare-schema pass, but
  "UI" here means the Project tab, not every existing surface).
- **Future idea, flagged by the user, not scheduled**: a cabinet with
  mixed speakers (e.g. top two Celestion V30, bottom two G12H) is
  expressible today via `speakerPosition` (Top-Left/Top-Right/etc.) +
  per-capture `speaker` override, but there's no persistent mapping from
  "this position" to "always this speaker model in this cab" — the
  operator retypes the speaker model each time it differs from the
  project default. Worth revisiting once used on a real mixed-cab
  session, not before.

irCatalog 112 tests (5 new this pass: cabinet/speaker project-fallback in
queryLibrary, three MicADistance bext cases, extended labProjectEnrichment
fixtures/assertions), renderer 357, build clean.

## 12g. Removing a folder/root from the catalog, and how deleted files are detected

User asked directly: "how do we manage changes to folders, or remove from
library. right click a folder and remove it and its children, with a
confirm dialog. what if I delete the folder [on disk] — how would we know,
without constantly scanning? how do other apps handle this at large scale?"

**Answer to the second question first, since it shapes the first**: no
live filesystem watcher exists for IR mode (`library_root.watch_mode` has
had a `'watched'` option in the CHECK constraint since Phase 1, but nothing
has ever implemented it — every root is inserted as `'manual'`). Detection
is scan-time only: `importLibrary.ts`'s existing `missing_since` mechanism
marks any item not re-found during a scan (never deletes the row), and
clears it if the file reappears later. This is deliberate, not a gap to
rush — constantly watching tens/hundreds of thousands of files across
network drives and external volumes is exactly the "waveform-thumbnail
cold-start problem" class of issue flagged as an open question in the
shared catalog schema doc, and it's how large-library apps in this space
actually behave: Lightroom doesn't live-watch a catalog's source folders
either — it scans on demand/at launch and shows missing files with a
"can't find" badge for the user to relink or remove in bulk, rather than
trying to react to every filesystem change in real time. **File → Rescan
Library already gives this app the same capability**; a live watcher would
only be worth adding later if the manual-rescan cadence turns out to be
actually annoying in practice.

**Folder/root removal** (`removeFromCatalog.ts`, new): right-clicking any
folder in the tree (a plain subfolder or a whole added library root) now
offers a destructive context-menu item, gated behind a confirm dialog that
fetches and shows a real item/folder count first — never a blind "are you
sure?". Two entry points because the two things being removed are
different in blast radius:

- **A subfolder** (`removeFolderFromCatalog`): deletes just that folder's
  full subtree — items, folders, and any `ir_project` collection anchored
  inside it — scoped via the same `resolveFolderScopeIds` every other
  folder-scoped query in this app already uses. Siblings and the rest of
  the `library_root` are untouched.
- **A whole root** (`removeLibraryRoot`): everything under that added
  library folder, then the `library_root` row itself. Re-running "Add
  Library Folder…" on the same path re-adds it from scratch.

**Never touches a real file.** Both functions only ever `DELETE` rows in
`catalog.db` — "remove" means "stop tracking this," matching the
disposable-index principle the whole schema is built on (delete
`catalog.db` entirely and a rescan rebuilds it).

**Why this needed care, not just two `DELETE` statements**: `PRAGMA
foreign_keys = ON` is set (schema.ts), but `folder.library_root_id` and
`item.folder_id`/`item.library_root_id` are deliberately NOT `ON DELETE
CASCADE` — a stray `DELETE FROM library_root` should never silently
cascade away a whole library by accident. So removal here is an explicit,
ordered delete (`collection` first, since collection_item/checklist_item/
delivery_target/asset_file all cascade from IT; then `item`, which
cascades ir_item/ir_item_field_source/item_tag/ir_derivative_variant and
fires the existing `item_search_ad` trigger so the FTS index stays live
in sync with no `finalizeIndexes()` call needed; then `folder` last).
5 new tests confirm the ordering doesn't orphan rows or leak across
sibling folders/roots.

irCatalog 117 tests (+5 this pass), renderer 357, build clean.

## 12h. Detecting a missing file at open-time — highlight, and offer to remove or restore

Direct follow-up to 12g's "how would we know if a file gets deleted, without
constantly scanning": "highlight the capture if someone tries to open one
and realizes it doesn't exist... maybe we could make it smarter, by
searching up from the file to see if all files in the folder, or its
parent(s), are also missing... alert the user, ask if they want to remove
from the app or find the folder and restore it."

Checked exactly once, at the moment `openPlayer` is actually invoked (Play/
Play Live) — not a timer, not per-render, consistent with 12g's "detect on
demand, not a live watcher" model. A single `fs.existsSync` round trip is
imperceptible; it's not an OS dialog, so this doesn't reintroduce the
earlier "why does play open a file picker" bug.

- **`missingFileCheck.ts` (new)**: `checkItemAvailability(db, itemId)`
  stats the item's own file first. If it exists, nothing else happens. If
  not, it marks `missing_since` on the item immediately (so the row's own
  "Missing" badge — new `chip-ir-missing` red pill — updates live, without
  waiting for a rescan), then walks UP from the library root DOWN to the
  item's folder (root first, then each subfolder in turn), stopping at the
  **shallowest** missing ancestor. That's deliberate, not incidental: if a
  whole cabinet subfolder got deleted, everything nested inside it is
  necessarily also gone, but reporting the topmost missing folder is what
  lets the dialog offer one action that actually fixes the real scope,
  instead of reporting each descendant file as its own separate problem.
  Three outcomes: `'item'` (just this file), `'folder'` (a subfolder and
  everything in it), `'root'` (the whole added library folder is gone —
  e.g. moved, renamed, or a drive letter changed).
- **The dialog** (`IrModeShell.tsx`) explains which scope was hit, how many
  other captures share it, and offers:
  - **Remove from Catalog** — always available. Routes to whichever of
    12g's existing functions matches the scope: the new
    `removeItemFromCatalog` (one row) for `'item'`,
    `removeFolderFromCatalog` for `'folder'`, `removeLibraryRoot` for
    `'root'`.
  - **Locate Folder…** — only offered for `'root'`. Opens the existing
    native folder picker, then `relinkLibraryRoot` repoints
    `library_root.path` at the new location (a plain `UPDATE` — `path` is
    `UNIQUE`, so the very next scan against that same path resolves back
    to this same root row via its existing `ON CONFLICT(path)` upsert,
    re-validating every folder/item under the new location), followed
    immediately by the normal scan pipeline to actually re-populate it.
  - **Leave it** — dismisses with no action; the row stays flagged
    `missing_since` until it either reappears on a later scan or the user
    removes it.
- **Why "Locate…" isn't offered for `'folder'`**: `relative_path` is
  stored relative to `library_root.path`. A subfolder that moved to
  somewhere NOT still nested under that same root path has no clean way to
  be represented without either treating the whole root as having moved
  (the `'root'` case above) or introducing per-item absolute-path
  overrides — explicitly out of scope for this pass. Documented in
  `relinkLibraryRoot`'s own comment, not silently unsupported.

irCatalog 122 tests (+5: exists/not-missing no-op, item-scope, the
shallowest-ancestor-not-deepest folder case, whole-root case, single-item
removal), renderer 357, build clean.

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
- **TODO, explicitly deferred by the user ("add a to do, will scope further later"): play a whole
  group from the Selection Tray.** Ask was: a way to "play group" from the tray, opening the
  player with prev/next buttons that cycle through exactly that group's members (not the full
  browse list — `PlayerPanel`'s existing arrow-key row-stepping walks the CURRENT filtered browse
  list, which isn't the same thing as a fixed, named set of IRs). Needs its own scoping pass before
  building: does prev/next wrap around or stop at the ends; does opening it also apply the group
  filter to the browse list underneath (so the two stay visually in sync) or leave browse alone;
  does the tray needs its own "Play Group" entry point distinct from Groups' existing filter
  button, since the tray and Groups are two different member-list concepts today.

## 12i. Panel resize range, and the group filter not actually isolating group members

Two bugs reported together, both real:

- **"seems i cant drag the right panel very far, give it way more space to move left"**: the
  panel's own resize handle capped it at a flat 480px regardless of window size — plenty of room
  went unused on a wide window. Changed to a dynamic bound (`IrModeShell.tsx`'s
  `onPanelDragStart`), matching NAM Lab's own App.tsx pane-resize convention: `window.innerWidth -
  treeWidth - 300`, reserving 300px for the list column so it narrows rather than disappearing.
- **"filtering groups still does nothing, i see an item in the group but its not in the list when
  i click it"** — reported again after the earlier fix (12g's session) that cleared folder/root
  scope on group selection. That fix was necessary but not sufficient: ANY other active filter —
  a facet chip, Favorites/Rated, leftover search text — ANDs with `tagId` the same way folder/root
  scope did, so a group's item could still be silently hidden by whatever the user had been
  browsing with before clicking the group. `selectTagFilter` now clears every narrowing filter
  (facets, audioFacets, favoritesOnly, ratedOnly, search) alongside folder/root scope, not just
  the two that caused the first report — clicking a group should always show exactly its members.
