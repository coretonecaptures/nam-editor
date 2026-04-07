# NAM Lab

### Metadata management and library tooling for Neural Amp Modeler

*Organize, clean, and scale your NAM library.*

Built with Electron, React, and Tailwind CSS. Runs on **Windows**, **macOS**, and **Linux**.

> **This app does not run captures or process audio.** It is purely a metadata editor for `.nam` files. To actually use your captures, you need the [Neural Amp Modeler plugin](https://www.neuralampmodeler.com/) (free, available for all major DAWs).

---

## What It Does

Neural Amp Modeler captures store metadata (capture name, gear info, tone type, etc.) as JSON inside the `.nam` file alongside the model weights. Most tools don't expose this metadata for editing — NAM Lab lets you open many files at once, update their metadata, and save back safely.

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
- **Collapse panels** — hover any divider and click the chevron button to collapse the Library tree or File List panel entirely, giving more room to the editor or grid
- **Refresh** button rescans the folder for new or removed files (warns about unsaved changes)
- Remembers the last opened folder and reopens it automatically on next launch
- Panel widths and window size are remembered between sessions

### Library Search & Filter
- Click the **🔍** icon in the Library header to open the collapsible search panel
- **Text search** across capture name, filename, manufacturer, model, and modeled-by
- **Tone type chips** (indigo) — click to filter by clean, crunch, hi_gain, fuzz, overdrive, distortion
- **Gear type chips** (amber) — click to filter by amp, pedal, amp_cab, preamp, studio, etc.
- Filters stack (text AND tone AND gear simultaneously)
- Folders with zero matches **disappear** from the tree; folder counts show match count in sky blue
- A sky blue **FILTERED** banner with match count appears when any filter is active
- When filtered, the amber dirty count only reflects unsaved files that are visible in the results
- Closing the panel clears all filters

### List View & Grid View
- Toggle between **List** and **Grid** views using the icons to the right of the search bar
- **List view** — compact single-row per file with name, subtitle, gear/tone chips, and missing-field badge
- **Grid view** — spreadsheet-style table with configurable columns
  - Click any column header to **sort** ascending/descending
  - **Drag column edges** to resize individual columns
  - **Column chooser** — click the columns icon (⊞) at the far right of the header to show/hide columns; choices persist across launches
  - Available columns: Capture Name (always visible) · Date · Modeled By · Manufacturer · Model · Gear Type · Tone Type · Reamp Send (dBu) · Reamp Return (dBu) · ESR · Loudness · Gain · Architecture · NAM Version · Model Channels · Checks Passed · Latency (samples) · Trained Epochs · NAM-BOT Preset · Detected Preset
  - **ESR column** is colour-coded: green < 0.01 (excellent) · amber 0.01–0.05 (acceptable) · red > 0.05; empty for captures that don't include training stats
  - **Reset to default** option in the column chooser restores the original column set
  - Panel auto-widens when switching to grid view
- Set your **default view** in Settings → Appearance — switches immediately, persists across launches
- Per-mode width memory: list and grid each remember their last-used panel width separately

### Export
- **Export button** (download icon, next to list/grid toggles) — available whenever files are loaded
- Choose **CSV** or **Excel (.xlsx)** format
- Choose **Visible columns** (respects your column chooser selection) or **All columns** (every available field)
- Export respects active search and filters — only visible rows are exported

### File List Filters
- **All / Edited / Unnamed / No Type / No Maker / No Tone** filter chips in the file list header
- **Edited** chip shows count of manually-changed files and filters to just those
- **Gear Type** and **Tone Type** dropdowns filter to a specific type — highlight in their respective colors when active
- Each file item shows a **"N missing"** badge (tooltip lists which tracked fields are empty)
- Search bar in the file list to search by name, filename, make, model, or modeled-by
- Files are sorted by Capture Name by default; click any column header in grid view to re-sort
- **Ctrl+A / Cmd+A** selects all visible files

### File Management
- Open individual `.nam` files or an entire folder (scans recursively)
- Shift+click and Ctrl+click for range and multi-selection in the file list
- Opening a new file or folder replaces the current session (with unsaved-changes warning)
- Close All button clears the session
- **Drag files between folders** — drag any file (or a multi-selection) from the list or grid view and drop it onto a folder in the tree to move it on disk; the folder highlights as you drag over it
  - Dragging a file that is part of a multi-selection moves all selected files
  - Dragging a non-selected file moves just that one file
  - Warns if any files have unsaved changes; skips files that already exist at the destination
  - Folder tree counts update and the view switches to the destination folder automatically

### Metadata Editing
- **Capture Name** — display name shown in plugins; click **↺ filename** button to reset it to the filename
- **Modeled By** — capture artist / creator
- **Gear Type** — amp, pedal, pedal_amp, amp_cab, amp_pedal_cab, preamp, studio
- **Tone Type** — clean, crunch, hi_gain, fuzz, overdrive, distortion, other
- **Manufacturer** and **Model** — gear make/model
- **Reamp Send Level (dBu)** and **Reamp Return Level (dBu)**
- **Trained Epochs** — number of training epochs; editable so capture artists can backfill this value for existing captures. Written to `metadata.training.nam_bot.trained_epochs` for compatibility with NAM-BOT
- Ctrl+S / Cmd+S to save the current file
- **Revert** button discards unsaved changes and restores the file's saved values
- **↺ Defaults** button re-applies your active Settings rules to the current file's empty fields — useful after reverting to re-fill auto-populated values without overwriting anything you've set manually
- **File path** in the header is clickable — opens the file's folder in Finder/Explorer
- **Gear type icon** displayed in the file header for visual identification (amp, pedal, cab, etc.)

### Capture Stats (Read-Only)
Shown in the detail panel for each file:
- Architecture, NAM Version, Integrated Loudness, Gain Factor
- **Validation ESR** — colour-coded green/amber (training quality indicator)
- **Model Size** — number of channels in layer 1 of the WaveNet config
- **Detected Preset** — reverse-engineered from the config fingerprint; identifies Standard, Complex, Lite, Feather, Nano, REVySTD, REVyHI, REVxSTD without needing the trainer to write it
- **Checks Passed** — whether the NAM trainer's quality checks passed; flags bypassed captures
- **Calibrated Latency** — measured latency in samples from the calibration run
- **NAM-BOT Preset** — preset name written by NAM-BOT trainer (if present)
- Captured On date

### Change Tracking & Highlighting
- Fields auto-populated by settings rules show an **indigo border** and **"auto-filled"** label
- Fields you manually edit show an **amber border** (no label)
- Auto-fill highlights clear automatically after saving
- Amber dot in the file list and folder tree counts unsaved edits

### Appearance
- **Dark theme** (default) and **Light theme** — toggle in Settings → Appearance, applies instantly
- **Default view** (List or Grid) — set your preferred starting view in Settings → Appearance
- **Label Style** — choose between Subtle (muted tinted backgrounds) or **Solid Colors** (bold solid backgrounds with white text, default) for gear and tone type pills

### Smart Defaults (Settings)
Settings are stored locally and start blank. Each section can be **enabled or disabled independently** — turn off a section to browse other people's captures without applying your defaults.

**Capture Defaults** *(toggleable)*
- Default Modeled By — applied if the file has no `modeled_by`
- Default Reamp Send Level (dBu) — applied if the file has no `input_level_dbu`
- Default Reamp Return Level (dBu) — applied if the file has no `output_level_dbu`

**Behavior**
- **Populate name from filename** — auto-sets Capture Name to the filename if empty
- **Auto-detect tone type** — scans the filename for tone keywords and sets Tone Type if empty; the rightmost keyword wins (e.g. `BE Clean Crunch DI` → Crunch). Keywords: `clean`, `crunch`, `highgain`/`hi-gain`/`higain`, `fuzz`, `overdrive`/`od`/`edge`/`drive`, `distortion`/`dist`
- **Amp Suffix** — configurable filename ending that auto-sets Gear Type to Amp (e.g. `DI` or `DIRECT`). Leave blank to disable
- **Default to Cab if no amp suffix match** — when enabled, files that don't match the amp suffix get set to `amp_cab`
- **Confirmation dialogs** — independently skip Save All and Batch Edit confirmation dialogs once you're comfortable

**Startup**
- **Remember last opened folder** — every time you open a folder it becomes the default for next launch
- **Open default folder on launch** — automatically loads a pinned folder when the app starts

**Current Amp Info** *(toggleable — at the bottom of Settings)*
- Default Manufacturer and Model — applied to files missing those fields on open
- Best used when tagging a batch of captures from a single amp session; **disable when browsing a large shared library** to avoid stamping your amp info onto other people's captures

### Active Defaults Pill
A slim bar above the status bar shows which defaults are currently active (e.g. `Amp: Friedman BE100 · Capture: Core Tone Captures · Name from filename`). Disappears entirely when nothing is enabled.

### Saving
- **Save** button (or Ctrl+S / Cmd+S) saves the current file
- **Revert** button discards unsaved changes for the current file
- **Save All** in the toolbar saves all unsaved files (always requires confirmation)
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
- Editable fields include: Modeled By, Gear Type, Manufacturer, Model, Tone Type, Reamp Send/Return, Trained Epochs

### Per-Folder Right-Click Actions
- **Save all in folder** — saves all unsaved files under that path (with optional confirmation)
- **Revert all in folder** — discards unsaved changes (with confirmation)
- **Batch edit…** — opens the batch editor scoped to that folder
- **Reveal in Explorer** — opens the folder in Finder or Explorer

### Name from Filename
- If loaded files have no Capture Name set, a **"Name from File (N)"** button appears in the toolbar
- One click sets the capture name to the filename (minus `.nam`) for all unnamed files

### NAM-BOT Integration
NAM Lab supports metadata fields written by [NAM-BOT](https://github.com/nam-bot), a community NAM trainer wrapper:
- **Trained Epochs** (`metadata.training.nam_bot.trained_epochs`) — number of training epochs; editable in NAM Lab so capture artists can backfill existing captures
- **Preset Name** (`metadata.training.nam_bot.preset_name`) — training preset used; displayed as read-only in Capture Stats

---

## Installation

Download the latest installer from the [Releases](https://github.com/coretonecaptures/nam-editor/releases) page.

| Platform | File |
|----------|------|
| Windows  | `NAM-Lab-Setup-x.x.x.exe` |
| macOS    | `NAM-Lab-x.x.x-universal.dmg` (Intel + Apple Silicon) |
| Linux    | `NAM-Lab-x.x.x.AppImage` |

---

### ⚠️ First-launch security warnings (expected — this is normal for unsigned beta software)

NAM Lab is currently in beta and is not yet code-signed. Both macOS and Windows will show a one-time security warning on first launch. This is expected and safe to bypass — the steps below walk you through it.

---

#### macOS — "Apple cannot verify this app" or "app is damaged"

macOS Gatekeeper blocks apps that aren't notarized by Apple. Here's how to open it anyway:

**Option A — from the warning dialog:**
1. When the warning appears, click **Done** (do not move it to trash)
2. Open **System Settings → Privacy & Security**
3. Scroll down — you'll see *"NAM Lab was blocked"*
4. Click **Open Anyway**
5. Enter your Mac password if prompted
6. The app will open — you won't see this warning again

**Option B — if macOS says the app is "damaged":**

This happens on newer macOS versions (Ventura/Sonoma) that quarantine downloads more aggressively.

1. Open **Terminal** (search Spotlight for "Terminal")
2. Run this command (drag the app into Terminal after `xattr -cr ` to fill in the path automatically):
   ```
   xattr -cr /Applications/NAM\ Lab.app
   ```
3. Launch the app normally — the warning will be gone

> You only need to do this once. After the first approved launch macOS remembers your choice.

---

#### Windows — "Windows protected your PC" (SmartScreen)

Windows Defender SmartScreen warns about apps that don't have a code signing certificate yet.

1. When the SmartScreen dialog appears, click **More info**
2. Click **Run anyway**
3. The app will install and launch normally — you won't see this again

> If you're uncomfortable bypassing SmartScreen, you can scan the installer with [VirusTotal](https://www.virustotal.com) before running it.

---

#### Linux — AppImage

No installation required. AppImage is a portable format that runs on most distros (Ubuntu, Fedora, Arch, Mint, etc.).

1. Download the `.AppImage` file
2. Make it executable — either right-click → Properties → Allow executing as program, or in Terminal:
   ```
   chmod +x NAM-Lab-x.x.x.AppImage
   ```
3. Double-click to run, or launch from Terminal:
   ```
   ./NAM-Lab-x.x.x.AppImage
   ```

> No signing is required on Linux — AppImage runs without any security warnings.

---

## Tech Stack

- [Electron](https://www.electronjs.org/) — desktop shell
- [electron-vite](https://electron-vite.org/) — build tooling
- [React](https://react.dev/) — UI
- [Tailwind CSS](https://tailwindcss.com/) — styling
- [electron-builder](https://www.electron.build/) — packaging
- [xlsx](https://github.com/SheetJS/sheetjs) — Excel export

---

## Requirements

- **To use this app:** Windows 10+ or macOS 10.13+
- **To use your captures:** [Neural Amp Modeler plugin](https://www.neuralampmodeler.com/) (free) — available for VST3, AU, AAX, and standalone

---

## About

There's no existing tool that lets capture artists manage `.nam` metadata locally, in bulk, before sharing their work. NAM Lab was built to fill that gap — a fast, offline desktop app that gives you full control over how your captures are tagged and presented to the people who use them.

Conceived by [Core Tone Captures](https://github.com/coretonecaptures). Code written by [Claude Code](https://claude.ai/code).
