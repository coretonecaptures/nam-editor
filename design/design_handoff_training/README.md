# Handoff: NAM Lab — Local Training redesign ("Training: Mission Control")

## Overview
This redesigns NAM Lab's **Local Training** feature (the `TrainingPanel`) from a single-column right-panel overlay into a **full workspace** with: a persistent **left rail** (section nav + live session stats + collapsed Watch Folders), a **persistent "Now Training" strip** with an always-visible run-control bar, and four sections — **Live Run**, **Queue**, **History**, **New Run**. The Queue is rebuilt around **batches** (submissions) that keep finished items in place; the History is a clean filterable list with charts.

It introduces **live training graphs** (ESR-vs-epoch curve, ESR quality distribution, queue burndown, throughput) built on the app's existing `dashboard/Charts.tsx` primitives, and works across all five existing themes.

## About the Design Files
The files in `prototype/` are **design references built in HTML + React-via-Babel** — they show the intended look and behavior. They are **not** production code to copy directly.

The real app is **Electron + React + TypeScript + Tailwind** (the `nam-editor` repo). The task is to **recreate this design inside `src/renderer/src/components/TrainingPanel.tsx`** using the codebase's established patterns: the CSS-variable theme system in `src/renderer/src/assets/index.css`, the semantic Tailwind tokens in `tailwind.config.js` (`bg-panel`, `text-nm-text`, `border-nm-border`, `text-nm-accent`, etc.), IBM Plex fonts, the existing `HelpPopover` component, and the `dashboard/Charts.tsx` SVG chart primitives. **Do not hardcode hex colors** — use the semantic tokens so all five themes keep working.

The prototype's own `app/theme.css` / `app/trainer.css` are reference styling only; in the real app these become Tailwind classes + the existing CSS variables. The prototype re-implements `Icon`, `HelpPopover`, and the chart primitives so it can run standalone — **use the repo's real versions**, don't port the prototype copies.

## Fidelity
**High-fidelity.** Colors, type, spacing, radii, and interactions are specified and should be recreated faithfully — but via the existing token system, not literal values. Charcoal + indigo is the design-target theme; verify in Dark, Midnight, Blue, and Light too.

---

## Implementation plan (read first)

This is a **restructure of `TrainingPanel.tsx`**, not a from-scratch feature — the data model, IPC, and queue/history grouping already exist. Reuse them.

