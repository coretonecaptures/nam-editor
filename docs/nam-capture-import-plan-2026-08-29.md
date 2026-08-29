# Importing IR Lab's NAM Capture projects — implementation plan (2026-08-29)

## Context

IR Lab (sibling app, `C:\Users\Admin\ir-lab`) built a new "NAM Capture" feature — raw DI/reamp WAV
pairs for training NAM models, deliberately with no metadata curation UI and no training integration
of its own ("NAM Lab owns cataloging, tagging, and the actual training run" — settled in IR Lab's
own `docs/nam_capture_plan_2026-08-28.md`). This app currently knows nothing about that format.

Goal: recognize an IR Lab NAM Capture project, show every capture's trained/untrained status, let
the user queue an entire project for training in one action, and have trained `.nam` files land in
the normal workflow here — with a one-way result file feeding status back to IR Lab, no shared
database or IPC between the two apps.

The data contract this plan is built against is confirmed directly against IR Lab's
`NamCaptureStore.h/.cpp` and cross-checked with IR Lab in
`../ir-lab/docs/nam_lab_metadata_handoff_2026-08-29.md` (what NAM Lab is asking IR Lab for, and
confirmation that today's format is already sufficient — nothing here is blocked on an IR Lab change).

**On-disk shape** (one folder per capture, no nesting):
```
<project.outputRoot>/<sanitizedName>-<captureId>/
    excitation.wav      -- 32-bit float mono DI/reference
    recording.wav        -- 32-bit float mono captured return, same sample count
    nam-capture.json      { schemaVersion, captureId, captureName, createdAt, captureScope
                            (Cabinet/Device/Software), excitation, recording (explicit filenames --
                            always resolve paths from these fields, never assume literal names),
                            excitationSourceName, stimulusSha256?, sampleRate,
                            measuredLatencySamples, projectId, projectName,
                            synthetic?, syntheticSourceIrName? }
```

## 1. New top-level mode: "NAM Projects"

`src/renderer/src/AppRoot.tsx` — extend `type Mode = 'nam' | 'ir'` to
`'nam' | 'ir' | 'nam-projects'`, add a third toggle button, mount a new shell component (e.g.
`NamProjectsShell.tsx`) alongside `App`/`IrModeShell`. Same full-screen, no-shared-state pattern the
existing two modes already use (per `AppRoot.tsx`'s own header comment on why it's a thin wrapper).

New shell needs its own left-rail/tree (projects → captures) and right panel (per-capture
excitation/recording/status, per-project "Queue all for training") — modeled on
`src/renderer/src/components/ir/IrFolderTree.tsx`'s existing blue-dot badge and right-click
"Rescan"/"Reveal in Explorer" pattern, not a copy of `IrModeShell.tsx`'s row shape (`IrItemRow` is
hard-built around IR-specific columns — cabinet/speaker/microphone — that don't apply here).

## 2. `nam-capture.json` scanner — new file

New: `src/main/irCatalog/namCaptureEnrichment.ts` — sibling to, but NOT extending,
`src/main/irCatalog/labProjectEnrichment.ts` (that file is keyed to IR captures'
`.SessionData/session.json`/`analysis.json` schema — different shape, different layout, don't
conflate). Reuses the shared `library_root`/`folder`/`item` scan; `item.kind` already has
`'nam_capture'` reserved in the `CHECK` at `schema.ts:81` (confirmed, never populated) — only
enriches already-scanned rows, same discipline as the existing IR enrichment pass.

- Add `'nam_project'` to `collection.kind`'s CHECK list (`schema.ts:197`, currently
  `('ir_project', 'nam_pack', 'nam_bundle', 'release', 'tray')`) — one `collection` row per distinct
  `projectId` found, grouped by the JSON's own field, **never by folder nesting depth** (robust to
  IR Lab's own unresolved "Quick Captures for NAM?" question either way it's answered).
- `nam_capture_item` (`schema.ts:102-110`) is entirely post-training metadata
  (`modeled_by, gear_type, gear_make, gear_model, tone_type, input_level_dbu, output_level_dbu,
  trained_epochs, preset_name, loudness, gain, architecture, mics, cabinet, cabinet_config,
  amp_channel, boost_pedal, amp_settings, pedal_settings, amp_switches`) — this importer inserts a
  bare row (item_id only) per capture so training-completion code (step 5) has a row to `UPDATE`,
  not create.
- Add columns for pre-training facts the UI needs to query/filter on: `capture_scope`,
  `sample_rate`, `measured_latency_samples`, `synthetic`, `synthetic_source_ir_name`,
  `excitation_path`, `recording_path` (resolved absolute paths). `nam_capture_item` is created via
  `CREATE TABLE IF NOT EXISTS`, so adding columns to an already-shipped dev DB needs a small
  `ALTER TABLE ... ADD COLUMN` migration alongside the updated `CREATE TABLE` definition.
- **Never silently equate `synthetic: true` with a real capture** — store verbatim, every downstream
  consumer checks explicitly.

