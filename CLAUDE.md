# CLAUDE.md — NAM Lab

## SECURITY — NEVER COMMIT SECRETS
**Under absolutely no circumstances check in any private keys, certificates, API keys, tokens, or
passwords** (e.g. `.p12`/`.p8` files, `CSC_KEY_PASSWORD`, Apple API keys, AI provider keys, OAuth
tokens). These belong in GitHub Actions secrets or the user's local keychain/env, never in the
repo, never in a commit, never pasted into a tracked file. If a secret is ever handed over in
conversation, treat it as ephemeral — use it to set the remote secret, do not write it to disk
inside this repo.

**This guard also covers the user's real machine**, not just credentials: never commit a real
local filesystem path (drive letters, home directory paths, personal library/media locations),
real personal filenames, or any other detail specific to the user's own computer or accounts.
Scripts, fixtures, tests, and stress-test harnesses that need a real local path (e.g. a large
library to benchmark against) must take it from an environment variable, a CLI argument, or a
`.gitignore`d local config file — never hardcoded in a tracked file. When in doubt, treat "would
this reveal something about the user's specific machine" the same as "is this a secret."

## Project
Electron + React + TypeScript + Tailwind CSS desktop metadata editor for `.nam` files (Neural Amp Modeler captures). Built with `electron-vite`, packaged with `electron-builder`. Runs on Windows, macOS, Linux. Current version in `package.json`.

See `TODO.md` for all planned/pending work items.

## Working practice — match what already exists, don't invent

When asked for a UI feature by a generic name ("add cards", "add a tray", "add
a rail", "add tabs", "add a filter bar"), **do not go straight to an
implementation.** First:

1. **Search the app for prior art.** `grep` for the concept across
   `src/renderer/src/components` (and check sibling apps the user names —
   "gear-locker", "card-locker/pokemon app" — for the *interaction* pattern).
   Someone has usually built this idea already; find it and match it.
2. **Follow the established design.** Same iconography, same tokens, same
   affordances. Concretely:
   - A view toggle is **icons, not words** — e.g. list/cards is a grid icon vs
     a rows icon, never the literal text "Card" / "List".
   - Icons are inline `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
     strokeWidth={2}>` line art (Heroicons-outline style). No emoji, no icon
     font, no raster.
   - Colours are design tokens (`bg-panel-2`, `border-nm-border`, `bg-active-bg`,
     `text-nm-accent`, `text-accent-fg`, `bg-hov`, `text-nm-text-3`), never raw
     Tailwind greys or hex.
   - Cards: match `FolderCardView.tsx` and the `IrTray` card-locker pattern —
     restrained borders, one accent, dense but not cramped. The first-pass
     `CaptureCard` in `NamProjectsShell.tsx` is explicitly *not* the reference;
     it needs to be brought in line with `FolderCardView`.
3. **Re-implement, don't transplant.** Copy the *interaction* from another
   codebase, rewrite it in this app's tokens and Tailwind conventions so it
   reads as NAM Lab (see `IrTray.tsx`'s header comment for the standard).
4. Only if there genuinely is no precedent, say so, then propose one approach
   (not three) grounded in the nearest-neighbour pattern.

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
