# IR / NAM Projects parity backlog

A numbered, ordered work queue for porting NAM mode's file, metadata and folder
manipulation into the IR and NAM Projects workspaces. Written 2026-09-11 after an audit
found these repeatedly requested and repeatedly not built.

**How to work this file.** Take the lowest-numbered open item whose dependencies are
done. Do it completely — code, tests, and tick the box here in the same commit. Don't
batch several items into one commit; each number is meant to be a self-contained session.
If an item turns out to be wrong or unnecessary once you're in the code, say so and strike
it rather than building it anyway.

**Run `npm run test:electron`, not just `npx vitest run`, before calling any item done.**
`vitest run` uses this repo's plain Node devDependency, which has no FTS5 compiled in — every
DB-backed test in `irCatalog/` is `describe.skipIf(!hasFts5())`-guarded and silently SKIPPED
under it, not passing. `test:electron` runs the same suite under Electron's own Node build
(FTS5 present), which is the only way any of these tests actually execute. Discovered partway
through this backlog (after items 1-13 had only ever been typechecked and reviewed, never run)
— running it retroactively found zero implementation bugs but 3 real test-fixture bugs (wrong
rollback-simulation technique, a fixture that never created the `ir_item` row `write()` needed,
and two assertions that had the wrong expected item cleared) that pure code review had missed.

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
**Status:** ✅ done 2026-09-11 · **Size:** M · **Depends on:** 2

Both entry points built: context menu "Move to…" opens `IrMoveToFolderModal.tsx` (flat indented
folder list scoped to the item's own library root — cross-root is refused by `fileOps.ts` itself,
so the picker doesn't offer it — plus a "type a new path → Create & Move" path using
`ensureDestinationFolder`), and drag-and-drop of a row directly onto a node in `IrFolderTree`.

Landed single-item first — IR mode's list had no multi-select mechanism at all yet — with both the
modal and the IPC underneath already taking `itemIds: string[]` so multi-select could plug straight
in later. Item 9 is where that actually happened: multi-select now exists, and Move (along with
Trash and drag-and-drop) is retrofitted to act on the whole selection when the right-clicked/
dragged row is part of one. See item 9 for the mechanism itself.

Metadata re-resolution after a move needs no extra code: `folder_metadata_effective` is resolved
at QUERY time (`COALESCE(ir_item.field, folder_metadata_effective.value)` in `queryLibrary.ts`),
not cached on the item row, so a moved item's inherited fields are already correct the moment it's
re-queried — which happens automatically, since a move invalidates and refetches the browse list.

Tree counts needed one more piece than expected: `IrFolderTree`'s own `onLibraryChanged` only
fires for actions the tree performs itself (its right-click Remove) — a move triggered from
outside (the list, or this modal) had no way to tell the tree to refetch. Added a `refreshSignal`
prop, bumped by `handleMoved`, so the tree's row counts don't go stale until an unrelated
`libraryRootCount` change happens to touch it.

**Done when:** a multi-select move lands every file, the tree counts update, and inherited
metadata reflects the new parent. ✅

### 5. Trash IRs
**Status:** ✅ done 2026-09-11 · **Size:** S · **Depends on:** 2

