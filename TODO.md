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

- In Batch Rename, add a quick helper / hotkey for common cleanup like replacing underscores with spaces, so users do not have to repeatedly type `_` -> ` ` by hand.

## Checklist and release workflow

- Checklist row sync button is tiny and too far away
- Add a `Sync All` action for checklist rows
- Pack metadata cover image: add adjustable framing / zoom window for `ampcover.*`
- Add target-specific checklists for Delivery Targets (`ToneX`, `Proxy`, `QC`) so release steps can differ per platform while still allowing shared/base checklist content where useful. First pass: keep the current base checklist, add optional per-target checklist overrides, and surface target checklist status in the `Targets` tab before deciding whether it also belongs in the main dashboard.

## Folder watch

- Add a manual `Resync from watch source` action for a watch rule
- Add a manual `Forget imported history` action for a watch rule

## Metadata suggestions and organization

- Refine overwrite guards for metadata suggestion rules with a friendlier UI than a raw comma-separated text field (for example chips, multi-pick placeholders, or explicit junk-value presets).
- Expand friendly pattern-rule support beyond the first-pass `Prefix + value` matcher for settings strings like `G5.5`, `G1.2`, `G8`.
- Phase II / discussion: support broader wildcard or regex-style suggestion rules for patterned metadata tokens where one rule should recognize a family of values without requiring a separate exact-token rule for every variant.
- Discussion: explore reverse-template / pattern-based rules that extract metadata from naming structures (for example something in the spirit of `{tone_type} {creator} {cabinet}`) without requiring users to understand regex.
- Design a safe explicit-source workflow to collect `.nam` files from user-chosen intake folders into a working folder, without trying to automatically infer which existing folders are "loose" versus valid staging/archive/release locations.
- Investigate a safe "build logical folder structure from existing metadata" helper: preview-only first, because auto-restructuring by amp / cab / combo / settings could be powerful but dangerous if metadata is incomplete or wrong.
