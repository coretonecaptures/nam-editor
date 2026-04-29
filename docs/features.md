# NAM Lab — Full Feature Reference

This document covers everything NAM Lab can do. For installation, see [install.md](install.md). For architecture and contributing, see [CLAUDE.md](../CLAUDE.md).

---

## Library View (Folder Mode)

- Open a folder and get a three-panel layout: **Folder Tree | File List | Metadata Editor**
- Folder tree shows all subfolders with file counts; click any folder to filter the file list to that folder
- Each folder shows a **blue total count** and an **amber dirty count** (unsaved edits)
- All three panels are **resizable** — drag the dividers to any width
- **Collapse panels** — hover any divider and click the chevron button to collapse the Library tree or File List panel entirely
- **Refresh** button rescans the folder for new or removed files (warns about unsaved changes)
- **Recent folders** — click the dropdown arrow (▾) next to Open Folder to quickly reopen any of your last 10 folders
- Remembers the last opened folder and reopens it automatically on next launch
- Panel widths and window size are remembered between sessions
- **Expand all / Collapse all** — two chevron buttons in the Library header instantly expand or collapse the entire folder tree
- **Watch folder** — when enabled in Settings → Startup, monitors the open folder for newly added `.nam` files and shows a banner prompting you to refresh. Not supported on Linux

---

## Tone3000 Integration

- **Find New Tones** opens a built-in Tone3000 browser in the right panel
- Sign in with your Tone3000 account through OAuth; NAM Lab remembers your local session tokens until you disconnect
- **All tones** mode searches the public Tone3000 catalog with text query, gear filter, and sort order
- **My files** mode uses Tone3000’s created-tones endpoint for the currently authenticated user
- Click any result to open a detail view with description, tags, links, favorites, file variants, and batch download
- Downloaded models are copied into a folder you choose and then can be loaded into NAM Lab immediately
- Clicking a Tone3000 creator filters your local NAM Lab library by `modeled_by` without leaving the Tone3000 panel
- The **Tone3000 username** field helps narrow results by creator username, but this may be incomplete because Tone3000 does not currently expose a direct tones-by-user endpoint
- **Settings → Library → Tone3000 Username** stores an optional username that helps NAM Lab map Tone3000 creators to your local naming conventions
- Right-click any local capture in the list or grid and choose **Find Similar Captures on Tone3000** to search Tone3000 using `Manufacturer + Model`

---

## Library Overview Dashboard

Click the **≡** (dashboard) button in the toolbar (or enable **Show Library Overview on launch** in Settings → Startup) to open the Library Overview in the right panel.

- **Gear type breakdown** — count and percentage bar for each gear type; click a bar to filter the file list
- **Tone type breakdown** — same for tone type
- **Creator breakdown** — capture count per Modeled By value; click to filter
- **Completeness** — Complete vs Incomplete counts; click either to filter
- **Rating distribution** — bar chart of ★ to ★★★★★ ratings plus Unrated; click a row to filter to that exact rating
- **Recently Updated** — top 10 files by last-modified date; click to navigate to the file's folder and select it
- **Recently Added** — top 10 files by file creation date; click to navigate
- Clicking any dashboard stat clears all other active filters before applying the new one
- Selecting any capture automatically closes the dashboard and shows its editor

---

## Folder Overview Dashboard

Click a folder in the tree (no captures selected) → **Overview** tab in the right panel.

- Gear type, tone type, detected preset, ESR distribution, completeness, and rating bars — all scoped to the selected folder
- Click any bar to filter the file list to that value
- Active filter bars are highlighted; click again to clear

---

## Library Search & Filter

- **Text search** in the Library header — searches folder names
- Folders with zero matches disappear from the tree; folder counts show match count in sky blue
- A sky blue **FILTERED** banner with match count appears when any filter is active

---

## List View & Grid View

Toggle between **List** and **Grid** views using the icons to the right of the search bar.

**List view:**
- Compact single-row per file with name, subtitle, gear/tone chips, missing-field badge, and capture date
- **Sort dropdown** in the header bar: Date newest/oldest, Name A→Z/Z→A, Manufacturer A→Z, Modeled By A→Z — persists across sessions
- **Manufacturer filter** dropdown — filters by gear_make; populates from values in loaded files
- **Gear Type**, **Tone Type**, and **Detected Preset** dropdown filters
- **Name contains…** box — filters by capture name only

