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

## Grid and UI

## Checklist and release workflow

- Checklist row sync button is tiny and too far away
- Add a `Sync All` action for checklist rows
- Pack metadata cover image: add adjustable framing / zoom window for `ampcover.*`
- Add target-specific checklists for Delivery Targets (`ToneX`, `Proxy`, `QC`) so release steps can differ per platform while still allowing shared/base checklist content where useful. First pass: keep the current base checklist, add optional per-target checklist overrides, and surface target checklist status in the `Targets` tab before deciding whether it also belongs in the main dashboard.

## Folder watch

- Add a manual `Resync from watch source` action for a watch rule
- Add a manual `Forget imported history` action for a watch rule
