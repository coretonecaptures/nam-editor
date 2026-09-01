# NAM Lab — technical debt register

Date: 2026-08-31. Scope: `feature/ir-lab-manager` vs `master` (`df29cd8`) —
106 files, +28 855 / −9 711. Ranked by cost-to-carry, not size.

Verification gates that actually run and pass: `npx electron-vite build`
(clean), `npx vitest run` (449 pass / 80 skipped). Neither `tsc` project is a
gate.

---

## D1 — `tsc` is not a build gate; both projects carry a large error baseline

- `tsc -p tsconfig.node.json` → **35 errors**
- `tsc -p tsconfig.web.json` → **130 errors**

`electron-vite build` uses esbuild/swc transpilation, which ignores type
errors, so the app builds and ships with 165 unresolved type errors. This
means TS gives **no safety on a change** — a real type regression looks
identical to the baseline noise, which is exactly why the NAM Projects work
this cycle had to be verified by "build + vitest + manual error-count diff"
instead of "tsc clean."

Breakdown:

**Node (35):** almost entirely `src/main/index.ts`'s local
`TrainerStartPayload` / `TrainerQueueJob` / `TrainerHistoryEntry` interfaces
drifting from the canonical `src/shared/trainer.ts` (fields `namMode`,
`modelNameSuffix`, `normalizeWav*`, `validationEsrFull`, `retriedAt`,
`'staged'` status, etc. present in one and not the other). This is **already
diagnosed** with a leaf-first remediation plan in
`docs/trainer-types-dedup-plan-2026-08-31.md`. Nothing new was added to the
drift this cycle beyond one deliberate `namMode` field.

**Web (130):** dominant categories —
- **53× `TS2339` "Property X does not exist on `window.api`"** — renderer code
  calls `setCompanionContext`, `aiEnrich`, `folderWatchResync`,
  `onFolderWatchImportsBackfilled`, `downloadCoverFromUrl`,
  `copyLocalCoverFile`, `startQueuedTrainerRuns`, … that **are not in the
  preload `api` object**. These are latent runtime `undefined is not a
  function` bugs from feature branches (`feature/player`, `feature/trainer`,
  `advanced-pdf`) that were merged renderer-first without their preload half.
  `TrainingPanel.tsx` alone has 42.
- **33× `TS6133`** unused declarations — harmless, pure noise, but they hide
  the real ones.
- **14× `TS2769`** no-overload — mostly in `PackInfoEditor.tsx` /
  `MetadataEditor.tsx`.

**Recommendation.** (a) Land the trainer-types dedup plan → clears most of the
node 35. (b) Triage the 53 `window.api` misses — each is either a missing
preload export (fix) or dead renderer code (delete); they are real bugs, not
type pedantry. (c) Then flip `tsc --noEmit` (both projects) into the
pre-commit / CI gate so the baseline cannot regrow.

---

## D2 — `window.api` has no shared contract; the type is inferred from the preload literal

The renderer's `window.api` type is whatever TypeScript infers from the object
literal in `src/preload/index.ts` (that is why the D1 errors read
`type '{ openFiles: …; 157 more …; }'`). There is no
`interface NamLabApi` that both the preload implementation and the renderer
`declare global` block are checked against. Consequences: adding an IPC method
means editing 3 places (main handler, preload literal, `App.tsx`
`declare global`) with nothing enforcing they agree, and a renderer call to a
non-existent method is a 2339 lost in the baseline (D1).

**Recommendation.** Define `interface NamLabApi` in `src/shared/`, type the
preload object `const api: NamLabApi = {…}` (surfaces missing/misnamed methods
at the source), and `declare global { interface Window { api: NamLabApi } }`.

---

## D3 — Renderer shell files are oversized; three parallel shells duplicate idioms

| File | Lines | Note |
| --- | --- | --- |
| `src/main/index.ts` | 9 435 | main process, everything |
| `src/renderer/src/App.tsx` | 6 430 | NAM mode shell |
| `src/renderer/src/components/PackInfoEditor.tsx` | 2 621 | |
| `src/renderer/src/components/ir/NamProjectsShell.tsx` | 2 392 | +1 234 this cycle; ~12 components inline |
| `src/renderer/src/components/ir/IrModeShell.tsx` | 1 365 | |
| `src/renderer/src/components/MetadataEditor.tsx` | 1 254 | |

`NamProjectsShell.tsx` and `IrModeShell.tsx` are separate shells (justified —
different columns, no audition half in NP) but re-implement the same
patterns by copy: three-region layout, col-resize divider (`dragging` ref +
mousemove/up effect), `readStored`/`writeStored` localStorage helpers, filter
box + status chips, `nam-chip` pills, context-menu wiring. `ContextMenu` was
already extracted (`15c59f9`) after NAM and IR diverged; the divider, the
storage helpers, and the filter-bar shell are the next obvious extractions.

**Recommendation.** (a) Split `NamProjectsShell.tsx` into a directory
(`namProjects/` — `ProjectHeader`, `CaptureRow`, `CaptureCard`,
`CaptureDetailPanel`, `MetadataEditor`, `FacetPills`, `facets.ts` pure
helpers, `NamProjectsShell.tsx` container). (b) Extract
`useResizableRail()` and `useLocalStorageString()` hooks and a
`<FilterBar>` shell into `components/ir/shared/`. (c) `index.ts` and `App.tsx`
are their own long-standing problem — at minimum, carve the trainer subsystem
out of `index.ts` into `src/main/trainer/`.

