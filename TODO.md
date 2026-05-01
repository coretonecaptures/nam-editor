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
- Capture file size stats

## Import and performance

- Blank xlsx import template with lookup dropdowns
- Large collection / network share load performance: add mtime cache

## Grid and UI

- Drag-to-reorder grid columns
- Surface pack release status / on-time vs late summary in a dashboard view
## Checklist and release workflow

- Checklist does not make it obvious that changes need to be saved
- Checklist row sync button is tiny and too far away
- Add a `Sync All` action for checklist rows
- Add a Read Me tab next to Gallery that reads README.txt from the current directory into a large read-only text box, requires an explicit edit action, creates the file on save if missing, and notes that readmes are usually only distributed in the root folder but can be stored per folder when needed
- Tighten checklist row layout so a row can fit on one line: move up/down | checkbox | step name | note | right-aligned date | delete | sync
- Move release notes above the checklist items
- Add to the main Overview dashboard a list of all started-but-incomplete pack checklists, grouped by folder path with status
- Add drag-and-drop reordering to the checklist
