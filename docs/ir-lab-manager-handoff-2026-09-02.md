# IR Lab Manager — session handoff / upcoming milestones (2026-09-02)

Written so a fresh session (possibly a different account) can resume cold. All work is on
branch **`feature/ir-lab-manager`** — do not merge to `main`, keep committing there.

---

## Where things stand

Recent shipped work (newest first), all pushed to `origin/feature/ir-lab-manager`:

| Commit | What |
| --- | --- |
| `6172201` | TODO: added a `## UI test harness` section (3 tiers) |
| `0406fba` | `docs/security-review-2026-08-31.md` §S8 — open-source posture + AI/Tone3000 credential review |
| `659534c` | DataGrid controlled + virtualised mode; **IR view got a List \| Grid toggle** |
| `2969b35` | New `src/renderer/src/components/DataGrid.tsx` (`DataGrid<T>`); **NAM Projects capture list runs on it** |
| `1bc48a4` | IR view: sortable list (SQL `ORDER BY` via `QueryOptions.sort`) |
| `4786960` | NAM Projects: sorting + columnar list + click-to-filter chips |
| `74da23e` / `f651716` / `a19feb8` … `eec02b2` | Capture card rebuilt to `FolderCardView` idiom; `NamLabCrumb` in every mode; `IrMenuBar` deleted; vertical `ModeRail` below each shell's top bar |
| `5ef786d` | `docs/nam-projects-2026-08-31-audit-and-switcher.md`, `docs/security-review-2026-08-31.md`, `docs/technical-debt-2026-08-31.md` |
| `6e1ea25` / `1cf2a9a` / `b1e548d` | NAM Projects detail view (UI + backend + design doc) |
| `358cf43` / `d930141` | Fixes for a `nam_project` migration that corrupted a user's `catalog.db` twice |

### Verification gates (run all before committing)

```
npx electron-vite build              # must be clean
npx vitest run                       # 449 pass / 82 skipped  (skips are FTS5-gated, see below)
npx tsc --noEmit -p tsconfig.web.json    # 130 errors — PRE-EXISTING BASELINE, keep it at 130
npx tsc --noEmit -p tsconfig.node.json   # 35 errors — PRE-EXISTING BASELINE, keep it at 35
```

- `tsc` is **not** a build gate (esbuild transpiles). "No net-new errors" = diff the count
  against 130 / 35. Real gates are `electron-vite build` + `vitest run`.
- **FTS5**: this dev machine's `node:sqlite` (3.47.2) lacks the FTS5 module, so ~14 test files
  `describe.skipIf(!hasFts5())` — that's the 82 skips. Electron's bundled `node:sqlite` has FTS5,
  so search works in the shipped app; the skipped tests run in CI on an FTS5-capable runtime.
- No offscreen UI-render tool exists in this repo (unlike `ir-lab`'s `IRLabUiShot`). Anything
  visual needs `npm run dev` + a human, or the harness below.

### Reference docs already in `docs/`

- `ir-lab-manager-build-plan.md` — the authoritative multi-phase plan. **§0** = the public/private
  repo split; **§13** = open non-blocking decisions (IR licensing enforcement point, whether any
  IR piece becomes paid — both only affect the private build-time connector config, not public code).
- `nam-projects-detail-design-2026-08-31.md` — the NAM Projects detail spec (fully implemented).
- `nam-projects-2026-08-31-audit-and-switcher.md` — audit + the mode-switcher proposal (the rail
  that got built; note Part B's "left rail" sketch was superseded by the final "vertical rail
  inside each shell, below its top bar" form).
- `security-review-2026-08-31.md` — S1–S8. **S8** (new) answers the open-source/AI-key question.
- `technical-debt-2026-08-31.md` — D1–D8.
- `trainer-types-dedup-plan-2026-08-31.md` — leaf-first plan for the ~35 node `tsc` errors.

---

## Upcoming milestones (deferred, not blocked)

### M1 — Phase 1b: FileList adopts `DataGrid`

**Why deferred:** `FileList.tsx` (2124 lines) is a central app view. Its `filtered` → `sorted`
memos bake in `columnFilters` + `sortKey`, and those same memos feed four other things: the
list-view render path, keyboard nav (ctrl+A / arrows), CSV/XLSX export, and the "N of M" banner +
selection-trim. Swapping `GridView` for `DataGrid` means moving column-filter + sort *into*
`DataGrid` and feeding the order back out via `onVisibleRowsChange`, then rewiring those four
consumers. High blast radius, no visual verification here.

**Do it as its own session with `npm run dev` running.** `DataGrid` is ready for it (client mode,
per-column filters, chooser, resize, reorder — all proven in NAM Projects since `2969b35`).

Scope:
1. Define `NAM_COLUMNS: DataGridColumn<NamFile>[]` mapping `getCellValue` / `getSortValue`
   (currently in `FileList.tsx` ~line 184 / ~248) into `getValue` / `sortValue`. Keep the
   `ALL_GRID_COLUMNS` export — other code imports it for CSV/XLSX (`buildExportRows`).
2. In `viewMode === 'grid'`, render `<DataGrid rows={quickFilteredFiles} columns={NAM_COLUMNS}
   selectedIds=… onSelectionChange=… sort={{key,dir}} onSortChange=… onVisibleRowsChange={setGridOrder} />`.
   `quickFilteredFiles` = FileList's existing status/gear/tone/preset/search filter, WITHOUT
   `columnFilters` (DataGrid owns those now).
3. Rewire keyboard nav / export / banner / selection-trim to read `gridOrder` (from
   `onVisibleRowsChange`) instead of the old `sorted` when in grid mode.
4. Delete `GridView` + `DEFAULT_COL_WIDTHS` + `getUniqueValues` from `FileList.tsx` once green.
5. Verify by hand: click / ctrl / shift-range selection, ctrl+A, arrow nav, column
   chooser/resize/reorder persistence, per-column filter, CSV + XLSX export (visible + all cols),
   list-view path still works.

### M2 — `DataGrid` external column-filter for IR grid (optional polish)

IR's Grid view currently has `disableColumnFilters` — the facet filter bar above the list covers
narrowing. If per-column filter dropdowns in the grid are wanted: `DataGrid` already surfaces
`onColumnFiltersChange`; wire the facetable columns (`manufacturer` / `cabinet` / `speaker` /
`microphone` / `sampleRate` / `bitDepth`) to `IrModeShell`'s `facets` / `audioFacets` state, and
feed each column's checklist from `window.api.irLibraryListFacetOptions` (main already has it,
`IrFilterBar` already calls it). Columns that aren't facetable stay filter-less. Small, additive.

### M3 — S8 security hardening (3 small items, from `security-review-2026-08-31.md` §S8)

1. **`readAiKey`** (`src/main/index.ts` ~6338): the `isEncryptionAvailable() ? decrypt :
   buf.toString('utf-8')` plaintext fallback contradicts `storeAiKey`'s refuse-plaintext stance.
   Make `readAiKey` return `null` when `!safeStorage.isEncryptionAvailable()` so a planted
   plaintext `ai-key-*.bin` can't be picked up. ~2 lines.
2. **`aiEnrich` egress disclosure**: the prompt is built from a capture's metadata and sent to
   the user's chosen third-party AI. Add a one-line "this sends these fields to <provider> using
   your API key" note next to the AI-enrich button in the renderer (SettingsPanel / wherever the
   enrich action lives).
