# CLAUDE.md — NAM Lab

## Project Overview

NAM Lab is a desktop metadata editor for `.nam` files (Neural Amp Modeler captures). It lets capture artists view, edit, and bulk-manage the JSON metadata embedded in `.nam` files without touching the model weights.

Built with **Electron + React + TypeScript + Tailwind CSS**, using `electron-vite` for build tooling and `electron-builder` for packaging.

Runs on Windows, macOS, and Linux.

---

## Architecture

### Process Structure (Electron)

```
src/main/index.ts          — Main process: file I/O, IPC handlers, window management
src/preload/index.ts       — Preload script: exposes typed `window.api` to renderer
src/renderer/src/          — Renderer process: all React UI
```

The renderer never touches the filesystem directly — everything goes through `window.api` IPC calls defined in the preload.

### Key IPC Channels

| Channel | Direction | Purpose |
|---|---|---|
| `dialog:openFiles` | main | Open file picker |
| `dialog:openFolder` | main | Open folder picker |
| `file:read` | main | Read and parse a .nam file |
| `file:writeMetadata` | main | Surgically patch metadata in a .nam file |
| `folder:scanNam` | main | Recursively scan folder for .nam files |
| `folder:scanTree` | main | Build folder tree structure |
| `file:move` | main | Move a .nam file to a different folder |
| `path:stat` | main | Check if a path is a directory |
| `shell:revealFile` | main | Open file location in Explorer/Finder |
| `file:trash` | main | Move files to OS trash via `shell.trashItem()` |
| `file:copy` | main | Copy files to destination directory |
| `file:clearNamLab` | main | Surgically remove `metadata.nam_lab` block from files |
| `file:readBinary` | main | Read any file as base64 (used for xlsx import) |
| `dialog:openImportFile` | main | Open file picker for .xlsx/.csv import |
| `window:refocus` | main | Restore keyboard focus after native dialogs |
| `log:getErrorLogPath` | main | Path to parse error log |
| `log:getStartupLogPath` | main | Path to startup log |

### File Write Strategy — CRITICAL

**Never use `JSON.parse` → `JSON.stringify` to write back .nam files.** This destroys formatting and is unacceptable.

All writes use `patchMetadataFields()` in `src/main/index.ts` — a surgical text patcher that finds each changed key in the raw file text using regex and replaces only the value bytes. All original formatting, whitespace, field order, and non-metadata data (weights, config, etc.) are preserved exactly.

For nested fields like `metadata.training.nam_bot.trained_epochs`, use `patchNamBotField()` which navigates into the nested block and creates the structure if it doesn't exist.

For `nl_` fields, use `patchNamLabField()` which writes into `metadata.nam_lab.*`, creating the block if needed.

To remove the entire `nam_lab` block, use `removeNamLabBlock()` which surgically strips `"nam_lab": {...}` including comma handling.

Only fields in `EDITABLE_FIELDS` (plus `nb_trained_epochs`) are ever written — the patcher is a whitelist, not a catch-all.

### Watcher Suppression
`suppressWatcher()` sets `watcherSuppressUntil = Date.now() + 3000`. Any `folder:changed` event fired within 3s of a local write is silently dropped — prevents false-positive "new files detected" banners after saves.

---

## Renderer Structure

### `src/renderer/src/App.tsx`
The root component. Owns all application state:
- `files: NamFile[]` — all loaded files
- `selectedIds: Set<string>` — currently selected file paths
- `librarian: LibrarianState` — folder tree, selected folder, root folder
- `settings: AppSettings` — loaded from localStorage
- `listViewMode`, `treeWidth`, `listWidth` — layout state

Key functions:
- `loadFiles()` — reads files via IPC, applies defaults from settings, tracks `autoFilledFields`
- `loadFolderByPath()` — scans a folder, builds tree, loads all files
- `applyDefaults()` — applies settings rules to metadata at load time
- `handleDrop()` — native document-level drag/drop handler (registered via `useEffect`, not React props)

Layout uses three resizable panels: **FolderTree | FileList | MetadataEditor/BatchEditor/MultiSelectEditor**. Both the tree and file list panels have collapse buttons on their drag handles.

### Components

| Component | Purpose |
|---|---|
| `Toolbar` | Top bar: Open, Save All, Close All, Refresh, Name from File, Settings toggle |
| `FolderTree` | Left panel: folder hierarchy, dirty counts, search/filter, right-click actions |
| `FileList` | Middle panel: list or grid view, filters, column chooser, export |
| `MetadataEditor` | Right panel: single-file editor with all editable + read-only fields |
| `MultiSelectEditor` | Right panel: editor for 2+ selected files, shows shared/varies state |
| `BatchEditor` | Right panel: batch field editor for a folder or selection |
| `SettingsPanel` | Right panel: app settings (replaces editor content when open) |
| `DuplicatesModal` | Full-screen modal: find dupes by filename or metadata name, choose keep, move to _Duplicates or trash |
| `StatusBar` | Bottom bar: status messages, version number |