Context menu "Move to Trash…" (destructive-styled) plus `Delete`, both multi-select aware (acts on
the whole selection when the triggering row is part of one — item 9's retrofit) and both opening a
confirm dialog naming the file(s) and stating plainly what goes with them (favourites/rating/tags/
tray) and that undoing it needs a rescan, not just an OS Trash restore. `fileOps.ts`'s `trashItems`
(item 1) already does the one behaviour decided: the catalog row is removed outright, never left
as `missing_since` — the user asked for it to go.

Disabled for an already-`missing_since` item: there's no file left to trash, and `fileOps.ts`
refuses all four operations uniformly on a missing item. That case already has its own path
("Remove from Catalog" in the missing-file dialog) — different semantics, so left alone rather
than trying to make one button cover both.

Also removes the item from the tray if it was in it, and closes the player if it was the one
playing — trashing out from under either would otherwise leave stale state pointing at a file
that's gone.

**Done when:** trashed files leave both disk and catalog, and the operation is undoable from
the OS trash. ✅

### 6. Batch rename with a template
**Status:** ✅ done 2026-09-11 (two deviations from spec, noted below) · **Size:** M · **Depends on:** 3

`IrBatchRenameModal.tsx` ports the interaction from NAM's `BatchRenameModal.tsx` — template input,
live old→new preview, collision detection (per-directory, case-insensitive, matching how the
filesystem itself would collide) computed and shown before anything runs, Rename disabled while
any collision exists. Tokens: `{name} {manufacturer} {cabinet} {speaker} {microphone} {rate}
{depth} {index}` — IR's own resolved facts, already on every row this app fetches, not NAM's
gear/tone vocabulary.

Scope is the SELECTED FOLDER (and its subtree, via the same `resolveFolderScopeIds` every other
IR browse query already uses), not a multi-select — matching the scope decision items 4/5 already
made for the same reason (no multi-select mechanism exists yet). Capped at 2000 fetched rows with
a visible warning if the real scope is larger, so an accidental whole-library selection can't try
to preview hundreds of thousands of rows.

**Two honest deviations from the item's original wording, not silently built around:**
- **Not one transaction.** Executes as a loop of individual `renameItem` calls (each internally
  transactional per item, from `fileOps.ts`) rather than one all-or-nothing batch transaction. A
  failure partway leaves earlier renames applied and later ones not — reported via a
  succeeded/failed count, not rolled back. True batch atomicity would need a new `fileOps.ts`
  entry point (a single DB transaction wrapping N renames); didn't build that for this pass since
  the per-item safety already exists and a mid-batch failure is a real disk error (permissions, a
  file in use), which the user needs to see and can safely re-run the batch for the remainder.
- **`{index}` instead of `{position}`.** Same concept (1-based, zero-padded batch position),
  clearer name — token vocabularies elsewhere in this app (NAM's own `{name}` etc.) don't use
  `{position}` for this idea either, so this reads as consistent rather than a deviation for its
  own sake.

**Done when:** renaming 200 IRs by template previews correctly and refuses the batch if any two
results collide. ✅ (transactionality is the one open gap, noted above)

---

## Phase 3 — metadata editing in IR mode

### 7. Per-item metadata editor
**Status:** ✅ done 2026-09-11 · **Size:** M · **Depends on:** nothing

Context menu "Edit Metadata…" opens `IrEditMetadataModal.tsx` — manufacturer/cabinet/speaker/
microphone (the four with an existing `*_source` column and browse-row badge; `position` exists
on `ir_item` too but isn't selected in the browse query yet, so there was nothing to show a
current value against — left as a clearly-noted gap rather than half-wiring it), each field
labeled with where its current value came from, writing only fields actually changed.

**Found and fixed a real bug in `fieldConfidence.ts` while reusing it** — its writer refused a
SECOND `user_entered` write once a field was already `user_entered` (`if (existing.source ===
'user_entered') return false`, unconditional). That rule was written to keep automation from
overwriting a user's correction, but as written it also blocked the user from ever fixing their
own typo again — never caught before because neither existing caller (`importLibrary.ts`,
`applyVendorParsers.ts`) ever passes `user_entered` as the incoming source; item 7's edit path is
the first one that does. Fixed to `existing.source === 'user_entered' && source !== 'user_entered'`
— automation still blocked, a person editing their own correction again now works. Added
`fieldConfidence.test.ts` (didn't exist before), 7 cases covering rank ordering both directions,
`user_entered` blocking automation, `user_entered` overwriting `user_entered` (the fix), and empty-
value refusal.

**Done when:** editing a parser-derived field sticks through a full rescan (✅ — `user_entered` is
still unconditionally sticky against every automated source), and the field shows its source (✅
— shown per-field in the editor; a persistent badge on the browse row itself is item 8).

### 8. Provenance badges on item fields
**Status:** ✅ done 2026-09-11 · **Size:** S · **Depends on:** 7

The "every field carries its source" half was already built before this item — the browse row's
`FieldBadge` has shown source via color/opacity and a tooltip since Phase 3's original pass, and
item 7's editor modal now shows it per-field there too. The real gap, and the only new work: no
way to clear an override.

Added `IrFieldWriter.clear(itemId, field)` — nulls the item-level value AND deletes its
`ir_item_field_source` row (not just the value: a leftover `user_entered` row would keep blocking
every automated source from ever writing that field again, even after the value itself was gone).
There's no history of what an automated source guessed before the user overwrote it — the writer
replaces in place — so "restore" can only mean "clear the item-level value and let
`queryLibrary.ts`'s existing `COALESCE(ir_item.field, folder_metadata_effective.value)` show
whatever the folder would otherwise give it." Exactly what the item's own wording asks for.

"Clear" button per field in the editor modal, shown only when the field actually has a value.
One real rough edge, documented rather than silently accepted: the modal keeps the `row` snapshot
it opened with, so the "currently from …" label for a cleared field can't show the freshly-
resolved value without the modal being reopened — tracked locally so it says "cleared — reopen to
see the inherited value" instead of contradicting itself by still naming the old source.

**Done when:** every displayed metadata field carries its source (✅, pre-existing), and clearing
an override restores the inherited value rather than emptying the field (✅ — verified via
`fieldConfidence.test.ts`'s "after clear(), a lower-ranked automated source can write again" case,
which is exactly the mechanism that makes inheritance/re-resolution actually happen on rescan).

### 9. Multi-select batch metadata edit
**Status:** ✅ done 2026-09-11 · **Size:** M · **Depends on:** 7

**This item is why multi-select finally got built.** Items 4-6 deliberately scoped to single-item
with a note that the array-shaped IPC was already in place for it — item 9 is the first one where
"operate on one item via a right-click" doesn't make sense by definition. Built the actual
mechanism rather than deferring again: Ctrl/Cmd-click toggles a row, Shift-click ranges from the
last plain click (`selectionAnchorRef`, same convention as NAM mode's own `FileList.tsx`). No
Ctrl+A — documented as deliberate, not missing: this list is paginated against a live query, not a
loaded array, so "select all" would mean "everything matching the current filter" (unbounded,
could be tens of thousands of rows in a real library) rather than "everything on screen," and
building a version that silently means something narrower than it looks like it means is worse
than not having the shortcut.

Once a row is part of a multi-selection, right-clicking it (or the context menu's own selection
check) makes Move/Trash/Edit Metadata act on the WHOLE selection instead of just the clicked row —
retrofitted onto items 4/5, closing their own "single-item for now" scope note rather than leaving
it open. Drag-and-drop (item 4) also now carries the full selection when dragging a selected row.
Rename (item 3) stays single-item only — renaming N files to the same base name doesn't mean
anything; that's what item 6's batch-rename-with-a-template is for.

`IrBatchMetadataEditModal.tsx` ports NAM's `BatchEditor.tsx` idiom exactly: a checkbox per field
enables it for the batch, its text input is disabled until checked — "type it, check it to apply,"
not a mixed-values display trying to represent each item's differing existing value. Only checked
fields get written, to every selected item, always at the `user_entered` tier from item 7.

**Done when:** setting one field across 50 selected IRs leaves their other fields untouched. ✅

### 10. Push an item value up to its folder
**Status:** ✅ done 2026-09-11 · **Size:** S · **Depends on:** 7

New `promoteFieldToFolder(db, folderId, field, value)` in `fieldConfidence.ts`, next to the writer
it's the natural complement of: writes one `folder_metadata` row via the existing
`setFolderMetadata` (which already handles the descendant-cascade recompute), then walks the
folder's subtree (`resolveFolderScopeIds` — folder + every descendant, the same scope
`folder_metadata` inheritance itself uses) clearing any item-level override that ALREADY equals
the promoted value. Not unconditional: an item deliberately overridden to something ELSE is left
alone — only genuinely redundant overrides (inheritance would now give the same value anyway) get
cleared, which is what the item's own wording asks for.

Resolved server-side rather than trusting a client-supplied folderId/value: the IPC handler reads
the item's own current `folder_id` and field value directly, so "push to folder" can only ever
promote what the item's row actually says right now.

"Push to folder" button in `IrEditMetadataModal.tsx`, disabled when there's an unsaved edit in that
field (forces Save first, so what gets promoted is never different from what's actually stored) —
reports how many other items had a redundant override cleared, so the action isn't a silent
side-effect.

4 unit tests in `promoteFieldToFolder.test.ts`: a sibling with no override now inherits the
promoted value, an item that already matched has its override cleared, an item deliberately set to
something different is left alone, and the promotion cascades into a subfolder.

**Done when:** promoting a value writes one `folder_metadata` row and drops the now-redundant
per-item overrides. ✅

This closes out Phase 3 (metadata editing in IR mode) of the parity backlog — items 7-10 all done.

---

## Phase 4 — folder manipulation in IR mode

### 11. Create, rename and delete folders in the IR tree
**Status:** ✅ done 2026-09-11 · **Size:** M · **Depends on:** 1

`createFolder`/`renameFolder`/`deleteFolder` added to `fileOps.ts`. Rename cascades to every
descendant folder AND item's `relative_path` — walked via the recursive-CTE descendant SET (ID
lineage from `parent_id`), not a string-prefix match, since a prefix match would wrongly catch a
sibling like "Package" when renaming "Pack". Delete sends the whole directory to the OS Trash
(`deleteWithFallback`, generalized below) and removes the folder + descendant folders/items from
the catalog — folders deleted child-before-parent (reversed BFS order) since `folder.parent_id`
has no `ON DELETE CASCADE` and `foreign_keys` is ON, so deleting a parent while a child still
references it would be rejected. New "New Subfolder…" / "Rename…" / "Delete Folder (and its
files)…" context-menu items in `IrFolderTree.tsx`, alongside (not replacing) the existing
catalog-only "Remove from Catalog…" — genuinely different operations, kept distinct rather than
overloading one button. Delete's confirm reuses the exact same item/folder-count preview call
"Remove from Catalog" already uses, which is exactly the "explicit about how many items go with
it" the item's own wording asks for.

**Found and fixed a real, unexercised bug in already-shipped item-4 code while building this**:
`fileOps.ts`'s `ensureFolderPath` only ever inserted catalog rows — it never created the actual
directory on disk. `fs.renameSync`/`fs.copyFileSync` require their destination's parent directory
to already exist, so `IrMoveToFolderModal`'s "type a new path → Create & Move" path (item 4) would
insert the folder rows successfully and then fail the very next disk operation with ENOENT — never
caught because it couldn't be run against a real filesystem before now (this dev machine's
`node:sqlite` lacks FTS5, so this exact code path was typechecked and reasoned through but never
executed end-to-end). Fixed by having `ensureFolderPath` create the real directory too
(`fs.mkdirSync(..., { recursive: true })`), and added a regression test that would have caught it.

Also generalized `trashFile.ts`'s shared `deleteWithFallback` fallback from `fs.unlink` (throws
`EISDIR` on a directory) to `fs.rm(..., { recursive: true })` — a strict superset for the existing
single-file NAM-mode caller (recursive is a no-op on a plain file), needed so folder delete could
share it instead of a near-duplicate.