1. **Keep all existing logic & IPC.** `window.api.getTrainerState`, `onTrainerUpdate`, `enqueueTrainerRuns`, `runTrainerFolderOnce`, `removeTrainerJob`, `moveTrainerJob`, `makeTrainerJobNext`, `retryTrainerJob`, `watcherQueueAction`, `retryTrainerHistoryEntry`, the preset CRUD, routing/formula resolution, normalize resolution, history export — all stay. This is a **view-layer reorganization**.
2. **The four `runMode` values become the four sections.** Today `runMode: 'files' | 'folder' | 'queue' | 'history'` drives tabs. Map to the new rail nav: `files`+`folder` → **New Run** (a sub-toggle inside it), `queue` → **Queue**, `history` → **History**, plus a new **Live Run** section derived from `trainerState` (no new IPC needed — it's `activeJob` + progress fields). Default to **Live Run** when `isRunning`, else **Queue** (or **New Run** if the queue is empty).
3. **The Now-Training strip is `trainerState` you already render** (Run Status card + Phase block), restyled into a persistent header above the section content. The control bar = the existing Emergency stop / Pause after current / Resume / Retry failed / Remove queued buttons, always visible.
4. **Batches already exist** as `groupedQueue` (grouped by `submissionId`, labelled by `submissionLabel`). The redesign makes each group a **collapsible card** with a progress meter and per-status counts; items inside render by status. **Finished items already stay** in the queue snapshot — keep rendering `success`/`error`/`canceled` items in their group instead of filtering them out.
5. **New capabilities to add:**
   - **Collapse per batch** — local UI state `Set<submissionId>`; default-collapse fully-finished batches.
   - **Drag to reorder items within a batch** — replaces the up/down arrow buttons. On drop, call the existing `moveTrainerJob(jobId, 'up'|'down')` repeatedly to reach the target index, or add a new `reorderTrainerJob(jobId, beforeJobId)` IPC if you want a single call (preferred). Only `status === 'queued'` items are draggable.
   - **Drag batches to reorder** — reorders all queued jobs of one submission ahead of another's. Simplest backend: a `moveSubmissionBefore(submissionId, beforeSubmissionId)` IPC that reorders the queue array; or compose from `makeTrainerJobNext`. Finished/running items keep their position.
6. **Restore the things the v1 redesign dropped** — the queue quick filters (`queueProfileFilter` / `queueStatusFilter` / `queueArchitectureFilter`, already in state) above the batch list, and the `HelpPopover` "?" affordances on Training Settings / Architecture / Normalize / Output Routing in New Run.
7. **Charts** use `dashboard/Charts.tsx`. Add a live ESR curve (see "Charts" below) — a new primitive in that file. Feed it from `trainerState` progress history; if the backend doesn't retain a per-epoch ESR series yet, accumulate `{epoch, validationEsr}` on the renderer as `onTrainerUpdate` fires (and/or parse the structured progress line). The final saved ESR plot PNG is already read via `readFileBinary` for the history graph modal — keep that.

---

## App layout / footprint

Three footprints were prototyped (a Tweak). **Ship the full workspace.** The modal/two-panel options were exploration only.

- **Workspace (ship this):** Training replaces the 3-panel body entirely. Left rail (220px, fixed) + main column (flex). The app toolbar (46px) and status bar (28px) are unchanged.
- The current "maximize" button behavior can be retired or repurposed as a window action; the workspace is already full-bleed.

### Left rail — `220px`, `bg-panel`, right border `border-nm-border`
- **Header** (pad `16px`): eyebrow "NAM LAB" (`10px/700`, uppercase, `text-nm-text-3`) + title "Local Training" (`16px/680`, with a small flask icon in `--accent`).
- **Nav** (4 items, `38px` rows, `9px` radius): Live Run · Queue · History · New Run. Each: icon + label + count pill (right). Active row = `bg-active`, `text-accent-text` (light theme: `text-accent`), `weight 600`, `2.5px` accent left bar. Hover = `bg-hov`. The **Live Run** count pill turns accent-filled when a run is active; Live Run also gets a count of `1` while running.
- **This Session** block: 4 stat cards (`bg-panel-2`, `10px` radius, `border-nm-border-s`): Completed today (green), Avg ESR (mono), Throughput (`N/hr`, mono), Failed today (red if >0). These come from history aggregates.
- **Watch Folders** (collapsed by default): a bordered group; header shows a "N pending" amber badge; expands to per-watcher rows with a running LED, name, pending/skipped badges. Maps to `trainerState.watcherState.watchers`. Keep this **secondary**.

### Now-Training strip — persistent, above section content
- `bg`: subtle vertical gradient `panel-2 → panel`; bottom border `border-nm-border`; pad `14px 22px`.
- **Top row:** model thumbnail (42px rounded, accent-tinted, cpu icon) · model name (`16px/660`, ellipsis) + sub-line (arch chip, profile chip, "model X of N", source filename in mono) · a **Running/Paused/Idle badge** (accent pill, pulsing dot when running) · the **control bar**.
- **Control bar (always visible):** `Emergency stop` (danger style: red text/border/tint), `Pause after current` (when running) ↔ `Resume` (accent-filled, when not running), divider, `Retry failed`. Buttons `34px`, `9px` radius. Map to existing handlers. Add `Remove queued`/`Clear finished` per current behavior if you keep them.
- **Progress row:** phase + "Epoch C / T" (left, `phase` bold) and `%` (right, mono); an `8px` rounded progress bar (`bg-field` track, accent gradient fill with an animated shimmer sweep); then a mini-stat cluster (Rate it/s · Batch C/T · Val ESR (color-coded) · ETA), each `10px` uppercase label + `15px` mono value; then a small ESR sparkline (`-log10(esr)` so "up = better").
- When idle: name = "No active run", controls disabled appropriately, values show `—`.

---

## Section: Live Run
Derived entirely from `trainerState` (active job + progress). Empty state when nothing is running ("No run in progress").

- **Header:** title "Live Run" + sub "Real-time training telemetry for the active model"; legend (validation ESR / target).
- **Hero card — "ESR over epochs":** large `EsrCurve` (log scale, lower-is-better), with a dashed green **target line** at the job's `thresholdEsr` (default show `0.01`), an animated pulse dot on the latest point, y-axis ESR ticks (`0.001/0.005/0.01/0.05/0.1`), x-axis epoch labels. Card head note: "log scale · lower is better".
- **Stat line** (4 cells, `bg-panel-2`, hairline dividers): Epoch (C / T), Rate (it/s), Validation ESR (color-coded green/amber/red), Started (time).
- **Two cards:** Final output (mono path: `finalModelRoot/<modelName>.nam`) · Checkpoint export (placeholder text until training starts — existing copy).
- **Up next card:** next 3 queued items (name + arch chip + epochs), header shows total queued count.
- **Raw trainer log** (collapsible, open by default): mono console, `bg-field`, color-codes epoch lines (accent), ok (green), warn (amber). This is the existing `trainerState.logs`.

---

## Section: Queue (batch-centric — the most-changed area)

Render `groupedQueue` (existing). Above it: the **quick filters** row (restore these — state already exists): a filter text field + **All profiles** / **All statuses** / **All architectures** selects (`fsel` style: `bg-field`, `border-field-bd`, `34px`, `9px` radius). Plus a hint: "drag to reorder · click ▸ to collapse".

**Status metric tiles** (4, across the top): Queued / Running / Done / Failed, each a `metric` tile with an accent left-border in the status color (`--text-3` / `--accent` / `#10b981` / `#ef4444`), icon chip, uppercase label, big number. Counts are summed across all batches (finished items included).

**Batch card** (per submission) — `bg-panel`, `13px` radius, `border-nm-border-s`; gets an accent border when it contains the active job:
- **Header** (`bg-panel-2`, pad `12px 14px`): drag grip (dotsV, `cursor: grab`, draggable — reorders batches) · collapse caret (▸, rotates 90° when open) · type icon (Run WAVs = fileAudio/accent, Run Folder = folderOpen/accent, **Watch folder = eye/amber**) · label + (if active) a small pulsing "active" badge · sub-line (`TYPE_LABEL · profile chip · arch chip · N items · createdAt`) · a **progress meter** (`StackedMeter`: green=done, red=failed+canceled, accent=running, track=queued) with "F/T finished · %" above it · per-status mini-counts · batch actions (watcher: pause; retry-failed-in-batch; remove-batch).
- **Body** (when expanded): for watcher batches, a source line ("`<watchFolder>` · auto-queues new files as they appear"). Then one **item row** per job:
  - Grip (draggable only if `queued`, else locked/dimmed) · index (mono) · **status icon** (success=green check, error=red alert, canceled=stop, running=pulsing accent dot, queued=hourglass) · name + sub:
    - `error` → inline red mono error text (`job.error`) + "attempt N"
    - `running` → "Epoch C/T · R it/s" (mono)
    - `success` → "duration · architecture" (mono)
    - `queued` → "Waiting in queue"
  - `running` → an inline thin progress bar.
  - Right cluster: ESR badge (success) or status pill; row-hover actions: **Next** (queued, not already first-queued → `makeTrainerJobNext`), **Retry** (error → `retryTrainerJob`), **Show** (success → `revealFile`), **Remove** (`removeTrainerJob`, not when active). Right-click keeps the existing context menu (incl. watcher-specific actions).
- **Collapse:** caret toggles; when collapsed only the header + meter show. Default-collapse batches with no queued/running items.

**Alternate views** (kept as a segmented toggle — `Batches` default · `Compact` · `Board`):
- **Compact:** dense flat rows grouped by batch label (good for scanning many).
- **Board:** a **cross-batch status pivot** (Queued / Running / Done / Failed columns) — useful when watch folders feed many batches and you just want "what failed across everything". This intentionally drops batch boundaries; the **Batches** view is the one that preserves start/end.

**Drag behavior:**
- Item drag: HTML5 draggable on queued rows; drop computes before/after the target queued row; reorder within the same batch only. Wire to a new `reorderTrainerJob(jobId, beforeJobId)` IPC (preferred) or compose from `moveTrainerJob`.
- Batch drag: draggable on the batch header grip; drop reorders batches. Wire to a `moveSubmissionBefore(submissionId, beforeSubmissionId)` IPC. Finished/running items keep their place; only queued ordering changes.

---

## Section: History (clean rebuild — v1 was "weird grid/cards")

Render `groupedHistory` (existing, grouped by `submissionId`).

- **Header:** title + "N completed, failed & canceled runs" + Export button (existing `handleExportHistory`).
- **Two chart cards** at top: **ESR quality · last 7 days** (`QualityBars`: stacked green/amber/red per day, with legend `<.01 / <.05 / ≥.05`) and **Throughput · models/hour** (`ThroughputArea`). Derive both from `trainerState.history` timestamps + `validationEsr`.
- **Filter bar:** search field + status segmented (All / Done / Failed / Canceled) + profile select + time select. Wire to existing `history*Filter` state (`historyStatusFilter`, `historyProfileFilter`, `historyTimeFilter`, `historyEsrFilter`, `historySearch`).
- **Grouped list** — per submission: a group header (label + type badge + "N done" / "N failed" colored badges + timestamp). Then a bordered `h-list` of rows:
  - **Thumbnail** (`44×34`): for `success` with a graph, a tiny ESR-plot sparkline (or the real saved PNG thumbnail if cheap); for `error`, a red alert triangle; for `canceled`, a stop glyph.
  - Name + meta (arch chip · profile chip · epochs · duration) — or, for errors, the inline red error message.
  - Right: ESR badge (success) or status pill; timestamp (mono); hover actions: View ESR plot (opens the existing graph modal via `readFileBinary` → `data:image/png`), Retry (`retryTrainerHistoryEntry`), Reveal in folder (`revealFile`).
- Empty state when filters match nothing.

---

## Section: New Run (merges Run WAVs + Run Folder)

A sub-toggle at top — **Run WAVs** / **Run Folder** (segmented `seg-pick`, each with a sublabel). Then:
- **Captures card:** Input DI field + Browse (`openAudioFile`). WAVs mode: Choose WAVs / Clear (`openAudioFiles`) + a mono list box of selected WAVs. Folder mode: WAV folder field + Folder… picker + a "N WAV files found" note.
- **Training settings card** (with a `HelpPopover` "?" on the head): Preset select · Architecture select (disabled when NAM=A2; `HelpPopover`) · Epochs · NAM version segmented (A1 WaveNet / A2 — Soon, disabled) · Latency · Target ESR · checkboxes Save ESR plot / Ignore checks · Normalize select (`HelpPopover`) · Save as Preset. Wire to existing state + `handleSaveAsPreset`.
- **Output routing card** (with `HelpPopover`): the two existing routing cards (NAM formula = green, Graph formula = accent) showing the active formula token + resolved path, plus the routing-mode / root controls and the example model/graph paths. Use existing `resolveOutputFormula` / `effectiveFormula`.
- **CTA:** full-width accent button "Queue N captures" (`enqueueTrainerRuns` / `runTrainerFolderOnce`).

---

## Interactions & behavior
- **Section nav** swaps the main content; the Now-Training strip persists across all sections.
- **Run controls** are always visible in the strip and reflect live state (running → Pause shown; idle/paused → Resume shown; Emergency stop disabled when fully idle).
- **Batch collapse/expand** is instant, local UI state, persisted per session (optional: persist to settings).
- **Drag** (items within batch, batches past each other) — only queued items reorder; HTML5 drag with before/after drop indicators (accent box-shadow on the target edge).
- **Theme/accent/chip** changes apply instantly via the existing settings → `<html>` data-attributes; remember the **theme-switch reflow fix** (force a synchronous reflow on `#root` after changing `data-theme`, or keep `background` out of `transition` shorthand on theme-driven surfaces).
- **ESR color tones** (reuse existing `getEsrTone`): `< 0.01` green, `< 0.05` amber, `≥ 0.05` red, null = neutral.

## State (additions only — most already exist)
- New: `section: 'live' | 'queue' | 'history' | 'new'` (replaces `runMode`'s tab role; keep New Run's internal `'files' | 'folder'`).
- New: `collapsedBatches: Set<string>` (submissionIds).
- New (charts): a per-run `esrSeries: {epoch, esr}[]` accumulated from `onTrainerUpdate` (or backend-provided).
- Reuse: all filter state, preset modal state, context-menu state, `trainerState`.

## Design tokens (already in the repo — `assets/index.css` + `tailwind.config.js`)
- **Surfaces:** `--app-bg, --panel, --panel-2, --raised, --hover, --active, --border, --border-soft, --field, --field-border`. Tailwind: `bg-app-bg, bg-panel, bg-panel-2, bg-raised, bg-hov, bg-active-bg, border-nm-border, border-nm-border-s, bg-field, border-field-bd`.
- **Text:** `--text, --text-2, --text-3` → `text-nm-text, text-nm-text-2, text-nm-text-3`.
- **Accent:** `--accent, --accent-hover, --accent-text, --accent-fg` → `text-nm-accent, bg-nm-accent, text-accent-text, text-accent-fg`.
- **Status (semantic, not theme-driven):** done `#10b981` (emerald), failed/error `#ef4444` (red), warning/amber `#f59e0b`, running = `--accent`. Use Tailwind `emerald-*/red-*/amber-*` as the app already does in `getEsrTone`.
- **Chip type colors:** keep the existing gear/tone chip palette (`.nam-chip` classes / `data-chip` styles).
- **Type:** IBM Plex Sans (UI), IBM Plex Mono (numbers/paths/levels, `tabular-nums`). Sizes: base `13`, sm `12`, xs `11`; section title `18/680`; metric numbers `28/700`; now-strip name `16/660`.
- **Radii:** cards `12–14`, batch `13`, fields/buttons `8–9`, pills `20`. **Shadows:** `--shadow`.

## Charts (map to `dashboard/Charts.tsx`)
- **EsrCurve (new primitive):** ESR-vs-epoch, log scale, descending, dashed green target line, animated latest-point pulse, y ESR ticks + x epoch labels; variants area/line/minimal. See `prototype/app/charts.jsx` `EsrCurve` for exact math (log10 mapping, padded domain).
- **QualityBars (new):** vertical stacked green/amber/red bars per day/session.
- **Burndown (new):** remaining (accent area) vs done (dashed green) over time.
- **ThroughputArea:** reuse/extend the existing `AreaChart`.
- **Sparkline / StackedMeter / Donut / ProgressRing:** already exist in `Charts.tsx`; the now-strip sparkline and batch meter use these.

## Assets
- No new image assets. Icons: use the app's existing icon usage (the prototype's `Icon` set is a stand-in). Gear/amp imagery and the saved ESR plot PNGs come from the existing app paths.

