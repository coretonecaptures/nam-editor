# NAM Editor

A desktop app for editing metadata in [Neural Amp Modeler](https://www.neuralampmodeler.com/) `.nam` files — without touching the model weights or breaking the file format.

Built with Electron, React, and Tailwind CSS. Runs on **Windows** and **macOS**.

> **This app does not run captures or process audio.** It is purely a metadata editor for `.nam` files. To actually use your captures, you need the [Neural Amp Modeler plugin](https://www.neuralampmodeler.com/) (free, available for all major DAWs).

---

## What It Does

Neural Amp Modeler captures store metadata (capture name, gear info, tone type, etc.) as JSON inside the `.nam` file alongside the model weights. Most tools don't expose this metadata for editing — NAM Editor lets you open many files at once, update their metadata, and save back safely.

This is especially useful for capture artists who want to properly tag their `.nam` files before sharing or uploading them to tone libraries.

**Key guarantees:**
- Only the metadata fields you explicitly edit are written back
- Model weights, architecture, config, and all other file data are preserved exactly
- Files that haven't changed are never written to

---

## Features

### Library View (Folder Mode)
- Open a folder and get a three-panel layout: **Folder Tree | File List | Metadata Editor**
- Folder tree shows all subfolders with file counts; click any folder to filter the file list to that folder
- Each folder shows a **blue total count** and an **amber dirty count** (unsaved edits)
- All three panels are **resizable** — drag the dividers to any width
- **Refresh** button rescans the folder for new or removed files (warns about unsaved changes)
- Remembers the last opened folder and reopens it automatically on next launch
- Panel widths and window size are remembered between sessions

### Library Search & Filter
- Click the **🔍** icon in the Library header to open the collapsible search panel
- **Text search** across capture name, filename, manufacturer, model, and modeled-by
- **Tone type chips** (indigo) — click to filter by clean, crunch, hi_gain, fuzz, overdrive, distortion
- **Gear type chips** (amber) — click to filter by amp, pedal, amp_cab, preamp, studio, etc.
- Filters stack (text AND tone AND gear simultaneously)
- Folders with zero matches **disappear** from the tree; folder counts show match count in amber
- An amber **FILTERED** banner with match count appears when any filter is active
- Closing the panel clears all filters

### List View & Grid View
- Toggle between **List** and **Grid** views using the icons to the right of the search bar
- **List view** — compact single-row per file with name, subtitle, gear/tone chips, and missing-field badge
- **Grid view** — spreadsheet-style table with columns: Capture Name · Date · Modeled By · Manufacturer · Model · Gear Type · Tone Type
  - Click any column header to **sort** ascending/descending
  - **Drag column edges** to resize individual columns
  - Panel auto-widens when switching to grid view
- Set your **default view** in Settings → Appearance — switches immediately, persists across launches
- Per-mode width memory: list and grid each remember their last-used panel width separately

### File List Filters
- **All / Edited / Unnamed / No Type / No Maker / No Tone** filter chips in the file list header
- **Edited** chip shows count of manually-changed files and filters to just those
- Each file item shows a **"N missing"** badge (tooltip lists which tracked fields are empty)
- Search bar in the file list to search by name, filename, make, model, or modeled-by

### File Management
- Open individual `.nam` files or an entire folder (scans recursively)
- Drag & drop files directly onto the window to open them
- **Drag files between folders** — drag any file (or a multi-selection) from the list or grid view and drop it onto a folder in the tree to move it on disk; the folder highlights as you drag over it
  - Dragging a file that is part of a multi-selection moves all selected files
  - Dragging a non-selected file moves just that one file
  - Warns if any files have unsaved changes; skips files that already exist at the destination
  - Folder tree counts update and the view switches to the destination folder automatically
- Shift+click and Ctrl+click for range and multi-selection in the file list
- Opening a new file or folder replaces the current session (with unsaved-changes warning)
- Close All button clears the session

### Metadata Editing
- **Capture Name** — display name shown in plugins; click **↺ filename** button to reset it to the filename
- **Modeled By** — capture artist / creator
- **Gear Type** — amp, pedal, pedal_amp, amp_cab, amp_pedal_cab, preamp, studio
- **Tone Type** — clean, crunch, hi_gain, fuzz, overdrive, distortion, other
- **Manufacturer** and **Model** — gear make/model
- **Reamp Send Level (dBu)** and **Reamp Return Level (dBu)**
- Ctrl+S / Cmd+S to save the current file
- **Revert** button discards unsaved changes and restores the file's saved values
- Read-only stats: architecture, NAM version, integrated loudness, gain, validation ESR, epoch count (if present)
- **File path** in the header is clickable — opens the file's folder in Finder/Explorer
- **Gear type icon** displayed in the file header for visual identification (amp, pedal, cab, etc.)

### Change Tracking & Highlighting
- Fields auto-populated by settings rules show an **indigo border** and **"auto-filled"** label
- Fields you manually edit show an **amber border** (no label)
- Auto-fill highlights clear automatically after saving
- Amber dot in the file list and folder tree counts unsaved edits

### Appearance
- **Dark theme** (default) and **Light theme** — toggle in Settings → Appearance, applies instantly
- **Default view** (List or Grid) — set your preferred starting view in Settings → Appearance

### Smart Defaults (Settings)
Settings are stored locally and start blank. Each section can be **enabled or disabled independently** — turn off a section to browse other people's captures without applying your defaults.

**Current Amp Info** *(toggleable)*
- Default Manufacturer and Model — applied to files missing those fields on open

**Capture Defaults** *(toggleable)*
- Default Modeled By — applied if the file has no `modeled_by`
- Default Reamp Send Level (dBu) — applied if the file has no `input_level_dbu`
- Default Reamp Return Level (dBu) — applied if the file has no `output_level_dbu`

**Behavior**
- **Populate name from filename** — auto-sets Capture Name to the filename if empty
- **Auto-detect tone type** — scans the filename for tone keywords and sets Tone Type if empty; the rightmost keyword wins (e.g. `BE Clean Crunch DI` → Crunch). Keywords: `clean`, `crunch`, `lead`/`highgain`/`hi-gain`, `fuzz`, `overdrive`/`od`/`edge`/`drive`, `distortion`/`dist`
- **Amp Suffix** — configurable filename ending that auto-sets Gear Type to Amp (e.g. `DI` or `DIRECT`). Leave blank to disable
- **Default to Cab if no amp suffix match** — when enabled, files that don't match the amp suffix get set to `amp_cab`
- **Confirmation dialogs** — independently skip Save All and Batch Edit confirmation dialogs once you're comfortable

**Startup**
- **Remember last opened folder** — every time you open a folder it becomes the default for next launch
- **Open default folder on launch** — automatically loads a pinned folder when the app starts

### Active Defaults Pill
A slim bar above the status bar shows which defaults are currently active (e.g. `Amp: Friedman BE100 · Capture: Core Tone Captures · Name from filename`). Disappears entirely when nothing is enabled.

### Saving
- **Save** button (or Ctrl+S / Cmd+S) saves the current file
- **Revert** button discards unsaved changes for the current file
- **Save All** in the toolbar saves all unsaved files (with optional confirmation dialog)
- **Right-click selection → Save N selected** — saves only the files you've selected
- **Right-click folder → Save all in folder** — saves all unsaved files under that folder path
- Batch edit writes directly to disk — no separate Save step needed

### Multi-Select Editor
- Select 2 or more files to open the **multi-select editor** in the detail panel
- Fields where all selected files share the same value are pre-filled and marked **shared**
- Fields that differ across files are empty with a *— varies —* placeholder
- Edit any field — changed fields highlight in amber
- **Revert Capture Name to filename** checkbox sets each file's name to its own filename (without `.nam`)
- **Apply to N files** writes only the changed fields directly to disk — unchanged fields are never touched
- Clearing a field (leaving it empty) explicitly saves null, removing the old value

### Batch Edit
- **Right-click a selection** in the file list → **Batch edit N selected**
- **Right-click a folder** → **Batch edit…** (applies to the whole folder; if files are selected, applies to selection instead)
- Check only the fields you want to change — unchecked fields are untouched
- **Revert Capture Name to filename** checkbox available in batch edit — sets each file's name to its own filename
- Only the checked fields are written to disk; auto-fills and other pending changes are preserved separately
- Confirmation dialog shows exactly which fields and how many files will be affected (skippable in Settings)

### Per-Folder Right-Click Actions
- **Save all in folder** — saves all unsaved files under that path (with optional confirmation)
- **Revert all in folder** — discards unsaved changes (with confirmation)
- **Batch edit…** — opens the batch editor scoped to that folder
- **Reveal in Explorer** — opens the folder in Finder or Explorer

### Name from Filename
- If loaded files have no Capture Name set, a **"Name from File (N)"** button appears in the toolbar
- One click sets the capture name to the filename (minus `.nam`) for all unnamed files

---

## Installation

Download the latest installer from the [Releases](https://github.com/coretonecaptures/nam-editor/releases) page.

| Platform | File |
|----------|------|
| Windows  | `NAM-Editor-Setup-x.x.x.exe` |
| macOS    | `NAM-Editor-x.x.x-arm64.dmg` |

> **macOS note:** The app is ad-hoc signed but not notarized (notarization requires a paid Apple Developer account). On first launch, macOS will show an "unverified developer" warning. Go to **System Settings → Privacy & Security** and click **Open Anyway**. You only need to do this once.

> **Windows note:** Windows Defender SmartScreen may show a warning on first run. Click **More info → Run anyway**.

---

## Development

**Requirements:** Node.js 20+

```bash
git clone https://github.com/coretonecaptures/nam-editor.git
cd nam-editor
npm install
npm run dev
```

> On Windows, run dev with: `powershell -ExecutionPolicy Bypass -command "npm run dev"`

### Build installers locally

```bash
# Windows
npm run package:win

# macOS
npm run package:mac
```

Output goes to the `release/` folder.

### Publish a release

Tag a version and push — GitHub Actions builds both platforms automatically:

```bash
git tag v0.3.2
git push origin v0.3.2
```

The workflow builds a Windows `.exe` installer and a macOS `.dmg`, then attaches them to a GitHub Release.

---

## Tech Stack

- [Electron](https://www.electronjs.org/) — desktop shell
- [electron-vite](https://electron-vite.org/) — build tooling
- [React](https://react.dev/) — UI
- [Tailwind CSS](https://tailwindcss.com/) — styling
- [electron-builder](https://www.electron.build/) — packaging

---

## Requirements

- **To use this app:** Windows 10+ or macOS 10.13+
- **To use your captures:** [Neural Amp Modeler plugin](https://www.neuralampmodeler.com/) (free) — available for VST3, AU, AAX, and standalone

---

## About

There's no existing tool that lets capture artists manage `.nam` metadata locally, in bulk, before sharing their work. NAM Editor was built to fill that gap — a fast, offline desktop app that gives you full control over how your captures are tagged and presented to the people who use them.

Conceived by [Core Tone Captures](https://github.com/coretonecaptures). Code written by [Claude Code](https://claude.ai/code).
