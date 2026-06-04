# TODO

## Packaging and release

- App icon files for Windows and macOS (`.ico` / `.icns`)
- Code signing and notarization

## Security and hardening

- ~~Move Tone3000 OAuth token storage from plain `userData/tone3000-tokens.json` to `safeStorage` with migration from the old plain JSON file.~~ — Done. `tone3000-tokens.bin` written via `safeStorage.encryptString`; legacy `.json` is auto-migrated and unlinked on next save (`loadTone3kTokens` / `saveTone3kTokens` in `main/index.ts`).
- ~~Move AI provider keys (OpenAI, Anthropic, etc.) to `safeStorage`.~~ — Done. Per-provider `ai-key-{provider}.bin` files via `storeAiKey` / `readAiKey`. Keys never travel back to the renderer (saved by name; never re-emitted).
- ~~Add external URL validation in main process (`openExternal`, `window.open` handling) and allow only expected schemes.~~ — Done. `openExternalSafe(raw, allowedProtocols)` gates `shell.openExternal`; default allowlist is `['https:', 'mailto:']`. Used by the `app:openExternal` IPC handler and by `webContents.setWindowOpenHandler` for child-window requests.
- ~~Standardize renderer links on `window.api.openExternal(...)` instead of raw `window.open(...)`.~~ — Done. Zero `window.open(` / `window.location.href =` usages remain in `src/renderer/`.
- ~~Add URL guardrails for remote download helpers~~ — Done.
  - Tone3000 model + cover URLs are filtered through `isAllowedTone3000Url` (https:// only, hostname must be `tone3000.com` or `www.tone3000.com`) before any `fetch`.
  - `cover:downloadFromUrl` accepts only `http:` / `https:` URLs via `parseAllowedUrl`, validates `Content-Type` starts with `image/`, and restricts the saved extension to a known image-format whitelist.
- Review the broad preload / IPC surface and plan a narrower permission model before any store-distribution push. The preload currently exposes ~80 IPC channels — many of them broad filesystem operations (read/write/move/trash arbitrary paths). For app-store distribution this would need either: (a) per-channel scope/origin checks, (b) renderer-supplied paths restricted to user-selected dialogs/drops only, or (c) splitting trainer / library / Tone3000 IPC namespaces with separate preload scripts. Pending.
- Evaluate whether `sandbox: false` can be tightened without breaking file management, trainer flows, or local image rendering. `contextIsolation: true` and `nodeIntegration: false` are already in place, which provide the strongest practical boundaries — but a true `sandbox: true` would force the preload to be sandboxed too (no `require` of arbitrary modules) and would need a refactor of the preload's `electron`/`webUtils` imports. Pending; do this as a separate test-heavy pass.

## Pack Info and export

- Pack Info export markdown: add support for indented / nested bullet lists in the PDF export parser
- Pack Info `Copy to...`
- Pack export subfolder filter
- Pack export body text size and footer text size controls
- Add selection-based spreadsheet export from the file list and grid, e.g. right-click selected rows -> `Export these to Excel`, so small ad hoc subsets do not require a separate filter or folder.

## Library and file management

- Per-capture images
- OS `Open folder in NAM Lab`
- Append to comments (batch)
- ~~**Duplicate move destination picker**~~ ✓ — Already implemented; "Change folder…" button in DuplicatesModal lets user pick destination before moving.

## Import and performance

- Blank xlsx import template with lookup dropdowns
- Large collection / network share load performance: add mtime cache
- Tone3000 search follow-up: if the API stays limited, explore a bounded multi-page fetch/cache strategy for narrow searches, favorites, or creator-focused browsing without trying to mirror the full catalog locally.

## Onboarding and discoverability

- Inline `?` help popovers on complex fields (Python path, training presets, metadata suggestions, watch folders) — one-click "how to set this up" context that doesn't require opening docs.
- Setup wizard (non-forced): shown on the home/empty state when no folder is loaded (first launch experience), and accessible anytime from the Help menu. Covers: (1) loading a NAM folder, (2) key settings walkthrough with plain-language explanations of what each does, (3) capture defaults and what "fill on load" means, (4) Python/training setup if the user wants local training. Not a blocker — dismissible at any point.
- Clean function wizard: step-by-step guide explaining what the Clean tool does, when to use it, and how to configure it safely before running it on a real library.
- Metadata suggestions wizard: walkthrough for building suggestion rules — explains the concept, walks through creating a first rule, shows a live preview of what would change before the user commits.
- Capture defaults "fill blank on load" toggles: add a checkbox next to each capture default field so users can opt in to auto-populating that field when loading a .nam that has it blank, without needing to configure a full metadata suggestion rule.
- Settings discoverability: the app has grown deep — consider a search-within-settings feature or a "Quick Setup" shortcut panel that surfaces the most commonly needed first-time settings (Python path, default folder, modeled-by name) without scrolling the full settings page.

## Grid and UI

- Metadata header path display: consider a second muted/grey full-path presentation or alternate layout that shows more of the real file path without stealing too much editor real estate.
- Card view right-click "Get Cover Image": for folders without an ampcover, let the user fetch one from the web and save it as `ampcover.jpg`. See implementation notes below.
- Card view size picker: add a small/medium/large toggle (or slider) in the card view toolbar so the user can adjust card size to suit their display/resolution without leaving the view.

## Keyboard shortcuts

- Define logical shortcut keys for card view navigation (open card view, browse into folder, open folder, back) and common file operations (save, revert, batch edit, next/previous file)
- Add a Keyboard Shortcuts section in Settings for discovering and customizing key bindings

## Checklist and release workflow

- Checklist row sync button is tiny and too far away
- Add a `Sync All` action for checklist rows
- Pack metadata cover image: add adjustable framing / zoom window for `ampcover.*`

## Folder watch

- Add a manual `Resync from watch source` action for a watch rule
- Add a manual `Forget imported history` action for a watch rule

## NAM A2 / PackedWaveNet (future)

- A2 architecture research (done): A2 = PackedWaveNet / Slimmable NAM — released in `neural-amp-modeler` source. Uses a fundamentally different model: single flat config with 23 sub-layers, `LeakyReLU` activation, Fibonacci-ish dilations `[1,3,7,17,41,101,239,…]`, and two submodels (`channels_3` + `channels_8`) trained simultaneously so one run yields lite+standard outputs. Config loaded from `config_model_packed.json` resource file.
- A2 NAM Lab support: the current `__namlab__` Architecture enum trick is not applicable — the new `core.py` has no `Architecture` enum and no `get_wavenet_config()`. Supporting A2 requires a separate Python runner mode that calls `PackedLightningModule` directly with the packed config JSON. Doable as a new runner branch; should be treated as a separate feature once A2 stabilizes in the official NAM release.
- A2 config reference: packed config is at `nam/train/_resources/config_model_packed.json` in the NAM source; `lr=0.004`, `weight_decay=3.17e-7`, `ExponentialLR(gamma=0.994)`, `mrstft_weight=0.0005`. Two submodels: `channels_3` (nano-class) and `channels_8` (standard-class).

## Remote training (future / exploratory)

- **Remote training agent**: allow NAM Lab on one machine to dispatch training jobs to a separate, more powerful machine on the local network — e.g. a dedicated GPU workstation — while the user continues editing on their laptop. NAM Lab on the host machine would run a lightweight agent/server that accepts jobs from any NAM Lab instance on the same network.
- **Shared-drive workflow**: the simplest form of remote training would be shared-drive coordination — the submitting machine writes WAV pairs and a job manifest to a network path; the remote machine watches that path (via the existing Watch Folders mechanism), trains, and writes `.nam` outputs back. No custom protocol needed; just documenting the pattern and making the UX easy.
- **Remote job monitor**: a "Remote" section or dashboard card that shows live status (epoch, ESR, ETA) streamed from a remote agent, so the user can monitor a GPU workstation run without switching machines.
- **Remote queue dispatch**: extend the existing queue IPC so a job can be marked as `remote`, serialized, and sent to a remote NAM Lab agent over a local network socket (e.g. WebSocket or lightweight REST). The remote agent queues and executes it, streams back progress events, and sends the finished `.nam` back or writes it to a shared path.
- **Agent discovery**: mDNS/Bonjour-based local service discovery so NAM Lab instances can find each other on the network without manual IP entry — similar to how AirPlay or local dev servers advertise themselves.
- **Auth / trust model**: for any network-facing agent, define a simple shared-secret or pairing handshake so random machines on the same network cannot submit arbitrary training jobs to an exposed agent.

## Experimental training

- Training panel container usage: reduce the forced-feeling outer padding / dead margins so the trainer uses more of its available width and height, especially as the panel is resized.
- Training entry-point cleanup (partially done): standalone Training workspace exists and is the main surface now; finish retiring or simplifying the old file-level `Metadata | Training` pairing so metadata stays the file editor surface and Training lives as its own standalone workspace/tool.
- Training comparison test: run the same capture through a full `1000 epoch REVxSTD` build in both NAM-BOT and NAM Lab, then compare the resulting `.nam` files directly and also do a listening check to confirm they sound the same (or understand why they do not).
- ~~Training queue controls/icons~~: already SVGs — done.
- Training panel layout (partially done): a first cleanup pass happened, but the Training section still needs a dedicated neatening pass so Run WAVs / Run Folder / Queue, routing, and custom controls use space more gracefully and read more cleanly.
- Training architecture picker UX: validate on queue that at least one profile is selected, since the new card grid allows the selection to go empty.
- Training queue status line: fix the green running summary so it reports active/running work accurately (for example, a single active run should not say `Queue Running - 0 queued` in a misleading way).
- ~~**Training history graph preview**~~ — Stale; training page redesigned.
- Training watch presets: support more than one preset per watch folder, so one watched source can fan out into multiple training recipes such as `REVxSTD 1000 epoch` and `Standard 500 epoch`.
- Queue UX: support drag-and-drop queue reordering in addition to move up / move down controls.
- Queue grouping (partially done): queue/history rows already carry submission grouping for `Run WAVs`, `Run Folder`, and `Watcher`; remaining work is to deepen the batch/session UX where it helps without complicating the serial executor.
- Queue/history grouping UX: allow grouped Watcher / Run WAVs / Folder Run batches to be collapsed and expanded so long queues and histories are easier to scan.
- Training preset sharing: consider an export/import format so Capture Profile configs can be shared between users as standalone recipe files.
- Training history (partially done): reviewable grouped history exists; add export/report workflows and make sure the long-term storage/revisit experience is as useful as the live queue.
- Training watcher intake: maybe later, if the final expected output file is missing, allow reprocessing even when matching history already exists.
- Training verification report (partially done): WAV Check tab added — compares NAMs in the current folder against a user-chosen WAV staging folder, shows trained/missing/extra counts, and provides per-row Train and Train All buttons that enqueue jobs and jump to the queue view; remaining work is to surface ESR targets, epoch counts, and architecture verification against preset expectations.
- Training workflow (partially done): submission groups exist in queue/history; later consider a higher-level `job / batch` concept where one queued item can represent a multi-format set while watcher mode remains a separate automation layer.
- Training settings IA (partially done): training already has its own Settings tab; revisit once watcher folders, presets, history, and verification need more room or more specialized navigation inside Training itself.
- Training watch/preset UX: redesign watch folders and presets into a cleaner expandable master-detail style, so the user first sees a compact list with key summary fields and only expands/drills into one item at a time to edit the full details.
- Training drag-and-drop WAV intake: support dragging WAV files from Windows Explorer/Finder into the Training page’s WAV input area so the dropped files populate the selected capture list.
- Training history paging: the History tab currently renders every entry into a single grouped list. With 1000s of past runs the page becomes heavy. Add paging (or windowed/virtual scrolling) — default ~50–100 entries per page, with `Older →` / `← Newer` controls and a `Show all` escape hatch. Filter / search must apply across the full history, not just the current page.
- Training dashboard counter behavior: verify the intended lifecycle of the Dashboard `Completed` / `Failed` / `Queue progress` tiles end-to-end. Expected today: (a) within a session, the counters stay at the last finished queue's totals until a new batch is queued, at which point finished/error/canceled rows auto-clear from the queue and the tiles reset to 0; (b) across app restarts, the queue persistence file only stores `staged + queued + running` jobs so success/error rows never round-trip and the tiles read 0 on cold start. Run the scenarios — finish a queue and reopen the dashboard, queue a new batch and confirm the counters drop, close the app and reopen with nothing pending, close with staged batches pending — and see if the lived behavior matches expectations. If the "counters stuck at last run's count" reminder is more confusing than helpful, switch the Completed/Failed tiles to read from `todayStats` (history-today scope) instead of the in-memory queue so they read as a session counter.
- **[HIGH PRIORITY]** OS drag-and-drop from Explorer/Finder into app windows: NAM Lab has this wired for the main file/folder area (App.tsx `handleOsDrop`), but verify it actually works end-to-end on Windows (Electron `webContents` drop events + `e.dataTransfer.files` path extraction). Also wire drag-drop intake in gear-locker and expense-tracker.

## Metadata suggestions and organization

- Refine overwrite guards for metadata suggestion rules with a friendlier UI than a raw comma-separated text field (for example chips, multi-pick placeholders, or explicit junk-value presets).
- Expand friendly pattern-rule support beyond the first-pass `Prefix + value` matcher for settings strings like `G5.5`, `G1.2`, `G8`.
- Phase II / discussion: support broader wildcard or regex-style suggestion rules for patterned metadata tokens where one rule should recognize a family of values without requiring a separate exact-token rule for every variant.
- Discussion: explore reverse-template / pattern-based rules that extract metadata from naming structures (for example something in the spirit of `{tone_type} {creator} {cabinet}`) without requiring users to understand regex.
- Design a safe explicit-source workflow to collect `.nam` files from user-chosen intake folders into a working folder, without trying to automatically infer which existing folders are "loose" versus valid staging/archive/release locations.
- Investigate a safe "build logical folder structure from existing metadata" helper: preview-only first, because auto-restructuring by amp / cab / combo / settings could be powerful but dangerous if metadata is incomplete or wrong.
- AI-assisted suggestion rule discovery: explore sending a sample of a folder's filenames and existing metadata values to the AI and asking it to identify meaningful token patterns worth turning into suggestion rules — e.g. it notices `G5.5` / `G1.2` prefixes map to `input_level_dbu`, or that a filename segment always matches `gear_model`. Would need a clear review/confirm step before any rules are committed.