**Grid view:**
- Spreadsheet-style table with configurable columns
- Click any column header to **sort** ascending/descending; sort persists across sessions
- **Drag column header edges** to resize; **double-click the resize handle** to auto-size the column to fit the widest value
- **Drag column headers** (except Name) to reorder; order persists across sessions
- **Per-column filter popup** — click the funnel icon on any column header for a text-contains filter or an exact-match checkbox list of all values in that column. Multiple columns compose with AND logic. Active filters are indicated with a filled indigo funnel icon. A "Column filters active — Clear all" banner shows at the top when any column filter is set
- **Column chooser** — click the columns icon (⊞) at the far right of the header to show/hide columns; choices persist across launches; **Show all** and **Reset to default** buttons
- Available columns: Capture Name · Date · Modeled By · Manufacturer · Model · Gear Type · Tone Type · Reamp Send (dBu) · Reamp Return (dBu) · ESR · Loudness · Gain · Architecture · NAM Version · Model Channels · Checks Passed · Latency (samples) · Trained Epochs · NAM-BOT Preset · Detected Preset · Rating · plus all 9 Capture Details fields
- **ESR column** colour-coded: green < 0.01 · amber 0.01–0.05 · red > 0.05
- **Maximize grid** — click the expand icon to collapse both the folder tree and editor panels. In maximize mode, select files and click **Edit** to slide in the metadata editor panel. Close with × or by clearing the selection

**Both views:**
- **All / Edited / Incomplete / Unnamed / No Type / No Maker / No Tone / Rated** filter chips
- **Ctrl+A / Cmd+A** selects all visible files
- **↑/↓ arrow keys** navigate; **Shift+↑/↓** extends the selection
- Filtered count (sky blue "X of Y files") shown when any filter is active

---

## Export

- **Export button** (download icon, next to list/grid toggles)
- Choose **CSV** or **Excel (.xlsx)** format
- Choose **Visible columns** (respects your column chooser selection and column order) or **All columns**
- Export respects active search and filters — only visible rows are exported

---

## Metadata Editing

- **Capture Name** — display name shown in plugins; **double-click** the name in the editor header to edit inline (Enter/blur commits, Escape cancels)
- **Modeled By**, **Gear Type**, **Tone Type**, **Manufacturer**, **Model** — Manufacturer and Model include **autocomplete suggestions** from a built-in brand list plus values already in your loaded library
- **Reamp Send Level (dBu)** and **Reamp Return Level (dBu)**
- **Trained Epochs** — backfillable; written to `metadata.training.nam_bot.trained_epochs`
- **Rename** button — renames the `.nam` file on disk using a configurable template (default: `{name}`). Shows a from/to preview before committing
- **Revert** button — discards unsaved changes and restores saved values
- **↺ Defaults** button — re-applies your Settings rules to the current file's empty fields
- **File path** in the header is clickable — opens the file's folder in Finder/Explorer
- Ctrl+S / Cmd+S to save; Ctrl+Enter / Cmd+Enter to save and advance to the next file

---

## Capture Stats (Read-Only)

- Architecture, NAM Version, Integrated Loudness, Gain Factor
- **Validation ESR** — colour-coded green/amber/red
- **Model Size** — channels in layer 1 of the WaveNet config
- **Detected Preset** — fingerprinted from config: Standard, Complex, Lite, Feather, Nano, REVySTD, REVyHI, REVxSTD
- **Checks Passed** — whether the NAM trainer's quality checks passed; flags bypassed captures
- **Calibrated Latency** — measured latency in samples
- **NAM-BOT Preset** — training preset written by NAM-BOT (if present)
- Captured On date

---

## Completeness Indicator

Each file shows a colored dot:
- **No dot** — all 7 core fields filled (name, modeled_by, gear_make, gear_model, gear_type, tone_type, input_level_dbu)
- **Amber dot** — 1 field missing
- **Red dot** — 2+ fields missing

---

## Capture Rating

Rate captures 1–5 stars using the **Rating** field in the Metadata Editor (under Capture Details).

- Stored as `metadata.nam_lab.rating` (integer 1–5; 0 or absent = unrated)
- Shown as ★ stars in the list view and as a **Rating** column in grid view
- **Rated** filter chip in the toolbar shows only captures that have any rating set
- **Rating filter chip** (amber) appears when a specific rating is active; click × to clear
- Rating distribution bars in the Library Overview and Folder Overview dashboards are clickable to filter by exact rating or Unrated

---

## Change Tracking & Highlighting

- **Indigo border + "auto-filled"** — field was set by a settings rule at load time
- **Amber border** — field was manually edited by you
- Auto-fill highlights clear after saving
- **Amber dot** in the file list and folder tree counts unsaved edits

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl+S / Cmd+S | Save current file |
| Ctrl+Enter / Cmd+Enter | Save current file and advance to the next file |
| Ctrl+A / Cmd+A | Select all visible files |
| ↑ / ↓ | Navigate selection in file list |
| Shift+↑ / Shift+↓ | Extend selection |
| Escape | Close modal or lightbox |
| Double-click capture name | Edit capture name inline |