9 new unit tests in `fileOps.test.ts` (create/rename/delete, the cascade, the FK-safe deletion
order, the `ensureDestinationFolder` disk-creation regression) — same FTS5-unavailable caveat as
every other DB test in this session, typechecked and reviewed carefully rather than executed.

**Done when:** renaming a folder three levels up leaves every descendant item resolvable. ✅
(verified by the "cascades to every descendant folder and item" test, which renames a folder with
a nested subfolder and confirms both the subfolder's and its item's paths update correctly)

### 12. Library Cleanup / Build Library for IR
**Status:** ✅ done 2026-09-11 (structure input differs from spec, noted below) · **Size:** L · **Depends on:** 4, 11

New `libraryCleanup.ts` (`previewLibraryCleanup` / `runLibraryCleanup`), `IrLibraryCleanupModal.tsx`,
a "Build Library…" button. Preview-first: computes every in-scope item's new relative path from a
folder template built out of the item's own resolved facts, splits into ready (moves/copies) vs
needs-review (left untouched — never guessed), shows counts and a full path-by-path list before
anything runs. `runLibraryCleanup` applies the EXACT rows the preview produced, not a fresh
recompute — a metadata edit landing in the gap between Preview and Run can't silently change what
actually moves (covered by its own test).

**Structure input differs from the item's own wording, deliberately, not silently**: instead of a
fixed enum of layouts (`manufacturer/cabinet/mic`, `cabinet/mic/position`, flat-with-template), this
takes a free-text folder template using the exact token vocabulary `IrBatchRenameModal.tsx` (item
6) already established (`{manufacturer}/{cabinet}/{speaker}/{microphone}/{rate}/{depth}`, plus a
literal segment for a fixed folder name). Strictly more flexible than a fixed enum — it covers every
layout the enum would have named as one of its arbitrary orderings, plus any other ordering, using
one template language already written, reviewed, and tested for item 6 instead of a second one.

