# NAM Lab — Requirements & Feature Backlog

This file tracks all planned, in-progress, and completed features.
The canonical active TODO list is `TODO.md` in the root. This file adds more structured context.
Update both when features land.

---

## Core Metadata Editing

- [x] Three-panel layout: FolderTree | FileList | MetadataEditor
- [x] Surgical write strategy (`patchMetadataFields`) — never JSON.parse/stringify
- [x] Editable fields: name, modeled_by, gear_type, gear_make, gear_model, tone_type, input/output levels, nb_trained_epochs
- [x] NAM Lab extended fields (nl_ prefix → metadata.nam_lab.*)
- [x] Auto-fill from settings rules with change highlighting (indigo = auto-filled, amber = manual)
- [x] Read-only fields: date, loudness, gain, validation_esr, checks, latency, preset_name
- [x] Batch editor (multi-file selection)
- [x] Multi-select editor

## File Management

- [x] FolderTree with drag handles + collapsible panels
- [x] File rename, move, trash, copy via IPC
- [x] Duplicates detection (_Duplicates folder hidden from tree)
- [x] Pack Info sidecar (nam-pack.json per folder)
- [x] Bundle sidecar (nam-bundle.json)
- [x] File watcher suppression after local writes (suppressWatcher 3s)

## Pack Info & Export

- [x] Pack Info export (PDF + spreadsheet)
- [ ] Nested/indented bullet list support in PDF export parser
- [ ] Pack Info `Copy to…`
- [ ] Pack export subfolder filter
- [ ] Pack export body/footer text size controls
- [ ] Selection-based spreadsheet export (right-click → Export these to Excel)

## Training (Local Training / Training Panel)

- [x] Run WAVs / Run Folder modes
- [x] Queue with submission grouping (submissionId/submissionLabel)
- [x] History with grouped view
- [x] Watch folders
- [x] Training presets (CRUD)
- [x] Output routing formula
- [x] WAV Check tab (trained/missing/extra counts)
- [x] HelpPopovers on training settings fields
- [x] TrainingSetupGuide component
- [x] Training presets: duplicate, star, and a dedicated **Presets** left-rail page (separate from Create Batch)
- [x] Training Bundles — named groups of 2+ presets submitted together as one batch; watcher profiles can link a bundle instead of a single preset
- [x] Global **Always ignore pre-training data checks** setting (overrides the per-preset toggle, re-read live at job-start so it applies to already-staged/queued jobs too)
- [x] "Trained despite warnings" flagging — orange badge in History (hover for check-failure detail) + live badge on the Dashboard hero card while the flagged run is still training
- [x] Retrain from trained folder — shipped as Create Batch's **"From Captures"** mode: pick a folder of existing trained `.nam` files plus a matching WAV folder, **Analyze Captures** produces a match report (Matched / Unmatched / WAVs-only), then queue the matched pairs for one or more new target architectures. See training.md's *From Captures* section for the full matching/review-step behavior; the detailed acceptance-case spec below is kept for reference on the matching rules it was built against.
  - **Seed set rule**: every `.nam` in the chosen source folder counts as a seed; this is not an ESR-ranking feature and must not attempt to choose the "best" captures by ESR.
  - **Matching rule**: map each seed `.nam` back to one WAV using exact basename first, then the app's existing coverage/base-name normalization rules.
  - **Ambiguity rule**: if a seed `.nam` has no confident WAV match or matches multiple WAVs, skip it and report the reason — do not guess.
  - **Deduping rule**: if multiple seed `.nam` files map to the same WAV, queue that WAV only once per selected target architecture.
  - **Queueing rule**: reuse the normal batch queue flow and existing "already queued / already in history" protections for the selected target architectures.
  - **Review step**: before queueing, show a summary with counts for: seeds found, WAVs matched, duplicates collapsed, unmatched seeds, ambiguous seeds, and items skipped by existing queue/history protections.
  - **Acceptance cases**: (a) 40 seeds + 100-WAV superset + A2 selected → 40 jobs queued; (b) same input + A2 + Standard → 80 jobs; (c) two seeds map to the same WAV → one WAV queued once per architecture; (d) one seed has no WAV match → skipped and counted; (e) one seed matches multiple WAVs → skipped and counted; (f) matched WAV already in queue/history for target architecture → not requeued, counted as skipped.
  - **Out of scope (v1)**: manual conflict resolution UI, ESR-based ranking or filtering.