---

## Smart Defaults (Settings)

Settings are stored locally and start blank. Each section can be enabled or disabled independently.

**Capture Defaults** *(toggleable)*
- Default Modeled By, Reamp Send Level (dBu), Reamp Return Level (dBu)

**Behavior**
- **Populate name from filename** — auto-sets Capture Name to the filename if empty
- **Auto-detect tone type** — scans the filename for tone keywords; rightmost keyword wins
- **Amp Suffix** — filename ending that auto-sets Gear Type to Amp (e.g. `DI`)
- **Default to Cab if no amp suffix match**
- **File Rename Template** — tokens: `{name}` `{gear_make}` `{gear_model}` `{gear_type}` `{tone_type}` `{modeled_by}`
- **Confirmation dialogs** — independently skip Save All and Batch Edit dialogs

**Startup**
- Remember last opened folder / Open default folder on launch / Watch folder for new files
- **Show Library Overview on launch** — opens the dashboard in the right panel automatically on startup (on by default)
- **Default folder panel tab** — choose whether clicking a folder shows Overview, Pack Info, or Gallery first

**Library**
- **Tone3000 Username** — optional username used to improve local creator matching and creator-focused Tone3000 searches

**Current Amp Info** *(toggleable)*
- Default Manufacturer and Model — disable when browsing a shared library to avoid stamping your gear info on other people's captures

---

## Saving

- **Save** (Ctrl+S / Cmd+S) — saves the current file
- **Save All** in the toolbar — saves all unsaved files
- **Right-click → Save N selected** — saves selected files only
- **Right-click folder → Save all in folder**
- Batch edit writes directly to disk — no separate Save step

---

## File Management

- Open individual `.nam` files or an entire folder (recursive)
- **Drag and drop** `.nam` files or a folder from Explorer/Finder
- Shift+click and Ctrl+click for range and multi-selection
- **Drag files between folders** — drag from the list/grid onto a folder in the tree to move on disk; multi-selection moves all selected files; warns on unsaved changes

---

## Batch Rename

Right-click one or more files → **Rename N selected…**:
- **Suffix / Prefix / Find & Replace / Template** modes
- Live preview for every file with per-directory conflict detection
- Toggle **Rename files on disk** to also rename the `.nam` file itself

---

## Right-Click Context Menu (File List)

| Action | Description |
|--------|-------------|
| Show in Folder | Reveal in Explorer/Finder |
| Show in folder tree | Scroll tree to file's folder, highlight for 5s |
| Copy name(s) to clipboard | Capture names as plain text |
| Copy to folder… | Non-destructive copy to chosen destination |
| Move to folder… | Move files, remove from current view |
| Apply defaults | Re-run Settings defaults on selected files |
| Delete (trash) | Move to OS trash with confirmation |
| Rename N selected… | Open batch rename dialog |
| Copy metadata | Copy editable fields to in-memory clipboard (single file) |
| Paste metadata (from X) | Write clipboard fields to all selected files |
| Find Similar Captures on Tone3000 | Opens the Tone3000 browser and searches for `Manufacturer + Model` |
| Remove NAM Lab Custom Metadata | Strip `nam_lab` block from disk |
| Save N selected | Save selected files |
| Batch edit N selected | Open batch editor for selection |
| Launch in Neural Amp Modeler standalone… | Open in NAM standalone player |

---

## Duplicate Detection

- Toolbar **Duplicates** button — scan for dupes by filename or metadata Capture Name
- NAM Lab auto-selects the most complete copy to keep; click any copy to change
- Per-group: **Move non-kept** to `_Duplicates` subfolder or **Trash**
- Footer **Move all** / **Trash all** handle all groups at once
- `_Duplicates` folder is always hidden from the tree

---

## Multi-Select Editor

Select 2+ files to open the multi-select editor:
- Fields shared across all selected files are pre-filled and marked **shared**
- Fields that differ show *— varies —*
- **Apply to N files** writes only changed fields to disk

---

## Batch Edit

- Right-click a selection → **Batch edit N selected**
- Right-click a folder → **Batch edit…**
- Check only the fields you want to change — unchecked fields are untouched
- Confirmation dialog shows which fields and how many files are affected

---

## Per-Folder Right-Click Actions

| Action | Description |
|--------|-------------|
| Save all in folder | Save all unsaved files under this path |
| Revert all in folder | Discard unsaved changes |
| Batch edit… | Batch editor scoped to this folder |
| Reveal in Explorer | Open folder in Finder/Explorer |
| Export folder as CSV / Excel | All files in folder, all columns |
| Select all in folder | Select all files and navigate to folder |
| Rename folder | Inline rename on disk |
| New subfolder | Create subfolder with inline name input |
| Training version report… | Open pivot table for this folder |
| Generate import template… | Export editable `.xlsx` pre-filled with current metadata |
| Import metadata from spreadsheet… | Match rows by Capture Name and write non-empty cells back |

