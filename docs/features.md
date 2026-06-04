# NAM Lab Full Feature Reference

This document is the clean feature overview for NAM Lab. For first-launch and install notes, see **First Launch / Install** in the left menu.

---

## Core Library Workflow

- Open a folder of `.nam` files and work in a three-panel layout:
  - **Folder Tree**
  - **File List / Grid**
  - **Metadata Editor**
- Panels are resizable and collapsible.
- Recent folders are remembered.
- The app can reopen the last library on launch.
- Folder-level dashboards and Pack Info tools appear when a folder is selected and no capture is actively open.

---

## Library Overview

The main **Overview** dashboard summarizes the whole open library with clickable filters and drilldowns.

Highlights:
- gear type breakdown
- tone type breakdown
- creator breakdown
- completeness / missing metadata summary
- rating distribution
- recent additions / updates
- active checklist rollups

Clicking dashboard stats filters the file list so you can move from summary to cleanup quickly.

---

## Folder Overview

Each folder can show a scoped dashboard with:

- gear and tone breakdowns for that folder
- detected preset and ESR summaries
- checklist progress
- pack readiness
- duplicate counts
- folder size and average capture size
- recent updates
- folder watch status
- Delivery Target matrix summary when present

Empty folders still show the dashboard so watch status and pack tooling do not disappear.

---

## File List and Grid

NAM Lab supports both:

- **List view** for compact browsing
- **Grid view** for sortable spreadsheet work

List view includes:
- name and subtitle
- creator chip
- gear / tone chips
- completeness / dirty indicators
- date
- detected preset chip
- trained epoch count

Grid view includes:
- configurable visible columns
- column filters
- sorting
- drag-to-reorder
- double-click auto-size

---

## Metadata Editing

NAM Lab edits metadata inside the `.nam` file without touching model weights.

Supported workflows:
- single-file editing
- multi-select editing
- batch editor
- copy / paste metadata
- bulk rename
- batch comments
- ratings

Custom NAM Lab fields are stored under `metadata.nam_lab`.

---

## Capture Defaults

Capture defaults supply baseline values for training and manual re-apply.

Settings:
- **Default Modeled By** — your creator / studio name
- **Default Input Level (dBu)**
- **Default Output Level (dBu)**

Each field has two separate uses, controlled independently:

| Use | When it applies |
|-----|-----------------|
| Training / re-apply | Always used when you queue a training job or hit re-apply defaults |
| Auto-fill on load | Only if the "Auto-fill blank captures on load" checkbox is checked for that field |

The **Auto-fill on load** checkboxes are off by default. This matters if you open other creators' captures — loading them will not overwrite their existing metadata or silently inject your defaults into blank fields.

When auto-fill is enabled for a field, NAM Lab only fills that field if it is completely blank in the loaded file; it never overwrites an existing value.

Use **Clear suggestions** (per-file) or **Clear Suggestions** (toolbar) to remove auto-filled values without writing to disk.

---

## NAM-BOT Support

NAM Lab understands both current and legacy NAM-BOT metadata locations.

It can:
- read trained epochs
- read stored preset name
- detect the effective preset from the actual NAM config
- show detected preset / epochs in the UI
- clean outdated legacy NAM-BOT metadata into the newer layout

This includes compatibility for:
- old `metadata.training.nam_bot`
- newer `metadata.nam_bot`

---

## Pack Info

Each folder can have a `nam-pack.json` Pack Info document with:

- title
- subtitle
- description
- equipment
- pedals
- switches and modes
- glossary
- captures table
- export column choices
- color/accent styling

Pack Info can export to styled HTML for printing to PDF.

Related tools:
- Read Me tab
- gallery tab
- metadata cover image support via `ampcover.*`

---

## Pack Checklists

Pack folders can store release checklists with:

- progress tracking
- target date
- live date
- release notes
- reorderable checklist rows
- amber highlighting for unsaved row edits
- parent-pack sync tools
- drag-and-drop reordering

Checklist progress also appears in dashboards.

---

## Delivery Targets

