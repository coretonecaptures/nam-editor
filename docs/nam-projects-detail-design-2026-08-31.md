# NAM Projects — richer project / capture detail (design)

Status: **design, not built.** 2026-08-31. The NAM Projects mode currently shows a project as a
thin "name — N captures" line plus a flat capture list with a trained/untrained dot. Everything
the v2 scanner already collects (calibration, model-metadata hints, WAV facts, training result)
is hidden in tooltips or not shown at all. This spec lays out what to surface, a card/list view
for captures, and how to handle linking to the trained `.nam`.

Nothing here changes the import boundary: IR Lab still owns `nam-capture.json`; NAM Lab never
rewrites it.

---

## 1. What data we already have (no new IR Lab asks)

**Per project** (`collection` kind='nam_project'):
- `name`, `projectId` (stored in `naming_template`), `createdAt`
- `cabinet` / `speaker` / `room` / `signal_chain` / `description` / `project_notes` — **NULL in
  practice** (IR Lab didn't ship `nam-project.json`); keep the "not provided by IR Lab" empty
  state, populate if that file ever appears
- derived: capture / trained / synthetic counts

**Per capture** (`nam_capture_item` + the recording's own `ir_item` row, which survives the
kind→'nam_capture' flip and still carries WAV-header facts):
- identity: `capture_id`, `capture_name`, `capture_scope` (Cabinet / CabOnly / DirectAmp / Device
  / Software), `created_at`, `synthetic` + `synthetic_source_ir_name`
- files: `recording_path`, `excitation_path` (+ from `ir_item`: `bit_depth`, `channels`,
  `duration_seconds`, `sample_rate`, `audio_format` — for the recording, for free)
- from the sidecar (already parsed, some not yet stored): `excitationSourceName`,
  `stimulusSha256`, `measured_latency_samples`, `app` ("IR Lab"), `schemaVersion`
- **calibration** (`calibration_*` + `input_level_dbu` / `output_level_dbu`): the two dBu values,
  `method` (guided / precision), `confidence` (quick-estimate / interface-spec-verified /
  meter-verified), `profile_name`, `calibrated_at`
- **suggested** (`suggested_*`): `name`, `modeled_by`, `gear_make`, `gear_model`, `gear_type`,
  `tone_type` — IR Lab's `modelMetadataSuggested` hints
- **trained state** — presence of `<CaptureName>.nam-lab-result.json` beside the recording:
  `trainedAt`, `modelName`, `architecture`, `validationEsr`, `outputModelPath`, `trainerJobId`

**Not yet captured but cheap to add:**
- project folder images (a photo of the rig, a note scan) — glob `*.{jpg,jpeg,png,webp}` in the
  project dir and its `NAM Captures/` dir
- recording file size + mtime (fs stat)
- trained-model file existence / size / mtime (fs stat on `outputModelPath`)
- training graph PNG for a trained capture (the trainer already produces one per run — resolve
  from trainer history by `trainerJobId`, or write `graphPath` into `nam-lab-result.json`)

---

## 2. Layout

Keep the three regions (rail | centre | right). Changes are the **centre header**, a
**card/list toggle** on the centre list, and the **right panel** gaining a per-capture mode.

```
┌───────────┬─────────────────────────────────────────────┬──────────────────────┐
│ projects  │  PROJECT HEADER (§3)                         │  right panel:        │
│ rail      │  ─────────────────────────────────────────── │   • no selection →   │
│ (filter,  │  capture list  [ List | Cards ]  [filter] [status chips]            │
│  dots,    │  ─────────────────────────────────────────── │     project detail   │
│  n/m)     │  rows / cards (§4)                           │     + "Queue batch"  │
│           │                                             │   • capture selected  │
│           │                                             │     → capture detail  │
│           │  selection toolbar (Create batch / Run next) │       (§5)           │
└───────────┴─────────────────────────────────────────────┴──────────────────────┘
```

---

## 3. Project header (centre, replaces the current one-liner)

- **Line 1**: project name · created `2026-08-30` · `Reveal NAM Captures folder`
- **Line 2 — coverage**: a slim bar `▓▓▓▓▓▓░░░░  6 / 10 trained` · `2 synthetic (excluded)` ·
  `mean ESR 0.0121` (of trained)
- **Line 3 — makeup chips** (only those with data): `48k ×10` · `24-bit` · scope breakdown
  `DirectAmp ×8 · Cabinet ×2` · calibration `9/10 calibrated · mostly meter-verified`
- **Project details** (cabinet/speaker/room/signalChain/description/notes) — shown only when a
  `nam-project.json` supplied them; otherwise the existing muted "No project details supplied by
  IR Lab" line
- **Images strip**: horizontal thumbnails of any images found in the project folder; click →
  `shell:openFile`. Empty → nothing (no empty state — it's a bonus, not a gap).

The "Queue for training" controls (architecture / epochs / output folder / include-synthetic /
Stage / Run next) stay in the **right panel** under project detail, unchanged.

---

## 4. Capture list — List vs Cards toggle (persisted in localStorage, like the Overview toggle)

### List row (denser than today)
`[✓] Name · scope · 48k/24-bit · 384 smp · [⚑ cal −12.4/+4.0 meter] · [ⓘ hints] · [synthetic] ·············· Trained · ESR 0.012 · [⋯]`

`[⋯]` menu: Reveal WAV · Queue this capture · Run next · (trained) Open .nam / Reveal .nam ·
(trained, moved) Locate .nam…

### Card (grid, ~260px wide)
```
┌──────────────────────────────────┐
│ FMAN100 Crunch          ● Trained │   ● emerald / ○ grey / ◐ synthetic(dim)
│ DirectAmp · 48k/24-bit · 384 smp  │
│ ─────────────────────────────────│
│ cal  −12.4 / +4.0 dBu · meter     │   (only if calibrated)
│ Two Rock · Traditional Clean      │   (gear hints, small pills)
│ amp · clean                       │
│ ─────────────────────────────────│
│ [mini training-graph png]         │   (only if trained; from trainer history)
│ a1 · ESR 0.0118 · 3h ago          │
│ ─────────────────────────────────│
│ Reveal WAV   Queue   Open .nam    │
└──────────────────────────────────┘
```
Untrained card: drop the graph/result rows, footer is `Reveal WAV · Queue this · Run next`.

Both views share the same selection (checkbox / click-to-toggle on a card corner), so the
"Create training batch" / "Run next" toolbar works identically.

---

## 5. Capture detail (right panel, when one capture is selected)

One capture, everything:

- **Files**
  - Recording: `<name>.wav` · 24-bit / mono / 48 kHz · 3:12 · 27.7 MB · `Reveal`
  - Excitation: `v3_0_0-70f8ec7f2568-48000hz.wav` (shared) · sha256 `70f8ec7f…` ·
    source `v3_0_0.wav` · `Reveal`
- **Timing**: measured latency `384 smp` · captured `2026-08-30 20:50`
- **Calibration** (when present): method `guided` · confidence `quick-estimate` · profile
  `Universal Audio Thunderbolt (LINE 3)` · calibrated `2026-08-30 14:11` ·
  input `20.0 dBu` output `17.5 dBu`  — with a one-liner: *"embedded into the trained model as
  `input_level_dbu` / `output_level_dbu`."*
- **Model metadata** — `modeled_by` / `gear_make` / `gear_model` / `gear_type` / `tone_type`.
  **Editable** (see §7); shows "from IR Lab" when still equal to the suggested value, "edited"
  otherwise. A "reset to IR Lab's suggestion" affordance.
- **Training**
  - trained → model name · architecture (a1/a2, + Full/Lite ESR for a2) · ESR · trained
    `3h ago` · trainer job `…` · **model file** (see §6) · training graph (full image)
  - untrained → inline "Queue this capture" / "Run next" + the current arch/epochs/output
- **Provenance**: app `IR Lab` · schemaVersion `2` · projectId `94c9aeafeb…`

---

## 6. Linking to the trained `.nam` — the decision

The user's instinct is right: `outputModelPath` is captured at train time and the user can move
or rename the `.nam`. So: **soft link, verified at display time, never a hard dependency.**

Behaviour for a trained capture:
1. `fs.stat(result.outputModelPath)`:
   - **exists** → `Open` (shell open) + `Reveal in folder`, show size + mtime. Done.
   - **missing** → dimmed "model file moved or renamed" + two recovery paths:
     a. **auto-find**: glob `**/${modelName}.nam` under (i) the training output root the capture
        was queued with, (ii) any NAM Lab model-library root the user has configured. Exactly one
        hit → "found at `…` — relink?" (updates `outputModelPath` in the sidecar). Multiple/zero
        hits → fall through to (b).
     b. **Locate…** → file picker; on pick, rewrite `outputModelPath` in
        `<CaptureName>.nam-lab-result.json`.
2. Never block the rest of the row/card on this — trained status itself comes from the sidecar's
   presence, not from the model file existing.

**Long game (note, not v1):** every `.nam` we train already carries
`metadata.nam_lab.source_capture_id` (the phase-5 write-back). A future "scan my NAM Lab model
library" pass can match trained models back to their capture by id regardless of where they
moved — the robust answer. The stat + auto-find + Locate above is the pragmatic version that
needs no new infrastructure.

Also: **write `graphPath` (and `validation_esr_full` / `validation_esr_lite`) into
`nam-lab-result.json`** at train time (bump its `schemaVersion` to 2) so the detail view has the
training graph without reaching into trainer history — trainer history is capped/pruned, the
sidecar is forever.

---

## 7. Editable vs read-only

- **Calibration** and **file/timing/provenance** facts → read-only (they describe what was
  captured).
- **`modelMetadataSuggested`** → **editable in NAM Lab.** IR Lab's own field spec calls these
  "hints the user edits before export." Model:
  - `suggested_*` columns keep IR Lab's hint verbatim (read-only mirror).
  - The **effective** value lives in `nam_capture_item`'s existing post-training columns
    (`gear_make`, `gear_model`, `gear_type`, `tone_type`, `modeled_by`) + `input_level_dbu` /
    `output_level_dbu`. On first enrich these default to `suggested_*` / `calibration.*`.
  - The capture detail edits the **effective** columns. `buildNamCaptureImportPayloads` already
    reads capture `suggested` → change it to read the effective columns instead (or fall back
    suggested → effective). `persistTrainerMetadata` seeds the `.nam` from the effective value.
  - This gives a clean "IR Lab suggested X, I changed it to Y, the model got Y" story, and it's
    the same tagging surface the rest of NAM Lab uses — no parallel edit UI.
- Nothing is written back to `nam-capture.json` (single-writer).

---

## 8. Scanner / IPC changes (main process)

`getNamProjectDetail` gains:
- `imagePaths: string[]` — images in the project dir + `NAM Captures/` dir
- `namCapturesDir`, `excitationsDir` (absolute), for the header Reveal buttons
- per capture:
  - `recordingBytes`, `recordingMtime`, `recordingDurationSec`, `recordingBitDepth`,
    `recordingChannels`, `audioFormat` (JOIN the recording's `ir_item` row — already there)
  - `excitationSourceName`, `stimulusSha256` (add columns to `nam_capture_item` or read the
    sidecar on demand in the detail query — sidecar-on-demand is fine, it's one project at a time)
  - `effective` block: `{ modeledBy, gearMake, gearModel, gearType, toneType, inputLevelDbu,
    outputLevelDbu }` from the post-training columns
  - trained: `outputModelExists`, `outputModelBytes`, `outputModelMtime`, `graphPath`,
    `validationEsrFull`, `validationEsrLite`
- new IPC: `irLibrary:setNamCaptureMetadata(itemId, { modeledBy?, gearMake?, ... })` → writes the
  effective columns; `irLibrary:relinkNamModel(captureFolder, captureName, newPath)` → rewrites
  the sidecar's `outputModelPath`.

`nam-lab-result.json` schema → v2: add `graphPath`, `validationEsrFull`, `validationEsrLite`,
`sourceCaptureId`. Written from the trainerChild success hook (it has all of these on the job /
`trainerState`).

`namCaptureResult.ts` gains `relinkNamLabResult(recordingWavPath, newOutputModelPath)`.

---

## 9. Build order (if approved)

1. Scanner: `imagePaths` + the per-capture `ir_item` JOIN facts + `outputModelExists` stat +
   `effective` columns default-fill on enrich. (Backend only, testable.)
2. Right panel: capture-detail mode + project-header enrichment. List stays as-is.
3. Card view + List/Cards toggle.
4. Editable model-metadata (effective columns + IPC + "reset to suggestion").
5. `nam-lab-result.json` v2 (`graphPath` etc.) + the trained-`.nam` link/relink/auto-find.

Steps 1–2 are the bulk of the "it's super sparse" fix and are low-risk; 3–5 are additive.

---

## 9a. Search & filtering (all client-side — one project's captures fit in memory)

### Left rail — project search
The rail already has a `Filter projects…` box (substring on project name). Add to each rail row,
under the name: **created date** + the `n/m trained` count it already shows. Optional rail
sort control: Name · Newest · Least trained (so "what still needs work" floats up).

### Capture list — search + metadata pills
- **Search box** (already present): substring over capture name. Extend to also match
  `gear_make` / `gear_model` / `modeled_by` so typing "Two Rock" or "Bassman" finds it.
- **Status chips** (already present): All / Untrained / Trained / Synthetic — keep, add counts
  (`Untrained 3`), already planned in §3.
- **Metadata pills** — shown **only for facets that actually have ≥1 value across this project's
  captures** (no empty pills, matching IR mode's "what's in the list, not all in the world"):
  - **Scope**: `DirectAmp` · `Cabinet` · `CabOnly` · … (each a toggle; multi-select = OR)
  - **Sample rate**: `48k` · `96k`
  - **Gear type**: `amp` · `amp_cab` · … (from the effective `gear_type`)
  - **Tone type**: `clean` · `crunch` · …
  - **Calibration**: `Calibrated` · `Uncalibrated`, and when calibrated a confidence sub-filter
    `meter-verified` · `interface-spec-verified` · `quick-estimate`
  - **Architecture** (trained only): `a1` · `a2`
  Clicking a pill filters; clicking an active pill clears it; pills combine as AND across
  facets, OR within a facet — same semantics as IR mode's `FieldBadge` filter bar.
- Pills render for **both** list and card view (they live in the list header row, above the
  cards/rows).
- A `Clear filters` link appears when any pill / chip / search is active, plus a count
  "showing 4 of 12".

### Dates everywhere
- Rail row: `created 2026-08-30`
- List row: a right-aligned relative date (`3d ago`, hover → full timestamp)
- Card: `captured 2026-08-30` in the sub-line; if trained, `trained 3h ago` in the result row
- Capture detail (§5): full `captured` and `trained` timestamps, plus `calibrated` date

All dates come from fields we already have (`nam_capture_item.created_at`,
`nam-lab-result.json.trainedAt`, `calibration.calibratedAt`).

---

## 10. Open questions for the user

- **Card vs list default** — list (matches IR mode) or cards? (localStorage-persisted either way.)
- **Editable metadata (§7)** — yes to editing the gear/tone hints in NAM Lab, with the
  suggested/effective split? Or keep the capture detail purely read-only for v1 and do all
  tagging in the existing NAM metadata editor after training?
- **Auto-find for a moved `.nam` (§6a)** — worth it for v1, or ship just stat + "Locate…" and add
  auto-find later?
