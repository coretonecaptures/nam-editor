# TODO

## [HIGH PRIORITY] Settings: dedicated "Playback" section with per-type DI folders

Player settings are currently squeezed into Settings → Library alongside unrelated options
(`diPreviewLibraryPath`, `irLibraryPath`, `irMix`). They deserve their own **Playback** section,
and the DI library needs to stop depending on the user having pre-organized one folder tree.

**Today:** one `diPreviewLibraryPath`, and categories are inferred from its immediate subfolder
names (`Clean/`, `Break Up/`, ...). That works only if the user restructures their existing DI
collection to match, which is a real barrier — most people already have DIs scattered across
folders they don't want to move.

**Wanted:** pick a folder *per type*, so the app does the organizing instead of the filesystem:

| Type | Folder |
|---|---|
| Clean | `<browse>` |
| Break Up | `<browse>` |
| Medium Gain | `<browse>` |
| High Gain | `<browse>` |
| Lead | `<browse>` |
| Heavy | `<browse>` |

Then the player's pill row is built from configured types rather than discovered subfolders, and
the per-type dropdown lists the wavs in that type's folder.

Design decisions still open:
- **Shape of the setting.** A `Record<categoryName, folderPath>` is the obvious model, but should
  the type list itself be user-editable (add "Acoustic", "Bass", rename "Heavy")? Leaning yes —
  hardcoding six categories will be wrong for someone. `DI_CATEGORY_ORDER` in
  `utils/playerAudio.ts` is the current canonical list and would become the *default* set.