NAM Lab now supports a **Targets** workflow for pack-level release planning across:

- `ToneX`
- `NAM`
- `Proxy`
- `QC`

What it does:
- stores a delivery matrix in `nam-pack.json`
- imports matrix rows from Excel
- supports target-specific inclusion flags
- supports alternate names for `Proxy` and `QC`
- supports target-specific title, subtitle, and description
- includes sync buttons to pull title / subtitle / description from the base pack
- filters the matrix by selected target
- exports target-specific Pack Info PDFs using the selected target subset

This is intentionally virtual in the current pass:
- no Line 6 clone validation yet
- no QC file parsing
- no metadata backfill into actual `.nam` files

---

## Tone3000 Integration

NAM Lab can browse and download Tone3000 captures inside the app.

Key behaviors:
- all-tones search
- my-files view
- remembered search term
- open creator / public page
- local "find similar on Tone3000"
- large downloads use a background queue
- queue survives leaving the Tone3000 panel
- queue handles retries and cooldowns
- large runs lock Tone3000 browsing while active
- duplicate local filenames are skipped before download
- destination folders can be auto-seeded with Pack Info
- both `ampcover.*` and original Tone3000 image can be saved

---

## Folder Watch Automation

A release folder can watch a separate source folder and auto-copy new `.nam` files into the destination.

Current behavior:
- initial sync of existing source `.nam` files
- copies newly appearing files after they finish writing
- skips duplicate destination filenames
- shows watch state in the folder dashboard and Settings
- supports removing watches from dashboard or Settings

Important safety behavior:
- watch import history uses **SHA-256 content hashes** for deduplication — a file is not re-copied if the same content has already been imported, even if the filename or destination changes
- content hashes are retroactively backfilled for existing import history on startup so older entries also benefit from hash-based protection
- watch rules use **import-once semantics**
- renaming a copied file in the destination will not cause a re-copy because the hash still matches

---

## Duplicate Detection

NAM Lab can find duplicates by:

- filename
- capture name
- exact file content (full `.nam` file hash)
- same model, metadata differs

You can run duplicate scans from:
- the main toolbar
- folder-scoped right-click actions in the tree

Actions include keeping one file and moving or deleting the rest.

Content mode is exact-match only:
- it hashes the full `.nam` file
- matching files are byte-for-byte identical, including metadata and model data
- this is different from filename or meta-name grouping

Same-model mode is intentionally different:
- it strips the `metadata` block before hashing
- matching files share the same model content even if metadata was repaired or changed later
- this is useful for spotting cases where one file still has placeholders like `tz-make` / `tz-model` and another has already been cleaned up

When NAM Lab picks a default file to keep inside a duplicate group, it still prefers the file with richer core metadata first. If two files tie on metadata completeness, it now prefers cleaner filenames over obvious duplicate suffixes such as `(2)` or `- Copy`.

### Architecture-aware grouping

In filename and capture-name duplicate modes, NAM Lab defaults to **same-architecture-only grouping**. This means a `Standard` and a `REVxSTD` capture with the same name are not flagged as duplicates by default — they are different model formats and are typically kept together intentionally.

To also catch cross-architecture matches (for example finding that you trained the same WAV with multiple architectures and want to thin them out), toggle **Include cross-architecture** in the duplicate scan controls. When enabled, architecture badges appear on each file row in the results so you can tell which format each file is.

---

## Metadata Suggestions

NAM Lab includes a preview-first metadata suggestion system for filling or repairing metadata across many captures.

It supports:
- global rules
- folder-scoped rules
- blank-token scope defaults
- reusable rule library
- overwrite rules
- guarded overwrites for junk placeholders
- filename segment targeting
- "Build from example..." helpers

### Rule types

Rules can match:
- exact token
- contains
- starts with
- ends with
- prefix + value

Rules can look in:
- filename only
- folder only
- filename or folder

Rules can target a specific filename segment:
- `1` = first space-separated segment
- `2` = second
- blank = match anywhere in the full filename

### Overwrite behavior