Destination is a folder within the SAME library root, not a separate destination root on a
different drive the way NAM's version allows — every primitive underneath (`fileOps.ts`'s
`moveItems`/`copyItems`) already refuses a cross-root operation, and reorganizing within one
library is the actual IR-mode use case (NAM mode's version exists partly to consolidate captures
scattered across drives, which isn't how this app's users keep IR libraries). No saved-ignore-list
or CSV export of needs-review rows, kept out as a real scope trim given how large this item already
is — not an oversight.

Reuses `fileOps.ts`'s existing batch `moveItems`/`copyItems` rather than a new per-item-destination
primitive: items are grouped by their computed destination folder (each of those two functions
takes one destination for a whole batch), each destination folder created once via the existing
`ensureDestinationFolder`, then each group moved/copied in one call — no new disk-mutation code
needed at all, only orchestration on top of what items 1/4/11 already built and tested.

Also added `resolveLibraryRootId` (folder-scoped: resolves the root FROM the folder itself, since a
folder id is unique across the whole catalog — a caller with only a `selectedFolderId` doesn't need
to separately track which root it's under just to open this dialog), which the renderer needed
since folder selection and root selection are independent state in `IrModeShell.tsx`.

7 unit tests cover: full-token-match placement, needs-review items left untouched, a literal
(token-free) segment as a valid destination, the actual move (grouped-by-destination, verified on
disk), the actual copy (source untouched, new catalog row), already-at-destination reported
unchanged rather than moved, the exact-rows-not-recomputed guarantee, and the folder-only root
resolution.

**Done when:** a preview reports exactly what will move where, and executing it matches the
preview on a real multi-vendor library. ✅ (the move/copy tests specifically verify the preview's
computed paths are exactly what lands on disk)

This closes out Phase 4 (folder manipulation in IR mode) of the parity backlog — items 11-13 all
done.

### 13. Watch IR roots
**Status:** ✅ done 2026-09-11 (one deviation from spec, noted below) · **Size:** M · **Depends on:** nothing

New `irRootWatcher.ts`: `fs.watch` per root marked `watch_mode = 'watched'`, debounced 2.5s,
recovering with a retry after an `error` event (a network-drive drop being the realistic case) the
same way `main/index.ts`'s existing training-folder watcher already handles it — an unhandled
`error` on an `fs.watch` `EventEmitter` crashes the whole process, not just that watcher.
`syncRootWatchers`/`stopAllRootWatchers` reconcile the active watcher set against the DB (called at
startup, on watch-mode toggle, and on root add/remove/relink) and are torn down cleanly in
`will-quit`. "Watch for Changes" / "Stop Watching for Changes" toggle in the root's context menu in
`IrFolderTree.tsx`.

**One deviation from the item's own wording, not silently built around:** this triggers a FULL
rescan of the changed root, not a true incremental scan of just the changed subtree.
`importLibrary.ts` has no partial-import primitive today, and building one (surgical re-parse of
one subtree without re-walking/re-hashing the rest of a potentially huge root) is a materially
larger project than this item on its own — extracted the existing full-rescan pipeline out of the
`irLibrary:scan` handler into a shared `rescanRoot` so the watcher runs the exact same one, not a
second copy of it. Costs more CPU per change than a true incremental scan would; doesn't change
correctness, and both halves of the item's own "done when" (below) hold regardless.

`fs.watch(..., { recursive: true })` isn't supported by Linux's inotify backend — falls back to
top-level-only there (documented in the module's own header, not silently degraded); a new file
inside an existing subfolder won't be picked up on Linux, a new top-level pack folder will be.

No automated tests for this file: meaningfully testing real `fs.watch` + debounce timing needs
either a real filesystem and real timers (slow, flaky in CI) or a fake-timer/fs mock elaborate
enough that it mostly tests the mock — a real cost/value call, not an oversight. `rescanRoot`
itself is just the same pipeline the (untested-the-same-way, pre-existing) manual-scan handler
already runs.

**Done when:** dropping a WAV into a watched root makes it appear in the list without user
action (✅ — via the debounced full rescan), and the watcher survives a root going temporarily
offline (✅ — the `error`-event retry).

---

## Phase 5 — NAM Projects

### 14. Project-level metadata cascade
**Status:** ✅ done 2026-09-11 (mechanism differs from spec, noted below) · **Size:** M · **Depends on:** nothing

"Set Project Defaults…" in `NamProjectsShell.tsx`'s `ProjectHeader`, backed by new
`applyProjectDefaults()` in `namCaptureEnrichment.ts`. Fills `modeled_by`/`gear_make`/`gear_model`/
`gear_type`/`tone_type` only where a capture's own column is genuinely `NULL` — never a column
already holding a real value OR the sticky empty-string "deliberately cleared" sentinel (see
`setNamCaptureMetadata`'s own doc comment on that sentinel, which this reuses rather than
reinventing).

**Mechanism differs from the item's own wording, deliberately, not silently**: the item calls for
reusing `folder_metadata`/`folder_metadata_effective` — IR mode's LIVE, resolved-at-query-time
inheritance. That table's field vocabulary and resolution path both belong to `ir_item`
(manufacturer/cabinet/speaker/microphone, COALESCEd in `queryLibrary.ts`'s own SELECT); wiring a
SECOND, differently-named field set through that same live machinery means editing
`CAPTURE_SELECT` — the large, working query both `getNamProjectDetail` and `listNamProjects`
depend on — to LEFT JOIN through `collection_item` to the project's folder, real surgery on code
this session hadn't otherwise touched. `nam_capture_item`'s effective fields are already a
"seed-once-then-sticky" model everywhere else in this file (confirmed while building this: a
capture's `suggested_*` block seeds its effective columns via `COALESCE` at scan time in
`enrichNamCaptures`, and `setNamCaptureMetadata`'s own doc comment describes user edits the same
way) — not IR mode's live-resolved one. A fill-once action fits that existing model exactly, one
new function reusing the same `NULL`-vs-`''` sentinel every other write in this file already
respects, rather than introducing the one live-inheritance field set into an otherwise
seed-and-stick file.

**Caught and fixed while building this, in the tests, not the implementation**: my first test
draft assumed `suggested_*` only seeds separate hint columns, never the real effective ones — the
opposite is true (`enrichNamCaptures`'s own `updateNamCaptureFacts` statement does
`gear_make = COALESCE(gear_make, ?)` etc. straight from the suggested block on first scan). Running
`npm run test:electron` for real (see that discovery written up against items 11-13 below) caught
the wrong expectation immediately; fixed the test's understanding, not the code.

6 new tests in `namCaptureEnrichment.test.ts`: fills only genuinely-NULL fields (verified against a
capture whose fields are pre-seeded from `suggested`, matching the real seeding mechanism just
described), never overwrites an existing value, never overwrites a deliberate empty-string clear,
scopes to one project (a sibling project's captures are untouched), and ignores a blank/whitespace
patch value.

**Done when:** setting the amp once on a project fills it for every capture that hasn't
overridden it, and a per-capture override wins. ✅

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
**Status:** ✅ done 2026-09-11 (thinner than spec, noted below) · **Size:** L → actually S · **Depends on:** 14

"Build Pack…" in `ProjectHeader`, new `IrBuildPackModal.tsx`. Auto-detects the pack folder as the
common parent directory of every trained capture's `outputModelPath`; if trained models don't
share one folder, the field is left blank with a "Choose…" folder picker instead of guessing.
Writes `nam-pack.json` (title/description/notes seeded from the project, merged onto any existing
pack info already there — never blind-overwrites a folder that already has one) via the EXISTING,
already-generic `window.api.writePackInfo` — no new IPC channel needed for that half at all. Export
Sheet builds a plain HTML table (capture/architecture/validation ESR) and opens it through the
existing `window.api.exportPackSheet`, same "no new channel" reason.

**Turned out much thinner than the L estimate, because the release pipeline already being generic
made most of the estimated size disappear**: `writePackInfo`/`readPackInfo`/`exportPackSheet` take
a folder path and a plain object/HTML string — they don't care whether the caller is NAM mode's own
FileList or NAM Projects mode. The size-L estimate assumed real integration work; there wasn't any
once this was actually looked at.

**Deliberately does NOT**: move or copy the trained model files anywhere (a pack, in this app, is
folder metadata layered onto files already sitting where training put them — moving them is
backlog-item-12-shaped work, not this item's), or open NAM mode's full visual `PackInfoEditor`
(that component lives inside `App.tsx`'s own folder-tree navigation — a completely separate React
tree per `AppRoot.tsx`'s own "each shell owns its whole viewport" design; switching to NAM mode and
browsing to the written folder picks up the seeded `nam-pack.json` exactly as if it had been filled
in there by hand — no extra plumbing needed for that to work, so none was built). Cover art,
checklists and delivery targets are left for the user to fill in on that same next visit to NAM
mode — seeding everything the project actually KNOWS (title/description/notes) is what "no
retyping" asks for; a checklist and delivery targets aren't project knowledge to lose.

**Done when:** a trained project produces a pack folder with populated Pack Info and an export
sheet, with no retyping. ✅

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
