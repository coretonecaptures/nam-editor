# IR metadata: full-parity proposal (persistence + editor surface)

Written 2026-09-13 in response to two asks in the same conversation:

1. "We need a way to add metadata to IRs — either inside the wav (destructive, careful) or
   persist via SQL keyed on name/hash."
2. Immediately after: "then I need to click an item, see its metadata, add/edit metadata to
   one or more files — all the features of .nam metadata in this app."

**Headline finding: most of #1 and a real slice of #2 are already built.** This is not a
green-field feature. `docs/ir-nam-parity-backlog.md` items 7-10 (dated 2026-09-11, two days
before this doc) shipped a SQL-backed, hash-resilient, per-item-and-batch metadata editor for
IRs. This proposal is deliberately scoped to **the gap between what's built and true .nam
parity**, plus the one part of ask #1 that was never built (embedding into the WAV itself).
Per this repo's own working practice (CLAUDE.md), the move here is to extend the existing
mechanism, not invent a second one beside it.

---

## Part A — what already exists (don't rebuild this)

### A1. Persistence: SQLite catalog, keyed by a stable item id, resilient to renames/moves

`src/main/irCatalog/schema.ts` — every indexed IR is a row in `item` (kind='ir') joined to
`ir_item` for its cabinet/speaker/microphone/mic-position/etc. fields. The row's `id` is a
stable UUID, not derived from the current filename or path — `(library_root_id,
relative_path)` is just a UNIQUE constraint on top, not the identity.

This already answers the "name/hash" half of ask #1, and does it better than a naive
name-or-hash key would:

- **`item.quick_hash`** (size + first/last 64KB) and **`item.content_hash`** (full SHA-1,
  computed lazily in the background — `contentHash.ts`) are both stored per item.
- **`irCatalog/reconciliation.ts`** runs after every scan and re-links a file that moved or
  was renamed *back onto its original row* by matching `content_hash` first, `quick_hash`
  second, and a folder-name-similarity-gated filename+size heuristic as a last,
  human-confirmed resort. A relinked item keeps its id, and therefore keeps every metadata
  field, rating, favorite, and tag that was ever set on it. This is the actual mechanism the
  original ask was reaching for ("based on the name/file hash or something") — it exists,
  it's tested (`reconciliation.ts` has no test file yet, actually — see gap G4 below), and it
  runs automatically, not as a separate step the user has to remember to trigger.
- Metadata itself lives in `ir_item`'s columns (manufacturer, cabinet, speaker, microphone,
  position, capture_type, the whole 2026-08-26 mic-detail block — see `schema.ts` lines
  154-212) plus `ir_item_field_source` recording *where* each value came from
  (`ir_lab_native` / `ir_lab_embedded` / `vendor_documentation` / `vendor_parser` /
  `filename_inferred` / `user_entered`), with a fixed precedence ladder
  (`fieldConfidence.ts`) so a user's manual correction can never be silently clobbered by a
  rescan or a vendor-parser re-run.
- Folder-level defaults exist too (`folder_metadata` / `folder_metadata_effective`,
  resolved live at query time via `COALESCE`), so setting a field once on a folder is
  inherited by every IR under it until a specific item overrides it — and "push this item's
  value up to its folder" is a real, built action (backlog item 10).

### A2. Editor surface: per-item and multi-select batch, both live

- **Per-item**: right-click "Edit Metadata…" opens `IrEditMetadataModal.tsx` — shows each
  field's current value and its source (`sourceLabel()`), lets you edit, clear (reverts to
  whatever the folder/automation would otherwise resolve to — never just blanks it), or
  promote a value up to the folder. Writes land at the `user_entered` tier, which nothing
  automated is ever allowed to overwrite.
- **Batch**: multi-select (Ctrl/Cmd-click, Shift-click range — `IrModeShell.tsx`) plus
  right-click "Edit Metadata…" on a selection opens `IrBatchMetadataEditModal.tsx`, a direct
  port of NAM mode's `BatchEditor.tsx` idiom — a checkbox per field enables it for the batch,
  its input is disabled until checked, only checked fields get written, to every selected
  item, at the same `user_entered` tier.
- Rating and favorite are their own inline toggles in the list already (`IrModeShell.tsx`),
  same as NAM mode keeps them out of the text-field metadata editor.
