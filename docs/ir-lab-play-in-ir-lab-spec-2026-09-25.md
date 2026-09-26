# IR Lab side: "Play in IR Lab" — `irlab://playcab` route

Written 2026-09-25, for hand-off to whoever's working the IR Lab side. NAM Lab's half is
already built and sending this payload (`irLibraryIpc.ts`'s `sendPlayCabToIrLab` handler,
`irLabConnector.ts`'s `playcab` `IrLabPayload` kind) — it's a real URL your app will receive
the moment this route is added, not a future hypothetical.

## What NAM Lab sends

```
irlab://playcab?item=<abs path 1>&item=<abs path 2>[&item=<abs path 3>][&item=<abs path 4>]
```

- 1-4 repeated `item=` params (never comma-joined — same convention `blend` already uses),
  each an absolute path to a real `.wav` file.
- Already pre-flighted on NAM Lab's own side against the same three configured folders
  `blend` checks (Cab IR / Reverb IR / DI, `LiveAuditionSettingsStore`) — but treat that as a
  courtesy, not a guarantee: **IR Lab must re-validate every path itself**, exactly like
  `blend` already does, since the scheme is registered system-wide and any process can invoke
  it.

## What it should do

Confirmed directly against your own source (`ExternalHandoffRouter.cpp`, `LiveAuditionEngine.h/.cpp`,
`LiveAuditionLoadCoordinator.cpp`) before writing this — this is not a guess:

1. Add `else if (route == "playcab")` to `ExternalHandoffRouter.cpp`'s route dispatch
   (alongside `session`/`blend`/`nam`/`namgroup`/`project`), right next to `blend`'s own
   handler — reuse its exact allowlist block (`allowedRoots` built from
   `LiveAuditionSettingsStore::defaultCabIrFolder/defaultReverbIrFolder/defaultDiFolder()`,
   the `isAllowed` lambda checking `.wav` + is-under-a-root) rather than writing a second copy
   of it.
2. Collect the 1-4 validated `item=` files, in the order they arrived.
3. Read each with `tools::readMonoWav(file)` (already used for every existing "load a cab IR
   from a file" path — `MainComponent.cpp:1824`, `LiveAuditionLoadCoordinator.cpp`, etc.) to
   get `{ samples, sampleRate }`.
4. Call `liveAuditionEngine.loadCabImpulseResponse(samples, sampleRate,
   file.getFileNameWithoutExtension(), slot, cabIndex)` — the exact function every existing
   "pick a cab IR from disk" flow in your own codebase already calls. This is genuinely just
   wiring into an existing, well-exercised function (used from well over a dozen call sites
   already), not new DSP/audio-engine work.
5. Slot mapping, per the count of files received:

   | Files | `loadCabImpulseResponse` calls |
   |---|---|
   | 1 | slot 0, cabIndex 0 (Cab A) |
   | 2 | slot 0, cabIndex 0 (Cab A) + slot 1, cabIndex 0 (Cab B) |
   | 3 | slot 0/1 cabIndex 0 (Cab A/B) + slot 0 cabIndex 1 (stereo lane B's Cab A) |
   | 4 | slot 0/1 cabIndex 0 (Cab A/B) + slot 0/1 cabIndex 1 (stereo lane B's Cab A/B) |

   3-4 files implies the user wants the stereo fork — per your own acceptance-criteria intent
   (this doc's companion audit's own wording): **ask once before silently enabling the fork**
   if it isn't already on, rather than flipping it on with no confirmation. If the user
   declines, fail the whole request with a clear reason rather than silently dropping to a
   2-file result.
6. `appShell.setActiveWorkspace(ui::AppShell::Workspace::liveAudition)` before loading, same
   as the existing `nam` route already does.
7. On any rejected/missing/invalid file: fail before loading anything (don't partially load
   2 of 4 slots then report an error) — `showFailureBanner(...)`, same idiom every other route
   in this file already uses for its own failure cases.
8. On success: report which slots got loaded and with what names (matches the audit's own
   acceptance criteria: "the UI reports loaded slots and names, or a concrete failure reason").

## What it must NOT do

- Must not change amp, FX, input/output, or any other rig state beyond the cab slots it's
  explicitly asked to fill.
- Must not restructure the rig (e.g. silently turn on the stereo fork for a 1-2 file request,
  or turn it off for a 3-4 file request if some OTHER reason has it off).

## Out of scope for this route

- No new allowlist logic — reuse `blend`'s.
- No new WAV-reading code — reuse `tools::readMonoWav`.
- No new cab-loading code — reuse `loadCabImpulseResponse`.

If none of the above turn out to be true once you're actually in the code (e.g.
`loadCabImpulseResponse`'s signature has since changed, or the stereo-fork confirmation
dialog doesn't have an existing pattern to reuse), that's worth flagging back rather than
silently working around — the whole point of checking the source before writing this was to
make sure this spec doesn't ask for something that doesn't match what's actually there.