Rules normally suggest values only for blank fields.

If `Overwrite` is enabled, a rule can also replace existing values.

For safer cleanup, overwrite rules can be guarded so they only apply when the current value matches known junk placeholders such as:
- `tz-make`
- `tz-model`
- `Unknown`
- `N/A`

### Rule library

Complete non-blank-token rules can be saved into a reusable library and copied into:
- global rules
- folder rules

Blank-token scope defaults are intentionally not stored in the library.

### Build from example

The example builder is designed for consistent naming styles.

Example:
- `JCM800 Lo P6 B8 M4 T7 G10`

You can map that into:
- make / model
- amp switches
- amp settings

`Prefix + value` rules support templates such as:
- `Gain {value}`
- `Bass {value}`
- `Volume {value}`

The folder rule editor now keeps this more visible while you work:
- a quick guide explains that `{value}` means "the part after the prefix"
- `{match}` means "the full matched token"
- live examples update as you type, so `G10` + `Gain {value}` clearly previews as `Gain 10`

So a segment like `V8` can become:
- `Volume 8`

This works best when a creator or pack uses the same filename structure across many captures.

### Matching source

Filename-style rules are no longer limited to the raw filename on disk.

When available, NAM Lab now prefers the capture's embedded metadata name first, and only falls back to the disk filename when that metadata name is blank. This matters when a capture has a cleaner metadata name like:

- `[AMP] F.PLEX-HV-Hi SLP - BLEND #1`

but the actual filename had to be flattened on disk into something like:

- `_AMP_ F.PLEX-HV-Hi SLP - BLEND _1.nam`

That makes rule building and rule matching behave more like the naming style you actually care about.

### Pack Info as rule source

Pack Info can now help bootstrap folder-scoped metadata rules from structured notes you have already curated.

Current helpers include:
- build rule seeds from selected text inside Description
- parse selected `TOKEN = meaning` lines into Glossary
- create folder rules from selected or all Glossary entries
- create folder rules from selected or all Switches & Modes entries

These rule-generation tools open the current folder's rule editor immediately after seeding the rules so you can review and tweak before applying them.

### Clearing suggestions

If NAM Lab auto-filled values at load time and you want to see the raw on-disk metadata again:
- use `Clear suggestions` on a capture
- or `Clear Suggestions` globally in the toolbar

This only clears app-added auto-fill values in the current session. It does not write to disk by itself.

---

## Library Cleanup / Build Library

NAM Lab includes a preview-first cleanup and rebuild workflow for reorganizing libraries without manually dragging folders around.

### Entry points

There are two main ways to use it:

- **Library Tools -> Clean Up / Build Library...**
  - broad intake / collection flow
  - best for messy or disjointed source roots

- **Right-click folder -> Clean this folder...**
  - scoped subtree cleanup
  - best for recategorizing a creator folder, amp folder, or `Needs Review`

### Structure options

Current structure presets include:
- `Flat`
- `Creator`
- `Creator > Amp`
- `Creator > Amp > DI/CAB`
- `Creator > Amp > DI/CAB > Preset Type`

Cleanup builds as much path as it can from the metadata available instead of failing the whole file when one deeper level is missing.

Examples:
- creator known -> move into creator folder
- creator + amp known -> move into creator / amp
- creator + amp + DI/CAB known -> move deeper
- missing deeper data -> route to `Needs Review` at the deepest confident level

### Preview states

Cleanup preview separates rows into:
- `Ready`
- `Needs Review`
- `No Change`

`No Change` means the file already matches the selected structure.

`Needs Review` means NAM Lab cannot confidently place that file all the way into the requested structure with the metadata currently available.

The `Needs Review` subset can be exported to:
- CSV
- XLSX

### Folder mode anchor behavior

When you use **Clean this folder...**, NAM Lab treats the selected folder as an anchor.

That means:
- if the current folder already represents part of the desired path
- cleanup does not rebuild that same prefix inside it again

This is what makes "clean this creator/amp folder in place" work without generating duplicated parent folders.

