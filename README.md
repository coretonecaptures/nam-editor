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
- **Recent folders** — click the dropdown arrow (▾) next to Open Folder to quickly reopen any of your last 10 folders
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
  - **Column chooser** — click the columns icon (⊞) at the far right of the header to show/hide columns; choices persist across launches; **Show all** and **Reset to default** buttons at the bottom of the chooser
  - Available columns: Capture Name (always visible) · Date · Modeled By · Manufacturer · Model · Gear Type · Tone Type · Reamp Send (dBu) · Reamp Return (dBu) · ESR · Loudness · Gain · Architecture · NAM Version · Model Channels · Checks Passed · Latency (samples) · Trained Epochs · NAM-BOT Preset · Detected Preset · plus all 9 Capture Details fields (Mic(s), Amp Channel, Cabinet, etc.)
  - **ESR column** is colour-coded: green < 0.01 (excellent) · amber 0.01–0.05 (acceptable) · red > 0.05; empty for captures that don't include training stats
  - Panel auto-widens when switching to grid view
- **Maximize grid** — click the expand icon (next to the list/grid toggle) to collapse both the folder tree and editor panels, giving the grid the full window width. Click again to restore
  - In maximize mode, select one or more files and click the **Edit** button (next to the All/None selector) to slide in the metadata editor from the right — single-file editor, multi-select editor, and batch editor all work in the slide panel
  - Close the slide panel with the × button or by clearing your selection
- Set your **default view** in Settings → Appearance — switches immediately, persists across launches
- Per-mode width memory: list and grid each remember their last-used panel width separately

### Export
- **Export button** (download icon, next to list/grid toggles) — available whenever files are loaded
- Choose **CSV** or **Excel (.xlsx)** format
- Choose **Visible columns** (respects your column chooser selection) or **All columns** (every available field)
- Export respects active search and filters — only visible rows are exported

### File List Filters
- **All / Edited / Incomplete / Unnamed / No Type / No Maker / No Tone** filter chips in the file list header
- **Edited** chip shows count of manually-changed files and filters to just those
- **Incomplete** chip shows count of files missing any of the 7 core shareable fields (name, modeled_by, gear_make, gear_model, gear_type, tone_type, input_level_dbu) and filters to just those
- **Gear Type**, **Tone Type**, and **Detected Preset** dropdowns filter to a specific type — highlight in their respective colors when active. The Preset dropdown includes a **None detected** option to find files with unrecognized configs
- **Search bar** — searches capture name, filename, manufacturer, model, and modeled-by (hover the icon for details). **Name contains…** box filters by capture name only — handy when you need exact name matches without broader results
- Files are sorted by Capture Name by default; click any column header in grid view to re-sort
- **Ctrl+A / Cmd+A** selects all visible files
- **↑/↓ arrow keys** navigate the selection when the file list has focus; **Shift+↑/↓** extends the selection

### File Management
- Open individual `.nam` files or an entire folder (scans recursively)
- **Drag and drop** `.nam` files or a folder from Explorer/Finder directly into the app window to open them
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
- **Manufacturer** and **Model** — gear make/model; both fields offer **autocomplete suggestions** from a built-in list of common brands plus any values already in your loaded library
- **Reamp Send Level (dBu)** and **Reamp Return Level (dBu)**
- **Trained Epochs** — number of training epochs; editable so capture artists can backfill this value for existing captures. Written to `metadata.training.nam_bot.trained_epochs` for compatibility with NAM-BOT
- Ctrl+S / Cmd+S to save the current file
- **Rename** button — renames the `.nam` file on disk using a configurable template (default: `{name}`, which renames the file to match the Capture Name). Shows a from/to preview before committing. Template is configurable in Settings → Behavior
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

### Completeness Indicator
Each file in the list and grid shows a small colored dot indicating metadata completeness across 7 core shareable fields:
- **No dot** — all 7 fields filled (name, modeled_by, gear_make, gear_model, gear_type, tone_type, input_level_dbu)
- **Amber dot** — 1 field missing
- **Red dot** — 2+ fields missing

The dot appears below the unsaved-changes dot (amber) so both can be visible at once.

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
- **File Rename Template** — template used by the Rename button in the metadata editor. Default: `{name}`. Tokens: `{name}` `{gear_make}` `{gear_model}` `{gear_type}` `{tone_type}` `{modeled_by}`
- **Confirmation dialogs** — independently skip Save All and Batch Edit confirmation dialogs once you're comfortable

