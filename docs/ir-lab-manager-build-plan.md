# IR Lab Manager — build plan

Supersedes `docs/ir-lab-manager-shared-catalog-schema.md` (kept for history; this
doc is the authoritative one going forward). Written 2026-08-24, revised
2026-08-24 after a design review surfaced a real cross-app database coupling
problem (section 0/2) plus several underspecified pieces (folder inheritance
cost, reconciliation, FTS5 bulk-load overhead, hash-queue strategy) — all
resolved below, not just noted. Planning only — nothing here has been
implemented. This same file lives in both `ir-lab` and `nam-editor`, since the
two repos build different halves of one system.

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
  content_hash     TEXT,                -- NULL until the background hash queue reaches it; see section 4
  rating           INTEGER,             -- 1-5, independent of...
  is_favorite      INTEGER NOT NULL DEFAULT 0,  -- ...this: a binary flag, different concept
  notes            TEXT,
  UNIQUE (library_root_id, relative_path)
);
CREATE INDEX idx_item_kind    ON item(kind);
CREATE INDEX idx_item_folder  ON item(folder_id);
CREATE INDEX idx_item_missing ON item(missing_since) WHERE missing_since IS NOT NULL;
CREATE INDEX idx_item_hash    ON item(content_hash) WHERE content_hash IS NOT NULL;

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
-- disabled and this is populated in one pass afterward via
-- INSERT INTO item_search(item_search) VALUES('rebuild') -- FTS5's own
-- documented bulk-load path. Per-row triggers during a 200K+-row import
-- would triple write volume (three source tables, one search index write
-- each) at exactly the moment throughput is being stress-tested; see
-- section 11 Phase 1, where this gets measured, not assumed.
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
- **Scanner is batched and resumable.** Transactions of ~2,000-5,000 rows, progress reported to the UI, cancelable mid-scan. FTS5 triggers are disabled for the duration and rebuilt in one pass afterward (see the `item_search` comment above). This is non-negotiable at the scale a real vendor pack represents (Ownhammer alone: 226K files in one import) — validate this in isolation before any UI work (see Phase 1 below).
- **Folder metadata inheritance resolves once per folder, not per item.** When a folder's own `folder_metadata` changes (or a new folder is created), recompute `folder_metadata_effective` for that folder by walking `parent_id` to the root (nearest ancestor wins) — a cheap operation at folder-count scale (hundreds, even under a huge pack). Every item then reads its own `folder_id`'s already-resolved row directly; no per-item ancestor walk, ever.
- **`content_hash` is computed by a background worker pool, not inline with scanning.** Reuse `nam-editor`'s existing `scanRenderPool.ts` pattern rather than building a second one. This is best-effort and explicitly allowed to lag behind a huge import by a long time — nothing in browse, search, or audition depends on it being complete, only duplicate detection and hash-based relink do (see reconciliation below). Show a plain progress counter ("342,000 / 495,000 hashed"), not a completion promise.

## 5. Reconciliation & move detection

- A scan that can't resolve a previously-indexed `relative_path` sets `missing_since`; the row is never deleted.
- A scan that finds a file it hasn't indexed before, before creating a new `item` row, checks it against currently-missing items in this order:
  1. **Exact `content_hash` match** (only possible once the hash queue has reached that item) → silently relink: update the existing row's `relative_path`/`folder_id`, clear `missing_since`, keep the same `item.id` — every rating/tag/collection membership survives untouched.
  2. **Same filename + same file size, different folder, no hash yet** → surfaced to the user as a suggested relink, never auto-merged at this confidence level.
  3. **No match** → genuinely new item; the old row stays `missing_since`-flagged, waiting for the bulk reconcile/repair UI (Lightroom-style "N items missing, relink or remove?") already scoped for later.
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

1. **Bulk-import stress test, standalone, no UI.** Point the batched scanner at a real large library (your own ~525K-file `Impulse Responses` folder is the actual test fixture). Measure wall-clock, memory, resumability, FTS5 rebuild-pass cost, and how far behind the content-hash queue falls. This is the one genuinely unproven risk — everything else in this plan is proven-elsewhere or straightforward. Do not proceed past this until it holds up.
2. **Read-only virtualized browse + search**, no organization features yet. List/grid over the catalog, FTS5 search, confidence badges, favorite/rating working. This alone should already feel better than Explorer for a big library — validate that claim here before building more.
3. **Vendor parsers**: generic filename-vocabulary fallback first (broadest coverage, least code), then Ownhammer, then RedWirez.
4. **Quick audition**, ported from NAM Lab per section 8.
5. **Folder notes + vendor document import**, with inheritance (section 2's `folder_metadata`/`folder_metadata_effective`/`folder_document`) and reconciliation (section 5).
6. **Tray + IR Lab handoff** (sections 9 and 11, built together since they're two halves of one feature) — this is the point where the private connector piece is actually needed; everything before it ships fully functional without it.
7. **A/B audition, tags, collections beyond the tray** — polish layer, no new architecture.

Deferred, explicitly out of scope until requested: acoustic/fingerprint
similarity search, non-WAV formats, user-customizable parser definitions.

## 13. Open, non-blocking decisions

- Exact IR Lab license enforcement point/timing — the user has already noted this can land before final release, independent of this plan.
- Whether IR mode ships free indefinitely or some future piece becomes paid — doesn't change anything built here; only changes what gets injected into the private connector config later.
