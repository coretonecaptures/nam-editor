# IR Library and IR Lab Integration — GPT Review / Audit

**Date:** 2026-09-25  
**Scope:** NAM Lab's IR metadata, catalog, IR Lab Project import, and the two-app audition/import workflow.  
**Method:** local source review of `master`, `origin/feature/ir-lab-manager`, and IR Lab's current `main`, plus competitor documentation.

## Executive conclusion

The strongest product direction is not "a better WAV browser." It is a **portable, provenance-aware IR project system**: users should be able to import a vendor pack or an IR Lab Project, understand what the data means and where it came from, find a usable sound quickly, audition it with their real rig, and recreate/share that decision after files move to another machine.

The newest implementation work is on `origin/feature/ir-lab-manager` (commit `48326ca`, 2026-09-21), not on `master`. It is substantially ahead of the currently shipped-looking branch and already supplies much of the catalog foundation described below.

The highest-value missing integration is **Play in IR Lab**: selecting two IRs in NAM Lab should load IR Lab Live Audition's Cab A/B slots; selecting four should populate the two slots on each lane of a stereo amp rig. The current handoff sends up to eight files to IR Lab's Blender instead. Those are different workflows and should remain separate actions.

## What exists today

### `master`

`master` has a player-oriented IR picker: searchable paths from a configured folder plus recent/favourite entries. It is a useful loading control, but it is not an IR catalog: metadata, project relationships, and favourites are path-based rather than portable identities.

### `origin/feature/ir-lab-manager`

The feature branch already implements a serious catalog:

- SQLite catalog with WAV format facts, indexing, full-text/faceted search, tags, roots, watched roots, move reconciliation, and missing-file handling.
- IR metadata including cabinet, speaker, microphone, position, capture type, two-mic detail, stereo/true-stereo facts, and reverb fields.
- A confidence ladder: IR Lab-native metadata, embedded BWF metadata, vendor documentation/parser inference, filename inference, and user-entered values are deliberately distinguished.
- IR Lab Project import/enrichment: detects `.SessionData/project.json`, matches `captureIndex` deliverables, reads per-capture `session.json`, `analysis.json`, and `variants.json`, then creates a project collection and capture/variant relationships.
- Vendor parsing, spreadsheet metadata export/import with preview, batch metadata operations, project/folder views, duplicate tooling, and a live audition path.
- An eight-slot tray which can send selected files to IR Lab's Blender via `irlab://blend`.

Relevant implementation anchors:

- `src/main/irCatalog/labProjectEnrichment.ts`
- `src/main/irCatalog/importLibrary.ts`
- `src/main/irCatalog/schema.ts`
- `src/main/irCatalog/spreadsheetImport.ts`
- `src/main/irLibraryIpc.ts`
- `src/main/irLabConnector.ts`

## Current gaps and risks

### Project import is scan-led, not project-led

The importer correctly enriches a project after scanning WAVs, but the user does not first see a project-import report. A robust import should preview which projects/captures were detected, which deliverables match, what is missing, which values are inherited or guessed, and what will change.

### File moves remain a cross-machine hazard

The catalog has hash-based reconciliation, but several workflows still fundamentally start from a path. In particular, the spreadsheet round-trip resolves rows by absolute path. A Mac-to-PC project copy needs project ID, capture ID, content hash, and relative-path fallback so it can repair relationships rather than ask the user to rebuild them.

### Source changes need explicit reconciliation UX

An IR Lab Project can have deleted captures, replacement deliverables, archived/current variant changes, or revised metadata. Rescanning should produce a reviewable change set and safely retire stale links; it should not leave a user wondering whether the catalog reflects the project's current truth.

### Third-party metadata must never impersonate measurement metadata

NAM Lab can copy a WAV and carry descriptive metadata. It must not manufacture IR Lab measurement data such as latency, polarity, SNR, endpoint detection, or capture telemetry for a third-party IR. The existing provenance model is the correct basis for enforcing this.

### Existing export-to-project concept needs an IR Lab adoption contract

The current draft correctly proposes copying WAVs into a project without NAM Lab writing IR Lab's `.SessionData` itself. However, IR Lab must then own an explicit adoption step or watched inbox convention. Otherwise a foreign WAV may sit in a project folder without becoming a recognized IR Lab capture.

## Recommended product direction

### P0 — Project Import Preview and Repair

Make **Import IR Lab Project(s)** a first-class importer rather than a special scan:

1. Inspect selected folders before changes.
2. Present detected project name/ID, captures, deliverables, variants, embedded metadata, and confidence/provenance.
3. Show `matched`, `missing`, `new`, `changed`, `duplicate`, and `needs attention` counts.
4. Let the user choose import scope: full project, selected captures, current variants only, or include archived variants.
5. Apply exactly the reviewed diff.
6. Offer **Locate moved project**: match project ID/capture ID/content hash first, then relink all files and sidecars in one operation.

This is the essential trust feature for real studio data and backup/migration workflows.

### P0 — Play in IR Lab: direct Live Audition slot loading

Add a dedicated action beside the existing Blender handoff:

| Selection / rig state | NAM Lab action | IR Lab result |
|---|---|---|
| 1–2 selected IRs, normal rig | **Play in IR Lab** | Load Cab A and optionally Cab B in Live Audition |
| 1–4 selected IRs, stereo amp rig | **Play in IR Lab — Stereo Rig** | Load Left Cab A/B and Right Cab A/B |
| Up to 8 selected IRs | **Send to Blender** | Open Blender and add files for a new blend |