- **Coexistence with the current single-folder mode.** Simplest is to keep both: if per-type
  folders are configured they win; otherwise fall back to scanning `diPreviewLibraryPath` for
  subfolders (which already works and shouldn't break for anyone using it).
- **Same question for IRs.** `irLibraryPath` has the identical subfolder-as-category convention,
  so per-type IR folders (by cab size? by mic?) may deserve the same treatment — or may not,
  since IR packs usually *are* already organized in folders.
- **Ordering** when types are user-defined: explicit drag order, or keep matching against the
  canonical gain progression and append unknowns (what `sortDiCategories` does now).

Also worth moving into the new Playback section while it exists: `namStandalonePath` arguably
belongs there rather than under Library, and the preview length (currently the hardcoded
`MAX_PREVIEW_SECONDS = 12` in `PlayerPanel.tsx`) could become a setting.

---

## DONE: Player cabinet IR stage

**Implemented.** Captures whose `gear_type` has no cabinet (`amp`, `preamp`, `pedal_amp`,
`pedal`, `studio`) are raw power-amp signal and sound harsh alone; they now get a cabinet IR
convolved in. `amp_cab`/`amp_pedal_cab` skip it automatically so you never hear two speakers
in series. Unknown/absent `gear_type` is left alone rather than coloured wrongly, and the user
can force the IR on or off either way.

- **IR source:** a user-pointed folder (`irLibraryPath`, Settings -> Library), same
  subfolder-as-category convention as the DI clip library. Nothing is bundled, which sidesteps
  the cab-IR licensing question entirely.
- **Scan IPC:** `player:scanWavLibrary` — the DI handler generalized, since both libraries are
  "a folder of wavs organized into category subfolders".
- **Convolution:** Web Audio `ConvolverNode` inside an `OfflineAudioContext`, baked into the
  cached preview buffer (suits render-then-play; no live graph to rebuild per play). Parallel
  wet/dry paths with `dryGain = 1 - mix` copied from upstream's topology, so cab amount is
  blendable via the `irMix` setting. `convolver.normalize = false` so switching cabs doesn't
  jump the level — our own loudness stage handles that.
- **Chain order:** model -> IR -> DC blocker -> normalize. IR before normalization because IRs
  vary wildly in gain. When an IR is applied, loudness metadata no longer describes the signal,
  so normalization falls back to peak-based.
- **Verified** against a real IR (`FNDR 2x12 G12-65 MIX.wav`): 6kHz down 21.2dB, 2kHz down
  5.2dB, fundamental unchanged — a real speaker's rolloff.

Follow-ups worth considering: per-capture IR memory (currently one selection for the session),
suggesting an IR from `nl_cabinet` metadata, and IR support in the future tone map.

---

## [HIGH PRIORITY] In-app tone player — offline WASM render (no real-time AudioWorklet)

**Status: IN PROGRESS on `feature/player`.** Prior attempt on this branch (see
`docs/player-investigation.md`, checkpoint `5c84181`) tried to embed Tone3000's
`neural-amp-modeler-wasm` React player (`T3kPlayer`) for real-time playback via
`AudioWorkletNode`. That's permanently blocked in Electron: the WASM module is built with
`-pthread -sAUDIO_WORKLET -sWASM_WORKERS` (see upstream `wasm/CMakeLists.txt`), which requires
`self.crossOriginIsolated === true` to transfer `SharedArrayBuffer` into the worklet thread.
Every approach tried to get `crossOriginIsolated` to `true` in Electron 41/Chromium 130 failed
(COOP/COEP via `onHeadersReceived`, custom `app://` protocol, Vite middleware, `sandbox: true`
— which additionally broke preload since the current preload does synchronous `fs`-based
settings bootstrap incompatible with a sandboxed preload). Do not re-attempt the real-time
AudioWorklet path without a fundamentally different preload/window architecture.

**New approach — fork the DSP core, drop threading entirely:**

The actual neural-net inference in `tone-3000/neural-amp-modeler-wasm` (MIT licensed,
https://github.com/tone-3000/neural-amp-modeler-wasm) is an ordinary synchronous C++ call —
`wasm/t3k-wasm-module.cpp`'s `process(float* in, float* out, int n_samples)`, backed by
`nam::get_dsp(jsonStr)` and `nam::DSP::process()` from the vendored `NAM/*.cpp` sources. It has
**no threading requirement of its own** — the `-pthread`/`AudioWorklet` machinery only exists to
schedule that call every 128 samples from the browser's real-time audio thread. Since a preview
player doesn't need real-time bounded latency (render once, then play back), we don't need any
of that scaffolding.

Plan:
1. Vendor `NAM/*.cpp` + `NAM/*.h` and the `Dependencies/eigen` / `Dependencies/nlohmann` headers
   from the upstream repo (MIT — freely forkable) into this repo, e.g. under `native/nam-wasm/`.
2. Write a new, small entry point (not present upstream) exposing three C functions:
   `loadModel(jsonStr) -> handle`, `processBuffer(handle, in, out, n)`,
   `freeModel(handle)` — directly wrapping `nam::get_dsp` / `nam::DSP::process`. No
   `emscripten/webaudio.h`, no `EMSCRIPTEN_WEBAUDIO_T`, no click-to-resume handler, none of the
   AudioWorklet plumbing.
3. Compile with plain `emcc` (Emscripten SDK — not yet installed on this machine, needs
   confirmation before installing) — **no** `-pthread`, `-sAUDIO_WORKLET`, or `-sWASM_WORKERS`.
   Just `-sMODULARIZE -sEXPORT_ES6=1 -sALLOW_MEMORY_GROWTH -sEXPORTED_FUNCTIONS=...`. Produces an
   ordinary single-threaded `.wasm` that never allocates `SharedArrayBuffer` — so
   `crossOriginIsolated` is never checked and never needs to be true. This is not "bypassing" the
   COOP/COEP security gate (which exists to gate Spectre-class side-channels via shared memory +
   high-res timers) — it's not using the feature that requires the gate at all, which is the
   correct fix, not a workaround.
4. Renderer side: a plain Web Worker loads the module, is handed the `.nam` file's JSON contents
   and the DI reference WAV's samples, calls `processBuffer` once over the whole buffer (NAM
   inference is cheap; expect well under a second for a several-second capture on any modern
   CPU, even single-threaded), gets back rendered float samples, builds a WAV/`AudioBuffer`.
5. Playback: normal `AudioBufferSourceNode` (or encode to WAV blob + `<audio>`). No
   `AudioWorkletNode`, no COI requirement, no dependency on the Python/conda `nam` env at all —
   this stays fully client-side and is bit-accurate to the real NAM plugin since it's the same
   DSP core.
6. Wire into `PlayerPanel.tsx`: replace the AudioWorklet init path with "render once, cache
   result, play the rendered buffer." Simpler UI too — no live mic input needed for a library
   preview player (could be a v2 addition once offline render works).

**Not yet installed / needs a decision before compiling:** Emscripten SDK (`emsdk`) is not on
this machine — sizable download + first-time toolchain setup. Vendoring the C++ sources and
writing the new entry point + CMake target can happen without it; actually producing a `.wasm`
needs `emcc` installed and confirmed first.

---

## DONE (branch `feature/player`): "Tone Map" — organic clickable tone-browsing dashboard(s)

**Built.** Full-window view: amp rows ordered cleanest→heaviest by *measured* mean gain, continuous
saturation X axis, tone-type colour, multi-select facets (amp / creator / tone type), hover-to-name,
click-to-play through the in-app player, heat cells for dense rows, real axis zoom with pan +
scrollbar, and rows that auto-size to half the window with a drag grip. The brainstorm below is kept
for the design rationale; **the successor ideas are the "Scan mode" and "Tone Radio" entries that
follow it.**

Original brainstorm follows.

**Immediate, concrete first step (separate, smaller item — see the folder-dashboard gain strip
entry below):** two simple 1D gradient/heat strips on the folder dashboard — one for gain level
(clean → high gain, using `metadata.gain`) and one showing tone-type category counts as a
heat/gradient strip (how many captures fall into each `tone_type` bucket). That's the concrete
near-term deliverable and is tracked separately so it doesn't get stuck behind this bigger idea.

**The bigger idea — a real explorable map, not just a strip:** an "organic chart" view that plots
*all* tones in the library (or a scoped subset) on some kind of 2D field — e.g. gain on one axis,
brightness/character or gear type on another — where visually-close points represent
similar-sounding captures, clustered rather than just linearly sorted. The user should be able to:
- **Filter** the map before/while browsing — e.g. "only Marshall-type amps" — and watch the map
  narrow to just that cluster.
- **Click a point (or a cluster)** to get oriented — "here's the cluster of upper-mid-gain
  Marshall tones" — as a way to *discover* tones you might like, not just find a specific one you
  already know the name of.
- **Play a clicked tone immediately**, using the in-app player above — this is explicitly called
  out as the feature that would make the whole thing "REALLY useful": click a point in the map,
  hear it right there, no separate load/select step.

**Open design questions to resolve before scoping real implementation:**
- What determines position on the "map" — is it purely metadata-driven (gain, tone_type, gear
  fields — all already on `NamFile`/`.nam` metadata, no new extraction needed), or does it need an
  actual similarity/clustering computation (e.g. fingerprinting `waveNetConfig`/architecture the
  way `detectPreset.ts` already does for preset matching)? Metadata-driven is far cheaper to ship
  first; true similarity clustering is a "v2" if the metadata-driven version doesn't feel
  "organic" enough.
- Is this one dashboard or several purpose-built ones (a "by gain" map, a "by gear" map, a "by
  quality/ESR" map)? The user brainstorm mentioned "some sort of new dashboard(s)" — plural is on
  the table.
- Where does this live in the app — a new top-level view, or a mode within the existing folder
  dashboard?
- How does filtering compose with the existing folder-tree scope — is the map always
  library-wide, or does it respect "currently browsing this folder"?

Do not start building the big map until these are actually answered; the gain/tone-type strips
below are the right-sized next step.

---

## [HIGH PRIORITY] Scan mode — audition a scoped set by ear, in order

**Next thing to build.** The Tone Map's weakness is that every facet it offers is a *name*, and you
cannot name a tone you have not heard. Scan mode makes the ear the filter: pick a scope, then sweep
through it hearing each capture crossfade into the next, radio-tuning style. Stop when something
catches you.

**Scope first, then scan** — the drill-down is the point, not a later refinement:
- this creator only (`modeled_by`, normalized via `utils/gearMake.ts`)
- this amp only (`gear_make` + optional `gear_model`)
- **this amp family**, and **several families at once** — see the amp-family taxonomy entry below
- the current folder-tree scope, or library-wide
- compose with the Tone Map's existing facet state so scanning "what I'm looking at" is one click

**Scan order matters more than similarity does.** v1 orders the scoped set by measured
`metadata.gain` (clean → saturated), which needs *no new measurement at all* and is already a
smooth, meaningful sweep. Better orderings (see Tone Radio below) can replace the comparator later
without touching the UI — keep ordering behind a single function so that swap stays cheap.

**The real engineering constraint — MEASURED.** Each capture must be rendered through the WASM model
before it can be heard, and render time is dominated by clip length (~60 ms fixed model load/reset,
then ~120 ms per audio-second):

| scan clip | render per capture |
|---|---|
| 0.5 s | 117 ms |
| 1 s | 176 ms |
| 3 s | 406 ms |
| 6 s | 727 ms |
| **12 s (today's `MAX_PREVIEW_SECONDS`)** | **1518 ms** |

So scanning must **not** reuse the 12 s preview — 1.5 s of silence before every capture makes a
sweep unusable. Use a short dedicated scan clip (~3 s) and a prefetch pool rendering ahead of the
playhead; at 406 ms across 4 workers that is one capture ready every ~100 ms, comfortably faster
than anyone sweeps. Prefetch is most of the work here — budget for it rather than discovering it
late.

**Descriptors are scope-lazy, never library-wide.** 38k captures would be ~1.6 h across 4 workers;
the ~100–500 captures in the scope you are about to sweep are far less. Sweeping starts immediately
on metadata ordering and re-sorts as descriptors land, so the wait is never blocking.

**Incremental, and cheaper than the prescan.** Cache per capture keyed by path + mtime + size +
probeVersion, so adding or editing captures rescans only what changed — never the whole scope again.
The prescan's 618 ms probe was sized to *test identity* (sine + three sweep levels); ordering only
needs the sweeps, so the shipped probe is smaller:

| probe | per capture | 3,853-capture folder, 4 workers |
|---|---|---|
| 1 sweep — brightness only | ~176 ms | **~2.8 min** |
| 2 sweeps — brightness + drive-dependent tilt | ~300 ms | ~4.8 min |

Show the estimate before starting (count x measured ms / workers) and let the user cancel; the cost
scales with scope, and a narrow scope like "these two amps from this maker" is seconds.

**Changing the audition DI does NOT invalidate the scan.** Worth stating because it is the obvious
worry: the descriptor probe is a *synthetic sweep*, not the user's DI, so it characterises the model
itself and is independent of whatever clip you later audition with. The DI only affects what you
hear during a sweep, and is rendered on demand.

The real nuance is drive level, not clip choice. Model response is level-dependent — measured `tilt`
spanned **-300 to +217 Hz**, so some captures genuinely reorder between gentle and hard playing.
That is handled by storing centroid at more than one drive level in the *same* scan, so sorting by
"clean playing" vs "driven" is free and still needs only one pass. No per-DI rescan, ever.

**Metadata cleanup is the user's job, not the scanner's.** Split spellings (SLAMMIN MOFO x4,
`MARSHALL`/`Marshall`) are exactly what the app's batch editor exists for. `gearMake.ts` grouping
still helps the picker read sensibly, but scan mode should not try to be clever about it.

**This is ordinary app code.** The scan runs locally in worker threads on the user's own machine —
no network, no service, nothing external. Every user scans their own library.

**Open questions:**
- Fixed dwell time per capture, or hold-to-listen / release-to-advance?
- Same DI clip for every capture in a sweep (fair comparison, and the render cache stays warm) —
  confirm, but almost certainly yes.
- Crossfade length: long enough to be pleasant, short enough that 50 captures is not 5 minutes.
- Does a "keep" action collect favourites into a shortlist as you sweep?

---

## [MEDIUM] Amp family taxonomy — group makes into families for scoping

Needed by Scan mode's drill-down and useful to the Tone Map's facets. Curated `gear_make` → family
mapping (British / American clean / American high-gain / boutique / fuzz / bass / …), covering the
~54 distinct makes in the library. Curated rather than measured because it is instantly explainable
and reliable, where a clustered grouping would be neither.

Must handle the dirty reality already documented above: case-split spellings, and the 656
`tz-make` placeholder captures that belong to no make at all. Families are a *grouping over* the
normalized keys from `utils/gearMake.ts`, not a replacement for it. Multi-select, since "Marshall
and everything Marshall-derived" (Friedman, Splawn, Bogner …) is exactly the query worth having.

---

## [MEDIUM] Tone Radio — browse by ear-adjacency instead of by name

Successor to the Tone Map, and the eventual source of a better Scan ordering. One capture plays;
8–12 nearest neighbours by *measured timbral distance* sit around it, closer ring = more similar.
Click one → it plays and becomes the new centre, neighbours recompute. Two dials bias the
neighbourhood rather than filter it: darker ⟷ brighter, cleaner ⟷ dirtier. The "filter" is a
heading, not a checkbox.

**The reason it is worth doing at all:** similarity never looks at `gear_make`, so the 656 untagged
captures become exactly as findable as a tagged Marshall. No name-based facet can reach them.

**Do not trust the descriptor before testing it — see the validation entry below.** A single
fixed-amplitude sweep response captures static EQ and saturation but *not* harmonic order and *not*
dynamic feel, which is a large part of what separates two amps by ear. Expect to need the richer
feature set (harmonic even/odd ratio, multi-level compression index) described there.

Also worth keeping in mind: neighbour-browsing can trap you in a pocket where everything sounds the
same, so a deliberate "further afield" / temperature control is part of the feature, not a polish
item.

**Deferred sibling:** the "molecules" free-floating scatter (user: *"like molecules"*) is the same
data in a second view mode — positions from the same descriptors, same hit-testing and
click-to-play, only the layout and mark rendering differ.

---

## MEASURED (2026-07-31): descriptor prescan results — Tone Radio is NOT supported by the evidence

Ran the falsifiable test on the real library (3,853 captures, 140 sampled at 14 each across the 10
makes with enough captures). One combined probe per capture — 220 Hz sine for harmonic structure,
plus log sweeps at three drive levels for spectral tilt and compression — rendered through the
bundled WASM core in Node. 140/140 rendered, 0 failures, 618 ms/capture (~40 min library-wide
single-threaded, ~10 min across 4 workers, cached).

**Verdict: do not build Tone Radio.** Nearest-neighbour same-make accuracy was **23.6% against 9.4%
chance** — real signal at 2.5x lift, but far too weak to navigate by. Same-make captures sit only
**1.13x** closer to each other than to other makes. Per-make recall is wildly uneven: Two Rock and
Victory 50%, but **Friedman 0/14** — not one Friedman's nearest neighbour was another Friedman.
Clicking a capture and being offered "similar" amps would be wrong three times in four.

**Caveat worth keeping:** "same make" may itself be a poor ground truth, since one amp's clean and
lead channels genuinely sound different. A low score partly indicts the label, not only the
descriptor. But it does settle the product question — similarity cannot be *sold* as "amps like
this one".

**What the run did prove, and it is useful:**
- **`metadata.gain` is nearly useless as an axis.** Measured across all 3,853: median 0.797, and
  **79.2% fall inside 0.55–0.85** — a 30% slice of the axis holding four fifths of the library.
  Only 10 captures (0.3%) are below 0.40. On identity it scores 12.1%, barely over 9.4% chance.
  Adding it to the timbre features made them *worse* (25.7% timbre-only vs 23.6% with gain).
  This is why the Tone Map's X axis looks bunched — the axis is real but the data is not spread
  along it.
- **Compression (how much output level fails to track input level) is the single best feature at
  20%** — and it is exactly what a fixed-amplitude probe cannot see. Multi-level probing earns its
  cost; single-level probing would have missed the most informative dimension.
- **Spectral centroid has genuinely wide spread**: 372–1083 Hz, sd 159. It fails at *identity* but
  it is a real, continuous, well-distributed perceptual quantity — i.e. a good **sort key**, which
  is what Scan mode actually needs. Brightness ordering beats gain ordering on spread alone.

**Reframe: the descriptor fails as a similarity metric but succeeds as an ordering.** Use it to sort
a scan sweep, not to claim two captures sound alike.

**Library metadata reality — CORRECTED.** A first pass scanned only `Y:/_RELEASES` (3,853 captures,
own releases) and concluded the creator facet was dead. That was an artifact of the folder chosen.
Across the real collection (`Y:` plus `F:/NAM Captures Paid and Tone3000`) there are **38,263
captures**, and:
- **26 distinct `modeled_by`** — the creator facet is very much alive. It is also the strongest case
  for normalization anywhere in the app: SLAMMIN MOFO appears as **four** spellings totalling ~5,840
  (`SLAMMIN MOFO` 3863, `slamminmofo` 1425, `Slammin Mofo` 184, plus `MADE BY KDM TRAINED BY SLAMMIN
  MOFO` 368). Others: Core Tone Captures 18,372, ML Soundlab 904, stjepanherceg 520, 2dor 320.
- **71 distinct `gear_make`**, 15,251 (40%) with none at all, `tz-make` placeholder 1,947, and
  `MARSHALL` 1590 vs `Marshall` 182 again splitting on case.
- Gain stays useless regardless of folder — the distribution above holds.

**Scale changes the descriptor economics completely.** 38,263 x 618 ms = **6.6 hours
single-threaded, ~1.6 hours across 4 workers**. That is far too much to ask of every user as a
blocking step, and every user builds their own collection so it cannot be precomputed and shipped.
**Descriptors must therefore be scope-lazy, not library-wide** — see the Scan mode entry.

---

## [HIGH PRIORITY] Validate timbral descriptors before building anything on them

**Gate for Tone Radio and for any similarity-based Scan ordering.** The earlier probe measured
spectral centroid across 14 real captures at 349–608 Hz and, importantly, *independent of gain*
(five captures at gain ≈0.43 sat at ≈530 Hz while five at ≈0.44 sat at ≈370 Hz) — so it is a
genuinely orthogonal axis, ~133 ms/capture, ~1.5 min for the library across 4 workers, cached.

**But a single fixed-amplitude sweep is probably not enough**, and this should be proven or
disproven cheaply before any UI depends on it. What it misses:
- **Harmonic order** — even (2nd/4th) vs odd (3rd/5th) is much of "warm/tubey" vs "harsh/fizzy",
  and a sweep's centroid confounds harmonic generation with EQ rather than separating them.
- **Dynamic response** — how the tone changes with input level is arguably *the* thing that
  separates captures, and a fixed-amplitude probe cannot see it at all.

Richer feature set to measure instead (all cheap, all from the same render path):
- spectral tilt / centroid at **two or three drive levels**, not one
- **even/odd harmonic ratio** from a pure sine via Goertzel (the "character" axis)
- **compression index**: how much output level compresses as input rises (the "feel" axis)
- measured `metadata.gain`, free, already present

**The falsifiable test, and it must come first:** captures of the *same amp by the same creator*
should land close together, and captures of clearly different amps should not. If same-amp captures
do not cluster, the descriptor is not capturing amp identity and we need to know that *before*
building a browser on top of it. Cheap to run, and it settles the question by measurement instead of
argument.

Also measure before committing: base64 IPC for 2,577 models may dominate the 133 ms of DSP, in which
case the render path moves to the main process. Do not pre-build that — measure on ~50 real captures
first.

---

## [MEDIUM] Folder dashboard: gain + tone-type gradient strips

Two 1D gradient/heat strips on the folder dashboard (not the big Tone Map above — this is the
concrete, buildable slice of it):
1. **Gain strip**: every capture in scope placed along a clean → high-gain gradient using
   `metadata.gain` (already a read-only field on `NamFile`, no new extraction needed). Color
   intensity or position = gain value.
2. **Tone-type strip**: count of captures per `tone_type` category, rendered as a heat/gradient
   strip (which categories are well-represented in this folder/library vs. sparse).
Scope: folder dashboard (i.e. respects current folder-tree scope, not necessarily library-wide —
confirm against the Tone Map's "library-wide vs. scoped" open question above so the two don't
diverge in behavior later). Keep this intentionally simple (a strip, not a full scatter/map) —
it's the fast, obviously-useful version; the bigger clickable/filterable map is tracked
separately above.

---

## DONE: Option to include folder images (amp/cab/mic photos etc.) in the pack PDF

**Implemented.** Pack Info export now has a "Rig photos (N)" checkbox + thumbnail picker next
to the Simple/Advanced export buttons in `PackInfoEditor.tsx` (~line 2224). Wiring:
- `scanOwnAndInheritedImages` (`utils/folderImages.ts`) scans the folder's own images plus a
  cascade **up** through ancestor folders (stopping before root), each as a labeled group;
  `ampcover.*` is always excluded (reserved for cover art).
- `buildExportGallery()` (`PackInfoEditor.tsx` ~1357) inlines selected images as data URIs and
  passes them through to both `generatePackHtml` and `generatePackHtmlAdvanced` as a new
  `gallery` param. The advanced export renders a paginated "Rig Photos" grid
  (`packExportAdvanced.ts` ~256, `chunkGalleryPages` / `.gallery-grid`).
- Per-image include/exclude persisted via `exportIncludeGallery` +
  `exportExcludedGalleryImages` on `PackInfo`.

**Known limitation / follow-up:** the cascade is **up-only** (own + ancestor folders).
`folder:scanImages` (`main/index.ts:6303`) is a flat, non-recursive `readdir`, so photos sitting
in **child subfolders** of the pack folder are never picked up. The "Rig photos" checkbox is
also gated on there being at least one own/inherited image, so a pack whose photos all live in
subfolders shows no toggle at all. See the "include child subfolder photos" item below.

---

## [MEDIUM] Rig photos: include child-subfolder photos (bidirectional gallery)

Today `scanOwnAndInheritedImages` only cascades **up** (own + ancestors). A pack folder whose
gear photos live in child subfolders (e.g. per-capture folders) gets nothing. Extend the scan
to also collect images from descendant subfolders as additional labeled groups, surfaced in the
same "Rig photos" picker so each image stays individually include/excludable. Decisions still
open: recursion depth (immediate children vs. full descend), whether children default-on or need
their own checkbox, and how to keep noisy folders (DI waveform screenshots etc.) from flooding
the picker.

---

## [TOP PRIORITY] Investigate: "NAM did not produce a .nam file at the expected location"

Occasional training failures where the job completes without error but no `.nam` file is found at the output path. The error message is: `"NAM did not produce a .nam file at the expected location."`.

- Identify when this happens (specific architectures, epoch counts, WAV pair characteristics, or workspace paths with special characters/spaces?)
- Check whether NAM actually errored silently (non-zero exit, stderr output) vs. genuinely wrote the file somewhere else
- Confirm the expected output path construction in `main/index.ts` matches where NAM actually writes its output for each architecture variant
- Add better diagnostics: log the full expected path, list files actually present in the workspace dir after the run, surface that info in the failure history entry so users (and devs) can see what actually happened

---

## DONE (2026-07-12): Training-queue batch drag migrated to @dnd-kit

**Long-standing pain point.** Reordering training batches by dragging has been attempted ~15+
times across multiple sessions/models and has never worked *reliably*. The 2026-07-10 pass
(see the "batch drag" note under Experimental training) fixed several real defects and made it
work in the common case, but two things remain and are the whole point of this ticket:

1. **Collapsed batches don't drag reliably.** A collapsed batch card is just its header (much
   shorter hit area), so cursor tracking / drop-target resolution behaves differently than for
   an expanded card. This is the specific case the user calls out as still broken.
   - **Root cause, confirmed via code review (2026-07-11), distinct from the gap-hit-testing bug
     fixed on 2026-07-10:** `mousemove` events are rate-limited by the browser (tied to display
     refresh, not actual pixel distance moved), not fired continuously. A collapsed card is only
     ~45-50px tall. At normal drag speed, with several collapsed cards stacked only `space-y-3`
     apart, it's entirely plausible that **zero mousemove samples ever land within that 45px
     band** — the cursor's tracked position jumps straight from "card above" to "card below"
     without ever registering the intended card as a match. The existing 80px nearest-neighbor
     fallback (`resolveDragTargetBatch`, added 2026-07-10) does NOT help here: it only rescues a
     sample that landed reasonably close to a target; it can't retroactively notice a target the
     cursor skipped over between two samples with no nearby sample at all. Widening the 80px
     radius further is not a real fix — it starts resolving drops onto the wrong adjacent card
     instead of the intended one. This is why further mouse-event patching is not recommended;
     see the `@dnd-kit` note below for why that architecture doesn't have this failure mode.
2. **No drag ghost/preview.** The current implementation only dims the source card
   (`opacity-50`) and rings the target — there is no floating "ghost" of the dragged batch
   following the cursor, which is what makes a drag feel real and predictable. Compounds #1:
   with everything collapsed and visually similar, and no cursor-following visual, the user has
   no clear signal of where the drag currently thinks it's hovering — so even correctly-resolved
   drops can *feel* unreliable.

**Do NOT keep patching the hand-rolled mouse-event drag.** That's the approach that has failed
repeatedly. The current code (`TrainingPanel.tsx`, the batch drag handle `onMouseDown` +
`resolveDragTargetBatch` + `draggingBatch`/`dragOverBatch` state) attaches `window` mousemove/
mouseup listeners and hit-tests with `elementFromPoint`. It was built this way because native
HTML5 DnD (`draggable`/`onDrop`) does not fire `drop` reliably on same-window targets in
Electron on Windows.

**The proven path is already in this repo: `@dnd-kit`.** `@dnd-kit/core` + `@dnd-kit/sortable`
+ `@dnd-kit/utilities` are already dependencies AND already used successfully for drag-reorder
**with a ghost image** in `PackInfoEditor.tsx` and `PackTargetsEditor.tsx`. The pattern there:
`DndContext` with `useSensors(useSensor(PointerSensor))` + `SortableContext` +
`verticalListSortingStrategy` + `closestCenter`, and `onDragEnd` reads `event.active`/
`event.over`. Pointer sensors work in Electron where HTML5 DnD doesn't, and `@dnd-kit`'s
`DragOverlay` gives the floating ghost for free — solving both remaining problems at once, and
collapsed vs. expanded is a non-issue because dnd-kit tracks the pointer, not element geometry.

**Recommended implementation when picked up:**
- Wrap the batch list (Queue "Batches" view) in a `DndContext` with a `PointerSensor`
  (add a small `activationConstraint: { distance: 4 }` so a click-to-collapse isn't read as a
  drag), `SortableContext` over the batch `groupKey`s with `verticalListSortingStrategy`.
- Make each batch card a `useSortable` item keyed by `groupKey`; keep the existing drag-handle
  as the sortable listener target so clicking the header still collapses.
- Render a `DragOverlay` containing a compact clone of the batch header as the ghost.
- On `onDragEnd`, map `active.id`/`over.id` (both `groupKey`s) to the existing IPC calls
  (`moveSubmissionBefore` / `moveSubmissionToEnd`) — the main-process reorder handlers are
  correct and should not change; only the renderer drag mechanism is being replaced.
- Delete the mouse-event drag code (`resolveDragTargetBatch`, the `onMouseDown` window-listener
  block, `draggingBatchRef`/`dragOverBatchRef`/`draggingBatch`/`dragOverBatch`).
- Test specifically: dragging a **collapsed** batch, dragging above the running batch, dragging
  to the very end, and that a plain header click still collapses (doesn't start a drag).

**Implemented 2026-07-12.** `TrainingPanel.tsx`'s Queue "Batches view" now uses `DndContext`
(`PointerSensor`, `activationConstraint: { distance: 5 }`) + `SortableContext`
(`verticalListSortingStrategy`, items = batch `groupKey`s) + a `DragOverlay` ghost (compact
clone of the batch header, done/total count). Each batch card is wrapped in a small render-prop
component (`SortableBatchCard`) that calls `useSortable({ id: group.groupKey })` — this avoids
extracting the ~250-line card body into its own component with dozens of threaded props; the
render-prop callback still closes over every handler/variable the existing JSX already used.
`onDragEnd` reuses the exact same `moveSubmissionBefore`/`moveSubmissionToEnd` IPC calls the old
mouse-event handler called. The old `draggingBatch`/`dragOverBatch`/`resolveDragTargetBatch`/
`groupedQueueRef` state and the `onMouseDown` window-listener block were deleted outright.
Verified via `tsc --noEmit` (net-zero new errors — two pre-existing errors from the deleted
mousemove code disappeared) and a dev-server launch smoke test (app builds and starts with no
console/render errors). **Still needs**: real manual verification in the running app — drag a
collapsed batch, drag above the running batch, drag to the end of the list, and confirm a plain
header click still collapses instead of starting a drag.

---

## ~~[MEDIUM PRIORITY] Fix literal `\uXXXX` escape sequences showing up as raw text in UI strings~~ — Done

All 18 plain JSX attribute strings containing `\uXXXX` escapes (which don't get JS
escape-sequence processing, so users saw literal `—` etc.) were wrapped in `{"..."}`
so the escape is processed as a JS string literal. Chose the `{...}` expression form over
pasting raw Unicode chars deliberately: this repo had an encoding-hardening pass
(commit `bf6d33f`) that replaced raw Unicode with `\u` escapes to avoid garbling on Windows,
so keeping the source ASCII while wrapping in braces respects that and still renders correctly.
Regression check: `grep -rn '="[^{][^"]*\\u[0-9a-fA-F]\{4\}' src --include="*.tsx"` returns 0.

---

## Modularization

**Status: Components exist but are themselves too large. Priority: Medium.**

58 TS files in `src/renderer/src/` — already well-structured with a `components/` directory and a 5,520-line App.tsx. However several component files are themselves monoliths that need splitting:

| File | Lines | Problem |
|------|-------|---------|
| `TrainingPanel.tsx` | 5,202 | Larger than poke-locker's App.tsx was |
| `SettingsPanel.tsx` | 2,956 | Three or four logical sections |
| `PackInfoEditor.tsx` | 2,432 | Editor + preview + export mixed |
| `FileList.tsx` | 1,966 | Grid + detail + modals all in one |
| `PackTargetsEditor.tsx` | 1,180 | Could split into sub-panels |
| `FolderTree.tsx` | 1,180 | Complex tree logic + UI mixed |
| `MetadataEditor.tsx` | 1,169 | Multiple field groups |

**App.tsx** (5,520 lines) also needs reduction — the root component should be ~300–400 lines.

**Plan** (do these in priority order):

1. **TrainingPanel.tsx** — Split into:
   - `training/QueuePanel.tsx` — job queue + status + controls
   - `training/HistoryPanel.tsx` — history browser + grouped entries
   - `training/BatchBuilder.tsx` — WAV/folder intake + preset selection
   - `training/WatcherPanel.tsx` — watch folder rules
   - `training/PresetsPanel.tsx` — bundle/preset management
   - `training/lib/` — queue helpers, ESR utils, naming templates

2. **SettingsPanel.tsx** — Split into:
   - `settings/GeneralSettings.tsx`
   - `settings/AISettings.tsx`
   - `settings/TrainingSettings.tsx`
   - `settings/SecuritySettings.tsx`

3. **App.tsx** — Extract remaining section scaffolding so root is nav + state only.

**Approach**: Same Node.js extraction script pattern used in poke-locker. Target `npx tsc --noEmit` clean before committing each file.

## Packaging and release

- App icon files for Windows and macOS (`.ico` / `.icns`)
- Code signing and notarization

## Security and hardening

- **[SUPER HIGH PRIORITY] macOS safeStorage Keychain prompt on every launch** — Users on unsigned macOS builds get a Keychain access dialog (sometimes multiple times) each time the app starts. Root cause: unsigned apps can't bind a keychain item to a stable code signature, so macOS re-prompts on every session. `loadTone3kTokens()` triggers it at `app.whenReady`; each `readAiKey(provider)` call is a separate potential prompt.
  - **Immediate mitigation**: move `loadTone3kTokens()` out of `app.whenReady` — lazy-load it on first use. Same for AI keys — read from disk only when the renderer requests them, not eagerly. Fewer startup calls = fewer prompts.
  - **Proper fix**: code-sign the app (Apple Developer Program, $99/yr). A signed build stores the keychain item tied to the code signature; macOS stops prompting after the first "Always Allow". Required before any Mac distribution.
  - **Fallback for dev / unsigned builds**: detect `app.isPackaged === false` or check `safeStorage.getSelectedStorageBackend()`. If the backend isn't 'basic_text' (which means the OS is using a secure backend that might prompt), offer to fall back to plaintext JSON with a one-time warning to the user. This is a security regression but better UX for dev.
  - Until code signing is in place, document the workaround: in Keychain Access on macOS, find the NAM Lab entry and set it to "Always Allow" to silence future prompts.

- ~~Move Tone3000 OAuth token storage from plain `userData/tone3000-tokens.json` to `safeStorage` with migration from the old plain JSON file.~~ â€” Done. `tone3000-tokens.bin` written via `safeStorage.encryptString`; legacy `.json` is auto-migrated and unlinked on next save (`loadTone3kTokens` / `saveTone3kTokens` in `main/index.ts`).
- ~~Move AI provider keys (OpenAI, Anthropic, etc.) to `safeStorage`.~~ â€” Done. Per-provider `ai-key-{provider}.bin` files via `storeAiKey` / `readAiKey`. Keys never travel back to the renderer (saved by name; never re-emitted).
- ~~Add external URL validation in main process (`openExternal`, `window.open` handling) and allow only expected schemes.~~ â€” Done. `openExternalSafe(raw, allowedProtocols)` gates `shell.openExternal`; default allowlist is `['https:', 'mailto:']`. Used by the `app:openExternal` IPC handler and by `webContents.setWindowOpenHandler` for child-window requests.
- ~~Standardize renderer links on `window.api.openExternal(...)` instead of raw `window.open(...)`.~~ â€” Done. Zero `window.open(` / `window.location.href =` usages remain in `src/renderer/`.
- ~~Add URL guardrails for remote download helpers~~ â€” Done.
  - Tone3000 model + cover URLs are filtered through `isAllowedTone3000Url` (https:// only, hostname must be `tone3000.com` or `www.tone3000.com`) before any `fetch`.
  - `cover:downloadFromUrl` accepts only `http:` / `https:` URLs via `parseAllowedUrl`, validates `Content-Type` starts with `image/`, and restricts the saved extension to a known image-format whitelist.
- Review the broad preload / IPC surface and plan a narrower permission model before any store-distribution push. The preload currently exposes ~80 IPC channels â€” many of them broad filesystem operations (read/write/move/trash arbitrary paths). For app-store distribution this would need either: (a) per-channel scope/origin checks, (b) renderer-supplied paths restricted to user-selected dialogs/drops only, or (c) splitting trainer / library / Tone3000 IPC namespaces with separate preload scripts. Pending.
- Evaluate whether `sandbox: false` can be tightened without breaking file management, trainer flows, or local image rendering. `contextIsolation: true` and `nodeIntegration: false` are already in place, which provide the strongest practical boundaries â€” but a true `sandbox: true` would force the preload to be sandboxed too (no `require` of arbitrary modules) and would need a refactor of the preload's `electron`/`webUtils` imports. Pending; do this as a separate test-heavy pass.

## Pack Info and export

- Pack Info export markdown: add support for indented / nested bullet lists in the PDF export parser
- Pack Info `Copy to...`
- Pack export subfolder filter
- Pack export body text size and footer text size controls
- Add selection-based spreadsheet export from the file list and grid, e.g. right-click selected rows -> `Export these to Excel`, so small ad hoc subsets do not require a separate filter or folder.

## Library and file management

- Per-capture images
- OS `Open folder in NAM Lab`
- Append to comments (batch)
- Investigate: refresh after copying files may not be fully working. Suspected cause (needs more testing to confirm): `handleCopyToFolder` (`App.tsx` ~2724) only calls `refreshFolderTree()` after a copy, which rescans the folder tree/nav plus pack-info and bundle folder lists (`refreshFolderTree`, ~1898) - it does not reload the currently-open folder's file grid (`loadFolderByPath`/`loadFiles`). If the destination is the folder currently being viewed (or the user copies into a subfolder then navigates there), the newly copied files may not show up until the folder is manually reselected/reloaded. Confirm repro, then decide whether to also reload the current file list when the destination matches (or is under) the currently open folder.
- ~~**Duplicate move destination picker**~~ âœ“ â€” Already implemented; "Change folderâ€¦" button in DuplicatesModal lets user pick destination before moving.

## Import and performance

- Blank xlsx import template with lookup dropdowns
- Large collection / network share load performance: add mtime cache
- Tone3000 search follow-up: if the API stays limited, explore a bounded multi-page fetch/cache strategy for narrow searches, favorites, or creator-focused browsing without trying to mirror the full catalog locally.
- Tone3000 OAuth picker/select flow: add a hosted Tone3000 picker path alongside direct API browsing, so users can choose tones through Tone3000's recommended Select OAuth flow without replacing the current NAM Lab browser/download workflow.

## Onboarding and discoverability

- Inline `?` help popovers on complex fields (Python path, training presets, metadata suggestions, watch folders) â€” one-click "how to set this up" context that doesn't require opening docs.
- Setup wizard (non-forced): shown on the home/empty state when no folder is loaded (first launch experience), and accessible anytime from the Help menu. Covers: (1) loading a NAM folder, (2) key settings walkthrough with plain-language explanations of what each does, (3) capture defaults and what "fill on load" means, (4) Python/training setup if the user wants local training. Not a blocker â€” dismissible at any point.
- Clean function wizard: step-by-step guide explaining what the Clean tool does, when to use it, and how to configure it safely before running it on a real library.
- Metadata suggestions wizard: walkthrough for building suggestion rules â€” explains the concept, walks through creating a first rule, shows a live preview of what would change before the user commits.
- Capture defaults "fill blank on load" toggles: add a checkbox next to each capture default field so users can opt in to auto-populating that field when loading a .nam that has it blank, without needing to configure a full metadata suggestion rule.
- Settings discoverability: the app has grown deep â€” consider a search-within-settings feature or a "Quick Setup" shortcut panel that surfaces the most commonly needed first-time settings (Python path, default folder, modeled-by name) without scrolling the full settings page.

## Grid and UI

- Pack Info / Parse Pack Notes guidance + parser follow-up: clarify in the UI that glossary parsing only recognizes `TOKEN = meaning` or `TOKEN: meaning` today (not `TOKEN – meaning`), make the parser more forgiving for human-written legends that use dash separators, document the intended workflow ("parse into Glossary first, then create folder-scoped rules from curated glossary rows"), and review better default field-targeting for shorthand tokens such as `VAR`, `LO`, `BRI`, `WRM`, `SCP` (likely `nl_amp_switches`) versus cab/DI legend tokens like `DI`, `Mars`, `Mars BE`, `Mars 2` (likely glossary-only or `Comments` by default).

- Metadata header path display: consider a second muted/grey full-path presentation or alternate layout that shows more of the real file path without stealing too much editor real estate.
- Metadata editor: make `Trained By` editable instead of read-only when we are ready to expose trainer/source editing in the normal UI.
- Metadata editor layout: swap the icon/type and date placement in the stats/header area so the date sits on top and the type/icon treatment moves below it.
- Card view right-click "Get Cover Image": for folders without an ampcover, let the user fetch one from the web and save it as `ampcover.jpg`. See implementation notes below.
- Card view size picker: add a small/medium/large toggle (or slider) in the card view toolbar so the user can adjust card size to suit their display/resolution without leaving the view.
- ~~**Simplify the folder tree right-click menu — currently cluttered and overwhelming.**~~ — Done. User (2026-07-10): "very cluttered and overwhelming." `FolderTree.tsx`'s single-folder context menu now promotes 5 always-visible actions (Reveal in Explorer, Import metadata from spreadsheet, New subfolder, Rename folder, Save all in folder) to the top, per the user's explicit pick. Everything else stays in the existing Folder/Metadata/Maintenance/Organize-Export groupings, now collapsed by default behind a clickable header (`MenuSection` component) — collapse state persists via `localStorage` (`nam-tree-menu-collapsed-sections`) across all folders. Multi-select folder menu (2+ folders) is unchanged.

## Keyboard shortcuts

- Define logical shortcut keys for card view navigation (open card view, browse into folder, open folder, back) and common file operations (save, revert, batch edit, next/previous file)
- Add a Keyboard Shortcuts section in Settings for discovering and customizing key bindings

## Checklist and release workflow

- Checklist row sync button is tiny and too far away
- Add a `Sync All` action for checklist rows
- Pack metadata cover image: add adjustable framing / zoom window for `ampcover.*`

## Folder watch

- Add a manual `Resync from watch source` action for a watch rule
- Add a manual `Forget imported history` action for a watch rule

## NAM A2 / PackedWaveNet (future)

- **[PENDING UPSTREAM] PR #676 ESR convention change** — NAM `main` (merged 2026-06-08, not yet released; latest release is v0.13.0 from 2026-06-02). Changes `metadata.training.validation_esr` for A2 from **sum** of both sub-models to **`esrs[-1]`** (channels_8 Full). Also changes epoch `ESR` metric from sum → mean, and removes the `"Aggregate error-signal ratio = X"` stdout line. When a NAM release ships this:
  - `main/index.ts` ~1681: change `finalEsr` for A2 to use `subFull` (channels_8) directly instead of the aggregate/mean.
  - `main/index.ts` ~1624: remove the now-dead `Aggregate error-signal ratio` stdout regex and `epochValidationEsrAggregate` tracking.
  - `esr.ts`: decide threshold treatment for externally-trained A2 captures (no `a2_full_validation_esr` field) whose `validation_esr` will now be a real Full value — either accept slight threshold mismatch or add a versioning convention.
  - Full analysis and action items in `docs/a2-status.md` under "Upstream ESR convention change — NAM PR #676".

- A2 architecture research (done): A2 = PackedWaveNet / Slimmable NAM â€” released in `neural-amp-modeler` source. Uses a fundamentally different model: single flat config with 23 sub-layers, `LeakyReLU` activation, Fibonacci-ish dilations `[1,3,7,17,41,101,239,â€¦]`, and two submodels (`channels_3` + `channels_8`) trained simultaneously so one run yields lite+standard outputs. Config loaded from `config_model_packed.json` resource file.
- A2 NAM Lab support: the current `__namlab__` Architecture enum trick is not applicable â€” the new `core.py` has no `Architecture` enum and no `get_wavenet_config()`. Supporting A2 requires a separate Python runner mode that calls `PackedLightningModule` directly with the packed config JSON. Doable as a new runner branch; should be treated as a separate feature once A2 stabilizes in the official NAM release.
- A2 config reference: packed config is at `nam/train/_resources/config_model_packed.json` in the NAM source; `lr=0.004`, `weight_decay=3.17e-7`, `ExponentialLR(gamma=0.994)`, `mrstft_weight=0.0005`. Two submodels: `channels_3` (nano-class) and `channels_8` (standard-class).

## Remote training (future / exploratory)

- **Remote training agent**: allow NAM Lab on one machine to dispatch training jobs to a separate, more powerful machine on the local network â€” e.g. a dedicated GPU workstation â€” while the user continues editing on their laptop. NAM Lab on the host machine would run a lightweight agent/server that accepts jobs from any NAM Lab instance on the same network.
- **Shared-drive workflow**: the simplest form of remote training would be shared-drive coordination â€” the submitting machine writes WAV pairs and a job manifest to a network path; the remote machine watches that path (via the existing Watch Folders mechanism), trains, and writes `.nam` outputs back. No custom protocol needed; just documenting the pattern and making the UX easy.
- **Remote job monitor**: a "Remote" section or dashboard card that shows live status (epoch, ESR, ETA) streamed from a remote agent, so the user can monitor a GPU workstation run without switching machines.
- **Remote queue dispatch**: extend the existing queue IPC so a job can be marked as `remote`, serialized, and sent to a remote NAM Lab agent over a local network socket (e.g. WebSocket or lightweight REST). The remote agent queues and executes it, streams back progress events, and sends the finished `.nam` back or writes it to a shared path.
- **Agent discovery**: mDNS/Bonjour-based local service discovery so NAM Lab instances can find each other on the network without manual IP entry â€” similar to how AirPlay or local dev servers advertise themselves.
- **Auth / trust model**: for any network-facing agent, define a simple shared-secret or pairing handshake so random machines on the same network cannot submit arbitrary training jobs to an exposed agent.

## Experimental training

- Training panel container usage: reduce the forced-feeling outer padding / dead margins so the trainer uses more of its available width and height, especially as the panel is resized.
- Training entry-point cleanup (partially done): standalone Training workspace exists and is the main surface now; finish retiring or simplifying the old file-level `Metadata | Training` pairing so metadata stays the file editor surface and Training lives as its own standalone workspace/tool.
- Training comparison test: run the same capture through a full `1000 epoch REVxSTD` build in both NAM-BOT and NAM Lab, then compare the resulting `.nam` files directly and also do a listening check to confirm they sound the same (or understand why they do not).
- ~~Training queue controls/icons~~: already SVGs â€” done.
- Training panel layout (partially done): a first cleanup pass happened, but the Training section still needs a dedicated neatening pass so Run WAVs / Run Folder / Queue, routing, and custom controls use space more gracefully and read more cleanly.
- ~~Training architecture picker UX: validate on queue that at least one profile is selected~~ â€” Done. `handleQueue` blocks with "Choose at least one architecture before queueing." when `targetArchitectures.length === 0`; same guard on preset-save flow.
- ~~Training queue status line: fix the misleading green running summary~~ â€” Done in the workspace redesign. Now strip shows the active job name or "Queue idle"; the "Queue Running - 0 queued" wording is gone.
- ~~**Training history graph preview**~~ â€” Stale; training page redesigned.
- ~~Training watch presets: support more than one preset per watch folder~~ — Done. Replaced by Training Bundles: named groups of presets that fan out into multiple training recipes; watcher profiles now reference a bundle ID.
- ~~**[HIGH PRIORITY] Per-architecture batch settings**~~ — Done. Training Bundles let each preset store its own architecture list, epoch count, and all other settings; one submission fans out across all presets in the bundle.
- ~~**[HIGH PRIORITY] New training output folder detection**~~ — Done. A green dismissable banner appears in the Queue section when a batch completes, collecting unique output folder paths from successful jobs.
- ~~**[HIGH PRIORITY] Queue visual ordering after restart**~~ — Done. `getPersistableTrainerQueueJobs()` now filters the original array in-place (builds a set of kept terminal IDs) so submission order is preserved exactly on reload.
- Batch edit — architecture changes: the current Edit modal (epochs / ESR / LR) does not support changing architecture(s). Adding architecture changes is significantly harder because each architecture is its own `TrainerQueueJob` with a separate model name, output path, workspace path, and waveNetConfig. The clean approach is to rebuild the queued job set for the submission: remove all current queued jobs in the submission, then create new ones from the edited payload (same WAV list + new architecture list + updated settings). Needs: (a) store `namingTemplate` and the original WAV output paths on each job (already done — `namingTemplate` added to `TrainerQueueJob`); (b) an IPC handler that takes `(submissionId, { architectures, epochs, thresholdEsr, lr, lrDecay })` and rebuilds the queued jobs; (c) extend the Edit modal with the architecture multi-select. Be cautious: rebuilding jobs resets their `jobId`, `workspacePath`, `outputModelPath` etc. — any running job in the batch must be left alone (only rebuild `queued` jobs).
- **Bug: drag-and-drop in the training queue — PARTIALLY improved (2026-07-10), still not fully reliable. See the dedicated HIGH PRIORITY section near the top of this file.** The 2026-07-10 pass fixed several concrete defects in the hand-rolled mouse-event drag — (a) `elementFromPoint` returned null in the 12px gaps between cards / over padding, so drops there silently did nothing → now falls back to the vertically nearest card within 80px; (b) no visual feedback → the target card now shows an accent ring; (c) the IPC result was discarded so a rejected reorder looked like success → failures now surface in the queue error banner; (d) `moveSubmissionBeforeSubmission` required the *target* batch to have a queued row so dragging above the running batch failed outright → now falls back to the target's first row of any status; plus successful drags finally have a scheduling effect (sticky-preference fix below). **But per the user it still does not reliably drag COLLAPSED batches and has no proper drag ghost/preview image** — the remaining work is scoped in the HIGH PRIORITY section.
- **Per-job drag WITHIN a batch (future, per user):** job rows still use native HTML5 `draggable`/`onDrop`, which doesn't fire `drop` reliably in Electron on Windows — port to the same mouse-event pattern as batch drag when picked up (`reorderTrainerJob` IPC already exists). User: within-batch only, never across batches.
- **[RE-EVALUATE] Prompt for queue placement when queueing while the queue isn't empty.** User (2026-07-10): "i added a new batch while queue not empty, i thought fable had a pass that would ask if you want it at the top, next, or add to do to re-evaluate that" — expected a dialog asking where a new batch should land (top / next / end) when submitted while something is already queued or running. Searched all branches/history (`git log --all -p -S` for queue-placement-choice code, "Add to top", "where would you like", etc.) and found **no trace this was ever implemented** — either it was scoped/discussed in an earlier session but never actually built, or it's a mix-up with a different app/session. Treat as a fresh feature to build, not a regression to restore.
  - Underlying behavior today (unchanged): `enqueueTrainingPayloads` (`main/index.ts` ~3136) always does `trainerQueue.push(...jobs)` — straight append to the end, no prompt. Finished/failed/canceled rows deliberately stay in the queue until cleared (so a running batch stays visible), which means a freshly queued batch often visually lands right under the current batch simply because the running batch is the last "live" entry before it.
  - If built: reuse the existing reorder primitives already shipped (`moveSubmissionBeforeSubmission` / `moveSubmissionToEnd` / the sticky-preference fix from the 2026-07-10 queue-semantics pass) rather than inventing new queue-placement logic — the prompt would just be a UI-level choice that calls into machinery that already exists and is already correct.
- **Drag-and-drop a WAV file onto an existing batch card (Queue or Staged Batches) to append it to that batch.** User (2026-07-10): "say i add 5 captures, its running 2 of 5...and i find a 6th file i want to add to this batch, i just drag it to the batch window and it adds it to the end of that batch." Assessed as medium difficulty, not a deep architectural change:
  - **The hard part is already solved.** `groupedQueue`/`groupedStagedQueue` (`TrainingPanel.tsx`) group jobs by `submissionId` regardless of array position/insertion order — a new job pushed with the SAME `submissionId` as an existing batch will automatically render merged into that batch's card. No new grouping/merging logic needed; `enqueueTrainingPayloads` (`main/index.ts:3146`) already does the actual enqueue.
  - **Real work needed:** (a) a drop handler on the batch card `<div data-submission-id=...>` in both the Queue Batches view (`TrainingPanel.tsx` ~3221) and the separate Staged Batches rendering; (b) build a `TrainerStartPayload` for the dropped file by cloning settings (architecture, epochs, LR, thresholdEsr, output routing/naming template, Input DI, `submissionId`) from an existing job already in that batch — same WAV-drop pattern the Create Batch form already uses (`addWavsToBatchList`, ~line 4212), just targeting an existing submission's template instead of the form's current draft settings.
  - **The one genuinely fiddly part:** multi-architecture batches. If the original 5 captures were fanned out across multiple architectures (e.g. both A1-Standard and A2), dropping 1 new file should likely create one new job PER distinct architecture already present in that submission, not just one job — mirroring the original fan-out. Needs a real decision, not just code.
  - **Scope decision:** probably disallow dropping onto a `watcher`-sourced batch (`sourceMode: 'watcher'`) — manual mid-batch additions don't fit that source mode's model, and the user's described scenario is a manual "Run WAVs" batch anyway.
- ~~**[VERY SOON] Training queue semantics pass: reorder / park / sticky-batch behavior.**~~ — Done (2026-07-10), all sub-items shipped:
  - ~~`Run next` / move-to-top doesn't actually run next~~ — Fixed. New `trainerStickyPreferenceCleared` flag: every explicit reorder (batch drag, Run next, per-job Next, watcher retry-now) recomputes whether the first queued job now belongs to a different batch than the active one; if so, the next pump after the current job finishes uses pure queue order instead of the sticky preference. The running job is never interrupted, and reordering the active batch back to the front restores normal batch-continuation (recomputed, not latched).
  - ~~Batch reordering moves every non-active row~~ — Fixed. `moveSubmissionBeforeSubmission` / `moveSubmissionToEndOfQueue` now move **queued rows only**; the active job stays pinned, staged rows stay in Staged Batches, terminal rows don't participate. The grouped-card UI already merges split batches and anchors card order on the first queued/running row, so rows left behind never split a card.
  - ~~Park wording~~ — Fixed. "Park batch" tooltip now says explicitly: finishes the current capture if one is training, then freezes the rest in Staged Batches; does NOT stop the active run (Emergency stop does that).
  - Restart behavior preserved as-is (starting/running rows demote to queued on load, queue paused) — untouched.
  - ~~Parked-batch finished rows review~~ — Decided (user): keep finished rows visible in the queue card. `pruneFinishedBatchesFromQueue` no longer skips staged rows when deciding all-success, so parking a half-done batch keeps its finished rows in the queue as a progress record until the parked remainder is unstaged and completes.
- Queue grouping (partially done): queue/history rows already carry submission grouping for `Run WAVs`, `Run Folder`, and `Watcher`; remaining work is to deepen the batch/session UX where it helps without complicating the serial executor.
- ~~Live A2 ESR labeling~~ — Done. The live stat card now shows `Validation ESR (Full)` for A2 runs.
- ~~Queue/history grouping UX: collapsed/expanded batches~~ â€” Done. Queue cards have per-batch chevron + Expand-all / Collapse-all buttons in the filter bar; same on Staged Batches header.
- Training preset sharing: consider an export/import format so Capture Profile configs can be shared between users as standalone recipe files.
- Training history (partially done): reviewable grouped history exists; add export/report workflows and make sure the long-term storage/revisit experience is as useful as the live queue.
- **Plan a retry workflow rethink.** Current retry behavior always creates a brand-new submission (`Retry - ...`) rather than mutating the old history/queue row in place. That is technically safe, but it may not match user expectations when the failure is clearly non-retryable (for example a NAM pre-check failure like bad validation replicate/self-ESR). Plan a UX pass before changing behavior:
  - Decide whether Retry should stay as "always re-queue a fresh batch" or split into clearer actions such as `Retry`, `Retry as new batch`, `Re-run failed capture`, or `Duplicate settings`.
  - Consider context-sensitive behavior for known non-retryable failures: disable Retry, warn first, or offer a more specific action like `Open log` / `Review source WAV` instead of implying the same input will likely succeed on a second try.
  - Revisit whether the original failed row should remain visually distinct from the new retry submission, and whether there should be an explicit parent/child link between them in History.
  - If the workflow changes, update help/tooltips so users understand whether retry reuses current settings, current Input DI, current routing, and backup-overwrite behavior.
- Training watcher intake: maybe later, if the final expected output file is missing, allow reprocessing even when matching history already exists.
- Training verification report (partially done): WAV Check tab added â€” compares NAMs in the current folder against a user-chosen WAV staging folder, shows trained/missing/extra counts, and provides per-row Train and Train All buttons that enqueue jobs and jump to the queue view; remaining work is to surface ESR targets, epoch counts, and architecture verification against preset expectations.
- Training verification report (WAV Check tab, `WavCoverageTab.tsx`): add export for missing-only items from either side - the "Missing NAM" (red, WAVs with no trained NAM) and "No Source WAV" (amber, trained NAMs with no matching WAV) sections currently have no export at all. Also add a per-section "Copy all names" action for each column - today the only copy affordance is a per-row right-click "Copy filename" context menu (one file at a time), there is no bulk copy of every missing name in a section to the clipboard.
- Training workflow (partially done): submission groups exist in queue/history; later consider a higher-level `job / batch` concept where one queued item can represent a multi-format set while watcher mode remains a separate automation layer.
- Training settings IA (partially done): training already has its own Settings tab; revisit once watcher folders, presets, history, and verification need more room or more specialized navigation inside Training itself.
- Training watch/preset UX: redesign watch folders and presets into a cleaner expandable master-detail style, so the user first sees a compact list with key summary fields and only expands/drills into one item at a time to edit the full details.
- ~~Training drag-and-drop WAV intake~~ — Done. The WAV list drop zone in Create Batch accepts WAV files and folders from Windows Explorer/Finder via `webUtils.getPathForFile`.
- **[HIGH PRIORITY] Training history: per-batch expand/collapse + investigate paging.** Queue and Staged Batches both already have per-batch collapse (chevron, backed by the shared `collapsedBatches` set) plus filter-bar "Expand all" / "Collapse all" buttons (`TrainingPanel.tsx` ~3038 and ~3465) - History has neither. Every group in `groupedHistory` always renders all of its entries unconditionally (~3820), so a batch with many captures cannot be collapsed at all, and there is no global expand/collapse toggle in the History filter bar. Add the same collapsedBatches-backed chevron per group plus matching Expand all / Collapse all buttons, reusing the existing pattern rather than inventing a new one.
  - Also look into paging (or windowed/virtual scrolling) for History: the tab currently renders every entry into a single grouped list, and with 1000s of past runs the page becomes heavy. Default ~50-100 entries per page, with Older/Newer controls and a Show all escape hatch. Filter/search must apply across the full history, not just the current page. Worth checking whether per-batch collapse alone (above) is enough to keep things light before committing to full paging/virtualization.
- Training dashboard counter behavior: verify the intended lifecycle of the Dashboard `Completed` / `Failed` / `Queue progress` tiles end-to-end. Expected today: (a) within a session, the counters stay at the last finished queue's totals until a new batch is queued, at which point finished/error/canceled rows auto-clear from the queue and the tiles reset to 0; (b) across app restarts, the queue persistence file only stores `staged + queued + running` jobs so success/error rows never round-trip and the tiles read 0 on cold start. Run the scenarios â€” finish a queue and reopen the dashboard, queue a new batch and confirm the counters drop, close the app and reopen with nothing pending, close with staged batches pending â€” and see if the lived behavior matches expectations. If the "counters stuck at last run's count" reminder is more confusing than helpful, switch the Completed/Failed tiles to read from `todayStats` (history-today scope) instead of the in-memory queue so they read as a session counter.
- OS drag-and-drop from Explorer/Finder: main library area (`handleOsDrop` in App.tsx) and training WAV intake are done. Remaining: wire drag-drop intake in gear-locker and expense-tracker.

## Metadata suggestions and organization

- Refine overwrite guards for metadata suggestion rules with a friendlier UI than a raw comma-separated text field (for example chips, multi-pick placeholders, or explicit junk-value presets).
- Expand friendly pattern-rule support beyond the first-pass `Prefix + value` matcher for settings strings like `G5.5`, `G1.2`, `G8`.
- Phase II / discussion: support broader wildcard or regex-style suggestion rules for patterned metadata tokens where one rule should recognize a family of values without requiring a separate exact-token rule for every variant.
- Discussion: explore reverse-template / pattern-based rules that extract metadata from naming structures (for example something in the spirit of `{tone_type} {creator} {cabinet}`) without requiring users to understand regex.
- Design a safe explicit-source workflow to collect `.nam` files from user-chosen intake folders into a working folder, without trying to automatically infer which existing folders are "loose" versus valid staging/archive/release locations.
- Investigate a safe "build logical folder structure from existing metadata" helper: preview-only first, because auto-restructuring by amp / cab / combo / settings could be powerful but dangerous if metadata is incomplete or wrong.
- AI-assisted suggestion rule discovery: explore sending a sample of a folder's filenames and existing metadata values to the AI and asking it to identify meaningful token patterns worth turning into suggestion rules â€” e.g. it notices `G5.5` / `G1.2` prefixes map to `input_level_dbu`, or that a filename segment always matches `gear_model`. Would need a clear review/confirm step before any rules are committed.
