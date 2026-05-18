# TODO

## Packaging and release

- App icon files for Windows and macOS (`.ico` / `.icns`)
- Code signing and notarization

## Pack Info and export

- Pack Info export markdown: add support for indented / nested bullet lists in the PDF export parser
- Pack Info `Copy to...`
- Pack export print page-break improvements
- Pack export subfolder filter
- Pack export body text size and footer text size controls
- Add selection-based spreadsheet export from the file list and grid, e.g. right-click selected rows -> `Export these to Excel`, so small ad hoc subsets do not require a separate filter or folder.

## Library and file management

- Per-capture images
- OS `Open folder in NAM Lab`
- Append to comments (batch)
- Unify list-view filter clear buttons
- High priority: when moving duplicates, let the user choose the destination folder at move time instead of always using the root `_Duplicates` folder

## Import and performance

- Blank xlsx import template with lookup dropdowns
- Large collection / network share load performance: add mtime cache
- Speed up the list sort/filter toolbar by memoizing expensive `FileList` derived work (`filtered`, `sorted`, duplicate counts, preset detection, and related summary counts)
- Tone3000 search follow-up: if the API stays limited, explore a bounded multi-page fetch/cache strategy for narrow searches, favorites, or creator-focused browsing without trying to mirror the full catalog locally.

## Grid and UI

- Metadata header path display: consider a second muted/grey full-path presentation or alternate layout that shows more of the real file path without stealing too much editor real estate.

## Checklist and release workflow

- Checklist row sync button is tiny and too far away
- Add a `Sync All` action for checklist rows
- Pack metadata cover image: add adjustable framing / zoom window for `ampcover.*`

## Folder watch

- Add a manual `Resync from watch source` action for a watch rule
- Add a manual `Forget imported history` action for a watch rule

## Experimental training

- Training comparison test: run the same capture through a full `1000 epoch REVxSTD` build in both NAM-BOT and NAM Lab, then compare the resulting `.nam` files directly and also do a listening check to confirm they sound the same (or understand why they do not).
- Training queue controls/icons: replace the temporary plain-text queue controls (`^`, `v`, `x`) with nicer stable icons/SVGs that cannot regress into mojibake.
- Training panel layout: do a dedicated neatening pass on the Training section so Run WAVs / Run Folder / Queue, routing, and custom controls use space more gracefully and read more cleanly.
- Training custom-run UX: make `Save as Preset` actually work end to end by prompting for a preset name and saving the recipe into the preset library.
- Training queue controls: move `Start queue` to the right side of the queue action row and style it as a more obvious success / go action.
- Training queue styling: add a little more row/border contrast so adjacent queue items are easier to distinguish at a glance.
- Training history actions: right-click history rows to reveal useful artifacts when available, including the promoted `.png` graph, the processed/source `.wav`, and the final `.nam` (or its containing folder if the file no longer exists).
- Training watch presets: support more than one preset per watch folder, so one watched source can fan out into multiple training recipes such as `REVxSTD 1000 epoch` and `Standard 500 epoch`.
- Queue UX: support drag-and-drop queue reordering in addition to move up / move down controls.
- Queue grouping: add an optional higher-level batch/session grouping so captures queued from `Run WAVs`, `Run Folder`, or future watcher intake can still appear in one serial queue while showing which submission they came from.
- Training presets: expand the first-pass NAM Lab-owned presets into saved or importable recipe definitions so we do not rely on locally customized `core.py` architectures for formats like `complex`, `revyhi`, `revxstd`, and future custom variants.
- Training presets: support saved manual-launch presets as an alternative to watch-folder presets, so a user can open a folder to process, pick a saved setup (epochs, selected architectures, ESR target, and related training options), and run it without going through the watcher workflow.
- Training ESR target: build on the first-pass `threshold_esr` support with clearer guidance, preset defaults, and queue-level visibility for stop-when-good-enough behavior.
- Training history: persist processed training runs, with a way to review and export them later instead of keeping queue state only in memory.
- Training watcher intake: maybe later, if the final expected output file is missing, allow reprocessing even when matching history already exists.
- Training verification report: scan a folder of WAVs / trained models and verify expected outputs, ESR targets, epochs, and architectures against watch or preset expectations.
- Training workflow: consider a higher-level `job / batch` concept later, so one queued item can represent a multi-format set while watcher mode remains a separate automation layer.
- Training workspace isolation: give each capture/format run its own internal work folder for Lightning logs, checkpoints, and graphs, then promote only the final user-facing assets back to the chosen destination.
- Training history: reflect the same WAV / Folder Run / Watcher batch grouping concept that the live queue uses, so history is easier to scan by submission instead of reading every item as one long flat list.
- Training settings IA: move experimental training settings into their own dedicated Settings tab once watcher folders, presets, history, and verification need more room than the general Settings page can comfortably give them.
- Settings IA: split Settings into tab-like sections such as `Training`, `Global`, `Metadata`, `Capture Defaults`, and related groupings so the growing watch / preset / checklist / metadata surface does not all compete in one long page.
- Settings disclosure UX: replace the repeated `Show ...` / `Hide ...` buttons for editable lists (folder watch rules, training presets, watch folders, etc.) with a cleaner UI pattern so these sections feel less clunky to open and manage.

## Metadata suggestions and organization

- Refine overwrite guards for metadata suggestion rules with a friendlier UI than a raw comma-separated text field (for example chips, multi-pick placeholders, or explicit junk-value presets).
- Expand friendly pattern-rule support beyond the first-pass `Prefix + value` matcher for settings strings like `G5.5`, `G1.2`, `G8`.
- Phase II / discussion: support broader wildcard or regex-style suggestion rules for patterned metadata tokens where one rule should recognize a family of values without requiring a separate exact-token rule for every variant.
- Discussion: explore reverse-template / pattern-based rules that extract metadata from naming structures (for example something in the spirit of `{tone_type} {creator} {cabinet}`) without requiring users to understand regex.
- Design a safe explicit-source workflow to collect `.nam` files from user-chosen intake folders into a working folder, without trying to automatically infer which existing folders are "loose" versus valid staging/archive/release locations.
- Investigate a safe "build logical folder structure from existing metadata" helper: preview-only first, because auto-restructuring by amp / cab / combo / settings could be powerful but dangerous if metadata is incomplete or wrong.
