# CLAUDE.md — NAM Lab

## Project
Electron + React + TypeScript + Tailwind CSS desktop metadata editor for `.nam` files (Neural Amp Modeler captures). Built with `electron-vite`, packaged with `electron-builder`. Runs on Windows, macOS, Linux. Current version in `package.json`.

See `TODO.md` for all planned/pending work items.

## Architecture
- `src/main/index.ts` — Main process: file I/O, IPC handlers, window management
- `src/preload/index.ts` — Exposes typed `window.api` to renderer
- `src/renderer/src/` — All React UI (never touches filesystem directly)

Three-panel layout: **FolderTree | FileList | MetadataEditor/BatchEditor/MultiSelectEditor**

## CRITICAL — File Write Strategy
**Never use `JSON.parse` → `JSON.stringify` to write back `.nam` files.** This destroys formatting.

All writes use `patchMetadataFields()` — surgical text patcher that replaces only changed value bytes via regex. Original formatting, whitespace, field order, and model weights are preserved exactly.

- `patchNamBotField()` — writes into `metadata.training.nam_bot.*`
- `patchNamLabField()` — writes into `metadata.nam_lab.*` (creates block if missing)
- `removeNamLabBlock()` — surgically strips `"nam_lab": {...}` with comma handling
- Only fields in `EDITABLE_FIELDS` (plus `nb_trained_epochs`) are ever written

## Metadata Fields
- **Editable**: `name`, `modeled_by`, `gear_type`, `gear_make`, `gear_model`, `tone_type`, `input_level_dbu`, `output_level_dbu`, `nb_trained_epochs`
- **NAM Lab extended** (`nl_` prefix → `metadata.nam_lab.*`): `nl_mics`, `nl_cabinet`, `nl_cabinet_config`, `nl_amp_channel`, `nl_boost_pedal`, `nl_amp_settings`, `nl_pedal_settings`, `nl_amp_switches`, `nl_comments`
- **Read-only**: date, loudness, gain, validation_esr, checks.passed, latency.recommended, preset_name

`nb_` and `nl_` fields are lifted from nested metadata to flat keys at read time in the main process.

## Key Conventions
- **Ask before pushing a version tag** — tags trigger CI builds on all three platforms
- `app.getPath('userData')` must never be called at module load time — use lazy functions
- Startup logging writes to `os.tmpdir()` first, moves to `userData` after app ready
- Settings stored in `userData/settings.json` (not localStorage) — read sync in preload
- `suppressWatcher()` called after every local write — suppresses `folder:changed` for 3s
- Drag handles between panels use the `DragHandle` component; both panels are collapsible
- `utils/detectPreset.ts` — reverse-engineers preset name from `config.layers` fingerprint

## Build