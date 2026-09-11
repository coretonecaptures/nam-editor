# IR / NAM Projects parity backlog

A numbered, ordered work queue for porting NAM mode's file, metadata and folder
manipulation into the IR and NAM Projects workspaces. Written 2026-09-11 after an audit
found these repeatedly requested and repeatedly not built.

**How to work this file.** Take the lowest-numbered open item whose dependencies are
done. Do it completely — code, tests, and tick the box here in the same commit. Don't
batch several items into one commit; each number is meant to be a self-contained session.
If an item turns out to be wrong or unnecessary once you're in the code, say so and strike
it rather than building it anyway.

---

## Why this didn't just happen when asked

Worth stating, because it explains why "port the file operations" kept stalling and why
item 1 is a foundation item rather than a thin wrapper.

NAM mode's file operations are **catalog-unaware** and can afford to be. `file:rename`,
`file:move`, `file:trash` and `file:copy` touch the disk and nothing else; NAM mode's view
of a folder is re-derived by scanning it. IR mode's view is a **SQLite catalog** where
every item is a row with a stable UUID carrying ratings, favourites, tags, tray
membership, resolved metadata and FTS index entries. Calling `file:rename` from IR mode
would rename the file on disk and leave the row pointing at a path that no longer exists —
the item goes `missing_since`, and on the next scan it comes back as a *brand-new* row with
a fresh UUID and none of its ratings, tags or group membership.

So the port is not "call the existing IPC from a new menu". Every disk mutation in IR mode
has to move the catalog row in the same transaction. That is item 1, and items 2–6 are
thin once it exists.

`irCatalog/reconciliation.ts` already solves the *external* case — a file moved behind the
app's back is re-matched by content hash and merged back onto its original row, preserving
everything. It is the safety net, not the mechanism: in-app operations should never need a
rescan to stay consistent.

---

## Phase 1 — the write foundation

### 1. Catalog-transactional file operations layer
**Status:** ✅ done 2026-09-11 · **Size:** M · **Depends on:** nothing

`irCatalog/fileOps.ts` — `renameItem`, `moveItems`, `trashItems`, `copyItems`, plus
`ensureDestinationFolder` (walks/creates a folder path top-down, same upsert shape the scanner's
own `insertFolder` uses). Disk operation first, then an `UPDATE`-in-place on the item row — never
delete+reinsert, so id/rating/favourite/tags/tray/`ir_item` survive automatically (all keyed by
`item.id`, which never changes) and FTS stays in sync via the existing `item_search_au` trigger
with zero extra code. A DB failure after a successful disk op attempts a best-effort rollback.
Cross-library-root moves/copies are refused. Trash removes the catalog row outright (not
`missing_since` — the user asked for it to go) and reuses `deleteWithFallback`, pulled out of
`main/index.ts` into a new side-effect-free `trashFile.ts` so `fileOps.ts` doesn't import the
Electron entry point (which would re-run its `app.whenReady()` startup on import).

9 unit tests in `fileOps.test.ts` (rename-in-place preserving identity, refuse-existing-
destination, move-to-new-folder, move-to-existing-folder reuses the row, trash, copy with a new
id, disk-succeeds-DB-fails rollback, refuse on `missing_since`, refuse cross-root) — couldn't be
run locally (this dev machine's `node:sqlite` lacks FTS5, same gap affecting ~15 other test files
per the 2026-09-02 handoff doc) but typecheck clean and reviewed carefully given this is the
foundation everything else depends on.

New `src/main/irCatalog/fileOps.ts` exposing `renameItem`, `moveItems`, `trashItems`,
`copyItems`. Each performs the disk operation and the catalog update as one unit:

- update `item.relative_path`, and `item.folder_id` when the parent changes
- create any missing `folder` rows for a new destination, top-down, same as the scanner
- preserve the item `id` and everything keyed to it — rating, favourite, tags, tray, notes,
  `ir_item` / `nam_capture_item` rows, FTS entries
- roll back the DB write if the disk operation throws, and vice versa where recoverable
- call the existing `suppressWatcher()` so the change doesn't bounce back as a folder event
- refuse to operate on an item whose `missing_since` is set, or where the destination
  already holds a file of that name unless `force` is passed

**Done when:** unit tests cover rename-in-place, move-to-new-folder, move-to-existing-folder,
trash, copy, name collision, and disk-failure rollback — and each asserts that a rating and
a tag set before the operation survive it.

