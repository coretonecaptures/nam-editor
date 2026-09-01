# NAM Projects detail — change audit + mode-switcher proposal

Date: 2026-08-31. Covers the two commits that implement
`docs/nam-projects-detail-design-2026-08-31.md`:

- `1cf2a9a` — backend (scanner facts, editable metadata, `nam-lab-result.json` v2, model relink)
- `6e1ea25` — UI (project header, list/cards, capture detail, facet pills)

Verification state at time of writing: `npx electron-vite build` clean;
`npx vitest run` 449 passed / 80 skipped; `tsc -p tsconfig.web.json` 130 errors
(unchanged pre-existing baseline, zero net-new from this work);
`tsc -p tsconfig.node.json` 35 errors (unchanged, all pre-existing index.ts ⇄
`src/shared/trainer.ts` drift — see `docs/trainer-types-dedup-plan-2026-08-31.md`).

---

## Part A — audit of the changes

### A1. What shipped, against the design

| Design section | Status | Notes |
| --- | --- | --- |
| §3 project header (name, created, Reveal, coverage bar, makeup chips, images) | done | `ProjectHeader` in `NamProjectsShell.tsx`. Images via `local-file://` — see security review S1. |
| §4 List ⇄ Cards toggle, denser row, card | done | `captureView` persisted in `localStorage` (`CAPTURE_VIEW_KEY`). |
| §5 capture detail panel | done | `CaptureDetailPanel`: Files / Timing / Calibration / Model metadata / Training / Provenance. |
| §6 trained-`.nam` soft link (stat → Open/Reveal, missing → auto-find + Locate…) | done | `ModelFileLink`; relink rewrites the sidecar via `irLibrary:relinkNamModel`. |
| §7 editable effective metadata, suggested/effective split | done | `MetadataEditor` + `setNamCaptureMetadata`; `toBatchItem` now seeds the `.nam` from the effective value. |
| §8 scanner/IPC (imagePaths, dirs, ir_item JOIN facts, effective columns, new IPC) | done | `getNamProjectDetail`, `setNamCaptureMetadata`, `relinkNamCaptureModel`, `findNamModelCandidates`. |
| §9a search & filtering (facet pills, extended search, dates everywhere) | done | `FacetPills`, `matchesFacets`, `availableFacets`. Capture search also matches `gear_make`/`gear_model`/`modeled_by` (effective + suggested). |
| §9a optional rail sort (Name · Newest · Least trained) | **deferred** | Marked optional in the design; not built. |
| §6 long game — scan model library, match by `source_capture_id` | **deferred** | Explicitly "note, not v1" in the design. |

### A2. Correctness notes / things to know

1. **`node:sqlite` migration risk is real and was hit twice this session.**
   `358cf43` and `d930141` are both fixes for the `nam_project` CHECK-widen
   migration corrupting `catalog.db` (orphaned `collection_old`, then FK refs
   in 5 child tables left pointing at `collection_old` after a
   `RENAME TO` with `legacy_alter_table` OFF). The migration now rebuilds from
   `CORE_SCHEMA_SQL`, copies shared columns only, forces
   `legacy_alter_table = ON`, and has a repair pass for dangling refs. It is
   covered by 3 tests in `schema.test.ts`. **But**: the approach is
   hand-rolled table surgery, and any future `collection`-shape change re-runs
   the same risky path. See tech-debt D4.

2. **`nam-lab-result.json` bumped to schemaVersion 2** (`namCaptureResult.ts`).
   v1 sidecars still parse (missing fields read back `null`). The 4 new fields
   (`graphPath`, `validationEsrFull`, `validationEsrLite`, `sourceCaptureId`)
   are written only from the trainer success hook in `index.ts`, *after*
   `promoteTrainerGraph`. A training run that fails before promotion writes no
   sidecar — trained state is still driven purely by sidecar presence, so this
   is consistent.

3. **`setNamCaptureMetadata` trusts the patch object's keys.** The column map
   is a fixed whitelist (`col[k]`), so there is no SQL injection, but an
   unknown key produces `"undefined = ?"` and a thrown SQLite error rather
   than being ignored. The renderer only ever sends known keys
   (`NamCaptureMetadataPatch`), so this is latent, not live. Cheap fix:
   `if (!(k in col)) continue`. See security review S3.

4. **Effective-metadata write-back timing.** `updateNamCaptureFacts` fills the
   effective columns from `suggested_*` / `calibration.*` via `COALESCE` on
   every enrich, so a rescan never clobbers a user edit (the effective column
   is already non-null). Clearing a field in the editor sets it to `null`,
   which means the *next* rescan re-defaults it from the IR Lab suggestion —
   this is intentional per the design ("a later scan re-defaults it") but is a
   sharp edge: "clear" is not "clear forever."

5. **`local-file://` now carries scanner-derived paths into `<img src>`**
   (`imagePaths` from `readdirSync` of the project dir; `graphPath` from the
   sidecar). Not attacker-controlled in a normal flow, but it broadens what
   flows through a protocol handler that does no path validation. Security
   review S1.

6. **`findNamModelCandidates` walks renderer-supplied roots.** Bounded to
   depth 6 / 20 000 entries / skips dotdirs + `node_modules`. Currently called
   only with `[outputRoot]`. Fine, but it is an unauthenticated "walk this
   directory tree" primitive exposed to the renderer. Security review S2.