The handoff should use a new versioned payload/manifest rather than overload `irlab://blend`. IR Lab should validate all files against its configured Cab IR root before loading anything, return a success/failure acknowledgement, preserve the current amp/effects/input state, and make no surprise rig-structure changes. If a four-IR request needs the stereo fork enabled, ask once rather than enabling it silently.

The receiving code already has independent loader paths for Cab A/B and for the second cab pair of a stereo fork. This is an integration route and UI/contract task, not an audio-engine invention.

### P1 — Portable Tone Recipes

Introduce a shareable **Tone Recipe** which represents a decision rather than merely a file:

- NAM model identity and hash.
- One, two, or four IR assignments by semantic slot.
- optional blend, level, phase/align, cuts, and rig/preset reference.
- project/capture IDs and source provenance.
- portable relative paths plus hashes, with a clear missing-item repair view.

This is more reliable than slot-number-only references. It also makes the NAM Lab ↔ IR Lab pairing tangible: import/capture, choose IRs, audition, save, reproduce on another system.

### P1 — Vendor-pack import recipes

The catalog's vendor parsers are useful but cannot scale indefinitely as bespoke code. Add a guided pack-import flow:

1. Choose a pack root and optional README/legend files.
2. Preview filename parsing over a representative sample.
3. Allow the user to map tokens to cabinet, speaker, mic, placement, mix, sample-rate/version, and vendor nomenclature.
4. Save a reusable vendor/pack rule with confidence marked as parser-derived.
5. Keep every mapping editable and reversible.

This directly addresses commercial packs with opaque abbreviations without pretending a guess is a measurement.

### P2 — Project Package / Foreign-IR Adoption

Define one documented, versioned package format for project transfer:

```text
Project package
├── manifest.json       project + capture IDs, schema version, checksums, provenance
├── audio/              delivered WAVs
├── metadata/           descriptive metadata and variants where authoritative
└── README.md           licensing/source notes
```

For NAM Lab → IR Lab, copy/stage the WAVs and manifest; IR Lab then performs the adoption and is the only writer of `.SessionData`. The adoption UI should explicitly label imported files as **external IRs**, retain NAM Lab's metadata/provenance, and leave measurement fields absent unless IR Lab itself later captures/measures them.

## Competitive observations

- [Two Notes GENOME](https://wiki.two-notes.com/doku.php?do=export_pdf&id=genome%3Agenome_user_s_manual) makes two-IR loading a normal part of a rig and supports importing/exporting rigs and banks. NAM Lab should surpass this with source-aware recipes and project portability.
- [Fractal Cab-Lab 4](https://www.fractalaudio.com/downloads/manuals/cab-lab/4p0/Cab-Lab-4-Manual.pdf) treats mixing, conversion, batch processing, and device export as connected workflows. Its lesson is that users value a dependable route from source IR to auditioned/exportable result.
- [Neural DSP Cortex Control](https://neuraldsp.com/cortex-control) makes IR import a simple drag-and-drop library action and makes assets immediately available to the device/cloud. NAM Lab should provide equally low friction while adding better local provenance and migration repair.
- [Line 6's IR documentation](https://kb.line6.com/impulse-response-irs) shows the fragility of slot-number-only preset references: replacing an indexed IR can silently change a preset. Tone Recipes should reference stable identity/hash and have explicit repair rules.
- [ML Sound Lab MIKKO2](https://ml-sound-lab.com/pages/mikko2) illustrates the value of preserving the creative context—cabinet, mic position, angle, and mixed result—rather than exporting anonymous WAVs. IR Lab already captures much of this; NAM Lab should preserve and expose it through import and recipes.

## Delivery order

1. **Project Import Preview + Project Repair.** Establish a trusted data-import experience before adding more catalog decoration.
2. **Direct Live Audition handoff (2 / 4 slot).** Deliver the immediate musical payoff: select IRs in NAM Lab and play through them in IR Lab.
3. **Tone Recipes.** Make the audition decision reproducible and sharable.
4. **Vendor import recipes.** Scale useful metadata across commercial packs.
5. **Portable package + IR Lab adoption workflow.** Complete safe round-trip import/export without cross-app writes into `.SessionData`.

## Acceptance criteria for the first two deliverables

### Project Import Preview

- A copied IR Lab Project can be imported on a second computer without manually re-entering metadata.
- The preview distinguishes exact metadata, inherited/project metadata, parser-derived metadata, and user edits.
- Missing WAVs, stale variants, duplicate bytes, and unsupported/foreign files are visible before apply.
- A moved project can be relinked with project/capture identity and hashes, not only an absolute path.
- Rescan produces an intelligible change report and never overwrites a user-entered value without an explicit choice.

### Play in IR Lab

- Selecting two IRs in NAM Lab loads IR Lab Live Audition Cab A/B—not Blender.
- Selecting four IRs maps predictably to stereo-lane A/B cab slots.
- Invalid/out-of-root/missing paths fail before any slot is replaced.
- Existing amp, FX, input/output, and rig state are preserved.
- The UI reports loaded slots and names, or a concrete failure reason.

## Final recommendation

Build around **projects, identities, and reproducible audition states**, not folders and filenames alone. The catalog work already present on the IR-manager branch is the hard foundation. The next work should turn it into a reliable musician workflow: import a project or pack with confidence, select the right IRs from meaningful metadata, play them immediately through the actual IR Lab rig, and save/share the exact result without fragile path or slot assumptions.