### Types

| File | Contents |
|---|---|
| `types/nam.ts` | `NamFile`, `NamMetadata`, `GEAR_TYPES`, `TONE_TYPES` |
| `types/settings.ts` | `AppSettings`, `loadSettings()`, `saveSettings()` |
| `types/layout.ts` | `loadLayout()`, `saveLayout()` — panel widths, persisted to localStorage |
| `types/librarian.ts` | `LibrarianState`, `FolderNode` |

### Utils

- `utils/detectPreset.ts` — reverse-engineers the NAM preset name (Standard, Complex, Lite, Feather, Nano, REVySTD, REVyHI, REVxSTD) from `config.layers` fingerprint

---

## NamFile Shape

```typescript
interface NamFile {
  filePath: string          // absolute path
  fileName: string          // basename without .nam
  version: string           // e.g. "0.5.4"
  metadata: NamMetadata     // working copy (may differ from disk)
  originalMetadata: NamMetadata  // raw values from file, never mutated
  autoFilledFields: (keyof NamMetadata)[]  // fields set by settings rules at load
  architecture: string      // e.g. "WaveNet"
  config: unknown           // full config block (layers, head_scale, etc.)
  isDirty: boolean
}
```

`nb_trained_epochs` and `nb_preset_name` are lifted from `metadata.training.nam_bot.*` to flat fields on `NamMetadata` at read time in the main process. The renderer always reads them as flat fields.

---

## Metadata Fields

### Editable (written to disk)
`name`, `modeled_by`, `gear_type`, `gear_make`, `gear_model`, `tone_type`, `input_level_dbu`, `output_level_dbu`, `nb_trained_epochs`

### NAM Lab Extended Fields (nl_ prefix, written to `metadata.nam_lab.*`)
`nl_mics`, `nl_cabinet`, `nl_cabinet_config`, `nl_amp_channel`, `nl_boost_pedal`, `nl_amp_settings`, `nl_pedal_settings`, `nl_amp_switches`, `nl_comments`

These are lifted from `metadata.nam_lab.*` to flat `nl_${k}` keys at read time (same pattern as `nb_` NAM-BOT fields). Written back with `patchNamLabField()`. Toggle via `showNamLabFields` in Settings → Library. Available as optional grid/export columns.

### Read-Only (displayed, never written by NAM Lab)
`date`, `loudness`, `gain`, `training.validation_esr`, `training.data.checks.passed`, `training.data.latency.calibration.recommended`, `training.nam_bot.preset_name`

### Computed / Derived
- **Detected Preset** — from `config` fingerprint via `detectPreset()`
- **Model Size** — `config.layers[0].channels`

---

## Change Tracking & Highlighting

- **Indigo border** + "auto-filled" label — field was set by a settings rule at load time (`autoFilledFields`)
- **Amber border** — field was manually changed by the user (differs from `originalMetadata`, not auto-filled)
- Auto-fill highlights clear after saving
- `isDirty` = any field in `metadata` differs from `originalMetadata`

---

## Settings & Defaults

Settings are stored in `localStorage` via `loadSettings()`/`saveSettings()`. Key toggleable sections:
- **Capture Defaults** (`enableCaptureDefaults`) — default modeled_by, input/output levels
- **Current Amp Info** (`enableAmpInfo`) — default manufacturer/model; disable when browsing shared libraries
- **Behavior** — name from filename, auto-detect tone type, amp suffix detection
- **Library** — `showNamLabFields` (show Capture Details section in MetadataEditor, default on), `hiddenFolders` (comma-separated folder names to exclude from scans)

`applyDefaults()` in App.tsx runs on every file at load time and on "↺ Defaults" button press. It only fills empty fields — never overwrites existing values.

---

## Grid & Export

Grid columns are defined in `ALL_GRID_COLUMNS` in `FileList.tsx`. Each has a `defaultVisible` flag. Visibility is persisted to `localStorage` under key `nam-lab-grid-columns`.

The column chooser button lives in the toolbar row (next to list/grid toggle and export) — **not** inside the scrollable table header.

Export (CSV or Excel) uses the `xlsx` library. Exports the current filtered/sorted rows. "All columns" ignores visibility settings; "Visible columns" respects them.

---

## Build & Release

```bash
npm run dev              # dev server with hot reload
npm run build            # production build
npm run package:win      # Windows NSIS installer
npm run package:mac      # macOS DMG (universal)
npm run package:linux    # Linux AppImage
```