### Important destination-root rule

If you are repairing a bad placeholder subtree like:
- `amalgamaudio/tz-make tz-model/di`

and you fixed the metadata so the files now belong under:
- `amalgamaudio/gibson g200/di`

set **Destination Library Root** to the parent branch you want to keep, such as:
- `amalgamaudio`

Do not leave the destination on the placeholder folder, or cleanup will keep rebuilding under that old branch because it is acting as the active anchor.

### Copy vs Move

- `Copy` is the safer default for broad cleanup runs
- `Move` is often the right choice for folder-scoped recategorize flows

Use `Copy` first whenever you are testing a new structure or naming repair strategy.

---

## Spreadsheet Import / Export

NAM Lab supports spreadsheet workflows for metadata.

Export:
- CSV
- XLSX
- visible columns or all columns
- respects current filters

Import template:
- generated as `.xlsx`
- includes target matrix columns:
  - `ToneX`
  - `NAM`
  - `Proxy`
  - `QC`
  - `Capture Name`
  - `Alt Proxy Name`
  - `Alt QC Name`
- includes a second lookup/reference sheet for common values

Import:
- round-trip metadata edits from Excel back into NAM Lab

---

## Built-in Training Workspace

NAM Lab orchestrates the NAM Python trainer directly inside the app. Full details are in [docs/training.md](training.md); short version:

