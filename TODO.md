# TODO

## Packaging and release

- App icon files for Windows and macOS (`.ico` / `.icns`)
- Code signing and notarization

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
- High priority: when moving duplicates, let the user choose the destination folder at move time instead of always using the root `_Duplicates` folder

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

## Experimental training

- Training panel container usage: reduce the forced-feeling outer padding / dead margins so the trainer uses more of its available width and height, especially as the panel is resized.
- Training entry-point cleanup (partially done): standalone Training workspace exists and is the main surface now; finish retiring or simplifying the old file-level `Metadata | Training` pairing so metadata stays the file editor surface and Training lives as its own standalone workspace/tool.
- Training comparison test: run the same capture through a full `1000 epoch REVxSTD` build in both NAM-BOT and NAM Lab, then compare the resulting `.nam` files directly and also do a listening check to confirm they sound the same (or understand why they do not).
- Training queue controls/icons: replace the temporary plain-text queue controls (`^`, `v`, `x`) with nicer stable icons/SVGs that cannot regress into mojibake.
- Training panel layout (partially done): a first cleanup pass happened, but the Training section still needs a dedicated neatening pass so Run WAVs / Run Folder / Queue, routing, and custom controls use space more gracefully and read more cleanly.
- Training architecture picker UX: validate on queue that at least one profile is selected, since the new card grid allows the selection to go empty.
- Training queue status line: fix the green running summary so it reports active/running work accurately (for example, a single active run should not say `Queue Running - 0 queued` in a misleading way).
- Training history graph preview: make `Show graph` open an in-app modal/lightbox that loads the PNG inside NAM Lab instead of only bouncing out to the OS.
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

## Metadata suggestions and organization

- Refine overwrite guards for metadata suggestion rules with a friendlier UI than a raw comma-separated text field (for example chips, multi-pick placeholders, or explicit junk-value presets).
- Expand friendly pattern-rule support beyond the first-pass `Prefix + value` matcher for settings strings like `G5.5`, `G1.2`, `G8`.
- Phase II / discussion: support broader wildcard or regex-style suggestion rules for patterned metadata tokens where one rule should recognize a family of values without requiring a separate exact-token rule for every variant.
- Discussion: explore reverse-template / pattern-based rules that extract metadata from naming structures (for example something in the spirit of `{tone_type} {creator} {cabinet}`) without requiring users to understand regex.
- Design a safe explicit-source workflow to collect `.nam` files from user-chosen intake folders into a working folder, without trying to automatically infer which existing folders are "loose" versus valid staging/archive/release locations.
- Investigate a safe "build logical folder structure from existing metadata" helper: preview-only first, because auto-restructuring by amp / cab / combo / settings could be powerful but dangerous if metadata is incomplete or wrong.
