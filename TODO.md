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

## Checklist and release workflow

- Checklist row sync button is tiny and too far away
- Add a `Sync All` action for checklist rows
- Pack metadata cover image: add adjustable framing / zoom window for `ampcover.*`
- Add target-specific checklists for Delivery Targets (`ToneX`, `Proxy`, `QC`) so release steps can differ per platform while still allowing shared/base checklist content where useful. First pass: keep the current base checklist, add optional per-target checklist overrides, and surface target checklist status in the `Targets` tab before deciding whether it also belongs in the main dashboard.

## Folder watch

- Add a manual `Resync from watch source` action for a watch rule
- Add a manual `Forget imported history` action for a watch rule

## Metadata suggestions and organization

- Expand metadata suggestions beyond global rules: support scoped suggestion sets that can be attached/applied at a selected folder or parent-folder level (for example, fixing many packs from one creator without affecting the whole library).
- Phase II: allow copying/applying suggestion rules from another folder scope, so similar creators/packs can inherit a scoped ruleset without rebuilding it by hand.
- Phase II: build a reusable rule library. Any unique rule created should be saveable into the library, then when starting work on a new folder the user can multi-select rules from that library and apply/copy them into the folder scope.
- Phase II: allow valid scoped rules with a blank token for folder-wide defaults, so a folder scope can set values like `Modeled By` for everything underneath even when no filename/folder token match is needed.
- Phase II: for lookup-backed suggestion fields like `Gear Type` and `Tone Type`, replace free-text "Suggested value" entry with real dropdowns / validated pickers so users do not have to know the stored internal value names.
- Phase II: add per-rule overwrite behavior for metadata suggestions. First pass: `blank only` vs `overwrite existing`. Safer follow-up: optional guard values so a rule only overwrites known junk placeholders (for example `tz-make` / `tz-model`) instead of any non-empty value.
- Phase II / discussion: support wildcard or regex-style suggestion rules for patterned metadata tokens (for example values like `G5.5`, `G1.2`, `G8`) where one rule should recognize a family of setting strings instead of requiring a separate exact-token rule for every variant.
- Add a workflow to consolidate loose `.nam` files from Downloads or scattered folders into a chosen working folder.
- Investigate a safe "build logical folder structure from existing metadata" helper: preview-only first, because auto-restructuring by amp / cab / combo / settings could be powerful but dangerous if metadata is incomplete or wrong.