## 3. Trained/untrained status — `nam-lab-result.json`

New sidecar, written **exclusively by this app**, into the same capture folder (single-writer
principle, same as the shared catalog generally):
```json
{ "schemaVersion": 1, "trainedAt": "...", "modelName": "...", "architecture": "a1|a2",
  "validationEsr": 0.0, "outputModelPath": "...", "trainerJobId": "..." }
```
Presence = trained, absence = untrained. IR Lab may read this later for its own status badge —
zero coupling beyond one JSON file, no shared DB, no IPC.

## 4. "Queue all for training" — new trainer-queue path

Core mismatch: every existing queueing path (`buildTrainerPayloadsForProfile`, `main/index.ts:3562`)
takes one shared `inputPath` looped against many `outputPath`s. NAM Capture needs the opposite —
each capture brings its own excitation+recording pair. Needs a sibling builder, not a parameter
tweak (the existing function's loop holds `inputPath` outer-scope).

- New `sourceMode` literal `'nam-capture-import'`, added everywhere the union is duplicated:
  `src/renderer/src/types/trainer.ts` (`TrainerStartPayload`, `TrainerQueueJob`,
  `TrainerHistoryEntry`), `src/main/index.ts` (local type alias + `sourceMode === 'watcher'`-gated
  lookups), `src/renderer/src/types/settings.ts`.
- New `buildTrainerPayloadsForNamCaptureImport(pairs: Array<{inputPath, outputPath, captureId,
  captureFolder, synthetic}>, ...)` in `main/index.ts`, sibling to `buildTrainerPayloadsForProfile`.
  Skip `synthetic: true` pairs by default; surface an explicit, non-default "include N synthetic
  captures" override in the UI rather than silently including or excluding them.
- Add `namCaptureFolderPath`/`namCaptureId` to `TrainerStartPayload`/`TrainerQueueJob`, threaded
  through exactly like the existing `submissionId`/`submissionLabel`/`submissionCreatedAt` fields —
  used by step 5's post-success hook to know where to write `nam-lab-result.json`.
- Feed built payloads into the existing `enqueueTrainingPayloads()` (`main/index.ts:3698`) and
  `createTrainerJob()` (`main/index.ts:3254`) unchanged — both already dedupe/default correctly
  against a new `sourceMode` value.
- Do not resurrect `trainer:runFolderOnce` (`main/index.ts:7871`, confirmed dead code today — no
  renderer call site) — it was built for the old one-shared-DI model.

## 5. Post-training write-back

In the existing trainerChild exit-handler block (`main/index.ts` ~4139-4246, same place
`persistTrainerMetadata()` already runs on success): when `job.sourceMode === 'nam-capture-import'`
and `namCaptureFolderPath` is set, write `nam-lab-result.json` (step 3) into that folder — new
plumbing, confirmed no existing hook writes back to a job's source folder today.

Extend `persistTrainerMetadata()` (`main/index.ts:5503`) to also write `captureName`/`projectName`
(and any Project Details fields IR Lab includes, per the handoff doc) into a new namespaced block —
`metadata.nam_lab.source_capture = {...}` — matching the existing convention that
`metadata.nam_lab.*` is the NAM-Lab-only scratch namespace NAM itself ignores. **Do not** auto-fill
`gear_type`/`gear_make`/`gear_model`/`tone_type` from this data — leave those for the normal
manual/Excel-import metadata workflow.

## Critical files
- `src/renderer/src/AppRoot.tsx` — third mode
- `src/main/irCatalog/schema.ts` — `nam_project` collection kind, `nam_capture_item` new columns
- `src/main/irCatalog/namCaptureEnrichment.ts` — new, scanner
- `src/main/irCatalog/labProjectEnrichment.ts` — pattern reference only, not extended
- `src/main/index.ts` — `buildTrainerPayloadsForProfile`/new sibling (~3562), `createTrainerJob`
  (~3254), `enqueueTrainingPayloads` (~3698), `persistTrainerMetadata` (~5503), trainerChild exit
  handler (~4139-4246)
- `src/renderer/src/types/trainer.ts`, `src/renderer/src/types/settings.ts` — `sourceMode` union
- `src/renderer/src/components/ir/IrFolderTree.tsx` — badge/context-menu pattern to mirror

## Verification
- `npx tsc --noEmit -p tsconfig.node.json` / `tsconfig.web.json` clean after each phase.
- Point the new mode at a real IR Lab NAM Capture project folder (or a hand-built fixture matching
  the confirmed schema) and confirm: projects/captures list correctly, synthetic captures are
  visibly flagged and excluded by default, "Queue all" produces the right number of jobs with
  correct input/output pairing (spot-check against `nam-capture.json`'s own filenames, not assumed
  ones).
- Run one real training job through this path end-to-end; confirm `nam-lab-result.json` appears in
  the source capture folder and the tree's trained/untrained badge flips.
- Existing trainer paths (manual-direct, watcher) must show zero behavior change.
