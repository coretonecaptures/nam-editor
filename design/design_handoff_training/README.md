# Handoff: NAM Lab — Local Training redesign ("Training: Mission Control")

## Overview
This redesigns NAM Lab's **Local Training** feature (the `TrainingPanel`) from a single-column right-panel overlay into a **full workspace** with: a persistent **left rail** (section nav + live session stats + collapsed Watch Folders), a **persistent "Now Training" strip** with an always-visible run-control bar, and five sections — **Dashboard (Simple mode)**, **Live Run**, **Queue**, **History**, **New Run**. The Queue is rebuilt around **batches** (submissions) that keep finished items in place; the History is a clean filterable list with charts.

The **Dashboard** is the default landing view: a spacious, big-text "Simple mode" home for users who just want to point at WAVs and go. It reads live state from `trainerState` and adds a one-tap **Quick Add** that picks files from the local filesystem and queues a new batch using the user's **favorite preset + favorite output routing + default Input DI** (new settings). The other four sections are the power-user "detail" views.

It introduces **live training graphs** (ESR-vs-epoch curve, ESR quality distribution, queue burndown, throughput) built on the app's existing `dashboard/Charts.tsx` primitives, and works across all five existing themes.

## About the Design Files
The files in `prototype/` are **design references built in HTML + React-via-Babel** — they show the intended look and behavior. They are **not** production code to copy directly.

The real app is **Electron + React + TypeScript + Tailwind** (the `nam-editor` repo). The task is to **recreate this design inside `src/renderer/src/components/TrainingPanel.tsx`** using the codebase's established patterns: the CSS-variable theme system in `src/renderer/src/assets/index.css`, the semantic Tailwind tokens in `tailwind.config.js` (`bg-panel`, `text-nm-text`, `border-nm-border`, `text-nm-accent`, etc.), IBM Plex fonts, the existing `HelpPopover` component, and the `dashboard/Charts.tsx` SVG chart primitives. **Do not hardcode hex colors** — use the semantic tokens so all five themes keep working.

The prototype's own `app/theme.css` / `app/trainer.css` are reference styling only; in the real app these become Tailwind classes + the existing CSS variables. The prototype re-implements `Icon`, `HelpPopover`, and the chart primitives so it can run standalone — **use the repo's real versions**, don't port the prototype copies.

## Fidelity
**High-fidelity.** Colors, type, spacing, radii, and interactions are specified and should be recreated faithfully — but via the existing token system, not literal values. Charcoal + indigo is the design-target theme; verify in Dark, Midnight, Blue, and Light too.

## ⚠️ Card & color rules (read this — the most common mistake)
A prior build tinted each section card a different color (Captures teal, Training Settings/Output Routing purple). **That is wrong and not in the design.** Follow these exactly:
- **Every top-level section card is a NEUTRAL panel:** `background: var(--panel)`, `border: 1px solid var(--border-soft)`, neutral `var(--text)` title. No colored card backgrounds, no colored card borders.
- **There is exactly ONE accent color** (`var(--accent)`), and on cards it appears **only** on the small header *icon* and (optionally) the header *title* — never as a fill or border. All section header icons are the **same** accent — do not vary the hue per section (no teal; teal exists in none of the five themes).
- **The only intentionally color-tinted elements** in the whole feature: (1) the two Output-Routing formula sub-cards — NAM = green (`#10b981` mixes), Graph = accent; (2) status semantics — success green / error-fail red / warning amber; (3) the amber "Before you can queue" validation banner; (4) the Dashboard hero's subtle accent gradient. Nothing else gets a tint.
- If a color isn't coming from `var(--accent)` or the green/red/amber status set, it's a bug.

---

## Implementation plan (read first)

This is a **restructure of `TrainingPanel.tsx`**, not a from-scratch feature — the data model, IPC, and queue/history grouping already exist. Reuse them.