## Files in this bundle (`prototype/`)
- `NAM Lab Trainer.html` — entry; load order + html chrome.
- `app/trainer.css` — all component/layout styling (reference; becomes Tailwind + CSS vars).
- `app/theme.css` — copy of the repo's token system (reference only; the real source is `assets/index.css`).
- `app/main.jsx` — shell, footprints, the live **simulation** (prototype-only — real app uses `trainerState`), tweaks wiring, theme application + reflow fix.
- `app/live.jsx` — Rail, Now-Training strip, Live Run, `ChartFit` (responsive width helper).
- `app/queue.jsx` — **the batch queue** (collapse + drag + filters + Compact/Board alternates).
- `app/views.jsx` — History.
- `app/newrun.jsx` — New Run setup (incl. restored HelpPopovers).
- `app/charts.jsx` — chart primitives incl. `EsrCurve`/`QualityBars`/`Burndown`.
- `app/parts.jsx` — EsrBadge / StatusPill / ArchChip / ProfChip / MiniEsrPlot / FullEsrPlot / **HelpPopover** (use the repo's real `HelpPopover.tsx` instead).
- `app/icons.jsx`, `app/data.js` — prototype-only (icon stand-ins, mock trainer state).
- `app/tweaks-panel.jsx` — prototype dev harness; not for production.

## Reference files in the real codebase
- Main: `src/renderer/src/components/TrainingPanel.tsx` (the file to restructure — see `QueueRow`, `groupedQueue`, `groupedHistory`, the Run Status/Phase blocks, the filters, `handleQueue`/`handleRunFolderOnce`).
- Types/model: `src/renderer/src/types/trainer.ts` (`TrainerQueueJob`, `TrainerHistoryEntry`, `TrainerStateSnapshot`, `submissionId/submissionLabel`).
- Charts: `src/renderer/src/components/dashboard/Charts.tsx`.
- Help: `src/renderer/src/components/HelpPopover.tsx`.
- Theme: `src/renderer/src/assets/index.css` + `tailwind.config.js`.
- Settings (presets, normalize, formulas): `src/renderer/src/types/settings.ts`, `utils/resolveOutputFormula.ts`.