CI runs on tag push via `.github/workflows/release.yml`. Tags matching `*-rc*` are automatically marked as GitHub pre-releases. Final releases use clean semver tags (`v0.4.2`).

Current version: **0.5.8** (see `package.json`). Version is injected into the renderer via `VITE_APP_VERSION` in `electron.vite.config.ts`.

App IDs:
- `appId`: `com.coretonecaptures.namlab`
- Windows AUMID: set via `app.setAppUserModelId()`
- macOS name: set via `app.setName('NAM Lab')` (overrides package.json `name`)

---

## Established Conventions

- **Ask before pushing a version tag** — tags trigger CI builds on all three platforms
- **Surgical JSON patching only** — never JSON.stringify the whole file
- `app.getPath('userData')` must never be called at module load time (crashes before app ready) — use lazy functions
- Startup logging writes to `os.tmpdir()` first, moves to `userData` after app ready
- All IPC channels are typed through `window.api` declared in `App.tsx`
- `nb_` prefix on metadata fields = NAM-BOT custom fields lifted to flat metadata
- Drag handles between panels use the `DragHandle` component; both tree and list panels are collapsible

---

## Known Issues / Pending

### Other Pending Items

- **App icon** — user has design concepts (lab beaker theme). Needs `.ico` (Windows) and `.icns` (macOS) files generated from artwork. Currently uses Electron default musical note icon.
- **Code signing** — app is unsigned. Users bypass SmartScreen (Windows) or Gatekeeper (macOS) on first launch. Options discussed: Apple Developer account ($99/yr) for notarization, EV certificate for Windows SmartScreen reputation.
- **Maximize grid view** — button to collapse both left (folder tree) and right (editor) panels so grid fills full width, with horizontal scroll if still too wide. Toggle to restore panels.
- **Column drag-to-reorder** in grid view — mentioned as a future improvement, not yet implemented.
- **Detected Preset label refinement** — current fingerprint covers Standard/Complex/Lite/Feather/Nano/REVySTD/REVyHI/REVxSTD. Awaiting confirmation from NAM developer or forum on complete channel→preset mapping before adding friendly labels back to Model Channels column.
- **NAM-BOT `trained_epochs`** — field is supported for reading and backfilling. NAM-BOT trainer will write it natively in future; field naming confirmed as `metadata.training.nam_bot.trained_epochs`.
- **Per-column filtering in grid view** — discussed and deferred; current gear/tone dropdowns cover the main use case.

---

## NAM-BOT Integration

NAM-BOT (community trainer wrapper) writes to `metadata.training.nam_bot`:
- `trained_epochs` — number of training epochs (editable in NAM Lab, backfillable)
- `preset_name` — training preset used (read-only display)

NAM Lab is coordinating with the NAM-BOT developer on field naming standards.

---

## Planned Features (Backlog)

These have been discussed and approved — remove each item when implemented.

### High Priority

- **[x] Rename file from metadata template** — Single-file rename button in MetadataEditor header. Template configurable in Settings (default: `{name}`). Confirm dialog shows from/to preview. IPC `file:rename` handler on main process.
- **[x] Batch rename from template** — Multi-file rename via BatchRenameModal. Modes: suffix, prefix, find & replace, template. Live preview with per-directory conflict detection. Accessible from right-click context menu in FileList.

- **[x] Completeness indicator** — Colored dot per file (amber = 1 missing, red = 2+ missing, no dot = complete). 7 core fields: `name`, `modeled_by`, `gear_make`, `gear_model`, `gear_type`, `tone_type`, `input_level_dbu`. Shown in list and grid. Only shown when file is not dirty (dirty = amber dot takes priority). "Incomplete (N)" filter chip added.

- **[x] Gear make/model autocomplete** — Custom `ComboInput` component (`src/renderer/src/components/ComboInput.tsx`) replaces native `<datalist>`. Scrollable dropdown, max 200px, keyboard navigable. Seed list of 32 brands + values from loaded files. Available in MetadataEditor, BatchEditor, and MultiSelectEditor.

- **[x] Missing field quick filter** — "Incomplete (N)" chip in FileList toolbar filters to files missing any of the 7 core fields.

### Medium Priority

- **[x] Recent folders** — Dropdown arrow (▾) next to Open Folder shows last 10 paths (persisted to localStorage). Implemented in Toolbar.

- **[x] Arrow key navigation in file list** — ↑/↓ arrows move selection; Shift+↑/↓ extends selection. Works in both list and grid view.

- **[x] Intra-app folder drag-to-organize** — Drag folder to another folder in tree to move it on disk. Right-click → Rename folder (inline edit). Right-click → New subfolder (inline input). Uses `application/x-nam-folder` data transfer, prevents drop into self/children.