---

## D4 — SQLite migrations are open-coded table surgery, no backup, no framework

`schema.ts` (737 lines) performs schema evolution by hand:
`ADD COLUMN` loops, and for `CHECK`-constraint changes a full
`CREATE _new / copy / DROP / RENAME` rebuild. This **corrupted a real
`catalog.db` twice this session** (`358cf43`, `d930141` — orphan
`collection_old`, then FK refs rewritten to `collection_old` by `RENAME TO`
under `legacy_alter_table = OFF`). It is now hardened + has 3 regression tests,
but:

- No `PRAGMA user_version` / ordered migration list — migration logic is
  `if (columnMissing)` / `if (sqlLacksToken)` probes scattered in one
  function. Adding the 5th such probe is how the corruption happened.
- **No pre-migration backup.** Recovery required an external `sqlite3.exe`.
- The rebuild is open-coded per constraint change rather than one tested
  helper.

**Recommendation.** Introduce `user_version` + an ordered
`migrations: Array<(db) => void>`; copy `catalog.db` → timestamped `.bak`
before any run that alters a table (keep last 3); one `rebuildTable()` helper.
The catalog is derived data (re-scannable), so this is availability debt, but
"re-scan 17 000 items" is the current failure cost.

---

## D5 — FTS5 availability is environment-dependent → 14 test files skip locally

`node:sqlite` on the dev machine (SQLite 3.47.2) lacks the FTS5 module, so
`finalizeIndexes` / `item_search` throw `no such module: fts5`. 14–15 test
files guard with `describe.skipIf(!hasFts5())` — that is the **80 skipped
tests** in every `vitest run`. Electron's bundled `node:sqlite` *does* have
FTS5, so search works in the shipped app but its test coverage never runs in
local dev or in any CI that uses plain Node.

**Recommendation.** Run the test suite under Electron's Node (or a SQLite
build with FTS5) in CI so the search path is actually exercised; document the
required SQLite build in `CONTRIBUTING`. Pin the Electron version that
provides FTS5 and note the dependency explicitly.

---

## D6 — Cross-shell navigation is module-level mutable singletons

`src/renderer/src/appNav.ts` (53 lines) is a hand-rolled pub/sub with
module-scope arrays of callbacks (`goToTrainingBatches`, `onGoToTrainingBatches`,
`consumePendingTrainingNav`, …), deliberately outside React so it survives an
`<App/>` remount when `AppRoot` flips mode. It works, but it is implicit global
state with one-shot "pending nav" flags read on mount — the kind of thing that
is fine at 2 call sites and a debugging nightmare at 10. The mode switch it
drives is itself an overlay button (`AppRoot.tsx`) flagged separately in
`docs/nam-projects-2026-08-31-audit-and-switcher.md` Part B.

**Recommendation.** Acceptable for now; if a third cross-shell intent appears,
promote to a single typed event bus (`navBus.emit('training:batches')`) with
one subscription point in `AppRoot`, rather than a function per intent.

---

## D7 — No component/integration tests for either IR shell; pure helpers untested

`IrModeShell.tsx` and `NamProjectsShell.tsx` have **zero** tests. The backend
enrichment layer is well covered (`namCaptureEnrichment.test.ts`,
`queryLibrary.test.ts`, `schema.test.ts`, `wavHeader.test.ts`, …), but the
renderer side of this whole feature is verified only by `electron-vite build`
succeeding. The newly added pure functions — `matchesFacets`,
`availableFacets`, `toBatchItem`, `relTime`/`formatBytes`/`audioLabel` — are
trivially testable and currently untested.

**Recommendation.** Extract the pure facet/format helpers to
`namProjects/facets.ts` + `format.ts` and unit-test them (no React runtime
needed). Add a smoke render test per shell with a fixture project.

---

## D8 — Duplicated read models: `src/shared/*` + re-export shims

`src/shared/trainer.ts`, `src/shared/namProjects.ts`, `src/shared/wavFormat.ts`
each have a re-export shim at the old `src/renderer/src/types/*` path
(`export * from '../../../shared/…'`). This was the right call to stop
main/preload/renderer copies drifting, but the shims are permanent
indirection. `src/shared/trainer.ts` (462 lines) is *also* still shadowed by
`index.ts`'s local interfaces (D1) — the dedup is half-done.

**Recommendation.** After the trainer-types dedup plan lands, delete the
`types/*` shims in one sweep and repoint imports to `src/shared/*` directly
(codemod-able).

---

## Suggested order

1. **D1 + D2** — trainer-types dedup (plan exists) and the `NamLabApi`
   interface. Clears ~35 node + a chunk of web errors and makes `tsc` a
   viable gate.
2. **D4** — `user_version` migrations + pre-run backup. Stops the recurring
   catalog corruption.
3. **D7 / D3a** — split `NamProjectsShell.tsx`, extract + test the pure
   helpers.
4. **D5** — CI on an FTS5-capable runtime.
5. **D3b/c, D6, D8** — opportunistic.
