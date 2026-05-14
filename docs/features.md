# NAM Lab Full Feature Reference

This document is the clean feature overview for NAM Lab. For install notes, see [install.md](install.md).

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
- watch import history is stored in NAM Lab app state
- watch rules use **import-once semantics**
- renaming a copied file in the destination will not cause the original source filename to be re-added

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

So a segment like `V8` can become:
- `Volume 8`

This works best when a creator or pack uses the same filename structure across many captures.

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