**Startup**
- **Remember last opened folder** — every time you open a folder it becomes the default for next launch
- **Open default folder on launch** — automatically loads a pinned folder when the app starts
- **Watch folder for new files** — when enabled, monitors the open folder for newly added `.nam` files and shows a banner prompting you to refresh. Not supported on Linux

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

### Right-Click Context Menu (File List)
Right-click any file or selection for quick actions:
- **Show in Folder** — reveals the file in Explorer/Finder
- **Show in folder tree** *(single file only)* — scrolls the folder tree to the file's folder and highlights it in blue for 5 seconds
- **Copy name(s) to clipboard** — copies the capture name(s) as plain text
- **Copy to folder…** — copies selected files to a chosen destination (non-destructive)
- **Move to folder…** — moves selected files to a chosen destination, removing them from the current view
- **Apply defaults** — re-runs your Settings defaults on the selected files
- **Delete (trash)** — moves selected files to the OS trash with confirmation
- **Rename N selected…** — opens the batch rename dialog for multi-file renaming
- **Copy metadata** *(single file only)* — copies the file's editable metadata fields to a clipboard buffer
- **Paste metadata (from X)** — pastes the copied fields to all selected files with confirmation; overwrites matching fields but never overwrites the Capture Name
- **Remove NAM Lab Custom Metadata** — permanently removes the `nam_lab` block from selected files on disk, clearing all Capture Details fields
- **Save N selected** — saves only the selected files
- **Batch edit N selected** — opens the batch editor for the selection
- **Launch in Neural Amp Modeler standalone…** *(single file)* — opens the capture in the NAM standalone player. Available automatically if NAM is registered as the default handler for `.nam` files on your system, or configure a custom path in **Settings → NAM Standalone**

### Duplicate Detection
- Click **Duplicates** in the toolbar to scan your loaded library for duplicate captures
- Detect by **filename** or by **metadata Capture Name**
- NAM Lab auto-selects the most complete copy to keep (based on how many fields are filled); you can click any other copy to change the keep choice
- Per-group actions: **Move non-kept copies** to a `_Duplicates` subfolder, or **Trash** them
- **Move all** and **Trash all** buttons in the footer handle all pending groups at once
- The `_Duplicates` folder is always hidden from the library tree

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
- Editable fields include: Modeled By, Gear Type, Manufacturer, Model, Tone Type, Reamp Send/Return, Trained Epochs, plus all Capture Details fields
- Manufacturer and Model fields include **autocomplete suggestions** (same seed list as the single-file editor)

### Per-Folder Right-Click Actions
- **Save all in folder** — saves all unsaved files under that path (with optional confirmation)
- **Revert all in folder** — discards unsaved changes (with confirmation)
- **Batch edit…** — opens the batch editor scoped to that folder
- **Reveal in Explorer** — opens the folder in Finder or Explorer
- **Export folder as CSV / Excel** — exports all files under that folder with all available columns
- **Generate import template…** — exports an editable `.xlsx` pre-filled with the folder's current metadata (editable fields only). Edit it in Excel, then import it back
- **Import metadata from spreadsheet…** — picks an `.xlsx` or `.csv`, matches rows to captures by Capture Name, and writes non-empty cells back to disk. Empty cells are skipped — only what you fill in is written. Requires a confirmation checkbox before anything is written
  - **Gear Type is never overwritten** — if a capture already has a Gear Type set, the import leaves it alone (Gear Type varies per variant and is easy to get wrong in a spreadsheet)
  - Supports **prefix match mode**: if your spreadsheet has entries for DI captures but you want to apply their settings to amp_cab variants with the same name prefix, enable prefix matching in the import dialog — Gear Type, Tone Type, Cabinet, Cab Config, and Mic(s) are automatically skipped for prefix matches since those fields vary per variant

### Name from Filename
- If loaded files have no Capture Name set, a **"Name from File (N)"** button appears in the toolbar
- One click sets the capture name to the filename (minus `.nam`) for all unnamed files

### Capture Details (NAM Lab Custom Metadata)
NAM Lab can store extended capture details in a `nam_lab` block inside the `.nam` file's metadata. These fields are entirely optional and don't affect playback — they're for documentation purposes.

Enable via **Settings → Library → Show NAM Lab metadata fields** (on by default).

