# NAM Lab: bidirectional IR Lab integration build plan

Status: revised 2026-10-01 after review. Companion implementation plan: `ir-lab/docs/ir-lab-nam-lab-integration-build-plan.md`, which is also the single home of the shared package contract. This document assigns work owned by NAM Lab. Current code is the authority when older plans disagree.

## Revision 2026-10-01: two phases

**Phase A — daily same-machine handoff (built 2026-10-01).**

- NAML-1 — built. `namlab://library?path=` is parsed (`namLabUrl.ts`), validated as an existing directory in the main process, and routed cold or warm to NAM mode: a folder inside the current library is selected; any other folder asks before replacing the library. On a cold launch it waits for the default folder to finish loading first.
- NAML-2 `playcab` sender — gated. Before sending, NAM Lab reads IR Lab's `integration-status.json` `routes` list (`irLabSupportsRoute`) and refuses with a clear reason when IR Lab hasn't run or predates `playcab`. IR Lab writes the outcome to `last-event.json` (type `playcab`); surfacing that in NAM Lab's UI is still open.
- NAML-3 — built. **Publish to IR Lab** on a trained model and **Publish N trained to IR Lab** on a project: plan → one confirmation (destination, copies, reuses, conflicts) → hash-verified copy into `<IR Lab NAM folder>/NAM Lab Published/` → optional open via `nam`/`namgroup`. Identical files are reused, different files with a taken name become a renamed copy, nothing is overwritten, `nam-lab-result.json` is untouched. Old `nam-lab-group-*.json` manifests are pruned after a day.

**Phase B — deferred until a real transfer need exists:** the preview/relink half of NAML-2, NAML-4 and NAML-5. Do not restate the package contract here; follow the IR Lab plan's copy.

## Product flow and ownership

IR Lab owns the capture project, raw audio, IR variants, and `.SessionData`. NAM Lab owns its SQLite catalog, training queue, curated metadata, trained `.nam` output, and packs. NAM Lab reads IR Lab source projects and writes only its own result sidecars where the current training contract calls for them. A package is an explicit transfer copy; normal same-machine use remains folder-based so new captures appear on rescan/watch without repeated exports.

Today NAM Projects scans IR Lab's schema v2 `NAM Captures/*.nam-capture.json`, resolves each referenced recording and shared `_excitations/` WAV, opens `namlab://train` review, and writes `*.nam-lab-result.json` after successful training. IR mode detects `.SessionData/project.json` and enriches scanned WAVs. It has a one-project import preview, but ordinary scan/import applies enrichment immediately and the preview does not cover a whole project transfer or path repair. NAM Lab sends `irlab://blend`, `nam`, `namgroup`, and `playcab`; IR Lab has no `playcab` receiver yet. `namlab://project` and `namlab://train` are handled; IR Lab's `namlab://library` link is not. **Build pack from project** currently writes `nam-pack.json` and an export sheet into an existing model folder; it does not bundle files.

## Shared v1 package contract

Defined once, in `ir-lab/docs/ir-lab-nam-lab-integration-build-plan.md` ("Shared v1 contract"). Both repos must validate the same fixture archives before either UI advertises portable project support.

## NAM Lab work packages

### NAML-1 — Complete incoming navigation (built 2026-10-01)

Add `namlab://library?path=<folder>` parsing in `src/main/namLabUrl.ts`, bridge it through `src/main/index.ts` and `AppRoot`/`appNav`, then open NAM mode at the named folder. If it is already in the library, select it; otherwise show an **Add folder?** review before scanning. Validate that the path exists and is a directory. Retain the current `project` and `train` routes, including arrival while NAM Projects is already mounted. Update the empty NAM Projects instructions to the actual schema v2 flat `NAM Captures/<name>.wav` plus same-name sidecar and project `_excitations/`; the current text still describes the obsolete per-capture folder schema.

Acceptance: cold/warm `library`, `project`, and `train` links land correctly; malformed path yields an actionable error; train link opens review and never starts jobs automatically. Add a route parser test plus one navigation integration test.

### NAML-2 — Complete daily same-machine handoff

Keep **Import IR Lab Project(s)** for IR captures and NAM Projects folder scan for training pairs. Make initial IR project import a preview-first action: scan into a staging/report model, show detected projects, capture/variant counts, missing deliverables, confidence/source, and prospective user-metadata changes before catalog writes. Reuse the current single-project preview logic where possible, but do not promise that its current Apply path writes the exact previewed diff. Add **Locate moved project** by project/capture IDs and hashes, then atomically relink the affected catalog root/items. Rescan should report added/changed/missing/archived variants and retain explicit user edits.

