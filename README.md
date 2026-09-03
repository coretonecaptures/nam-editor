# NAM Lab

**Metadata management and library tooling for Neural Amp Modeler.**

*Organize, tag, and scale your NAM capture library without touching the model weights.*

Built with Electron, React, and Tailwind CSS. Runs on **Windows**, **macOS**, and **Linux**.

> NAM Lab is primarily a metadata editor and library manager for `.nam` files — it does not need a Python/NAM install to organize, tag, and export your existing captures. It also includes an **optional built-in training workspace** (see below) that orchestrates your own local `neural-amp-modeler` Python install if you want to train new captures without leaving the app. Either way, to actually *use* a `.nam` file in a DAW you need the [Neural Amp Modeler plugin](https://www.neuralampmodeler.com/) (free, available for all major DAWs).

---

## Install

Download the latest installer from the [Releases](https://github.com/coretonecaptures/nam-editor/releases) page.

| Platform | File |
|----------|------|
| Windows  | `NAM-Lab-Setup-x.x.x.exe` |
| macOS    | `NAM-Lab-x.x.x-universal.dmg` (Intel + Apple Silicon) |
| Linux    | `NAM-Lab-x.x.x.AppImage` |

The app is currently unsigned. macOS will show a Gatekeeper warning; Windows will show a SmartScreen prompt. Both are safe to bypass - [first-launch instructions](docs/install.md)

On macOS, you may also see a system prompt related to secure storage / Keychain access. This is expected when NAM Lab reads or saves sensitive credentials such as Tone3000 login tokens or AI API keys. The app uses Electron `safeStorage` so those secrets are encrypted on your machine instead of being stored as plain text.

**Building from source:** see [docs/building.md](docs/building.md).

---

## What It Does

NAM captures embed metadata (name, gear info, tone type, etc.) as JSON inside the `.nam` file alongside the model weights. Most tools don't expose this for editing. NAM Lab opens many files at once, lets you update and bulk-edit their metadata, and writes back **only the bytes that changed** - weights, config, and all other file data are preserved exactly.

---

## Key Features

- **Tone3000 integration** - browse and download captures from Tone3000 inside NAM Lab, search by gear and sort order, remember your last search term, open your own created tones, jump from a local capture to similar Tone3000 results, open the public Tone3000 page from the detail view, run large downloads through a background queue with retry/cooldown handling, auto-seed Pack Info for new Tone3000 folders, and save both an `ampcover` image and the original Tone3000 image into the folder
- **Folder card view** - gallery-style library overview showing first-level folders as visual cards with amp cover art, capture counts, and a resizable right-side preview panel; single-click to preview, double-click to drill into subfolders; right-click for context actions including Get Cover Image (URL paste, drag-drop, or Browse) and Find on Tone3000 (opens inline in the preview panel); card size picker (small / medium / large) persisted between sessions
- **Three-panel library** - Folder Tree | File List | Metadata Editor; all panels resizable and collapsible
- **Library Overview dashboard** - gear type, tone type, creator, completeness, and rating breakdowns across your whole library; clickable stats filter the file list; recent files list for quick navigation
- **Folder Overview dashboard** - same at folder level; shown in the Overview tab when a folder is selected, with checklist status, pack readiness, duplicates, size, recent updates, and folder watch details
- **Delivery Targets workflow** - build pack-specific target matrices for `ToneX`, `NAM`, `Proxy`, and `QC`, import them from Excel, manage target titles/subtitles/descriptions, filter rows per target, and export target-specific Pack Info PDFs from the same pack
- **Pack checklist workflow** - per-pack release checklist with progress, target/live dates, release notes, dashboard rollups, and parent-pack row sync
- **Checklist editing polish** - amber unsaved-row highlighting, drag-and-drop row reordering, tighter one-line row layout, and parent sync tools
- **List and Grid views** - sortable spreadsheet with configurable columns, per-column filters, drag-to-reorder, and double-click auto-size
- **List view metadata chips** - show `modeled_by`/creator in list rows when present, alongside gear and tone tags, plus detected training preset and trained epoch count on the right rail
- **Capture rating** - 1-5 star rating (`nl_rating`) per capture; shown in list/grid; filterable; rating distribution in both dashboards
- **Bulk editing** - batch editor, multi-select editor, and copy/paste metadata across files
- **Batch rename** - suffix, prefix, find & replace, or template-based rename with live preview and conflict detection
- **Duplicate detection** - find dupes by filename or capture name; choose a keeper and move or trash the rest, including folder-scoped duplicate scans from the tree
- **Advanced duplicate detection** - find dupes by filename, metadata name, exact full-file content, or "same model, metadata differs" when the model content matches but the metadata block has changed. When duplicate groups tie on metadata richness, NAM Lab prefers cleaner original filenames over obvious suffixes like `(2)` or `- Copy`.
- **Smart defaults** - default values for training and manual re-apply; per-field "auto-fill on load" checkboxes (off by default) let you opt in to populating blank captures when opening them, without affecting captures that already have values
- **Metadata suggestions** - global and folder-scoped suggestion rules, overwrite guards for junk placeholders, reusable rule library, blank-token scope defaults, capture-name-aware matching, filename-segment / example-based rule building, and Pack Info powered rule seeding from glossary, switches, and selected notes
- **Library cleanup / rebuild tools** - preview-first cleanup modal, top-level library intake flow, folder-level recategorize-in-place flow, `Needs Review` routing, CSV/XLSX export for the review list, and safe copy/move options
- **Pack Info editor** - documentation sheet per amp pack with rich text description, glossary, switches, equipment table, captures table, PDF export, customizable dark-mode accent color, and helpers to turn curated pack notes into folder-scoped metadata rules
- **Read Me tab** - open, edit, and save folder README text files directly inside NAM Lab
- **Metadata cover image** - show `ampcover.*` images above the metadata editor without stretching, while keeping those cover images out of the gallery view
- **Native text menus** - right-click selected text in Tone3000 details, Read Me, and Metadata fields for normal copy/paste/select-all behavior
- **Folder watch automation** - attach a watched source folder to a release folder, sync existing `.nam` files immediately, auto-copy newly finished files into the destination, remember imported source files so destination renames do not re-add originals, and manage watch rules from the folder dashboard or Settings
- **Folder image gallery** - browse rig photos stored alongside `.nam` files; images cascade from parent folders
- **Export** - CSV or Excel from any view; visible or all columns; respects active filters
- **Spreadsheet import** - generate a pre-filled `.xlsx` template with target columns and a lookup/reference sheet, edit in Excel, import back
- **Training version report** - pivot table showing preset x capture coverage per folder
- **Built-in training workspace** - mission-control UI for the NAM Python trainer with a Dashboard, Live Run with a live ESR-over-epochs chart driven by an embedded PyTorch-Lightning callback, a batch-grouped Queue, Staged Batches (drafts) tab, History with twin trend charts and right-click purge / batch retry, a dedicated Presets page (presets + **Training Bundles** — named groups of presets submitted together as one batch), watcher automation (which can link a whole bundle to a watch folder), and full mixed A1 + A2 batches in one submission (one preset can ship `['A2', 'standard', 'revxstd']` and produce three flavors of the same capture). A global "always ignore pre-training data checks" setting can bypass NAM's own data validation on every run; bypassed runs that would have failed are flagged with a "Trained despite warnings" badge (live during the run and in History) so you know to double-check them. Retries back up existing `.nam` files to `*.bak.nam` before overwriting. Queue, staged batches, and last-selected preset all persist across restarts.
- **File associations** - `.nam` files open directly in NAM Lab from Explorer/Finder

[Full feature reference](docs/features.md)  
[Workflow guide and screenshots](docs/workflows.md)

---

## Workflow Guides

If you want the practical "how do I actually use this?" side of the app, start here:

- [Library cleanup and metadata workflows](docs/workflows.md)
- [Full feature reference](docs/features.md)

---

## About

Conceived by **[Core Tone Captures](https://www.coretonecaptures.com)** - a NAM capture maker focused on quality tones. Questions, feedback, or collaboration: [info@coretonecaptures.com](mailto:info@coretonecaptures.com).

Code written by [Claude Code](https://claude.ai/code).
