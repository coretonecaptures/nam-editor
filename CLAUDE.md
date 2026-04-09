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
| `window:refocus` | main | Restore keyboard focus after native dialogs |
| `log:getErrorLogPath` | main | Path to parse error log |
| `log:getStartupLogPath` | main | Path to startup log |

### File Write Strategy — CRITICAL

**Never use `JSON.parse` → `JSON.stringify` to write back .nam files.** This destroys formatting and is unacceptable.

All writes use `patchMetadataFields()` in `src/main/index.ts` — a surgical text patcher that finds each changed key in the raw file text using regex and replaces only the value bytes. All original formatting, whitespace, field order, and non-metadata data (weights, config, etc.) are preserved exactly.

For nested fields like `metadata.training.nam_bot.trained_epochs`, use `patchNamBotField()` which navigates into the nested block and creates the structure if it doesn't exist.

Only fields in `EDITABLE_FIELDS` (plus `nb_trained_epochs`) are ever written — the patcher is a whitelist, not a catch-all.

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

Current version: **0.4.2** (see `package.json`). Version is injected into the renderer via `VITE_APP_VERSION` in `electron.vite.config.ts`.

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

### Drag & Drop from OS (Unresolved Bug)
Dragging `.nam` files or folders from Windows Explorer / macOS Finder into the app window does not work — the cursor shows a red forbidden circle. Attempted fixes:
- Added `will-navigate` prevention in main process (`mainWindow.webContents.on('will-navigate', e => e.preventDefault())`) to stop Electron navigating away on file drop
- Moved from React synthetic `onDrop` to native `document.addEventListener('drop')` listeners
- Added `dropEffect = 'copy'` on both `dragover` and `dragenter` on the root div
- Fixed FolderTree `dragover` to only intercept intra-app drags (checking `e.dataTransfer.types.includes('application/x-nam-files')`)
- Added `path:stat` IPC for reliable folder detection via `fs.statSync` instead of guessing from file extension
- Root cause still unclear — Electron's webContents may be consuming the drag event before it reaches the renderer. References to drag & drop removed from the UI until resolved.
- **Intra-app file moves** (dragging files between folders within the tree) work correctly — that uses `application/x-nam-files` data transfer and is unaffected.

### Other Pending Items

- **App icon** — user has design concepts (lab beaker theme). Needs `.ico` (Windows) and `.icns` (macOS) files generated from artwork. Currently uses Electron default musical note icon.
- **Code signing** — app is unsigned. Users bypass SmartScreen (Windows) or Gatekeeper (macOS) on first launch. Options discussed: Apple Developer account ($99/yr) for notarization, EV certificate for Windows SmartScreen reputation.
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
- **[ ] Batch rename from template** — Apply the rename template to all selected files or all files in a folder. Needs preview list (show all from→to pairs) before committing. Should reuse same template setting. Deferred until single-file rename is validated.

- **[ ] Completeness indicator** — Colored dot or score per file showing how many "shareable" fields are filled (`name`, `modeled_by`, `gear_make`, `gear_model`, `gear_type`, `tone_type`, `input_level_dbu`, `output_level_dbu`). Show in FileList rows and grid cells. Pair with a filter to show "incomplete only."

- **[ ] Gear make/model autocomplete** — Free-text inputs for `gear_make` and `gear_model` get datalist suggestions. Two layers: (1) hardcoded seed list of ~30 common brands (Marshall, Fender, Mesa Boogie, Bogner, Friedman, Dumble, Vox, Orange, Peavey, EVH, Carr, Two-Rock, Matchless, Bad Cat, Soldano, Dr. Z, etc.), (2) values already present in loaded files. User can still type anything — suggestions are non-binding.

- **[ ] Missing field quick filter** — Toolbar filter in FileList: a select dropdown listing the shareable fields. Choosing one filters the list to files where that field is empty/null. Pairs with completeness indicator.

### Medium Priority

- **[ ] Recent folders** — Dropdown on Open Folder showing last 5–10 opened folder paths (persisted to localStorage). Speeds up switching between libraries.

- **[ ] Arrow key navigation in file list** — Up/down arrow keys move selection when the file list has focus. Multi-select with Shift+arrow. Feels polished, speeds up review.

- **[ ] Intra-app folder drag-to-organize** — Drag files from one folder to another within the FolderTree (this already works for moving files). Extend to support reorganizing the folder structure itself (create subfolder, move folder). Distinct from the unresolved OS drag & drop bug.

- **[ ] Watch folder / auto-refresh** — Optional: monitor the open folder for new `.nam` files appearing on disk (from a trainer finishing) and offer to reload. Could be a toggle in Settings.

---

## Credits

Conceived by [Core Tone Captures](https://github.com/coretonecaptures). Code written by [Claude Code](https://claude.ai/code).