---

## Capture Details (NAM Lab Custom Metadata)

NAM Lab stores extended capture details in a `nam_lab` block inside the `.nam` file's metadata. Enable via **Settings → Library → Show NAM Lab metadata fields** (on by default).

| Field | JSON key |
|-------|----------|
| Mic(s) | `metadata.nam_lab.mics` |
| Amp Channel | `metadata.nam_lab.amp_channel` |
| Cabinet | `metadata.nam_lab.cabinet` |
| Cabinet Config | `metadata.nam_lab.cabinet_config` |
| Amp Settings | `metadata.nam_lab.amp_settings` |
| Amp Switches | `metadata.nam_lab.amp_switches` |
| Boost Pedal(s) | `metadata.nam_lab.boost_pedal` |
| Pedal Settings | `metadata.nam_lab.pedal_settings` |
| Comments | `metadata.nam_lab.comments` |

The editor shows only fields **relevant to the selected Gear Type** by default. Use the **Relevant / All** toggle to see all fields.

Right-click → **Remove NAM Lab Custom Metadata** to permanently strip the `nam_lab` block from selected files.

> **For tool developers:** If you're building a training tool, plugin, or anything that reads/writes `.nam` files, we encourage you to support the `metadata.nam_lab` block. Write only the keys you have, ignore the rest, never overwrite the block unless you intend to.

---

## Training Version Report

Right-click any folder → **Training version report…** — a pivot table showing training coverage.

- **DI Captures table** — rows = base capture names, columns = detected preset
- **Amp+Cab Captures table** — same structure; cells show the variant suffix (e.g. Mars2, Mesa) so you can see which cab was trained at each preset. Epoch count shown where available (e.g. `Mars2 (100)`)
- Header shows total base count and total capture count per table
- **Export CSV** and **Export Excel** per table

---

## Pack Info Editor

Click a folder in the tree (no captures selected) to open the **Pack Info** editor — a documentation sheet for that amp pack.

**Pack Info tab:**
- **Title / Subtitle** — displayed in the exported PDF header
- **Description** — rich formatting: `**bold**`, `*italic*`, `# Heading`, `---` divider, `- bullet`, color accents (`[orange]text[/orange]`, `[dim]text[/dim]`)
- **Equipment / Pedals / Switches & Modes / Glossary** — key/value rows
- **Captures table** — auto-populated from files; subfolder checklist and per-capture checkboxes control what's exported
- **Column chooser** — choose and reorder columns in the exported captures table
- **Export PDF…** — generates styled HTML, opens in browser for printing/saving; Dark/Light mode toggle

**Gear Catalog (Settings → Pack Info):**
- Personal catalog of Equipment, Pedals, and Glossary entries reused across packs
- **Add from catalog…** inserts entries as rows — no retyping

**Logo (Settings → Pack Info):**
- Separate logos for light and dark mode exports; appears top-right in the PDF header

---

## Folder Image Gallery

Click a folder (no captures selected) — images stored in that folder (and parent folders up to the library root) are shown in the right panel.

- Supports jpg, jpeg, png, webp, gif
- Parent folder images shown below a *"From [folder name]"* divider
- Adaptive grid: 1 → full width; 2 → side by side; 3 → 2+1; 4 → 2×2; 5+ → 3-column
- **Click any thumbnail** to open a lightbox; **Open in viewer** button opens in OS default image app
- Images are read-only — manage them in Finder/Explorer
- Toggle in **Settings → Library → Show folder images** (on by default)

---

## NAM-BOT Integration

Supports metadata written by [NAM-BOT](https://github.com/nam-bot):
- **Trained Epochs** (`metadata.training.nam_bot.trained_epochs`) — editable and backfillable
- **Preset Name** (`metadata.training.nam_bot.preset_name`) — read-only display in Capture Stats

---

## Check for Updates

- **Settings → Check for Updates** — checks GitHub for a newer release
- **Download** link opens the releases page in your browser (manual install)
- **Include RC builds** toggle — counts pre-release builds as "newer"
- Current version always shown next to the button

---

## Tech Stack

- [Electron](https://www.electronjs.org/) — desktop shell
- [electron-vite](https://electron-vite.org/) — build tooling
- [React](https://react.dev/) — UI
- [Tailwind CSS](https://tailwindcss.com/) — styling
- [electron-builder](https://www.electron.build/) — packaging
- [xlsx](https://github.com/SheetJS/sheetjs) — Excel export
