# NAM Lab

**Metadata management and library tooling for Neural Amp Modeler.**

*Organize, tag, and scale your NAM capture library without touching the model weights.*

Built with Electron, React, and Tailwind CSS. Runs on **Windows**, **macOS**, and **Linux**.

> **This app does not run captures or process audio.** It is purely a metadata editor for `.nam` files. To actually use your captures, you need the [Neural Amp Modeler plugin](https://www.neuralampmodeler.com/) (free, available for all major DAWs).

---

## Install

Download the latest installer from the [Releases](https://github.com/coretonecaptures/nam-editor/releases) page.

| Platform | File |
|----------|------|
| Windows  | `NAM-Lab-Setup-x.x.x.exe` |
| macOS    | `NAM-Lab-x.x.x-universal.dmg` (Intel + Apple Silicon) |
| Linux    | `NAM-Lab-x.x.x.AppImage` |

The app is currently unsigned. macOS will show a Gatekeeper warning; Windows will show a SmartScreen prompt. Both are safe to bypass - [first-launch instructions](docs/install.md)

---

## What It Does

NAM captures embed metadata (name, gear info, tone type, etc.) as JSON inside the `.nam` file alongside the model weights. Most tools don't expose this for editing. NAM Lab opens many files at once, lets you update and bulk-edit their metadata, and writes back **only the bytes that changed** - weights, config, and all other file data are preserved exactly.

---

## Key Features

- **Tone3000 integration** - browse and download captures from Tone3000 inside NAM Lab, search by gear and sort order, open your own created tones, jump from a local capture to similar Tone3000 results, and open the public Tone3000 page from the detail view
- **Three-panel library** - Folder Tree | File List | Metadata Editor; all panels resizable and collapsible
- **Library Overview dashboard** - gear type, tone type, creator, completeness, and rating breakdowns across your whole library; clickable stats filter the file list; recent files list for quick navigation
- **Folder Overview dashboard** - same at folder level; shown in the Overview tab when a folder is selected
- **List and Grid views** - sortable spreadsheet with configurable columns, per-column filters, drag-to-reorder, and double-click auto-size
- **Capture rating** - 1-5 star rating (`nl_rating`) per capture; shown in list/grid; filterable; rating distribution in both dashboards
- **Bulk editing** - batch editor, multi-select editor, and copy/paste metadata across files
- **Batch rename** - suffix, prefix, find & replace, or template-based rename with live preview and conflict detection
- **Duplicate detection** - find dupes by filename or capture name; choose a keeper and move or trash the rest
- **Smart defaults** - auto-fill empty fields at load time (modeled by, levels, amp info); each rule section independently togglable
- **Pack Info editor** - documentation sheet per amp pack with rich text description, equipment table, captures table, PDF export, and customizable dark-mode accent color
- **Folder image gallery** - browse rig photos stored alongside `.nam` files; images cascade from parent folders
- **Export** - CSV or Excel from any view; visible or all columns; respects active filters
- **Spreadsheet import** - generate a pre-filled `.xlsx` template, edit in Excel, import back
- **Training version report** - pivot table showing preset x capture coverage per folder
- **Watch folder** - detects new `.nam` files and prompts to refresh (Windows/macOS)
- **File associations** - `.nam` files open directly in NAM Lab from Explorer/Finder

[Full feature reference](docs/features.md)

---

## About

Conceived by **[Core Tone Captures](https://www.coretonecaptures.com)** - a NAM capture maker focused on quality tones. Questions, feedback, or collaboration: [info@coretonecaptures.com](mailto:info@coretonecaptures.com).

Code written by [Claude Code](https://claude.ai/code).