- **Dashboard** — single-glance "what's running now" view with 8 big stat tiles (Current epoch, Queue progress, Active batch, Current ETA, Completed, Failed, Last ESR, Last item took), Quick Add card, Up Next card. Completed / Failed / Last ESR tiles are clickable and jump to History pre-filtered.
- **Live Run** — real-time ESR-over-epochs chart fed by an embedded `pytorch_lightning.Callback` that NAM Lab installs into the trainer so per-epoch validation ESR actually populates (the official NAM trainer's tqdm postfix carries training loss, not validation ESR). Statline cells for Epoch / Rate / Validation ESR / Started; Final output + Checkpoint paths; collapsible Raw trainer log that mirrors what an Anaconda shell would show (tqdm-aware dedupe + filter so each epoch becomes one rolling line instead of hundreds).
- **Queue** — batch-grouped, with Expand-all / Collapse-all, status / profile / architecture filters, and tiles that count both **captures** and **batches**. Finished / failed / canceled rows auto-clear when a new batch is queued; history is the source of truth.
- **Staged Batches** — drafts saved via **Stage** in Create Batch. Cards with amber type icon + Staged pill + color-coded architecture chips per unique arch in the batch + routing line + Edit / Delete / Queue-now / expand-to-see-captures.
- **History** — ESR-quality and Throughput trend charts, search bar with magnifier icon, segmented status filter (All / Done / Failed / Canceled), grouped by batch submission with `N done` / `N failed` counts + **Retry failed** + **Retry batch** buttons on every group header. Each row has a seeded MiniEsrPlot thumbnail tinted to the entry ESR tone; failed rows show their architecture chip + profile + epochs + duration on one line and the failure reason in red mono on the next. Right-click → View ESR plot / Retry / Reveal in folder / Purge from history / Purge entire batch (with confirm modal — only the history record is removed, on-disk `.nam` and PNG stay). Whole row click opens the ESR plot modal.
- **New Run** (Create Batch) — optional Batch name field with smart placeholder (capture / folder / count), Input DI, drop-or-pick output WAVs, Preset selector on one line + Architecture multi-select with **A2 first, A1 variants prefixed as `A1 - Standard` / `A1 - Lite` / etc.**, color-coded selection chips below with × buttons to remove. Submitting clears the form and jumps to Queue (or Batches for staged) so duplicate submissions are hard to make by accident.
- **Mixed A1 + A2 batches** — one ticked architecture spawns one job; one batch can mix A1 variants and A2 freely, all under one shared submission. `namMode` is derived per-job from `architecture` so the right Python runner (`_run_a2` / `_run_a1_v13` / `_run_a1`) fires per capture.
- **Quick Add** — Dashboard card that fires a training run from your favorite preset + favorite routing + default DI without opening Create Batch. Falls back to the global output formula if the favorite routing is empty.
- **Watcher automation** — folder watchers attach a profile to a directory; new WAVs are queued automatically; SHA-256 content tracking prevents re-training after renames / copies. Watcher Files modal per profile with per-file Wipe & retrain / Retrain as new file / Mark as skipped actions.
- **Persistence** — `trainer-queue.json` saves staged + queued + running jobs (throttled to 1 write per 2 s, flushed on quit). `trainer-history.json` keeps the last 2000 entries newest-first. `trainingLastSelectedPresetId` remembers the Create Batch preset choice across restarts. The session-restore demotes anything that was running when the app died back to `queued` with progress cleared (the Python child is gone).
- **Retry safety** — Retry failed / Retry batch / per-row Retry rebuild jobs from history entry metadata + current Settings, submit them as a new `Retry - {label}` batch, and **back up any existing `.nam` to `*.bak.nam` before overwriting**. One backup max, replaced on subsequent retries. Normal queue submissions still overwrite as before.
- **Live trainer log** — selectable text + native right-click Copy across the entire trainer (overriding the global `body { user-select: none }`). Python child spawned with `PYTHONUNBUFFERED=1`, `PYTHONIOENCODING=utf-8`, `TQDM_MININTERVAL=10`, `TQDM_ASCII=1` so the log looks like an Anaconda terminal even though it's a piped subprocess.

---

## Training Version Report

NAM Lab can generate folder-scoped coverage reports showing:

- base capture rows
- detected preset columns
- DI and Amp+Cab coverage
- variant suffixes
- epoch counts where available

Exports:
- CSV
- Excel

---

## Folder Card View

The card view gives a gallery-style overview of your library at the folder level.

Entry point:
- click the **Cards** (grid) icon in the toolbar (enabled only when a root folder is loaded)
- clicking again returns to the normal three-panel view

Cards:
- one card per first-level subfolder
- shows `ampcover.*` image if present in that folder, or the first cover found one level deeper (up to 5 children checked)
- folders without any cover show a dark placeholder
- displays folder name and total `.nam` count badge
- card size is switchable between **Small / Medium / Large** via a picker in the breadcrumb bar; choice persists between sessions

Interactions:
- **Single click** — select the card; a resizable preview panel slides in on the right showing the amp cover, folder name, path, counts, and pack title/subtitle if available; panel width persists between sessions
- **Double click** — drill into that folder's subfolders (stays in card view)
- **Breadcrumb bar** — shows the current drill path; click any crumb to go back up

Right-click menu:
- **Open folder** — exits card view and loads the folder in the three-panel view
- **Find on Tone3000** — opens Tone3000 search in the right preview panel slot without leaving card view; downloads flow through the normal queue and the new folder card appears automatically when done
- **Get Cover Image** — fetch or set an `ampcover` image for the folder:
  - paste an image URL
  - drag-drop an image from a browser or Windows Explorer
  - click **Browse** to pick a local file via the native file picker
  - click the Google Images button to open a ready-to-search browser window

Breadcrumb bar also includes a **Refresh** button to rescan the current folder without leaving card view.

---

## Images and Gallery

NAM Lab supports:
- folder image galleries
- parent-folder image cascade
- lightbox viewing
- OS image viewer launch
- metadata cover images through `ampcover.*`

`ampcover.*` is intentionally excluded from the gallery view so it can act as pack cover art instead.

---

## Native Text Menus

NAM Lab enables native right-click text menus in places where text selection matters, including:

- Tone3000 detail text
- metadata text fields
- Read Me text

That restores copy / paste / select-all behavior users expect from desktop apps.

---

## Update Checking and Packaging

NAM Lab can:
- check GitHub releases for updates
- optionally include prerelease builds in update checks

Package targets:
- Windows installer
- macOS DMG
- Linux AppImage

The app is still unsigned at the moment, so first-launch warnings from the OS are expected.
