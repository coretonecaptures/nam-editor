# Live and playback player audit

Date: 2026-10-23. Branch: `feature/ir-lab-manager`.

> **Status (2026-10-23): findings 1–12 fixed** on `feature/ir-lab-manager` (commits `f582b70`, `e15ffdc`). Also fixed: live output now has the preview's 10 Hz DC blocker; IR swaps no longer leave the old convolver running. Still open from "Additional concerns": measured live/preview level parity, the latency label, and multichannel-input hardware checks. `scripts/audit-player.cjs` now asserts the fixed behaviour. The rest of this document is the original audit, unchanged.

Scope: `PlayerPanel`, `LiveEngine`, offline render worker, audio helpers, NAM/gate/reverb worklets, and native WASM bridge. Production code has not been changed. Findings below are code-confirmed; eight also have diagnostic reproductions. No physical interface, microphone, headphones, or OS device switching was tested.

Priority: P1 = fix first (unexpected level, monitoring lifecycle, or graph duplication); P2 = functional/DSP correctness issue.

## Findings

### 1. P1 — Live output has no final peak ceiling or non-finite guard

References: `src/renderer/src/utils/liveEngine.ts:945`, `:1045`; `src/renderer/public/nam-worklet.js:297`; `src/renderer/src/utils/playerAudio.ts:281`.

The live graph multiplies model output by metadata-based normalization and volume, then connects directly to the destination. The normalization gain clamp bounds the multiplier, not the signal. EQ and additive effects can raise it further. The worklet also copies non-finite DSP samples without sanitizing them. Preview instead measures its rendered signal and caps the peak at 0.99.

Evidence: the existing native worklet test produces peak 10.19616 with `wavenet_a2_max.nam`. Its declared loudness is -20 dB. Live normalization is approximately 1.259, yielding a possible peak of 12.836 at unity volume, whereas preview normalization yields 0.99. This is over-range digital audio; actual perceived loudness depends on downstream clipping and hardware. The fixture establishes the missing protection, not the prevalence among user captures.

Suggested fix: add a final output protection stage after all effects, sanitize non-finite samples before they enter stateful processing, and test high-output/missing-loudness models. Preserve a predictable level when enabling cabinets/effects.

Validation: native WASM tests and diagnostic reproduction.

### 2. P1 — Stopping or closing during live startup does not cancel startup

References: `src/renderer/src/components/PlayerPanel.tsx:1083`, `:1233`, `:1444`, `:1448`; `src/renderer/src/utils/liveEngine.ts:872`.

`startLive()` crosses several file/decode awaits before assigning an engine, then awaits `engine.start()`. Neither layer uses a cancellation generation. Switching to Preview or unmounting can call stop while those awaits are pending, after which the old continuation can still create an audio context, request a microphone, connect output, and start a meter loop. A capture changed while startup is pending can also leave the old capture loaded because the capture-change effect restarts only when `liveRunning` is already true. Concurrent starts can overwrite shared refs and release the same owner slot.

Evidence: holding WASM loading pending, calling `stop()`, then resolving loading still constructs a new AudioContext. This is reproduced without opening a device.

Suggested fix: cancellation generations at panel and engine levels, checked after every await; serialize starts/stops; dispose stale engines/streams immediately. A stop must invalidate pending permission requests and release any stream they eventually return.

### 3. P1 — Playback can override the current volume with an old value

Reference: `src/renderer/src/components/PlayerPanel.tsx:972`, `:1000`, `:1038`.

`startPlaybackAt` reads `volumeGain` but omits it from its callback dependencies. Turning the volume down updates an existing GainNode through an effect, but Play/Restart/seek subsequently assigns the old captured value back to that node. Before the first play, the volume effect has no node to update, so Play can also ignore a volume change entirely. The slider continues displaying the newer value. This includes setting the control to mute before pressing Play.

Suggested fix: read a current gain ref, or include the current gain in the callback dependencies; ramp changes consistently.

Validation: source inspection; the current tests do not mount effects or interact with the transport.

### 4. P1 — Overlapping IR rebuilds leave duplicate connected branches

References: `src/renderer/src/utils/liveEngine.ts:2310`, `:2329`, `:2346`, `:2399`; `src/renderer/src/components/PlayerPanel.tsx:1379`, `:1398`.