### 2. IPC + preload surface for item file operations
**Status:** ✅ done 2026-09-11 · **Size:** S · **Depends on:** 1

`irLibrary:renameItem`, `irLibrary:moveItems`, `irLibrary:trashItems`, `irLibrary:copyItems`,
`irLibrary:ensureDestinationFolder` in `irLibraryIpc.ts`, typed through preload and mirrored in
`App.tsx`'s global `Window.api` augmentation (that file, not preload's own inferred type, is what
`window.api` actually resolves to app-wide — see the isMac regression this session hit for why
that matters). Destination path validation turned out to need no extra code: a destination is
always a `folder.id` already scoped to a real `library_root` by construction (from the catalog, or
newly created via `ensureDestinationFolder`, which itself only ever creates rows under a given
`libraryRootId`) — there's no way to pass an arbitrary filesystem path in, so `fileOps.ts`'s
existing cross-root check is the only guard needed.

**Done when:** `window.api` exposes all four with real types and a bad destination is refused. ✅

---

## Phase 2 — file operations in IR mode

### 3. Rename a single IR
**Status:** ✅ done 2026-09-11 · **Size:** S · **Depends on:** 2

Context menu "Rename…" plus `F2` on the focused row (list view only for this pass — the grid/
`DataGrid` view doesn't get inline rename yet). Extension preserved, not editable, matching NAM
mode's own rename convention. On a name collision the input stays open with an inline error and an
"Overwrite" action that retries with `force`. On success the cached row is patched in place
(`relative_path`/`display_name`) rather than a full refetch — same "the row IS the truth" approach
the favourite/rating toggles already use — so it never needs a rescan to reflect immediately.

**Done when:** renaming a rated, tagged, trayed IR keeps all three, and the row updates
without a rescan. ✅ (patches the cache directly; `fileOps.ts`'s `UPDATE`-in-place from item 1
means the catalog side was already correct — this just needed the UI to not force a reload)

### 4. Move IRs to a folder
**Status:** open · **Size:** M · **Depends on:** 2

Multi-select aware. Two entry points: a "Move to…" menu item opening the folder tree in a
picker, and drag-and-drop onto the existing `IrFolderTree`. Moving into a folder that has
its own `folder_metadata` must re-resolve the item's effective metadata afterwards.

**Done when:** a multi-select move lands every file, the tree counts update, and inherited
metadata reflects the new parent.

### 5. Trash IRs
**Status:** open · **Size:** S · **Depends on:** 2

Multi-select, OS trash (never a hard delete), confirmation naming the count. Decide and
document one behaviour: the row is removed from the catalog outright. Do not leave it as
`missing_since` — the user asked for it to go.

**Done when:** trashed files leave both disk and catalog, and the operation is undoable from
the OS trash.

### 6. Batch rename with a template
**Status:** open · **Size:** M · **Depends on:** 3

Port the `BatchRenameModal.tsx` interaction, not the file. NAM's token vocabulary is wrong
here — IR tokens are `{manufacturer} {cabinet} {speaker} {microphone} {position} {rate}
{depth} {index}`, sourced from the resolved metadata the catalog already holds. Live preview
of the first few results, collision detection across the whole batch before anything runs.

**Done when:** renaming 200 IRs by template completes in one transaction, previews correctly,
and refuses the batch if any two results collide.

---

## Phase 3 — metadata editing in IR mode

### 7. Per-item metadata editor
**Status:** open · **Size:** M · **Depends on:** nothing

The biggest single gap: metadata can be set on a folder and inherited, but a single IR whose
mic was mis-parsed cannot be corrected. Add an editable panel for the focused item writing at
`user_entered`.

The write rules already exist — `fieldConfidence.ts` ranks `ir_lab_native` (1) above
vendor documentation (3), and treats `user_entered` as sticky: nothing automated ever
overwrites it. Only the UI is missing.

**Done when:** editing a parser-derived field sticks through a full rescan, and the field
shows its source.

### 8. Provenance badges on item fields
**Status:** open · **Size:** S · **Depends on:** 7

Show where each value came from — IR Lab native, embedded `bext`, vendor doc, parser, or
the user — and let the user clear an override back to the inherited value. Flagged in TODO
as a known gap from the §12f pass.

**Done when:** every displayed metadata field carries its source, and clearing an override
restores the inherited value rather than emptying the field.

### 9. Multi-select batch metadata edit
**Status:** open · **Size:** M · **Depends on:** 7

Port the `BatchEditor` / `MultiSelectEditor` idiom: mixed values shown as such, only
explicitly touched fields written, count of affected items stated before applying.

**Done when:** setting one field across 50 selected IRs leaves their other fields untouched.

### 10. Push an item value up to its folder
**Status:** open · **Size:** S · **Depends on:** 7

"Apply this value to the whole folder" — the inverse of inheritance, and the fast path for
correcting a pack whose parser got one field wrong everywhere.

**Done when:** promoting a value writes one `folder_metadata` row and drops the now-redundant
per-item overrides.

---

## Phase 4 — folder manipulation in IR mode

### 11. Create, rename and delete folders in the IR tree
**Status:** open · **Size:** M · **Depends on:** 1

Catalog-aware, cascading to descendant `relative_path` values in the same transaction.
Deleting a non-empty folder must be explicit about how many items go with it.

**Done when:** renaming a folder three levels up leaves every descendant item resolvable.

### 12. Library Cleanup / Build Library for IR
**Status:** open · **Size:** L · **Depends on:** 4, 11

The IR equivalent of NAM's `LibraryCleanupModal` — restructure a messy library into a chosen
shape, driven by resolved catalog metadata rather than filename parsing at the point of use.
Structures worth offering: `manufacturer / cabinet / mic`, `cabinet / mic / position`, and
flat-with-template-names. Copy-vs-move, dry-run preview with counts, and the destination-root
rule NAM mode already enforces.

**Done when:** a preview reports exactly what will move where, and executing it matches the
preview on a real multi-vendor library.

### 13. Watch IR roots
**Status:** open · **Size:** M · **Depends on:** nothing

`library_root.watch_mode` exists with a `'manual' | 'watched'` CHECK constraint and nothing
reads it. Bind a watcher to roots marked `watched`, debounced, running an incremental scan of
the changed subtree rather than the whole root. This is what makes an IR Lab "finished
exports" folder appear without a manual Rescan — called out by name in the build plan §4.

**Done when:** dropping a WAV into a watched root makes it appear in the list without user
action, and the watcher survives a root going temporarily offline.

---

## Phase 5 — NAM Projects

### 14. Project-level metadata cascade
**Status:** open · **Size:** M · **Depends on:** nothing

Every capture in a project shares an amp, cab, room and modeller. Today each is set per
capture by hand, while IR mode one directory over has a complete inheritance system with a
resolved-and-cached effective table. Reuse `folder_metadata` / `folder_metadata_effective`
rather than building a second mechanism.

**Done when:** setting the amp once on a project fills it for every capture that hasn't
overridden it, and a per-capture override wins.

### 15. Capture rename
**Status:** open · **Size:** M · **Depends on:** 1 · **Needs IR Lab coordination**

A capture is not one file. Renaming it means the WAV, its `nam-capture.json` sidecar, any
`nam-lab-result.json`, and the `captureIndex` entry in IR Lab's `project.json` — which this
app does not own. **Do not build this until the IR Lab side has been checked**: either IR Lab
tolerates a renamed `outputFileName` and re-resolves by `captureId`, or NAM Lab must rewrite
`project.json`, which needs agreement across repos.

**Done when:** a renamed capture still opens correctly in IR Lab, verified against the real app
— not assumed.

### 16. Build a pack from a finished project
**Status:** open · **Size:** L · **Depends on:** 14

A completed NAM Project is exactly a pack's worth of models, and NAM Lab already has the whole
release pipeline — Pack Info, cover art, read-me, checklists, delivery targets, PDF and
spreadsheet export. There is no path from one to the other. Add "Build pack from project",
seeding Pack Info from the project's own metadata.

**Done when:** a trained project produces a pack folder with populated Pack Info and an export
sheet, with no retyping.

### Not doing: moving captures between projects
IR Lab owns project structure on disk. Reorganising captures across projects from here would
desynchronise `project.json` for no real gain. Reveal-in-Explorer stays the answer.

---

## Phase 6 — bulk in / out

### 17. Duplicate detection over content hash
**Status:** ✅ done 2026-09-11 · **Size:** S · **Depends on:** nothing

New `irCatalog/duplicates.ts` (`findDuplicates`, 5 unit tests in `duplicates.test.ts`) groups by
`item.content_hash`, ranked by metadata completeness so the richest copy is suggested as the
keeper. `IrDuplicatesModal.tsx`, opened from a new "Duplicates" button in the IR mode header.
Report-only for now: the only removal action is the existing catalog-only
`removeItemFromCatalog`, labeled explicitly as not touching the file — real disk-trash for the
extras is the natural first use of item 1/5 once built, not duplicated here ahead of it.

`item.quick_hash` and `item.content_hash` are already computed and stored; nothing reads them
for this. Group by `content_hash`, report duplicate sets with reclaimable bytes, and offer to
trash all but one — keeping the copy with the richest metadata, not an arbitrary one.

**Done when:** a real library reports its duplicate sets with a correct reclaimable total.

### 18. Spreadsheet export of the IR catalog
**Status:** open · **Size:** S · **Depends on:** nothing

NAM mode exports to Excel; the catalog — the one with rows genuinely worth exporting — does
not. Export current scope or current selection, columns matching the visible grid.

**Done when:** exporting a filtered view produces exactly the filtered rows.

### 19. Spreadsheet import for bulk metadata
**Status:** open · **Size:** M · **Depends on:** 7, 18

Round-trip the export: edit in Excel, import back, write at `user_entered` with a diff preview
before anything is applied.

**Done when:** a round-trip with three edited cells changes exactly three fields.

### 20. Metadata suggestion rules for IR filenames
**Status:** open · **Size:** L · **Depends on:** 7

Vendor parsers are hardcoded. NAM mode has a full user-facing rule engine — rule library,
build-from-example, match sources, overwrite policy. Porting it gives users a way to teach the
app a vendor it has never seen, which no amount of built-in parsers achieves.

**Done when:** a user can build a rule from one example filename and apply it across a pack.

---

## Interleaving with the integration work

These sit outside parity but are cheap and sequence naturally alongside — full detail in the
2026-09-11 IR Lab Integration Audit.

- **I1. Wire the `session` and `project` handoff routes.** ✅ Done 2026-09-11 —
  `capture_id` added to the IR query row (`queryLibrary.ts`, plumbed through preload/App.tsx's
  `window.api` types), two new IPC handlers (`irLibrary:sendSessionToIrLab`,
  `irLibrary:sendProjectToIrLab`) beside the existing `sendTrayToIrLab`. IR mode: "Open in IR Lab"
  in the row context menu (disabled when the row has no `capture_id` or the connector isn't
  configured). NAM Projects: "Open capture in IR Lab" / "Open project in IR Lab" buttons in
  `CaptureDetailPanel`'s Provenance section and `ProjectHeader` respectively — `projectId` was
  already on `NamProjectDetail` (`shared/namProjects.ts`), just never had a caller.
- **I2. Pre-flight the blend allowlist.** ✅ Done 2026-09-11 — new `irLabRoots.ts` reads IR
  Lab's own `<appData>/IR Lab/live-audition-settings.json` (same `userApplicationDataDirectory`
  IR Lab's `LiveAuditionSettingsStore::storeFile()` resolves to) for its three configured
  folders, and `sendTrayToIrLab` checks every tray item against them before firing the handoff.
  All-or-nothing: any item outside the allowlist blocks the whole send with a reason explaining
  which items and why, surfaced through the existing `IrTray` error slot — no renderer change
  needed. 13 unit tests in `irLabRoots.test.ts`. Read-only; never writes IR Lab's config.
  Becomes more urgent with I3.
- **I3. Player group handoff.** Send a curated NAM Lab group to IR Lab Player as a cycling
  set. Too large for a URL — write a manifest and pass its path. The primary free-to-paid
  bridge, and the reason I2 matters.
- **I4 / C1. Player in NAM Projects.** ✅ Done 2026-09-11 — trained model gets a real "Play"
  button in the capture detail panel (`ModelFileLink`), loading it through `loadNamFileForPlayback`
  and opening the existing `PlayerPanel` as a full-viewport overlay (it's a real instrument — FX
  rig, presets, live tab — so it needs guaranteed full space, not a slot in the 320px detail rail).
  DI and return get a lightweight `<audio>` preview (new `WavPreviewPlayer.tsx`) reading bytes
  through the existing unrestricted `file:readBinary` IPC into a blob: URL — `local-file://` was
  deliberately hardened to image extensions only (S1), so this reads bytes instead of pointing at
  that protocol.
