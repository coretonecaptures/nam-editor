# IR Lab Manager — build plan

Supersedes `docs/ir-lab-manager-shared-catalog-schema.md` (kept for history; this
doc is the authoritative one going forward). Written 2026-08-24. Planning only
— nothing here has been implemented. This same file lives in both `ir-lab` and
`nam-editor`, since the two repos build different halves of one system.

## 0. Repo split — who builds what

| Repo | Visibility | Builds |
|---|---|---|
| `nam-editor` | Public, MIT | The NAM/IR mode-switcher shell, the entire IR Lab Manager catalog/scan/audition/search/parser stack, the tray UI. Everything in sections 2-9 below. |
| `ir-lab` (this repo) | Private | The receiving side of the IR Lab handoff: URL-scheme registration, single-instance forwarding, wiring an incoming request into the existing `reopenSession()`/Blender-slot-population code. Section 10 below. Already private — no new repo needed for this half. |
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

SQLite, WAL mode. One catalog file, `catalog.db`, owned and located by
IR Lab Manager (app-support path, never inside a watched/portable library
folder — see reconciliation notes at the end).

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
-- user has ever touched it -- created lazily by the scanner the first time
-- an item is found inside it. This is deliberately separate from
-- `collection` (section 6): a folder record exists because the scanner saw
-- it, a collection exists because the user (or IR Lab) explicitly made one.
CREATE TABLE folder (
  id               INTEGER PRIMARY KEY,
  library_root_id  INTEGER NOT NULL REFERENCES library_root(id),
  relative_path    TEXT NOT NULL,       -- '' for the root itself
  notes            TEXT,
  UNIQUE (library_root_id, relative_path)
);

-- Facts a folder declares for everything under it -- e.g. "this whole
-- OwnHammer pack folder is a Marshall 412" -- inherited downward by every
-- item whose folder_id resolves here (see section 5's inheritance rule).
-- One row per (folder, field); a child folder's own row for the same field
-- overrides the parent's when present.
CREATE TABLE folder_metadata (
  folder_id  INTEGER NOT NULL REFERENCES folder(id) ON DELETE CASCADE,
  field      TEXT NOT NULL,             -- 'manufacturer' | 'cabinet' | 'speaker' | ...
  value      TEXT NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('vendor_documentation', 'user_entered', 'ir_lab_native')),
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
  content_hash     TEXT,                -- lazy/background, for duplicate detection
  rating           INTEGER,             -- 1-5, independent of...
  is_favorite      INTEGER NOT NULL DEFAULT 0,  -- ...this: a binary flag, different concept
  notes            TEXT,
  UNIQUE (library_root_id, relative_path)
);
CREATE INDEX idx_item_kind    ON item(kind);
CREATE INDEX idx_item_folder  ON item(folder_id);
CREATE INDEX idx_item_missing ON item(missing_since) WHERE missing_since IS NOT NULL;

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
-- a provenance tag (see ir_item_field_source below), not a structural fork
-- -- an IR from your own capture and an IR from Ownhammer have the same
-- shape of fields, just different confidence per field.
CREATE TABLE ir_item (
  item_id         TEXT PRIMARY KEY REFERENCES item(id) ON DELETE CASCADE,
  capture_id      TEXT UNIQUE,          -- IR Lab's own captureId; NULL for third-party
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
-- analysis.json) > vendor_documentation (an imported info sheet) >
-- vendor_parser (a structural recognizer, e.g. the Ownhammer path shape) >
-- filename_inferred (generic gear-vocabulary token match) > user_entered
-- (hand-typed, trusted absolutely once set). A field with no row here has
-- no known source -- blank, not guessed.
CREATE TABLE ir_item_field_source (
  item_id  TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
  field    TEXT NOT NULL,
  source   TEXT NOT NULL CHECK (source IN (
              'ir_lab_native', 'vendor_documentation', 'vendor_parser',
              'filename_inferred', 'user_entered')),
  PRIMARY KEY (item_id, field)
);

-- IR Lab's existing DerivativeVariant concept (src/session/SessionStore.h),
-- indexed here for IR-Lab-native items only.
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