Finish the `playcab` sender experience after IR Lab implements its receiver: use one/two IRs for Cab A/B, three/four for stereo lanes; keep the existing eight-item Blender action separate. Preflight configured IR roots, check IR Lab's advertised `playcab` capability, and show the receiving app's completion or specific rejection once IRL-5 provides it. Do not report OS URL dispatch as successful loading.

Build anchors: `IrModeShell`, `IrProjectImportPreviewModal`, `irLibraryIpc.ts`, `labProjectEnrichment.ts`, `labProjectImportPreview.ts`, `irLabConnector.ts`, catalog path-relink helpers. Acceptance: repeated scan leaves catalog stable, copied project at a new path relinks without duplicate capture rows, a user edit survives source metadata updates, and a bad item in a four-IR handoff leaves IR Lab's slots unchanged.

### NAML-3 — Publish trained models to IR Lab (built 2026-10-01)

Add **Publish to IR Lab Library** to trained capture and project/pack actions. Read IR Lab's configured NAM root, show destination, selected model count, name/hash collisions and projected copies. Copy to a staging directory under that root, verify hashes, then atomically place files. Identical content may be reused; different content with the same name requires a rename or explicit replacement choice. Keep `nam-lab-result.json` pointing to the canonical NAM Lab output; record the published copy/path separately so training status does not drift. After publish, call the existing `irlab://nam` or `namgroup` route using the published paths. Do not write a new group manifest for every failed dispatch; clean temporary manifests after an appropriate lifetime.

Build anchors: new main-process publish IPC/service, `NamProjectsShell`, group actions in `App`, `irLabRoots.ts`, `irLabConnector.ts`. Acceptance: a model outside IR Lab's NAM root can be published and opened; identical re-publish is idempotent; collision never overwrites silently; a failed copy leaves no partial model; a group containing models in different source folders can be published and auditioned.

### NAML-4 — Build and import portable packages (Phase B, deferred)

Extend **Build pack from project** with a distinct **Export portable project** action. For a NAM project, package selected trained models, their result sidecars and source capture references; **Full archive** also includes each recording and its referenced shared excitation exactly once. For IR catalog projects, export selected current variants and metadata; include raw sessions only when the source is an IR Lab project and full archive is chosen. A catalog-only third-party IR pack is marked external and has no fabricated measurement data. Show estimate and missing-file review; write a temporary archive, validate its manifest/hash set, then publish it.

Add **Import portable project** to IR/NAM Projects. Validate archive structure and hash set before any catalog or filesystem write. Preview project/capture match, new/identical/changed entries, missing dependencies, metadata source, and destination. Choices: link an existing local project, import as new, skip identical content, or keep both versions. If a package contains IR Lab `.SessionData`, either place the validated source project under a selected new folder or link to an already unpacked source; NAM Lab only indexes it. Never edit IR Lab session files. Repeated import must be idempotent. A failed import rolls back staged files and catalog changes.

Build anchors: new main-process package reader/writer and IPC, `NamProjectsShell`, `IrModeShell`, catalog reconciliation, existing `IrBuildPackModal` as a UI entry point. Acceptance: IR Lab package imported on a second computer, NAM package with shared excitation imported once, corrupt hash rejected before writes, renamed source folder repaired by identity, and imported external IRs retain external provenance.

### NAML-5 — Adopt foreign assets into IR Lab through its importer (Phase B, deferred)

From an IR catalog item or curated selection, offer **Send to IR Lab project** only when IR Lab advertises package/adoption support. Export a deliverables package containing WAVs, descriptive metadata, source/license notes and hashes, then open IR Lab's import flow with the package path or ask the user to open it there. IR Lab owns creation of external-IR records and `.SessionData`; NAM Lab must not synthesize calibration, onset, endpoint, SNR or phase measurements. For immediate listening, keep `playcab`/`blend` as separate lighter actions.

Acceptance: a vendor IR becomes an explicitly external item in IR Lab, metadata source remains visible, source WAV is unchanged, and audition works without suggesting it was measured by IR Lab.

## Delivery gates

1. Ship NAML-1 with IRL-2 and verify all three reverse links.
2. Ship NAML-2's `playcab` UX with IRL-1; then finish preview/relink as an independent catalog change.
3. Ship NAML-3 so trained captures outside IR Lab's configured NAM root have a one-click path into Live Audition.
4. Freeze shared package fixtures; ship NAML-4 with IRL-3 and IRL-4 under capability gating.
5. Ship NAML-5 after IR Lab's external asset adoption is available; use IRL-5 capability/completion data for reliable cross-app status.

Test with empty and populated libraries, cold and running apps, changed source paths, duplicate names with different bytes, partial/corrupt archives, and canceled review. No existing model, capture, or user-entered metadata is replaced without a previewed choice.
