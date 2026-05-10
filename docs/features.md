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

You can run duplicate scans from:
- the main toolbar
- folder-scoped right-click actions in the tree

Actions include keeping one file and moving or deleting the rest.

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