Cabinet rebuilds tear down the old graph, await resampling, and then connect newly built nodes without a transaction/version check. Two rebuilds can both finish and attach their branches, with only the last branch retained in the engine's fields. The earlier branch remains audible and cannot be controlled through those fields. Both slot effects run when `liveRunning` becomes true, so overlap does not require rapid user clicking. The problem is demonstrable when resampling is asynchronous; the diagnostic did not reproduce duplicate branches when rates already matched.

Evidence: simultaneous A/B changes with 44.1 kHz impulses in a 48 kHz graph leave four connected convolvers instead of two. Duplicate branches can sum output and add CPU cost. The delay/reverb IR loaders also commit after awaits without checking whether their request or context was superseded.

Suggested fix: prepare nodes off the active path, reject stale builds, and atomically install/crossfade one current graph. Apply lifecycle guards to all async impulse loaders.

### 5. P2 — An old preview request can terminate the newer render worker

Reference: `src/renderer/src/components/PlayerPanel.tsx:759`, `:802`, `:838`.

The generation check runs only after all rendering/postprocessing or in catch. An older request still reading/decoding/resampling can resume after a newer request has created its worker. The older request unconditionally terminates `workerRef.current`, which now belongs to the newer request. Termination does not settle that newer request's promise. The old request's eventual result is rejected as stale, leaving the current preview stuck in rendering without a buffer.

Suggested fix: check generation after every asynchronous preparation step, associate each worker with its own request, and explicitly settle cancellation. Invalidate the generation on unmount as well, preventing a pending file read from creating a worker/context after cleanup.

Validation: source inspection and asynchronous ordering analysis.

### 6. P2 — Starting with cabinet mix at zero makes later mix changes ineffective

References: `src/renderer/src/utils/liveEngine.ts:2365`, `:2619`.

`wireCabinets()` skips constructing cabinet and dry gain nodes when mix is zero, connecting NAM directly to FX. `setIrMix()` only updates existing gains. Start with a selected IR and 0% mix, then raise the mix: the direct bypass stays connected and the IR remains absent until another event rebuilds the cabinet graph.

Suggested fix: build cabinet branches whenever impulses are present, even at zero wet gain, or rebuild when crossing out of the direct bypass state.

Validation: diagnostic reproduction.

### 7. P2 — Clearing cabinet B can silence or attenuate cabinet A

References: `src/renderer/src/components/PlayerPanel.tsx:2687`, `:2702`; `src/renderer/src/utils/liveEngine.ts:2338`, `:2446`.

Choose A and B, blend fully toward B, then clear B. The clear button changes only B's path; the blend stays at 1. A's wet gain is zero, B no longer exists, and dry gain is zero at 100% cabinet mix. The blend control disappears, leaving the rig silent. Partial blend values leave A attenuated. Removing/disabling A while blend favors A has the corresponding issue.

Suggested fix: reset/resolve blend when a slot disappears, routing the sole remaining cabinet at full wet weight.

Validation: diagnostic reproduction of the engine state reached by clearing B.

### 8. P2 — Live always runs models at 48 kHz, unlike playback

References: `src/renderer/src/utils/liveEngine.ts:880`; `src/renderer/public/nam-worklet.js:241`; `src/renderer/src/components/PlayerPanel.tsx:797`; `native/nam-wasm/NAM/dsp.cpp:105`.

Preview reads the model's `sample_rate` and resamples the DI accordingly. Live hardcodes the context to 48000 and resets every model at the worklet's global sample rate. The bundled DSP Reset records the external rate but does not perform rate conversion. A declared 44.1/96 kHz model therefore runs its learned sample-domain behavior at the wrong rate in live mode. A pedal and amp trained at different rates are also accepted without conversion or warning. The comment saying this asks for the model's rate does not match the implementation.

Suggested fix: select the main model rate where supported, detect incompatible pedal/main rates, and either resample around each stage or reject unsupported combinations with a clear explanation.

Validation: source inspection; audible comparisons at alternate model rates remain to be performed.

### 9. P2 — Convolution Delay bypasses the selected effect order

References: `src/renderer/src/utils/liveEngine.ts:1614`, `:1808`.

Algorithmic Delay receives `delayIn`, whose source changes when Echo Lab is placed before/after Delay. Convolution Delay always receives `tremOut`. When Echo Lab is before Delay, convolution repeats omit Echo Lab's processed output even though the dry/algorithmic path follows the chosen order.

Suggested fix: feed convolution from `delayIn`, keeping both delay modes inside the same reroutable unit.

Validation: diagnostic reproduction inspects the actual connected source.

### 10. P2 — Changing input with a pedal breaks routing when the gate is unavailable