**Training Mission Control redesign** — design handoff at `design/design_handoff_training/`. **Shipped** — left-rail layout, Now-strip, and all sections below are live in `TrainingPanel.tsx` (see training.md for the current user-facing description); the rail also grew a **Presets** page and Dashboard/Batches sections beyond the original handoff scope.
- [x] Full workspace layout: left rail + main column
- [x] Rail: section nav (Dashboard / Live Run / Queue / Batches / History / Presets / New Run) + This Session stats + Watch Folders
- [x] Now-Training persistent strip with always-visible run controls
- [x] Section: Live Run — ESR curve chart, phase stats, raw log
- [x] Section: Queue — batch cards (collapse/expand), drag-to-reorder items + batches (migrated to `@dnd-kit`, see TODO.md), filters
- [x] Section: History — filterable grouped list, ESR quality bars + throughput charts
- [x] Section: New Run — Manual / From Captures toggle, restored HelpPopovers
- [x] Charts: EsrCurve, QualityBars/throughput area chart, Sparkline
- [x] New IPC: batch/queue reordering (`moveSubmissionBefore`, `moveSubmissionToEnd`)

## Onboarding / Discoverability

- [x] HelpPopovers on complex fields
- [x] TrainingSetupGuide
- [ ] Setup wizard (non-forced, shown on empty state first launch)
- [ ] Clean function wizard (step-by-step guide)
- [ ] Metadata suggestions wizard
- [ ] Settings search / Quick Setup shortcut panel
- [ ] Capture defaults "fill blank on load" per-field checkboxes

## Grid & Card View

- [x] Card view with amp cover images
- [x] Card view size picker (small/medium/large)
- [ ] Card view right-click "Get Cover Image" (fetch from web, save as ampcover.jpg)
- [ ] Metadata header path display (fuller path without stealing editor space)

## Import / Performance

- [ ] Blank XLSX import template with lookup dropdowns
- [ ] Large collection / network share load: mtime cache
- [ ] Tone3000 search: bounded multi-page fetch/cache for narrow searches

## Metadata Suggestions

- [x] Prefix + value matcher suggestion rules
- [ ] Friendlier overwrite guard UI (chips vs raw comma-separated)
- [ ] Broader wildcard/regex pattern support
- [ ] Reverse-template / pattern-based rules
- [ ] AI-assisted suggestion rule discovery

## Keyboard Shortcuts

- [ ] Card view navigation shortcuts (open, browse, back)
- [ ] Common file operation shortcuts (save, revert, batch edit, next/prev)
- [ ] Keyboard Shortcuts section in Settings

## NAM A2 / PackedWaveNet

- [x] A2 support — shipped. Selectable architecture in Create Batch/presets/watchers, mixed A1+A2 batches, per-job `namMode` routing to `_run_a2` (PackedWaveNet), Full/Lite sub-model ESR tracking and tone-band thresholds, A2 detection on read. See `docs/a2-status.md` for full detail, including the deferred NAM PR #676 follow-up (not yet in a NAM release as of this writing — re-verify before assuming it needs action).

## Bugs / Known Issues

- [ ] Checklist row sync button too small / too far
- [ ] Training queue status line misleading for single active run

## Security / Distribution Hardening

- [ ] Protect Tone3000 OAuth tokens with `safeStorage` instead of plain JSON-at-rest storage.
- [ ] Validate all renderer-triggered external opens in the main process and restrict schemes to an allowlist.
- [ ] Standardize UI links on the preload bridge instead of direct `window.open(...)`.
- [ ] Add URL validation around remote download helpers, especially Tone3000 asset downloads and generic cover-image fetches.
- [ ] Review preload / IPC surface area and trim high-impact operations where practical.
- [ ] Revisit `BrowserWindow` sandboxing as a separate hardening/test pass because it may affect current filesystem-heavy workflows.