3. **CONTRIBUTING note**: in `npm run dev` (`isDev`), Tone3000 refresh tokens are stored
   **plaintext** in `userData` (the `!isDev &&` guard in `saveTone3kTokens`/`loadTone3kTokens`).
   Acceptable dev convenience — just document it so a contributor isn't surprised.

### M4 — `CaptureCard` small/medium/large size toggle

`FolderCardView` has a 3-size picker (180 / 264 / 336 px, dot-grid icon control in its header).
`NamProjectsShell`'s `CaptureCard` is fixed at 264. Port the toggle: a `captureCardSize` state
(persisted), swap the `gridTemplateColumns` px value, add the control to the capture toolbar next
to the List/Cards toggle.

### M5 — UI test harness (full detail already in `TODO.md` → `## UI test harness`)

1. **Component tests now** — `@testing-library/react` + `jsdom` under existing `vitest`.
   First targets: `DataGrid` (sort/persist/filter/selection/virtualised-range), the untested pure
   helpers (`matchesFacets`, `availableFacets`, `sortRows`, `toBatchItem`, `CAPTURE_COLUMNS` /
   `IR_GRID_COLUMNS` getValue+sortValue, `relTime`/`formatBytes`/`audioLabel`), `ModeRail` /
   `NamLabCrumb` smoke. This is `technical-debt-2026-08-31.md` D7.
2. **`?dev=components` gallery route** — optional, one dev-only page rendering the components
   against fixtures, no `window.api`.
3. **Playwright + Electron E2E** — defer to the pre-merge hardening pass (titlebar clearance per
   OS, 3-mode switch end to end, narrow-panel layout, screenshot diffs). Real CI infra — bundle
   with making `tsc` a gate (D1).

### M6 — pre-merge hardening pass (from `technical-debt-2026-08-31.md`)

Before `feature/ir-lab-manager` → `main`:
- **D1 / D2**: land `trainer-types-dedup-plan-2026-08-31.md` (clears most of the 35 node errors);
  add a shared `NamLabApi` interface so the ~53 "property does not exist on window.api" web
  errors surface as real bugs; then make `tsc --noEmit` (both projects) a pre-commit/CI gate.
- **D4**: `catalog.db` migrations → `PRAGMA user_version` + ordered list + a timestamped `.bak`
  before any table-altering migration (this session's corruption happened twice without a backup).
- **D5**: run the suite on an FTS5-capable runtime in CI.
- **S1**: add a CSP (`onHeadersReceived`) + restrict the `local-file://` handler to known roots —
  before any markdown/HTML rendering surface is added.

---

## Quick-start for the resuming session

```
git fetch && git checkout feature/ir-lab-manager && git pull
npm ci   # if node_modules stale
npx electron-vite build && npx vitest run     # confirm the baseline is green
```

Then pick a milestone above. M3 (security hardening) and M4 (card size toggle) are small and
self-contained. M1 (FileList → DataGrid) is the biggest and wants `npm run dev` open throughout.