Reference: `src/renderer/src/utils/liveEngine.ts:2530`.

Startup correctly routes splitter → pedal → amp when a pedal is loaded and the optional gate cannot load. `setInputChannel()` assumes the first node is either gate or main worklet. It tries to disconnect the main worklet, catches the missing-connection exception, skips disconnecting the old tuner tap, then connects the newly selected channel straight to the amp. The old channel continues through the pedal while the new channel is added directly. Tuner inputs can also be summed.

Suggested fix: retain the actual first input node and use it consistently for channel selection; isolate disconnect failures so they do not skip unrelated cleanup.

Validation: diagnostic reproduction. Requires the gate module/node failure fallback and a loaded pedal.

### 11. P2 — A failed model/worklet silently passes raw input

References: `src/renderer/public/nam-worklet.js:274`; `src/renderer/src/utils/liveEngine.ts:927`.

The not-ready/no-model branch copies input whenever `modelHandle` is zero, including failed initialization or rejected model loading. `LiveEngine.start()` does not await a successful `modelLoaded` acknowledgement; error messages only update UI text. The session can report running while monitoring dry input, or an amp can receive raw signal instead of the requested pedal stage.

Suggested fix: distinguish explicit bypass from unloaded/error states. Keep failed stages silent, await model readiness before arming output, and reject startup on fatal model errors.

Validation: actual worklet JavaScript evaluated in a VM; failed initialization followed by `process()` copies a 0.25 input unchanged.

### 12. P2 — Animation loops outlive the transport/session

References: `src/renderer/src/components/PlayerPanel.tsx:972`, `:1034`, `:1333`, `:1448`.

Each seek/restart starts a new playback RAF loop without cancelling the existing loop. Only the newest request ID is stored, so Stop cancels only one loop; the older ones keep scheduling meter/progress updates. Separately, live unmount cleanup calls engine.stop() directly without cancelling `liveMeterRafRef`, leaving the live meter/tuner closure scheduling after the panel has been removed.

Suggested fix: cancel an existing RAF before each transport restart, guard each tick by session generation, and share complete live cleanup between Stop and unmount.

Validation: source inspection of scheduling and cleanup paths.

## Additional DSP and measurement concerns

- **Live/preview level matching remains approximate.** Preview measures RMS change caused by the actual cabinet-filtered signal; live divides by the IR's L2 norm. Those are different measurements for colored guitar signals. Metadata normalization is also clamped differently, and missing-loudness preview peak-normalizes while live uses unity. Matching target constants does not establish equal perceived levels. Measure representative clean/high-gain captures with the same input and cabinet before claiming parity.
- **DC treatment differs.** Preview calls `applyDcBlocker`; the live worklet/graph has no equivalent output DC blocker. Captures with DC offset can use headroom differently and create different transients. Validate with asymmetric models and a DC test signal.
- **Latency is labeled round-trip but includes output estimates only.** `LiveEngine.latencyMs` adds context base/output latency and omits input capture buffering and other unmeasured delay. Treat it as an output estimate or measure actual round-trip latency with an interface loopback.
- **Input channel discovery needs hardware verification.** The graph sizes its splitter/meters from `MediaStreamAudioSourceNode.channelCount`, without obtaining the track's actual channel count or requesting a multichannel capture explicitly. Verify mono, stereo, and >2-channel devices before claiming all hardware channels are selectable.

## Validation performed

- Focused Vitest run: **141 tests passed across 6 files** (`playerAudio`, `liveEngine`, `liveEngineOwner`, `impulseTrim`, `PlayerPanel`, `namRender.worker`). These predominantly exercise math/settings, worker behavior, and server-rendered UI; they do not establish live graph/lifecycle correctness.
- `node native/nam-wasm/test/worklet.cjs`: **26 checks passed**. Covers WASM manifest/shim and three test models; it does not execute the full production engine graph.
- `node native/nam-wasm/test/test.cjs`: **13 checks passed**. Offline model processing and malformed-input recovery.
- `node scripts/audit-player.cjs`: **8 current-bug diagnostic reproductions confirmed**. Uses the real transpiled engine/helpers and worklet code with mocked graph nodes/deferred resampling. No physical device is opened. These assertions intentionally describe current failures; convert them to desired-behavior regression tests during fixes.

Recommended fix order: output/volume protection; startup cancellation; serialized IR replacement; preview request ownership; remaining routing/transport issues; model-rate handling and measured live/preview DSP parity. Hardware listening, sustained CPU/dropout profiling, and platform/device testing remain outstanding.