7. **`NamProjectsShell.tsx` is now 2392 lines** (was 1159). It holds ~12
   components plus the shell. This is past the point where it should be a
   directory. Tech-debt D3.

### A3. Test coverage of the new code

- Backend: `namCaptureEnrichment.test.ts` +2 tests (effective-metadata default
  → edit → survives rescan; project detail carries dirs + finds images).
  `namCaptureResult` v2 round-trip is exercised indirectly.
  `schema.test.ts` — 3 migration/repair tests.
- **UI: no tests.** `NamProjectsShell.tsx` has zero component tests (consistent
  with `IrModeShell.tsx`, which also has none). `matchesFacets` /
  `availableFacets` / `toBatchItem` are pure and testable and currently
  untested — the highest-value place to add coverage.

### A4. Recommended follow-ups (not blockers)

1. Add unit tests for `matchesFacets`, `availableFacets`, `toBatchItem`
   (pure functions, no React needed — extract to a sibling `.ts` if desired).
2. `setNamCaptureMetadata`: skip unknown keys instead of building broken SQL.
3. Decide the "cleared field" semantics deliberately — either persist an
   explicit "user cleared this" tombstone, or document that clear = revert-on-
   next-scan in the UI copy.
4. The optional rail sort (Newest / Least trained) is a small, high-signal add
   for "what still needs work."

---

## Part B — a better IR / NAM / NAM Projects switcher

### B1. What exists today

`AppRoot.tsx` renders one of `<App/>` (NAM), `<IrModeShell/>`,
`<NamProjectsShell/>` and lays a **floating overlay** of three buttons at
`fixed top-10 right-3 z-[100]`. Rationale in the file: each shell uses
`h-screen` and assumes it is the viewport root, so they cannot be nested under
a shared flex header without breaking their height math.

Problems:

- **Discoverability** — a 3-button pill floating over the top-right corner,
  deliberately positioned to dodge the Windows titlebar overlay, reads as a
  debug affordance, not primary navigation.
- **Collision risk** — `z-[100]` over content that each shell manages
  independently; the NAM Projects header already crowds that corner.
- **No context** — it does not show counts, unsaved state, or which mode a
  cross-shell action (e.g. "create training batch") is about to throw you
  into.
- **Persisted, but silently** — `nam-lab-app-mode` in `localStorage`, no
  visible indication that state is per-mode.

### B2. Proposal — a slim persistent left rail (recommended)

A 48px fixed-width vertical strip that is a real sibling of the mode shell, not
an overlay. It owns the window's left edge; each shell renders to its right in
the remaining width.

```
┌──┬───────────────────────────────────────────┐
│N │                                           │
│A │   <App /> | <IrModeShell /> |              │
│M │   <NamProjectsShell />                     │
│  │                                           │
│I │                                           │
│R │                                           │
│  │                                           │
│N │                                           │
│P │                                           │
└──┴───────────────────────────────────────────┘
```

- Three icon buttons (NAM / IR / NP) top-aligned, active one filled with
  `nm-accent`, tooltip with the full name + a live count
  ("NAM Projects · 6/10 trained").
- The strip is `flex-shrink-0`; the shell container is `flex-1 min-w-0
  h-screen`. This is the one structural change: `AppRoot` becomes
  `<div className="flex h-screen"><Rail/><div className="flex-1 min-w-0">…</div></div>`
  and each shell drops `h-screen` for `h-full`. That is a mechanical edit in
  three files (`App` root div, `IrModeShell` root div, `NamProjectsShell` root
  div) — the height math the current comment worries about is preserved
  because the flex parent is itself `h-screen` and the child is `h-full`.
- Windows titlebar overlay: the rail starts below `env(titlebar-area-height)`
  / a 32px top pad, so the OS window buttons (top-right) never overlap it.
  macOS traffic lights are top-left — the rail's top button sits at ~40px,
  clear of them, same as today's `top-10`.
- Cross-shell nav (`appNav.ts`) stays exactly as is; the rail just calls
  `setMode`. Add a brief highlight pulse on the target icon when a
  programmatic switch happens so the jump is legible.

Cost: ~1 new component (~60 lines), 3 one-line root-class edits, no behavior
change to any shell. Reversible.

### B3. Alternative — a titlebar segmented control

Fold the switcher into the custom titlebar region (NAM Lab already uses
`titleBarStyle: 'hidden'` + overlay on Windows, `hiddenInset` on macOS). A
centered segmented control in the draggable title area reads as
application-level chrome.

Rejected as the primary recommendation because: the draggable-region / overlay
geometry differs per-OS and is already a documented source of pain
(`0898d52` "Fix NAM/IR mode toggle hidden under Windows titlebar overlay"),
and a centered control fights the traffic lights on macOS. The left rail keeps
navigation out of the OS-chrome danger zone entirely.

### B4. Not recommended

- **Tabs inside each shell** — triplicates the control, and a shell that owns
  its own header (NAM Projects) would need to reserve space for it.
- **Command-palette only** — fine as an *addition* (`Cmd/Ctrl+1/2/3`), not as
  the only way to switch.

### B5. Suggested increment

1. Add `Cmd/Ctrl+1/2/3` mode hotkeys in `AppRoot` now (2 lines, zero layout
   risk, immediately better than the overlay).
2. Then do B2 (left rail) as its own commit.