- Provenance badges are visible per-field on the browse row itself, not just inside the
  modal (backlog item 8).

**Conclusion on ask #1:** the SQL/hash approach is the right one, it's already built, and
building a second, competing persistence path (e.g. a sidecar file keyed by hash) would
fragment metadata across two stores for no benefit — the catalog already IS that store, and
already survives the rename/move case a sidecar would exist to solve.

---

## Part B — the real gaps against ".nam metadata" parity

Comparing against `MetadataEditor.tsx` (NAM mode's persistent third-panel editor) surfaces
four concrete, scoped gaps. None of them are "build a new system" — each is "extend the one
that's there."

### G1. Field coverage is 4 of ~30 columns

`IrEditMetadataModal`'s `FIELDS` array is hardcoded to `manufacturer / cabinet / speaker /
microphone`. `ir_item` already has columns for `position`, `capture_type`, `is_reverb`,
`is_stereo`, `is_true_stereo`, `speaker_position`, `modeled_microphone`, `preset_kind`, and
the full mic-A/mic-B block (type, polar pattern, target zone, distance + unit, axis angle,
signal-chain override, notes) — all of it schema-ready, none of it in either modal. This is
exactly the gap item 7's own "Done when" note flagged and left open ("`position` exists on
`ir_item` too but isn't selected in the browse query yet... left as a clearly-noted gap").

NAM mode's editor groups fields (identity / gear / levels / NAM Lab extended); IR's should
follow the same visual grouping rather than one flat list, given the field count once mic-A/B
are included — likely: **Identity** (manufacturer/cabinet/speaker/microphone/position),
**Capture facts** (capture_type, is_reverb/stereo/true_stereo — read-only, these are WAV
header facts per A1, not editable text), **Mic A** and **Mic B** as collapsible sub-groups
(only expand Mic B if it has any value — most captures are single-mic), **Notes**.

### G2. No persistent "click to see everything" panel — only a modal

NAM mode's `MetadataEditor` is always-visible in the third panel: select a file, its full
metadata is right there, editable in place, auto-filled vs. manually-changed fields carry the
indigo/amber border convention (CLAUDE.md). IR mode's equivalent today is a modal you
explicitly open per item — there's no "just glance at the selected row's full metadata"
view. Whether this becomes a genuine third panel (a bigger layout change to `IrModeShell.tsx`)
or the existing modal simply becomes non-modal (a docked side panel, opened by selection
rather than by right-click) is worth a decision *before* building G1's expanded field set into
whichever container wins — building the wider field list twice would be wasted work.

**Recommendation:** dock it. A right-click modal for a single field or two is fine; a ~30-field
editor as a blocking modal is a worse experience than NAM mode's own panel, and `IrModeShell.tsx`
already has the layout real estate question solved once elsewhere in this app (the three-panel
split). Concretely: a selection-driven detail rail, closable, replacing the click-to-open modal
for the read+edit case; keep a lightweight quick-action ("Edit Metadata…") for parity with how
batch-edit is invoked, but single-item editing becomes "select it, look right."

### G3. WAV embedding is read-only

`bwfCaptureMetadata.ts` / `wavHeader.ts` **parse** IR Lab's own bext-chunk metadata
(Description + Originator fields) — there is no writer anywhere in this codebase. This is the
literal "inside the wav" half of the original ask, and it's the one piece with no code today.

**Why build it at all, given the catalog already works:** the catalog's metadata doesn't
travel with the file. The moment an IR is copied out of a tracked library root — shipped to a
customer, dragged into a different DAW project, handed to someone without this app — every
field reverts to whatever (if anything) is baked into the file itself. Embedding is the
"make this portable" complement to the catalog's "make this fast to browse and never lose
provenance," not a replacement for either.

**How to build it safely (non-destructive to audio, matching this app's own writer
philosophy):** the CLAUDE.md rule for `.nam` files — never JSON.parse→stringify, always a
surgical patch that touches only the changed bytes — has a direct WAV analogue. A `bext`
chunk write must NOT touch the `data` chunk (the actual samples) or resize the file
unnecessarily:

- If a `bext` chunk of adequate size already exists (per `wavHeader.ts`'s chunk walk), patch
  its `Description`/`Originator` fields **in place** — same fixed-width, NUL-padded, offset
  layout `bwfCaptureMetadata.ts` already documents (`BEXT_DESCRIPTION_OFFSET`/`LENGTH`,
  `BEXT_ORIGINATOR_OFFSET`/`LENGTH`) — a pure byte-range overwrite, zero risk to the rest of
  the file.
- If no `bext` chunk exists yet, insert one (fixed 602-byte body per EBU Tech 3285, matching
  what IR Lab itself writes) immediately after `fmt ` and before `data`, which means rewriting
  the file (can't insert bytes into the middle of a file in place) — do this the same way any
  safe rewrite is done elsewhere: write to a temp file alongside the original, `fsync`, then
  atomic rename over the original, never truncate-and-rewrite-in-place. Update the RIFF
  top-level size field to match.
- **Format convergence with IR Lab, not a second dialect.** Write the exact "Key: value | ..."
  shape `bwfCaptureMetadata.ts` already parses (Cabinet/Speaker/Microphone/Position/Notes/
  CaptureType/MicADistance), Originator fixed to `"IR Lab"` (or, if this app wants its own
  identity, a value IR Lab's own parser would still need to recognize — needs a one-line
  cross-repo confirmation, not a design debate). This keeps a WAV embedded by NAM Lab
  transparently readable by IR Lab and vice versa, per the parser's own header comment about
  the 256-byte hard truncation ceiling — the write path must enforce that same 256-byte cap
  on Description (truncate with a visible warning in the UI, never silently overflow into the
  next chunk).
- **Scope of what's embeddable is smaller than what's in the catalog.** Per that same 256-byte
  ceiling and IR Lab's own precedent, only the fields IR Lab itself embeds today
  (cabinet/speaker/microphone/position/notes/captureType/micADistance) round-trip into the
  file; the mic-B block, axis angles, signal-chain overrides, etc. stay catalog-only — say
  this explicitly in the UI ("embedding writes 7 of N fields") rather than implying full
  fidelity.
- **Explicit, opt-in action, never automatic.** "Embed metadata in file" as a button per item
  (and a batch variant), not a background sync — a WAV is being asked to leave the tracked
  library specifically because it's about to be handled by something that isn't this catalog,
  so the action should be a deliberate "bake it in before it leaves" step, not something that
  runs on every edit. This also sidesteps the biggest risk with any file-mutation feature: an
  unreviewed embed running against read-only media, network-mounted vendor packs, or files
  someone doesn't expect this app to touch.

### G4. Reconciliation has no test coverage

Noted while reading `reconciliation.ts` for this proposal: unlike `fileOps.ts`,
`fieldConfidence.ts`, `promoteFieldToFolder.ts` and most of the rest of `irCatalog/`, there is
no `reconciliation.test.ts`. This is the exact mechanism ask #1 leans on ("survives a
rename/move") — worth closing before leaning on it further, independent of anything else in
this doc.

---

## Recommendation / sequencing

Nothing here needs new infrastructure — it's four additive slices on the existing catalog and
editor:

1. **G4 first, cheaply** — a `reconciliation.test.ts` covering content-hash relink, quick-hash
   relink, and the tier-3 suggestion path. De-risks everything else that assumes it works.
2. **G1** — widen `IrEditMetadataModal`'s (and the batch modal's) field list to the full
   `ir_item` surface, grouped (Identity / Capture facts / Mic A / Mic B / Notes). This alone
   closes most of the literal "all the features of .nam metadata" ask, reusing every existing
   write/clear/promote/source-badge mechanism as-is.
3. **G2** — decide docked-panel vs. modal-stays (recommend docked, see above), then move the
   widened G1 editor into that container. Do this after G1's field list is settled, not
   before, so the container isn't built once for 4 fields and reworked for 30.
4. **G3** — the WAV-embed writer, as its own scoped piece: chunk-patch-in-place +
   insert-with-atomic-rename, the 256-byte-cap warning, and the explicit per-item/batch
   "Embed…" action. Cross-check the Originator string and field list against IR Lab's current
   `WavIO.cpp` before writing, so both apps stay interoperable rather than drifting into two
   dialects of the same chunk.

Suggest filing 1-4 as new numbered items in `docs/ir-nam-parity-backlog.md` (continuing from
21) rather than a standalone plan, since that file is already the working queue for exactly
this kind of "port a NAM-mode capability into IR mode" work and item 7-10's own history is the
direct precedent for G1/G2.