| Field | What it's for | JSON field |
|---|---|---|
| Mic(s) | Microphone(s) used on the cabinet | `metadata.nam_lab.mics` |
| Amp Channel | Channel used (e.g. Lead, Clean, High Gain) | `metadata.nam_lab.amp_channel` |
| Cabinet | Cabinet name/model | `metadata.nam_lab.cabinet` |
| Cabinet Config | Speaker config (e.g. 4x12 Closed) | `metadata.nam_lab.cabinet_config` |
| Amp Settings | Notable knob positions | `metadata.nam_lab.amp_settings` |
| Amp Switches | Bright, Deep, Pentode/Triode, etc. | `metadata.nam_lab.amp_switches` |
| Boost Pedal(s) | Pedal(s) placed in front of the amp | `metadata.nam_lab.boost_pedal` |
| Pedal Settings | Boost pedal knob positions | `metadata.nam_lab.pedal_settings` |
| Comments | Anything else worth noting | `metadata.nam_lab.comments` |

All values are strings. All fields are optional — omit any you don't need.

**Example JSON block:**
```json
"metadata": {
  "name": "Friedman BE100 Lead",
  "gear_make": "Friedman",
  "gear_model": "BE100",
  "gear_type": "amp_cab",
  "tone_type": "hi_gain",
  "nam_lab": {
    "amp_channel": "BE Channel",
    "amp_settings": "Gain 7, Bass 6, Mid 4, Treble 7, Presence 6",
    "amp_switches": "Tight on, Crunch off",
    "boost_pedal": "Klon Centaur",
    "pedal_settings": "Gain 0, Treble max, Output unity",
    "cabinet": "Friedman 412 Vintage",
    "cabinet_config": "4x12 Closed Back",
    "mics": "SM57 + Royer R121",
    "comments": "No attenuator, room mic blended at -12dB"
  }
}
```

> **Note for developers:** If you're building a training tool, hardware device, plugin, or anything else that reads or writes `.nam` files, we encourage you to support the `metadata.nam_lab` block. It's a free-form string dictionary — write only the keys you have, ignore the rest, and never overwrite the block unless you intend to. This keeps capture metadata interoperable across tools.

The **Capture Details** section in the editor shows only the fields **relevant to the selected Gear Type** by default. Use the **Relevant / All** toggle to see all fields. Available in the single-file editor, multi-select editor, and batch editor. Also available as optional columns in grid view and export.

Right-click → **Remove NAM Lab Custom Metadata** to permanently strip the `nam_lab` block from files on disk if needed.

### Folder Image Gallery
When you click a folder in the tree with no captures selected, the right panel shows any images stored in that folder (and its parent folders up to the library root).

- Supports **jpg, jpeg, png, webp, gif**
- Images from parent folders are shown below a *"From [folder name]"* divider — useful for storing an amp photo at the parent level and having it appear in every subfolder (DI, Full Rig, various cab variants, etc.)
- **Adaptive grid layout**: 1 image fills the full width; 2 images sit side by side; 3 images form a 2+1 layout; 4 images form a 2×2 grid; 5+ images use a 3-column grid
- **Click any thumbnail** to open a centered lightbox with the full image. Click the backdrop or press **Escape** to close. An **Open in viewer** button inside the lightbox opens the file in your OS default image app
- Images are read-only — manage them in Finder/Explorer; NAM Lab just displays what's there
- Toggle in **Settings → Library → Show folder images** (on by default)

**Recommended image specs:** JPEG at 80% quality, longest edge ~1600px — looks sharp at any panel size and stays under 400KB.

### NAM-BOT Integration
NAM Lab supports metadata fields written by [NAM-BOT](https://github.com/nam-bot), a community NAM trainer wrapper:
- **Trained Epochs** (`metadata.training.nam_bot.trained_epochs`) — number of training epochs; editable in NAM Lab so capture artists can backfill existing captures
- **Preset Name** (`metadata.training.nam_bot.preset_name`) — training preset used; displayed as read-only in Capture Stats

### Check for Updates
- **Settings → Check for Updates** button (bottom of the Settings panel) — checks GitHub for a newer release and shows the result inline
- If an update is available, a **Download** link opens the releases page in your browser; installation is manual (the app is not yet code-signed for auto-update)
- **Include RC builds** checkbox (default off) — when enabled, pre-release and release candidate builds also count as "newer"
- Current version is always shown next to the button so you know what you're running without clicking

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

Conceived by **[Core Tone Captures](https://www.coretonecaptures.com)** — a NAM capture maker focused on quality tones. Questions, feedback, or collaboration: [info@coretonecaptures.com](mailto:info@coretonecaptures.com).

Code written by [Claude Code](https://claude.ai/code).
