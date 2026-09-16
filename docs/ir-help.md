# IR Library Guide

This covers the **IR** section (Ctrl/Cmd+2) — browsing, tagging, and cleaning up a catalog of
impulse response (and reverb) WAV files. For NAM Capture projects handed over from IR Lab, see
**NAM Projects Guide** in the left menu. For the metadata editor and library tools in the main
NAM section, see **Workflow Guide** / **Feature Reference**.

---

## 1. Library roots and folders

- **Add Library Folder** adds a folder as a tracked root — IR Lab drops finished exports into
  folders like this, and NAM Lab indexes everything under it into a searchable catalog.
- The folder tree on the left mirrors the folders on disk under each root. Selecting a folder
  scopes the browse list and search to that folder and its subfolders.
- **Rescan** re-walks a root from scratch, picking up anything added or changed outside the app.
- Right-click a root in the tree to turn on **Watch for Changes** — the app then rescans
  automatically a couple of seconds after anything changes on disk, no manual Rescan needed.
- **All roots** (top-right dropdown) browses everything at once instead of scoping to one root.

## 2. Browsing, search, and facets

- The search box matches mic, speaker, maker, filename, and format all at once.
- The filter bar below it narrows by **Type** (cab vs. reverb), audio **Format**, and **Mic** —
  click a chip to toggle it on, click again to remove it.
- Column headers under **Filter** (Makers, Speakers, Favorites, Rated, Groups) work the same way.
- **Sort** picks the column and direction the list is ordered by.
- Clicking a value on a row itself (manufacturer, speaker, microphone) toggles that as a facet
  filter too — a fast way to narrow to "everything else like this one."

## 3. List view vs. table view

The two icons next to **All roots** switch between:

- **List view** (rows icon) — compact rows with inline favorite/play controls.
- **Table view** (grid icon) — a spreadsheet-style grid with sortable, resizable, reorderable
  columns (drag a column header to reorder; double-click its right edge to autosize). Choose which
  columns are visible from the **Columns** button in its own toolbar.

Both views support the same selection and keyboard shortcuts (below) — pick whichever fits the
task better; table view is usually faster for scanning many fields at once, list view for quick
browsing and play/favorite.

## 4. Selecting multiple items

- **Ctrl/Cmd-click** a row to add or remove it from the selection.
- **Shift-click** a row to select the range from your last plain click.
- **Ctrl/Cmd+A** selects every row currently loaded on screen (not the whole filtered result set —
  a real IR library can be tens of thousands of rows, so this is deliberately bounded to what's
  actually visible/loaded, not "everything matching the filter").
- Selecting exactly one item docks its full metadata in the right panel automatically — no
  right-click needed. Selecting more than one switches that panel to the multi-select editor
  (below).

## 5. Metadata — one item

Select a single IR and its full metadata appears in the right panel: manufacturer, cabinet,
speaker, microphone, position, mic A/B details (type, polar pattern, target zone, distance, axis
angle, signal chain override, notes), reverb details (unit, preset, space type, recommended wet
%/pre-delay), and free-form notes. Edit any field, then **Save** (or **Revert** to discard).

- Every field shows where its current value came from (IR Lab itself, a vendor parser, a filename
  guess, or **you**) — a value you type always wins over anything automated, permanently, until you
  **Clear** it.
- **Clear** on a field reverts to whatever the folder or automation would otherwise supply, rather
  than leaving it blank.
- **Push** applies an item's value to its whole folder as the new folder default, and clears any
  sibling item whose own value was already redundant with it.
- **F2** (or right-click → **Rename…**) renames the file in place — works in both list and table
  view.

## 6. Metadata — multiple items at once

Select more than one IR and the right panel becomes a batch editor with every field one item's
detail panel has. For each field:

- If every selected item already shares the same value, it's shown with an **indigo "shared"**
  badge.
- If they differ, the field shows **"— varies —"** instead of guessing.
- Typing a new value into a field marks it **amber** — only fields you actually touch get written,
  to every selected item, when you click **Apply**.
- **Revert** discards your edits and restores the shared-value view.

## 7. Tags, favorites, ratings, and groups

- Click the star/heart icons on a row (or in the detail panel) to favorite or rate it (1-5 stars).
- The bulk toolbar that appears once you've checked rows offers **★ Favorite** and **Tag…** across
  the whole checked set.
- **Groups** collect specific items into a named set you can filter to later, distinct from a tag —
  useful for building a curated set to hand off to the Player (see below).

## 8. Playing and auditioning

- The play button on a row opens it through **NAM Lab's own player** — the same DI/Live/full-rig
  player NAM mode uses, not a second one — with the IR loaded into the cabinet slot.
- **Play Live** opens straight into the full-screen live rig.
- Pick which amp capture you're auditioning through from the **Amp:** button, top-right.
- **A/B Audition** — select exactly two IRs, then blind-A/B them: it plays one at a time without
  telling you which is which until you reveal it.

## 9. Duplicates and coverage

- **Library → Duplicates…** finds byte-identical IRs across the current scope and suggests which
  copy to keep (the one with the most complete metadata), reporting how much space the extras take.
- **Library → Coverage Planner…** compares a cabinet's mic/position combinations against what other
  cabinets in the library have, surfacing gaps worth capturing.

## 10. Bulk reorganization

- **Library → Batch Rename…** renames every IR in the selected folder from a template using tokens
  like `{manufacturer}`, `{cabinet}`, `{speaker}`, `{microphone}`, `{rate}`, `{depth}`, `{index}` —
  shows a live preview and refuses to run if any two results would collide. The rename is atomic
  across the whole batch: if anything fails partway, every file and catalog entry is rolled back
  to exactly where it started, not left half-renamed.
- **Library → Build Library…** restructures a scope into a new folder layout from the same token
  template language, with a full preview (ready / needs-review / unchanged) before anything moves.

## 11. Import and export

- **Import → Import Lab Projects…** pulls in NAM Capture projects IR Lab handed over (these show
  up in **NAM Projects** mode, not here).
- **Import → Import from Spreadsheet…** round-trips an edited export: pick the file, review the
  diff per item, then apply — a blank cell means "leave alone," never "clear this field."
- **Export…** exports the current filtered view, or just the checked selection, as CSV or Excel.
- **Metadata → Suggest Metadata…** runs your saved filename/folder-path rules against a folder (or
  the whole library) and previews every suggested field before applying any of it.
- **Metadata → Suggestion Rules…** manages those rules — build one from an example filename with
  the live Test panel, which shows immediately whether the rule matches and what it produces.
- **Saved Searches…** stores a named filter/facet combination to re-run later — it re-runs live
  against the catalog as it looks now, not a frozen snapshot of results.

## 12. Embedding metadata into the file itself

The catalog's metadata is fast and complete, but it doesn't travel with a WAV that leaves the
library (copied to a customer, dragged into a DAW project, handed to someone without this app).
**Embed in File…** (single item in the detail panel, or a whole selection in the multi-select
panel) writes cabinet/speaker/microphone/position/notes into the WAV's own header, in the same
format IR Lab itself reads and writes — so it stays readable even outside this catalog. Turn it on
under **Settings → Player → IR Catalog Metadata** first.

## 13. Sending to IR Lab

Right-click an item → **Open in IR Lab** hands its session back to IR Lab directly, when the
connector is configured.