- **[x] Watch folder / auto-refresh** — Toggle in Settings → Startup. Monitors open folder via `fs.watch`, debounced 1500ms. Shows amber banner when new files detected. Banner clears on refresh. Watcher stops during reload to prevent re-fire. Not supported on Linux.

- **[x] OS drag & drop** — Fixed in v0.4.4. Root cause: Electron 32+ removed `File.path`; switched to `webUtils.getPathForFile()`. Also reverted to React synthetic `onDrop` on root div (native document listeners don't receive OS file drops in Electron 41+). Supports dragging `.nam` files or folders from Explorer/Finder.

- **[x] File associations** — `.nam` files registered via `fileAssociations` in electron-builder config. macOS: `app.on('open-file')`. Windows: argv parsing. Paths queued before window ready are sent via `app:openFiles` IPC once renderer loads.

- **[x] Hidden folders** — Comma-separated folder names excluded at scan time in main process (default: `lightning_logs,version_0,checkpoints`). Settings → Library.

- **[x] Show in Folder** — Right-click file in list/grid → Reveal in Explorer/Finder.

- **[x] Delete to trash** — Right-click → Delete uses `shell.trashItem()` with confirmation; file removed from state.

- **[x] Copy to folder** — Right-click → Copy files to folder (folder picker, non-destructive).

- **[x] Apply defaults to selection** — Right-click → Apply defaults re-runs settings rules on selected files mid-session.

- **[x] Folder-level export** — Right-click folder in tree → Export as CSV or Excel (all columns, folder's files only).

- **[x] Extended NAM Lab metadata** — 9 nl_ fields stored at `metadata.nam_lab.*`, lifted to flat `nl_` keys. Toggle via Settings → Library → Show NAM Lab metadata fields. In grid and export.

- **[x] Duplicate detection** — Toolbar "Duplicates" button opens DuplicatesModal. Modes: by filename, by metadata name. Select which copy to keep. Move non-kept to `_Duplicates` folder or trash. Per-group actions. `_Duplicates` folder always hidden from tree.

- **[x] Copy/Paste metadata** — Right-click single file → "Copy metadata" stores editable fields (excluding name) in memory. Right-click one or more files → "Paste metadata (from X)" with confirm dialog overwrites those fields.

- **[x] Remove NAM Lab Custom Metadata** — Right-click → surgically removes `metadata.nam_lab` block from disk; clears nl_ fields from in-memory state without marking dirty. Uses `removeNamLabBlock()` in main process.

- **[x] Save confirmation setting** — All save dialogs (single, Save All, folder) include "(This warning can be toggled off in Settings → Behavior)". Skip Save All confirmation setting suppresses all save dialogs.

- **[x] Watch folder false-positive fix** — `suppressWatcher()` called after every local write; suppresses `folder:changed` events for 3s so saves don't trigger the "new files detected" banner.

- **[x] Name-only search filter** — "Name contains…" pill input to the right of Tone Type dropdown. Filters only on capture name (falls back to filename). Main search box has tooltip listing all fields it searches.

- **[x] Dynamic Capture Details in MetadataEditor** — Relevant/All segmented toggle when gear_type is set. Shows only fields relevant to the gear type; irrelevant fields dimmed at 40% in "All" mode. `NL_RELEVANT` map defines relevant fields per gear_type.

- **[x] Bulk metadata import from spreadsheet** — Right-click folder → "Generate import template…" exports editable fields only as `.xlsx` (pre-filled with current values). Right-click folder → "Import metadata from spreadsheet…" opens file picker, matches rows by Capture Name, shows warning modal with match count + unmatched list, requires checkbox confirmation, writes non-empty cells only. Columns: Capture Name, Modeled By, Manufacturer, Model, Gear Type, Tone Type, Amp Channel, Amp Settings, Amp Switches, Boost Pedal, Pedal Settings, Cabinet, Cab Config, Reamp Send (dBu), Reamp Return (dBu), Trained Epochs, NAM-BOT Preset (read-only), Mic(s), Comments.

- **[x] Move to folder** — Right-click → Move N files to folder… (folder picker, removes files from list on success). Sits alongside Copy to folder in the context menu.

- **[x] Jump to file's folder** — Right-click single file → "Show in folder tree" scrolls to and highlights the file's folder in the tree for 5 seconds.

- **[ ] Check for Updates** — Settings panel button that hits the GitHub releases API (`repos/coretonecaptures/nam-editor/releases`), compares the running version to the latest release, and shows a banner with a "Download" link that opens the releases page in the browser. No auto-install (app is unsigned). Two new settings (both default off): `checkForRCBuilds` — includes pre-releases in the comparison; `checkOnStartup` — runs a silent background check at launch and shows a status bar notification if an update is found. Version comparison must handle RC semver strings (`0.5.5-rc1 < 0.5.5`). IPC channel: `app:checkForUpdates` → returns `{ hasUpdate: boolean, latestVersion: string, releaseUrl: string }`.

- **[ ] Selective metadata copy** — *(High priority)* When right-clicking to "Copy metadata", show a checkbox list of fields (similar to the grid column chooser) so the user can choose which fields to include in the copy. The in-memory clipboard stores only the checked fields; paste then only writes those fields to target files. Default: all fields checked. Persist last-used selection across copies.

- **[ ] Multi-window settings isolation** — When a second window opens it doesn't see the current saved settings. No live sync needed (last-saved-wins is fine, each window owns its own state). The fix is just ensuring the second window reads the correct saved settings at load time. Root cause TBD — likely separate session partitions between windows (each `BrowserWindow` may get its own localStorage partition), or the window is created before the first window has flushed its latest settings to localStorage. Investigate whether both windows share the same Electron session/partition; if not, either consolidate to a single partition or move settings storage to a main-process JSON file read via IPC at startup.

- **[ ] In-app NAM preview player** — Real-time guitar → NAM inference inside NAM Lab using [`neural-amp-modeler-wasm`](https://github.com/tone-3000/neural-amp-modeler-wasm) (MIT, by Tone3000). Architecture: WASM-compiled NeuralAmpModelerCore + AudioWorklet + Web Audio API. All runs in the Electron renderer — no external app needed. Audio setup: uses OS default input/output; no config UI required for basic use. Optional device picker via `enumerateDevices()` for users with non-default interface routing. Implementation notes: install `neural-amp-modeler-wasm` npm package; load .nam file bytes into WASM module; stream guitar input through AudioWorklet; output to speakers. One-time browser-style audio permission prompt. The standalone "Launch NAM standalone" menu item stays as-is (NAM Plugin does not accept file path args via CLI — user loads manually). This feature replaces the need for that workaround. Tone3000 reference: no audio config wizard needed; just request `getUserMedia({ audio: true })` on the default input and it works.

- **[ ] Folder-level image gallery** — *(Medium LOE)* Store and browse rig/amp photos at the folder level. Storage: images sit in the actual folder on disk (`.jpg`, `.png`, `.webp`) — no sidecar needed, the folder IS the container. **Inheritance model**: parent folder images cascade down to all children — a child folder's gallery shows its own images PLUS all ancestor images. Example: Marshall amp folder has `amp.jpg`; Full Rig subfolder has `cabinet.jpg`; viewing Full Rig shows both. DI subfolder shows `amp.jpg` only (no cabinet shot). **UI placement**: when a folder is clicked in the tree and no captures are selected, the right panel is already empty — show the image gallery there naturally. No camera badge, no modal, no extra UI chrome needed. Own images shown first, then ancestor images with a subtle "From [parent folder name]" divider (collapsible). Clicking an image calls `shell.openPath` to open full-size in the OS default viewer — no in-app lightbox needed. No write/edit in v1 — read/display only, user manages image files in Explorer/Finder. IPC: `folder:scanImages(path)` returns image file paths in that folder (non-recursive); renderer walks up the already-loaded folder tree to assemble inherited images. **Layout**: adaptive CSS grid based on image count — no library needed. All cells use `aspect-ratio: 4/3` with `object-fit: cover`. Rules: 1 image → single column, fills ~65% panel height; 2 → two equal columns; 3 → two columns, third spans full width; 4 → 2×2; 5–6 → 3 columns; 7+ → 3-column wrapping grid. `grid-template-columns` and `col-span` set dynamically from `images.length`.

- **[ ] Per-capture images** — *(Medium-High LOE)* Associate photos with a specific capture (e.g., amp settings knob photo, pedal chain photo). Key architectural decision: where to store them. Options: (a) sidecar files alongside the `.nam` file (`MySolo.nam` → `MySolo.nam.jpg`, `MySolo.nam_2.jpg`); (b) paths stored in `metadata.nam_lab.images[]` — lightweight but paths break if files move; (c) base64 embedded in `nam_lab` — keeps everything in one file but bloats `.nam` files significantly (not recommended). Recommended: sidecar approach — clean, portable, no file bloat. Complication: all file operations (rename, move, copy, trash) must carry sidecars along. UI: collapsible "Photos" section at the bottom of MetadataEditor showing thumbnails; click to view full size; drag image files onto the section to associate them. Display in grid view as a photo count badge. Higher LOE than folder images due to sidecar management across all file operations.

- **[x] Pack Info editor + export** — When a folder is selected with no captures, the right panel shows a Pack Info editor (tabs: Pack Info | Gallery if images exist). Sidecar file: `nam-pack.json` in the folder. Fields: title, subtitle, description, equipment (Amp/Cabinet/Mic/Preamp/Interface), pedals, switches & modes, glossary. Captures table auto-populates from loaded files (name, channel, settings, switches). "Export PDF…" button generates styled HTML in OS temp dir and opens in default browser. Dark mode toggle (persisted to localStorage) produces black bg, white text, orange labels/headings. IPC: `folder:readPackInfo`, `folder:writePackInfo`, `app:exportPackSheet`, `folder:findPackOwner`. Child folders of a pack-owning folder suppress the Pack Info editor (gallery only). Folder panel tab resets to 'pack' on folder change.

- **[ ] Pack Info "Copy to…"** — Copy the current pack's equipment, pedals, glossary, description, etc. to another folder as a starting point for a new amp pack. The challenge vs. capture-lab (which has flat folders) is target selection: NAM Lab has a deeply nested tree and the user wants to copy *across* different amp roots, not within the same pack's subfolders. **Proposed UX**: "Copy to…" button in Pack Info header opens a folder picker dialog (native OS dialog, same as `dialog:openFolder`) so the user picks the exact destination directory regardless of what's loaded in the tree. Warn if a `nam-pack.json` already exists at the target. Infrastructure already scaffolded in `PackInfoEditor.tsx` — button is commented out, `CopyFolderPicker`, `handleCopyTo`, `allFolderPaths` prop, and `copyStatus` state are all in place. Just needs the UX decision finalized and the button un-commented (or replaced with the native dialog approach).

- **[ ] Pack export logo** — Add a logo/graphic to the top-right corner of the exported HTML header (light and dark mode each get their own image, since a dark logo won't show on a black background). **Storage**: read the picked file as base64 at pick time via IPC `file:readBinary`, store both base64 strings in `AppSettings` as `packLogoLight: string` and `packLogoDark: string` (empty = no logo). **Settings UI**: Settings → Pack Info section — two file pickers ("Light mode logo" and "Dark mode logo"), each showing a small thumbnail preview when set, with a clear button. File picker filters to PNG/JPG/SVG/WEBP. Warn if file exceeds ~200KB (base64 will bloat settings). **HTML placement**: header is `display: flex; justify-content: space-between; align-items: center`. Logo is a right-aligned `<img>` with `max-height: 48px; max-width: 160px; object-fit: contain`. Base64 data URI embedded directly so the HTML is self-contained. Logo only rendered if the relevant setting is non-empty. **New IPC needed**: none — `file:readBinary` already exists. **AppSettings changes**: add `packLogoLight: string` and `packLogoDark: string` (default `''`) to `AppSettings` and `DEFAULT_SETTINGS`. **PackInfoEditor change**: read both logo settings from props (passed from App.tsx) and pass `darkExport ? packLogoDark : packLogoLight` into `generateExportHtml`.

- **[ ] Pack export print page breaks** — Investigate CSS `page-break-*` / `break-before` / `break-inside: avoid` rules in the exported HTML to prevent sections splitting across pages. **Tried in rc7 and reverted**: `table-layout:auto`, col-channel/col-tonetype shrink-to-content, `@page :first { margin:0 }` / `@page { margin:10mm 0 0 0 }`, and full `@media print` page-break rules. The margin approach made the page-1 gap worse; page-break rules didn't help enough to justify the regressions. Original `table-layout:fixed` layout restored. Needs a fresh look — possibly a different approach to page margins or a Chromium-specific print workaround.

- **[ ] Pack export subfolder filter** — In the Pack Info captures preview, show a checklist of immediate subfolders (e.g. DI, Mesa, _STAGING) that can be included/excluded from the export. Default: all checked. Exclude patterns like `_STAGING` or `_WIP` automatically. Stored as `exportExcludedSubfolders: string[]` in `nam-pack.json`. The capture list shown in the editor and written to the export HTML respects this filter.

- **[x] Pack description rich formatting** — Allow bold, color, and emphasis in the description field so it has visual impact in the export. Brainstormed options:
  - **Option A — WYSIWYG editor (e.g. Tiptap)**: Full rich-text toolbar in the editor, stores HTML, renders directly in export. High fidelity but adds a heavy dependency and the editor would feel out of place in the compact UI.
  - **Option B — Markdown parsed at export time (recommended)**: Keep the textarea as plain text. At export time, parse a small subset: `**bold**`, `*italic*`, `# Heading`, `---` horizontal rule, `- item` for bullets, and color/highlight syntax. No new dependencies — just a regex pass on the description before injecting into HTML. The user writes naturally; the preview only matters in the browser. LOE: low.
  - **Option C — Predefined color spans via simple BBCode**: `[b]text[/b]`, `[orange]text[/orange]`. Familiar to guitar forum users, trivially parsed. Less standard than markdown but more explicit for color control.
  - **Recommended path**: Hybrid of B + C. Markdown for structure (`**bold**`, `*italic*`, `# Heading`, `---`, `- bullets`). BBCode-style for color since markdown has no color syntax: `[orange]text[/orange]`, `[dim]text[/dim]`. Named theme colors only (not arbitrary hex) so they respect dark/light mode — e.g. `[orange]` → accent color (orange in dark, teal in light), `[dim]` → muted secondary, `[white]` → primary text. A small hint panel below the textarea shows the supported syntax. No toolbar needed in v1.

- **[x] Pack global gear library** — Reuse equipment, pedals, and glossary entries across packs without retyping. Switches are intentionally excluded — they vary per amp. Captured By auto-populates from Settings → Capture Defaults → Modeled By. Brainstormed options, recommendation in **Option C**:
  - **Option A — Templates**: Save a whole pack as a template (title/subtitle stripped, equipment/pedals/glossary preserved). Apply template when creating a new pack to pre-fill those sections. Stored in localStorage as `nam-pack-templates`. Simple but coarse — template is all-or-nothing.
  - **Option B — Per-section presets**: Each section (Equipment, Pedals, Glossary) has a "Load preset…" dropdown that shows named snapshots of that section saved from previous packs. User picks one to replace the current section. Stored per section type. More granular than templates.
  - **Option C (recommended) — Global gear catalog in Settings**: Settings → Pack Info → maintain a personal catalog of gear items under Equipment, Pedals, and Glossary. Each item has a label+value (or term+description for glossary) and a category tag. When editing a pack section, an "Add from catalog…" button opens a picker — user checks what applies, rows are inserted. User maintains the catalog once; all packs draw from it. Stored in `AppSettings.packGearCatalog: { category: 'equipment'|'pedals'|'glossary'; label: string; value: string }[]`. LOE: medium (new settings section + picker modal).

- **[ ] Blank xlsx import template with lookup dropdowns** — *(Low-Medium LOE)* Right-click folder → "Generate blank import template" produces an Excel file with correct column headers but no data rows (vs. the existing pre-filled export which has current values). Sheet 2 contains lookup tables: Gear Type and Tone Type valid values. Sheet 1 cells in those columns use Excel data validation (dropdown lists) pointing to Sheet 2 ranges. Preferred approach: write validation programmatically by injecting `dataValidation` XML nodes directly into the worksheet XML — avoids bundling a binary template. SheetJS v0.18.x has limited validation API support so may require manual OOXML construction. Worth a focused prototype first before committing.

- **[ ] OS "Open folder in NAM Lab"** — Right-click a folder in Explorer/Finder and open it directly in NAM Lab. Requires registering a protocol handler or custom verb in electron-builder config. Similar to file associations but for folders; macOS needs a folder UTI handler, Windows needs a registry shell extension verb.

### Quality of Life

- **[x] Amber blinking status bar during load** — Status dot and text turn amber + animate-pulse when message matches /loading|scanning/i.

- **[x] Last-used folder memory in file pickers** — Move to folder / Copy to folder pickers remember the last destination per operation type (stored in localStorage). Passed as `defaultPath` to `dialog:openFolder` IPC.

- **[x] Save and advance keyboard shortcut** — Ctrl+Enter (Cmd+Enter on Mac) saves the current file and moves selection to the next file in the visible folder list.

- **[x] Double-click capture name to edit** — Double-clicking the capture name h2 in MetadataEditor header opens an inline input. Enter/blur commits; Escape cancels.

- **[x] Folder tree expand/collapse all** — Two chevron buttons in the Library header (expand all ↓ / collapse all ↑). Signal propagates down through TreeNode via incrementing seq counters.

- **[ ] Star / Pin captures** — Mark individual captures as starred/pinned for quick access. Stored as `metadata.nam_lab.starred` (boolean). Shown as a star icon in list and grid. Filterable chip in the file list toolbar. Separate from rating (see below).

- **[ ] Capture rating** — 1–5 star rating stored as `metadata.nam_lab.rating`. Shown in list/grid. Sortable column. Filter chip. Intended for personal quality ranking after auditioning in a DAW — most useful once the in-app preview player exists, but the field infrastructure is worth having now. Star/pin shortcut could set rating = 5.

- **[x] Select all in folder** — Right-click a folder in the tree → "Select all in folder" selects all files in that folder and navigates to it.

- **[x] Grid column sort persistence** — Sort column and direction persisted to localStorage (`nam-lab-sort`). Restored on next session.

- **[x] Filtered file count** — When any filter is active in FileList, a "X of Y files" count appears above the search bar in sky blue.

- **[x] Manufacturer filter in list view** — Manufacturer (gear_make) dropdown added to the list view filter bar. Options populate from distinct values in loaded files.

- **[x] Double-click grid column header to auto-size** — Double-click the resize handle (right edge of header) to auto-size the column to fit the widest value across all rows. Canvas `measureText` approach.

- **[ ] Drag-to-reorder grid columns** — HTML5 drag API exhaustively tried, never works reliably in Electron Chromium. All failed approaches:
  1. `draggable` on `<th>` + `dragColRef` + duplicate `onDrop` on inner `<div>`
  2. Inner `<div>` draggable + `pointer-events: none` on children (killed drag initiation)
  3. Unconditional `e.preventDefault()` in `onDragOver` + `e.dataTransfer.getData('text/plain')` in `onDrop` instead of ref — ghost drags but drop still does not reliably fire
  - Root cause: Electron Chromium delivers drop to deepest child, not `<th>`. `dataTransfer` data also inaccessible in `onDragOver` (browser security).
  - **Only viable path**: `mousedown`/`mousemove`/`mouseup` custom drag — no HTML5 API. Portal-rendered ghost div follows cursor; on `mouseup` determine target column via `getBoundingClientRect`. Sidesteps all child-element drop issues.

- **[x] CSV export from grid not working** — Fixed: `nl_rating` in `getCellValue` was returning a number (`?? 0`), causing `.includes()` to throw. Changed to `String(m.nl_rating)` or `''`. Also fixed export column order to respect `visibleCols` order.

- **[ ] Blank xlsx import template with lookup dropdowns (with sample)** — Update "Generate blank import template" to include a Sheet 2 with lookup tables for Gear Type and Tone Type valid values, and apply Excel data validation dropdowns to those columns on Sheet 1. Show a sample data row on Sheet 1 so users understand the expected format. Requires manual OOXML `dataValidation` injection since SheetJS v0.18.x has limited validation API support. **Investigated 2026-04-23**: user's existing template (BE100V2.NAM.ImportFormat_withToneTYpe.xlsx) has Sheet2 with gear/tone lookup columns — SheetJS reads it back with no `!dataValidations` on Sheet1, meaning either the dropdowns weren't wired up yet or SheetJS can't read them. Either way, the injection approach (manually writing `<dataValidation>` OOXML into the sheet XML before `XLSX.write()`) is confirmed feasible.

- **[ ] Append to comments (batch)** — Low priority. Right-click → "Append to comments…" on a multi-file selection opens a small input dialog. The text entered is appended to the end of each file's existing `nl_comments` value (with a space separator if the field is non-empty), preserving each file's unique existing content. Useful for tagging 50 captures that already have individual comments with a common suffix like "— v2 reamp".

- **[x] Per-column grid filters (multi-select + text search)** — Filter icon on each grid column header opens a popup with a text search (contains mode) and a checklist of distinct values (exact match mode). Multiple columns compose with AND logic. Active filter shown as a filled/indigo icon. All gear/tone/preset/name dropdowns hidden in grid mode (they are commented out, not deleted). "Column filters active — Clear all" banner shows when any column filter is set.

- **[x] README cleanup / wiki** — README trimmed to ~65 lines. Full feature reference moved to `docs/features.md`; first-launch instructions to `docs/install.md`.

- **[ ] Unify list-view filter bar controls** — The Manufacturer dropdown has an explicit × clear button but Gear Type, Tone Type, Preset, and Name Contains do not — they require re-selecting the placeholder option. All five controls should behave the same way: either all have an × clear button when active, or none do and all rely on the placeholder option. Manufacturer's × works well; add the same pattern to the other four.

- **[ ] Large collection / network share load performance** — On network shares (e.g. Y:\, 7,909 files) initial scan is slow. Investigate: (1) parallelise file reads with a concurrency-limited batch (e.g. 20 at a time) instead of sequential `await`; (2) lazy-load metadata — scan file list first, show names immediately, then read metadata in the background and update state as results arrive; (3) cache per-file mtime + size in localStorage so unchanged files skip the IPC round-trip on next open; (4) for watched folders, only re-read files whose mtime changed since last scan. The async scan with 5-minute timeout already prevents hangs; this is about making the UI feel responsive sooner.

- **[ ] Folder tree colorization** — Two-layer color system. Layer 1: name-based rules in Settings → Library (e.g. `DI=blue, CAB=green`) — any folder with that exact name gets a colored dot anywhere in the tree, set once. Layer 2: right-click any folder → "Set color" palette — stores color by folder path, applies to that specific folder. Parent color propagates to direct children as a subtle left accent bar (group membership signal), while the child's own dot shows its type. Two visual channels: left bar = amp group, dot = capture type. Storage: `folderNameColors: Record<string, string>` and `folderPathColors: Record<string, string>` in AppSettings. LOE: ~2–3 hours.

---

## Credits

Conceived by [Core Tone Captures](https://github.com/coretonecaptures). Code written by [Claude Code](https://claude.ai/code).