1. **Keep all existing logic & IPC.** `window.api.getTrainerState`, `onTrainerUpdate`, `enqueueTrainerRuns`, `runTrainerFolderOnce`, `removeTrainerJob`, `moveTrainerJob`, `makeTrainerJobNext`, `retryTrainerJob`, `watcherQueueAction`, `retryTrainerHistoryEntry`, the preset CRUD, routing/formula resolution, normalize resolution, history export — all stay. This is a **view-layer reorganization**.
2. **The four `runMode` values become sections, plus a new Dashboard.** Today `runMode: 'files' | 'folder' | 'queue' | 'history'` drives tabs. Map to the new rail nav: a new **Dashboard** (Simple mode) as the default/home, then `files`+`folder` → **New Run** (a sub-toggle inside it), `queue` → **Queue**, `history` → **History**, plus a new **Live Run** section derived from `trainerState`. Default landing = **Dashboard**. (No new IPC needed for Live Run — it's `activeJob` + progress fields.)
3. **The Now-Training strip is `trainerState` you already render** (Run Status card + Phase block), restyled into a persistent header above the section content. The control bar = the existing Emergency stop / Pause after current / Resume / Retry failed / Remove queued buttons, always visible.
4. **Batches already exist** as `groupedQueue` (grouped by `submissionId`, labelled by `submissionLabel`). The redesign makes each group a **collapsible card** with a progress meter and per-status counts; items inside render by status. **Finished items already stay** in the queue snapshot — keep rendering `success`/`error`/`canceled` items in their group instead of filtering them out.
5. **New capabilities to add:**
   - **Collapse per batch** — local UI state `Set<submissionId>`; default-collapse fully-finished batches.
   - **Drag to reorder items within a batch** — replaces the up/down arrow buttons. On drop, call the existing `moveTrainerJob(jobId, 'up'|'down')` repeatedly to reach the target index, or add a new `reorderTrainerJob(jobId, beforeJobId)` IPC if you want a single call (preferred). Only `status === 'queued'` items are draggable.
   - **Drag batches to reorder** — reorders all queued jobs of one submission ahead of another's. Simplest backend: a `moveSubmissionBefore(submissionId, beforeSubmissionId)` IPC that reorders the queue array; or compose from `makeTrainerJobNext`. Finished/running items keep their position.
6. **Restore the things the v1 redesign dropped** — the queue quick filters (`queueProfileFilter` / `queueStatusFilter` / `queueArchitectureFilter`, already in state) above the batch list, and the `HelpPopover` "?" affordances on Training Settings / Architecture / Normalize / Output Routing in New Run.
7. **Charts** use `dashboard/Charts.tsx`. Add a live ESR curve (see "Charts" below) — a new primitive in that file. Feed it from `trainerState` progress history; if the backend doesn't retain a per-epoch ESR series yet, accumulate `{epoch, validationEsr}` on the renderer as `onTrainerUpdate` fires (and/or parse the structured progress line). The final saved ESR plot PNG is already read via `readFileBinary` for the history graph modal — keep that.
8. **Dashboard (Simple mode) + favorites** — a new spacious home view plus three new settings (favorite preset, favorite routing, default Input DI). See the dedicated section below. This is the largest *new* surface; everything else reuses existing data/IPC.

---

## App layout / footprint

Three footprints were prototyped (a Tweak). **Ship the full workspace.** The modal/two-panel options were exploration only.

- **Workspace (ship this):** Training replaces the 3-panel body entirely. Left rail (220px, fixed) + main column (flex). The app toolbar (46px) and status bar (28px) are unchanged.
- The current "maximize" button behavior can be retired or repurposed as a window action; the workspace is already full-bleed.

### Left rail — `220px`, `bg-panel`, right border `border-nm-border`
- **Header** (pad `16px`): eyebrow "NAM LAB" (`10px/700`, uppercase, `text-nm-text-3`) + title "Local Training" (`16px/680`, with a small flask icon in `--accent`).
- **Nav** (5 items, `38px` rows, `9px` radius): **Dashboard** (tagged "SIMPLE", with a soft divider under it) · Live Run · Queue · History · New Run. Each: icon + label + count pill (right). Active row = `bg-active`, `text-accent-text` (light theme: `text-accent`), `weight 600`, `2.5px` accent left bar. Hover = `bg-hov`. The **Live Run** count pill turns accent-filled when a run is active; Live Run also gets a count of `1` while running. The **Dashboard** item is the home/default and carries a small accent "SIMPLE" tag.
- **This Session** block: 4 stat cards (`bg-panel-2`, `10px` radius, `border-nm-border-s`): Completed today (green), Avg ESR (mono), Throughput (`N/hr`, mono), Failed today (red if >0). These come from history aggregates.
- **Watch Folders** (collapsed by default): a bordered group; header shows a "N pending" amber badge; expands to per-watcher rows with a running LED, name, pending/skipped badges. Maps to `trainerState.watcherState.watchers`. Keep this **secondary**.

### Now-Training strip — persistent, above section content
- `bg`: subtle vertical gradient `panel-2 → panel`; bottom border `border-nm-border`; pad `14px 22px`.
- **Top row:** model thumbnail (42px rounded, accent-tinted, cpu icon) · model name (`16px/660`, ellipsis) + sub-line (arch chip, profile chip, "model X of N", source filename in mono) · a **Running/Paused/Idle badge** (accent pill, pulsing dot when running) · the **control bar**.
- **Control bar (always visible):** `Emergency stop` (danger style: red text/border/tint), `Pause after current` (when running) ↔ `Resume` (accent-filled, when not running), divider, `Retry failed`. Buttons `34px`, `9px` radius. Map to existing handlers. Add `Remove queued`/`Clear finished` per current behavior if you keep them.
- **Progress row:** phase + "Epoch C / T" (left, `phase` bold) and `%` (right, mono); an `8px` rounded progress bar (`bg-field` track, accent gradient fill with an animated shimmer sweep); then a mini-stat cluster (Rate it/s · Batch C/T · Val ESR (color-coded) · ETA), each `10px` uppercase label + `15px` mono value; then a small ESR sparkline (`-log10(esr)` so "up = better").
- When idle: name = "No active run", controls disabled appropriately, values show `—`.

---

## Section: Dashboard (Simple mode — the new default home)

A spacious, big-text "one-stop for your favorite defaults" view. It is the **default landing section** and the first rail item (tagged "SIMPLE"). Power users click into Live Run / Queue / History / New Run for detail; this view stays deliberately simple. All data comes from `trainerState` + `groupedQueue` (no new IPC); the only new backend pieces are the three favorite/default settings (below).

**Top strip (simple variant).** On this section, replace the detailed Now-Training strip with a *slim control bar*: a live status badge (Training / Paused / Idle, pulsing dot) + active model name on the left, and the big run controls on the right (**Emergency stop** danger button, **Pause** ↔ **Resume**). Same handlers as the detailed strip; just larger and fewer.

**Hero card** (`~210px`, subtle accent gradient bg, `20px` radius):
- Left: eyebrow `Now training · {batchLabel}` (active batch name, accent, uppercase); huge model name (`34px/720`, ellipsis); a meta row — `batch started {createdAt}` · a **live "running {elapsed}"** counter (accent, ticks each second from the active batch's start time) · arch chip; then a `14px` progress bar with `Epoch C / T` + `%`.
- Right: a large **ProgressRing** (`168px`, `13px` stroke) with big `%` (`42px`) + `epoch N` in the middle, and `~N min remaining` below.
- Idle state: flask icon + "Nothing training right now" + hint to add captures or resume.

**Big-stat grid** — 8 tiles, **4 columns × 2 rows**, `16px` radius, big tabular numbers (`38px/730`). Each tile: icon chip (status-colored) + uppercase label + big value + small sub. Every number is **explicitly scoped** so totals aren't ambiguous:
- Row 1 (live): **Current epoch** (`of 1000`) · **Queue progress** *(featured/accent tile)* = `{finished} / {total}` with sub `{N} batches · {remaining} to go` (finished = success+failed+canceled across **all** batches) · **Active batch** = `{idx} / {batchTotal}` with the batch name as sub (this is the *within-batch* item counter — keeping it on its own tile is what removed the earlier "is 4/13 the batch or the queue?" confusion) · **Current ETA** (`Nm`, sub `at R it/s`).
- Row 2 (results): **Completed** (green, queue-wide success count, sub "across queue") · **Failed** (red, queue-wide error+canceled, sub "across queue") · **Last ESR** (color-toned by `getEsrTone`, sub = last model's short name) · **Last item took** (`mm:ss`).
- Note the reconciliation the user asked for: Completed + Failed = Queue progress numerator. Keep that invariant.

**Quick Add card** (the important new interaction) + **Up Next card** side by side:
- **Quick Add** — header + gear button (opens Settings → favorites). Shows the three favorite defaults it will apply (Preset w/ star, Routing, Input DI). One big CTA: **“Pick WAVs & queue batch.”**
  - Clicking opens a modal whose core is a **real local-filesystem picker**: an `<input type="file" multiple accept=".wav,audio/wav,audio/x-wav">` behind a “Choose WAV files” drop/browse zone (click to browse, or drag-drop `.wav`s). Selected files list out (name + size, individually removable, “Add more”).
  - In the **real app**, use the existing native dialog (`window.api.openAudioFiles` / the same multi-select used by New Run’s “Choose WAVs”) instead of a browser file input — the prototype uses `<input type=file>` only because it runs in a plain browser.
  - Confirm (**“Queue N as new batch”**) builds a **new batch (submission)** from the picked files, applies the **favorite preset + favorite routing + default Input DI automatically** (no per-run setup), and **enqueues it at the end of the queue** via the existing `enqueueTrainerRuns` (one submission, `submissionLabel` like `Quick Batch · 3:42 PM`). A green confirmation row appears: “Queued N captures · {batch} · auto-queued at end.”
- **Up Next** — the next ~5 queued items (index + name + arch chip), header shows total waiting.

**Settings → Simple-mode favorites** (reached from the toolbar **Settings** button *and* the Quick Add gear). A modal with: a **favorite preset** list where each row has a **star** toggle (exactly one favorite; star = the default Simple-mode preset) + arch chip + epochs; a **favorite output routing** text field; a **default Input DI** field (“simple mode won’t ask”) with a Browse button. These persist to settings and are what Quick Add reads. In the real app, add them to the existing settings store (see State/Settings below) and surface them in the existing Settings UI — the modal here is just the prototype's stand-in.

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

## Section: New Run → "Create Batch" (Run WAVs + Run Folder fully unified)

**This is now a single unified form — there is NO Run WAVs / Run Folder toggle.** One Captures section feeds both paths: set an Input DI, then add output WAVs by **+Add Files**, **+Add Folder**, or drag-drop — all into one list. Every section card is a **neutral panel** (see the card rules near the top).

- **Captures card:** Input DI field (label "Input DI · trainer reference / DI file") + Browse (`openAudioFile`). Then **Output WAVs** with a right-aligned button cluster: **+ Add Files** / **+ Add Folder** (accent-*outline* buttons, not filled) + Clear once populated. Empty state = a dashed drop zone: "No WAVs — choose files, add a folder, or drop here". Populated = a mono list of WAVs. Wire to `openAudioFiles` (+ a folder picker that expands to its WAVs).
- **Training Settings card** (header `?` HelpPopover): Preset select · **NAM Version** segmented (A1 WaveNet / A2). Then a wrapping settings row: Architecture(s) select (+`?`, disabled when A2) · Epochs · Latency (+`?`) · Target ESR (+`?`) · "Save ESR plot" / "Ignore checks" checkboxes · Normalize select. "Save as Preset" bottom-right. Wire to existing state + `handleSaveAsPreset`.
- **Output Routing card** (header `?`): the two formula sub-cards (NAM = green tint, Graph = accent tint) showing `../../NAM/{architecture}/{folder}` etc., "Add WAVs to preview output path" until WAVs exist, an "Override for this run: Use fixed path…" affordance, plus routing-mode / NAM-output-root controls + example paths. Use existing `resolveOutputFormula` / `effectiveFormula`. (These two sub-cards are the ONLY tinted cards in the form.)
- **"Create all files as separate batches"** checkbox below the cards (one submission per WAV vs one batch for all).
- **Validation banner** (amber) — "Before you can queue" listing blockers (e.g. "No output WAV files added"). Shown until valid.
- **Actions:** **Stage (save, don't run)** (neutral) + **Queue + Start** (accent CTA, ~1.6× width). Both disabled until valid. Wire to the existing stage/enqueue handlers (`enqueueTrainerRuns` / `runTrainerFolderOnce`).

---

## Interactions & behavior
- **Section nav** swaps the main content; the Now-Training strip persists across all sections.
- **Run controls** are always visible in the strip and reflect live state (running → Pause shown; idle/paused → Resume shown; Emergency stop disabled when fully idle).
- **Batch collapse/expand** is instant, local UI state, persisted per session (optional: persist to settings).
- **Drag** (items within batch, batches past each other) — only queued items reorder; HTML5 drag with before/after drop indicators (accent box-shadow on the target edge).
- **Theme/accent/chip** changes apply instantly via the existing settings → `<html>` data-attributes; remember the **theme-switch reflow fix** (force a synchronous reflow on `#root` after changing `data-theme`, or keep `background` out of `transition` shorthand on theme-driven surfaces).
- **Quick Add (Dashboard)** opens a local-file picker (real native dialog in-app), builds a new submission from the chosen WAVs, applies the favorite preset/routing/DI, and enqueues it at the **end** of the queue via `enqueueTrainerRuns`. Show a green confirmation. The new batch then behaves like any other (collapsible, items retained, etc.).
- **Star a favorite preset** in Settings sets exactly one preset as the Simple-mode default; **favorite routing** and **default Input DI** are read by Quick Add so it never has to ask.
- **ESR color tones** (reuse existing `getEsrTone`): `< 0.01` green, `< 0.05` amber, `≥ 0.05` red, null = neutral.

## State (additions only — most already exist)
- New: `section: 'dashboard' | 'live' | 'queue' | 'history' | 'new'` (replaces `runMode`'s tab role; **default `'dashboard'`**; keep New Run's internal `'files' | 'folder'`).
- New: `collapsedBatches: Set<string>` (submissionIds).
- New (charts): a per-run `esrSeries: {epoch, esr}[]` accumulated from `onTrainerUpdate` (or backend-provided).
- New (Dashboard): a live `elapsed` tick (1s interval) computed from the active batch's start timestamp; modal flags for Quick Add + Settings.
- **New settings (persisted)** — add to the existing settings store/schema (`types/settings.ts`) and Settings UI: `favoritePresetId: string`, `favoriteRouting: string` (defaults to the current NAM output formula), `defaultInputDi: string` (absolute path). Quick Add reads these; Simple mode never prompts for them.
- Reuse: all filter state, preset CRUD/modal state, context-menu state, `trainerState`, the existing audio-file picker.

## Design tokens (already in the repo — `assets/index.css` + `tailwind.config.js`)
- **Surfaces:** `--app-bg, --panel, --panel-2, --raised, --hover, --active, --border, --border-soft, --field, --field-border`. Tailwind: `bg-app-bg, bg-panel, bg-panel-2, bg-raised, bg-hov, bg-active-bg, border-nm-border, border-nm-border-s, bg-field, border-field-bd`.
- **Text:** `--text, --text-2, --text-3` → `text-nm-text, text-nm-text-2, text-nm-text-3`.
- **Accent:** `--accent, --accent-hover, --accent-text, --accent-fg` → `text-nm-accent, bg-nm-accent, text-accent-text, text-accent-fg`.
- **Status (semantic, not theme-driven):** done `#10b981` (emerald), failed/error `#ef4444` (red), warning/amber `#f59e0b`, running = `--accent`. Use Tailwind `emerald-*/red-*/amber-*` as the app already does in `getEsrTone`.
- **Chip type colors:** keep the existing gear/tone chip palette (`.nam-chip` classes / `data-chip` styles).
- **Type:** IBM Plex Sans (UI), IBM Plex Mono (numbers/paths/levels, `tabular-nums`). Sizes: base `13`, sm `12`, xs `11`; section title `18/680`; metric numbers `28/700`; now-strip name `16/660`. **Dashboard (Simple mode) uses a larger scale:** hero model name `34/720`, ring `%` `42/730`, big-stat values `38/730` tabular.
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
- `app/live.jsx` — Rail (incl. the Dashboard/SIMPLE nav item), Now-Training strip, Live Run, `ChartFit` (responsive width helper).
- `app/dashboard.jsx` — **Simple-mode Dashboard**: slim control bar, hero + ProgressRing, big-stat grid, Quick Add modal (local file picker → new auto-queued batch), Settings/favorites modal, live elapsed counter.
- `app/queue.jsx` — **the batch queue** (collapse + drag + filters + Compact/Board alternates).
- `app/views.jsx` — History.
- `app/newrun.jsx` — New Run setup (incl. restored HelpPopovers).
- `app/charts.jsx` — chart primitives incl. `EsrCurve`/`QualityBars`/`Burndown`. **Note:** these reference a `--chart-track` CSS var for ring/meter tracks — it is defined per-theme in `theme.css`; if you port the primitives, define an equivalent low-contrast track token per theme (or use `var(--border-soft)`).
- `app/parts.jsx` — EsrBadge / StatusPill / ArchChip / ProfChip / MiniEsrPlot / FullEsrPlot / **HelpPopover** (use the repo's real `HelpPopover.tsx` instead).
- `app/icons.jsx`, `app/data.js` — prototype-only (icon stand-ins, mock trainer state).
- `app/tweaks-panel.jsx` — prototype dev harness; not for production.

## Reference files in the real codebase
- Main: `src/renderer/src/components/TrainingPanel.tsx` (the file to restructure — see `QueueRow`, `groupedQueue`, `groupedHistory`, the Run Status/Phase blocks, the filters, `handleQueue`/`handleRunFolderOnce`).
- Types/model: `src/renderer/src/types/trainer.ts` (`TrainerQueueJob`, `TrainerHistoryEntry`, `TrainerStateSnapshot`, `submissionId/submissionLabel`).
- Charts: `src/renderer/src/components/dashboard/Charts.tsx`.
- Help: `src/renderer/src/components/HelpPopover.tsx`.
- Theme: `src/renderer/src/assets/index.css` + `tailwind.config.js`.
- Settings (presets, normalize, formulas): `src/renderer/src/types/settings.ts`, `utils/resolveOutputFormula.ts`. **Add here:** `favoritePresetId`, `favoriteRouting`, `defaultInputDi` for Simple mode.

## Build order suggestion (for tomorrow)
1. **Shell** — rail (5 items incl. Dashboard/SIMPLE) + persistent Now-Training strip + section switching. Reuse `trainerState`.
2. **Queue** — batch cards (collapse, retained finished items, meters, restored filters), then item-drag + batch-drag (add the two small IPCs).
3. **Live Run** + the new `EsrCurve` chart primitive.
4. **History** rebuild + `QualityBars`/`Burndown`/throughput.
5. **Dashboard (Simple mode)** + the three favorite settings + Quick Add (wire to the existing native file dialog and `enqueueTrainerRuns`).
6. New Run cleanup (merge Run WAVs/Folder, restore HelpPopovers).
7. Verify across all five themes.