CREATE VIRTUAL TABLE item_search USING fts5(
  item_id UNINDEXED,
  display_name, notes, manufacturer, cabinet, speaker, microphone,
  mics, tone_type, gear_make, gear_model
);
```

**Design principles carried through unchanged from the earlier doc:** files
stay on disk, the DB never holds audio; identity is a UUID, never a path;
single writer per table family (IR Lab writes its own `ir_item`/
`ir_derivative_variant` rows for `capture_id`-bearing items, IR Lab Manager
writes everything else); the DB is authoritative for IR Lab Manager's own
data, disposable and rebuildable by rescan, never the only copy of anything.

## 3. Confidence ladder (drives both ingestion and the UI)

Highest to lowest, per field, per item:

1. `ir_lab_native` — read directly from IR Lab's own `analysis.json`
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
- **IR Lab's own root(s) are `watch_mode = 'watched'`**, pointed at finished-output locations only (a Project's `outputRoot`, "Named Exports") — never IR Lab's internal `.SessionData`/staging tree. This is what makes an IR-Lab-produced file arrive looking like any other WAV, optionally enriched by `analysis.json` if it's sitting alongside.
- **Scanner is batched and resumable.** Transactions of ~2,000-5,000 rows, progress reported to the UI, cancelable mid-scan. This is non-negotiable at the scale a real vendor pack represents (Ownhammer alone: 226K files in one import) — validate this in isolation before any UI work (see Phase 1 below).
- **Folder metadata inheritance**: when populating `ir_item` for a new item, first check `folder_metadata` up the item's folder chain (nearest ancestor wins) before falling back to filename inference. A folder-level fact never gets overwritten by a lower-confidence per-item guess.

## 5. Vendor parsers

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

## 6. Search

- SQLite FTS5 (`item_search`, defined above) for text search across name/notes/all descriptive fields, populated by triggers on `item`/`nam_capture_item`/`ir_item` insert/update.
- Faceted filtering as a secondary, click-to-narrow UI layer on top of the same indexed columns (not raw LIKE scans) — cabinet/speaker/mic/manufacturer as clickable chips.
- Every result row shows its confidence tier inline (small dot/badge per matched field), per section 3.

## 7. Audition

Two modes only — no third "audition a big batch automatically" mode; see the
ear-fatigue reasoning already agreed on.

**Quick audition** — adapted from NAM Lab's existing engine, not built new:
- Port `useAudition.ts`'s render-ahead pool, bounded clip cache (currently 64 clips / 5s each), and the generation-counter fix for overlapping playback.
- Port `audioGraph.ts`'s `applyCabinetIr()` as the actual convolution step.
- Drop the NAM WASM model worklet entirely — this workflow is DI → `ConvolverNode` against the selected IR → out. Strictly simpler than what's already shipped and running for NAM captures.
- Bind to arrow-key navigation through the current filtered result list, plus click.

**A/B** — hold exactly two candidates, instant toggle between them, no queue beyond two. This is the one "compare" primitive worth building; anything beyond it fights the same fatigue problem a full batch-audition feature would.

## 8. The tray → Send to IR Lab

- A `collection` row with `kind = 'tray'`, max 8 `collection_item` rows (matches `LiveAuditionEngine::blendPreviewSlotCount = 8` in `ir-lab/src/audio/LiveAuditionEngine.h:340` exactly — not an arbitrary UI limit).
- Add/remove from the tray is a deliberate action, not a side effect of auditioning — auditioning and collecting are two different verbs.
- "Send to IR Lab" is the only place the private connector code runs (public side): build the payload (tray's ordered item paths + display names), then call the injected, build-time-private `sendToIrLab(payload)` function. In a self-built (non-official) `nam-editor` build with no private config injected, this function is a documented no-op — the button can even be visible, it just explains "not available in this build."

## 9. UI shell — NAM Lab mode switcher

- Top-level mode switch: **NAM** | **IR**, persisted per-window like any other view preference.
- IR mode is its own route tree, its own top-level state slice, its own components directory (e.g. `src/renderer/src/components/ir/`) — touches existing NAM screens for exactly one thing: the crossover hook (audition an IR against whatever NAM capture is currently open in NAM mode), which should be a narrow, explicit prop/event, not a shared global store.
- New IPC channels needed in `src/main/index.ts` (additive to the existing list in `nam-editor/CLAUDE.md`): `irLibrary:addRoot`, `irLibrary:scan` (progress-reporting, cancelable), `irLibrary:query` (paginated), `irLibrary:updateFolderMetadata`, `irLibrary:importDocument`, `irLibrary:readAudio` (for the audition engine to decode), `irLibrary:sendToIrLab` (wraps the private connector call).

## 10. IR Lab's side (private, built in this repo)

- Custom URL scheme registration (e.g. `irlab://`), platform handler registration at install time.
- Single-instance enforcement: `moreThanOneInstanceAllowed()` returns false; `anotherInstanceStarted(commandLine)` parses the incoming URL.
- Payload → action mapping:
  - `irlab://session/<captureId>` → resolve via the catalog/`SessionStore`, call the existing `reopenSession()` → `loadSessionIntoReview(..., showWorkbench=true)` path (`MainComponent.cpp:4799`) — no new loading logic.
  - `irlab://blend?items=<id1,id2,...id8>` → resolve each path, populate Blender's library slots (up to the existing 8-slot cap), switch to the Blender workspace.
  - `irlab://project/<projectId>/capture?preset=<name>` → select the project, jump to Capture, pre-apply the preset.
- **Interruption policy**: if a capture or live audition is active when a handoff arrives, confirm before discarding — do not silently interrupt in-progress work.
- Depends on nothing from `nam-editor` except the documented payload shape (which is the one thing that stays private, matching section 0's table).

## 11. Phased build order

1. **Bulk-import stress test, standalone, no UI.** Point the batched scanner at a real large library (your own ~525K-file `Impulse Responses` folder is the actual test fixture). Measure wall-clock, memory, resumability. This is the one genuinely unproven risk — everything else in this plan is proven-elsewhere or straightforward. Do not proceed past this until it holds up.
2. **Read-only virtualized browse + search**, no organization features yet. List/grid over the catalog, FTS5 search, confidence badges, favorite/rating working. This alone should already feel better than Explorer for a big library — validate that claim here before building more.
3. **Vendor parsers**: generic filename-vocabulary fallback first (broadest coverage, least code), then Ownhammer, then RedWirez.
4. **Quick audition**, ported from NAM Lab per section 7.
5. **Folder notes + vendor document import**, with inheritance (section 4/section 2's `folder_metadata`/`folder_document`).
6. **Tray + IR Lab handoff** (sections 8 and 10, built together since they're two halves of one feature) — this is the point where the private connector piece is actually needed; everything before it ships fully functional without it.
7. **A/B audition, tags, collections beyond the tray** — polish layer, no new architecture.

Deferred, explicitly out of scope until requested: acoustic/fingerprint
similarity search, non-WAV formats, user-customizable parser definitions.

## 12. Open, non-blocking decisions

- Exact IR Lab license enforcement point/timing — the user has already noted this can land before final release, independent of this plan.
- Whether IR mode ships free indefinitely or some future piece becomes paid — doesn't change anything built here; only changes what gets injected into the private connector config later.
