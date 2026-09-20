# NAM Lab -> IR Lab: "Export Captures to Project" spec (draft, needs IR Lab team sign-off)

Written 2026-09-20 for hand-off to whoever is working the IR Lab side of this. This is a
**proposal**, not a committed design — the two open questions in Part 3 need an answer from
that side before any code gets written on either repo.

## 0. The ask, in one sentence

Let a NAM Lab user select some IRs in their catalog (any vendor — a York Audio pack, an
OwnHammer pack, IR Lab's own prior captures, anything already indexed) and push copies of
them into an IR Lab project folder on the same machine, merging cleanly if that project
already has files in it.

## 1. What NAM Lab actually has to offer

For any cataloged IR item, NAM Lab has:
- The WAV file itself (bytes, unmodified).
- Catalog metadata: manufacturer/cabinet/speaker/microphone/position/notes, mic-A/B detail,
  reverb detail, all with per-field provenance (`ir_item_field_source`).
- The ability to **embed** a subset of that metadata into the WAV's own `bext` chunk
  (`wavMetadataWriter.ts`, shipped this session) — cabinet/speaker/microphone/position/notes/
  captureType/micADistance, in the same "Key: value | ..." format `WavIO.cpp::buildBwavMetadata`
  already reads.

What it does **not** have, for anything except an IR Lab's own genuine capture: measurement
telemetry (SNR, endpoint detection, latency, polarity) — the fields that live in IR Lab's own
`analysis.json`. There is no honest way to synthesize that for a third-party WAV (a York Audio
IR, say) that was never actually captured through IR Lab's own pipeline.

**This is the load-bearing constraint on the whole design:** NAM Lab can hand over a real WAV
file and whatever metadata it can embed in the file itself, but it must never fabricate a
`session.json`/`analysis.json` claiming measurement data that doesn't exist.

## 2. What IR Lab's project format actually looks like (confirmed, not guessed)

Per `labProjectEnrichment.ts`'s own header (checked directly against `ir-lab`'s
`SessionStore.h/.cpp`, `ProjectStore.h/.cpp`, `Project.h` — private source, this session):

```
<projectFolder>/<deliverable>.wav              -- flat, a normal file, no nested captures/ folder
<projectFolder>/.SessionData/project.json       -- captureIndex: [{ captureId, outputFileName }]
<projectFolder>/.SessionData/<captureId>/session.json     -- cabinet/speaker/mic/position/notes/captureType
<projectFolder>/.SessionData/<captureId>/analysis.json    -- sampleRate, isStereo, isTrueStereo, measurement data
<projectFolder>/.SessionData/<captureId>/variants.json    -- edit-revision history
```

The deliverable WAV is a plain file sitting next to `.SessionData`, not inside it — this is the
part of the layout an "export into this project" feature actually touches.

## 3. Proposed design

**"Export Captures to IR Lab Project…"** in NAM Lab's IR mode, available from a multi-select:

1. **Destination picker.** Point at any folder. NAM Lab detects whether it's an existing IR Lab
   project (`.SessionData/project.json` present) or a plain folder — either is a valid target,
   surfaced differently ("Add to existing project" vs "Create a new folder").
2. **Copy the WAV(s)** into the project folder root, at the SAME level as its existing
   deliverables — never into `.SessionData`.
3. **Collision handling** (a project that already has files): detect a same-basename collision
   before copying anything (same discipline `IrBatchRenameModal.tsx`'s preview already uses for
   in-catalog renames) and refuse the batch with the exact collision list rather than silently
   overwriting or auto-suffixing — this is someone else's (IR Lab's) folder, so "guess a new name
   for you" is the wrong default here even though NAM Lab does that elsewhere for its own library.
4. **Embed metadata into the copy** via the existing `wavMetadataWriter.ts` writer — opt-in,
   reusing the same `irAllowEmbedMetadataInFile` setting gate already built, so cabinet/speaker/
   mic/position/notes travel with the file even though no `session.json` entry exists for it.
5. **Do NOT touch `.SessionData/project.json` or write any `session.json`/`analysis.json`.**
   Per Part 1, NAM Lab has no honest measurement data to put in one, and per this project's own
   "single writer per file" principle (`docs/ir-lab-manager-shared-catalog-schema.md`), NAM Lab
   writing into IR Lab's own authoritative index is exactly the kind of cross-boundary write that
   needs IR Lab's own sign-off, not a unilateral decision from this side.
6. Move vs. copy: **copy**, not move, by default — the source item stays in NAM Lab's own
   catalog untouched (same reasoning `fileOps.ts`'s own `copyItems` already documents: a copy is
   a new, independent file, not a second name for the source's).

## 4. Open questions for the IR Lab team (blocking, not just nice-to-know)

1. **Does IR Lab's own UI cope with a "foreign" WAV sitting in a project folder with no matching
   `.SessionData` entry?** If IR Lab's project view expects every deliverable to have a
   `session.json`, an export that's just a bare WAV file might show as broken/missing metadata
   there, or not show up at all. If that's the case, IR Lab may need to recognize and adopt an
   unregistered file on its own next scan (reading whatever's embedded in the `bext` chunk to
   seed a minimal `session.json`) rather than NAM Lab ever writing that file directly.
2. **Is there a preferred "drop zone" convention instead** — e.g. IR Lab watches a subfolder
   (`_Imported/`, or similar) inside a project and adopts anything dropped there into its own
   index on its own terms, on its own next scan? That would keep IR Lab as the sole writer of
   `.SessionData` entirely, with NAM Lab only ever staging files, never touching the index — a
   materially safer contract than NAM Lab guessing at project.json's schema from outside.

## 5. What's explicitly NOT in scope for a first pass

- Writing `.SessionData/project.json` or any `session.json`/`analysis.json` — see Part 3.
- Moving (vs. copying) the source — copy only, first pass.
- Round-tripping IR Lab's own measurement data back INTO NAM Lab's catalog — this spec is about
  the NAM Lab -> IR Lab direction only.
- Any new IR Lab-side code — this doc's job is to ask questions 1-2 above, not answer them.
