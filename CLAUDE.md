# CLAUDE.md — NAM Lab

## SECURITY — NEVER COMMIT SECRETS
**Under absolutely no circumstances check in any private keys, certificates, API keys, tokens, or
passwords** (e.g. `.p12`/`.p8` files, `CSC_KEY_PASSWORD`, Apple API keys, AI provider keys, OAuth
tokens). These belong in GitHub Actions secrets or the user's local keychain/env, never in the
repo, never in a commit, never pasted into a tracked file. If a secret is ever handed over in
conversation, treat it as ephemeral — use it to set the remote secret, do not write it to disk
inside this repo.

## Project
Electron + React + TypeScript + Tailwind CSS desktop metadata editor for `.nam` files (Neural Amp Modeler captures). Built with `electron-vite`, packaged with `electron-builder`. Runs on Windows, macOS, Linux. Current version in `package.json`.

See `TODO.md` for all planned/pending work items.

## Architecture
```
src/main/index.ts       — Main process: file I/O, IPC handlers, window management
src/preload/index.ts    — Exposes typed `window.api` to renderer
src/renderer/src/       — All React UI (never touches filesystem directly)
```
Three-panel layout: **FolderTree | FileList | MetadataEditor/BatchEditor/MultiSelectEditor**

### Key IPC Channels
`dialog:openFiles`, `dialog:openFolder`, `file:read`, `file:writeMetadata`, `folder:scanNam`, `folder:scanTree`, `file:move`, `file:rename`, `file:trash`, `file:copy`, `file:clearNamLab`, `file:readBinary`, `dialog:openImportFile`, `window:refocus`, `log:getErrorLogPath`, `folder:readPackInfo`, `folder:writePackInfo`, `app:exportPackSheet`, `folder:readBundle`, `folder:writeBundle`, `app:checkForUpdates`

## CRITICAL — File Write Strategy
**Never use `JSON.parse` → `JSON.stringify` to write back `.nam` files.** This destroys formatting.

All writes use `patchMetadataFields()` — surgical text patcher replacing only changed value bytes via regex. Original formatting, whitespace, field order, and model weights are preserved exactly.

- `patchNamBotField()` — writes into `metadata.training.nam_bot.*`
- `patchNamLabField()` — writes into `metadata.nam_lab.*` (creates block if missing)
- `removeNamLabBlock()` — surgically strips `"nam_lab": {...}` with comma handling
- Only fields in `EDITABLE_FIELDS` (plus `nb_trained_epochs`) are ever written

## Metadata Fields
- **Editable**: `name`, `modeled_by`, `gear_type`, `gear_make`, `gear_model`, `tone_type`, `input_level_dbu`, `output_level_dbu`, `nb_trained_epochs`
- **NAM Lab extended** (`nl_` prefix → `metadata.nam_lab.*`): `nl_mics`, `nl_cabinet`, `nl_cabinet_config`, `nl_amp_channel`, `nl_boost_pedal`, `nl_amp_settings`, `nl_pedal_settings`, `nl_amp_switches`, `nl_comments`
- **Read-only**: `date`, `loudness`, `gain`, `validation_esr`, `checks.passed`, `latency.recommended`, `preset_name`

`nb_` and `nl_` fields are lifted from nested metadata to flat keys at read time in the main process.

## NamFile Shape
```typescript
interface NamFile {
  filePath: string
  fileName: string
  version: string
  metadata: NamMetadata       // working copy
  originalMetadata: NamMetadata  // raw from disk, never mutated
  autoFilledFields: (keyof NamMetadata)[]
  architecture: string
  config: unknown
  isDirty: boolean
}
```

## Key Conventions
- **Ask before pushing a version tag** — tags trigger CI builds on all three platforms
- `app.getPath('userData')` must never be called at module load time — use lazy functions
- Startup logging writes to `os.tmpdir()` first, moves to `userData` after app ready
- Settings stored in `userData/settings.json` (not localStorage) — read sync in preload via `ipcRenderer.sendSync`
- `suppressWatcher()` called after every local write — suppresses `folder:changed` for 3s
- Drag handles between panels use the `DragHandle` component; both panels are collapsible
- `utils/detectPreset.ts` — reverse-engineers preset name from `config.layers` fingerprint
- Change highlighting: **indigo border** = auto-filled by settings rule; **amber border** = manually changed
- Pack info sidecar: `nam-pack.json` per folder. Bundle sidecar: `nam-bundle.json`.
- `_Duplicates` folder is always hidden from the tree

## Build
```bash
npm run dev              # dev server with hot reload
npm run build            # production build
npm run package:win      # Windows NSIS installer
npm run package:mac      # macOS DMG (universal)
npm run package:linux    # Linux AppImage
```

CI runs on tag push via `.github/workflows/release.yml`. Tags matching `*-rc*` are pre-releases. Version injected via `VITE_APP_VERSION` in `electron.vite.config.ts`. App ID: `com.coretonecaptures.namlab`.
