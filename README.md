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

- **Tone3000 integration** - browse and download captures from Tone3000 inside NAM Lab, search by gear and sort order, remember your last search term, open your own created tones, jump from a local capture to similar Tone3000 results, open the public Tone3000 page from the detail view, run large downloads through a background queue with retry/cooldown handling, auto-seed Pack Info for new Tone3000 folders, and save both an `ampcover` image and the original Tone3000 image into the folder
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
- **Exact content duplicate detection** - third duplicate mode hashes the full `.nam` file to find true byte-for-byte duplicates, not just same names
- **Smart defaults** - auto-fill empty fields at load time (modeled by, levels, amp info); each rule section independently togglable
- **Metadata suggestions** - global and folder-scoped suggestion rules, overwrite guards for junk placeholders, reusable rule library, blank-token scope defaults, and filename-segment / example-based rule building for consistent naming styles
- **Library cleanup / rebuild tools** - preview-first cleanup modal, top-level library intake flow, folder-level recategorize-in-place flow, `Needs Review` routing, CSV/XLSX export for the review list, and safe copy/move options
- **Pack Info editor** - documentation sheet per amp pack with rich text description, equipment table, captures table, PDF export, and customizable dark-mode accent color
- **Read Me tab** - open, edit, and save folder README text files directly inside NAM Lab
- **Metadata cover image** - show `ampcover.*` images above the metadata editor without stretching, while keeping those cover images out of the gallery view
- **Native text menus** - right-click selected text in Tone3000 details, Read Me, and Metadata fields for normal copy/paste/select-all behavior
- **Folder watch automation** - attach a watched source folder to a release folder, sync existing `.nam` files immediately, auto-copy newly finished files into the destination, remember imported source files so destination renames do not re-add originals, and manage watch rules from the folder dashboard or Settings
- **Folder image gallery** - browse rig photos stored alongside `.nam` files; images cascade from parent folders
- **Export** - CSV or Excel from any view; visible or all columns; respects active filters
- **Spreadsheet import** - generate a pre-filled `.xlsx` template with target columns and a lookup/reference sheet, edit in Excel, import back
- **Training version report** - pivot table showing preset x capture coverage per folder
- **File associations** - `.nam` files open directly in NAM Lab from Explorer/Finder

[Full feature reference](docs/features.md)

---

## Suggested Workflows

### 1. I have a messy / disjointed library and want to build structure

Use **Library Tools -> Clean Up / Build Library...**

1. Pick a broad parent root that contains the captures you want to collect.
2. Choose a destination library root.
3. Choose `Copy` first unless you are very confident.
4. Pick a structure such as:
   - `Creator`
   - `Creator > Amp`
   - `Creator > Amp > DI/CAB`
   - `Creator > Amp > DI/CAB > Preset Type`
5. Build the preview.
6. Review:
   - `Ready`
   - `Needs Review`
   - `No Change`
7. Export the `Needs Review` list if you want to clean those up in Excel or batch-edit them later.

### 2. I already have a few folders and want to clean just one subtree

Right-click the folder in the tree and use **Clean this folder...**

Best for:
- a creator folder
- an amp folder
- a flat `Needs Review` bucket
- a subtree you already trust but want to organize more deeply

If you clean a normal folder in place, NAM Lab treats that folder as an **anchor** and only builds the missing deeper structure underneath it.

### 3. I fixed metadata inside `Needs Review` and want to recategorize those files

1. Batch-edit or update the metadata you now know.
2. Right-click the `Needs Review` folder.
3. Choose **Clean this folder...**
4. Let the destination root point to the **parent library root**.

This is the best flow for moving repaired files back out of `Needs Review` into creator / amp / DI / preset structure.

### 4. I repaired placeholder metadata like `tz-make` / `tz-model`

After fixing those values, run cleanup again, but choose the **parent branch you want the files to live under** as the destination root.

Example:
- bad current path: `amalgamaudio/tz-make tz-model/di`
- repaired desired path: `amalgamaudio/gibson g200/di`

In that case, set **Destination Library Root** to:
- `amalgamaudio`

Do not leave it on the current placeholder folder, or NAM Lab will keep building underneath that junk branch because it is being treated as the current anchor.

### 5. I have consistent filenames and want fast metadata

Use **Suggest metadata...** plus the rule tools:

- global rules for patterns you use everywhere
- folder rules for creator-specific or batch-specific meaning
- **Build from example...** when the filename style is structured

Example naming style:
- `JCM800 Lo P6 B8 M4 T7 G10`

That can drive:
- make / model
- amp switches
- amp settings

without hand-tagging every file one at a time.

For more detail, see:
- [Full feature reference](docs/features.md)
- [Library cleanup and metadata workflows](docs/workflows.md)

---

## About

Conceived by **[Core Tone Captures](https://www.coretonecaptures.com)** - a NAM capture maker focused on quality tones. Questions, feedback, or collaboration: [info@coretonecaptures.com](mailto:info@coretonecaptures.com).

Code written by [Claude Code](https://claude.ai/code).
