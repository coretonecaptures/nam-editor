# Live player AudioWorklet spike

Proves that NAM inference can run on the real-time audio thread in Electron — the thing the
original `feature/player` attempt could not achieve.

## Run

```bash
SPIKE_PUBLIC_DIR="<repo>/src/renderer/public" \
SPIKE_NAM_PATH="<some real capture>.nam" \
node_modules/electron/dist/electron.exe native/nam-wasm/test/live-spike/main.cjs
```

Exits 0 on pass. Prints each step, then a `SPIKE_DONE {...}` JSON line.

## Why it's a standalone harness

- **Own `userData` dir.** NAM Lab holds a single-instance lock, so launching the real app while
  it's already running just quits — the spike would never run.
- **Serves over `http://127.0.0.1`.** `AudioWorklet.addModule()` and `fetch()` of a `.wasm` are
  both blocked from `file://`.
- **Deliberately sends no COOP/COEP headers**, so a pass proves the approach does not depend on
  cross-origin isolation.
- **Renders through an `OfflineAudioContext`**, so it needs no audio device, no microphone
  permission and no user gesture. Live input is a separate phase.

## Result (2026-07-29, Electron 41 / Chromium)

```
crossOriginIsolated=false  SharedArrayBuffer global=false
fetched wasm 508KB, model 276KB
compiled WebAssembly.Module
audioWorklet.addModule OK
AudioWorkletNode constructed — no DataCloneError
worklet: wasm instantiated inside AudioWorkletGlobalScope
worklet: wasm memory backing = ArrayBuffer
worklet: model loaded, loudness=-19.71158790588379 sr=48000
rendered 48000 frames, peak 0.260202, nonFinite 0
PASS — NAM inference ran on the audio thread in Electron
```

The two lines that matter:

- `AudioWorkletNode constructed — no DataCloneError` — the exact failure that killed the previous
  attempt (`SharedArrayBuffer transfer requires self.crossOriginIsolated`).
- `wasm memory backing = ArrayBuffer` with `crossOriginIsolated=false` — the module never
  allocates shared memory, so the isolation requirement simply never applies.

## What this required

- **`-fwasm-exceptions`** in the worklet build. Lowering C++ exceptions into the wasm instead of
  JS trampolines cut imports **59 → 9**, few enough to stub by hand. Emscripten's glue cannot run
  in `AudioWorkletGlobalScope` (no `import`, `importScripts`, `fetch` or DOM), so the worklet
  instantiates the module itself.
- **`-sALLOW_MEMORY_GROWTH=0`.** Growing the heap inside an audio callback isn't real-time safe,
  and a fixed heap also means the `Float32Array` views can never be detached.
- **A generated name manifest.** `-O3` minifies the wasm boundary to single letters and keeps the
  mapping only in the unused glue, so `tools/gen-worklet-manifest.cjs` extracts it at build time.
  Hardcoding the letters would silently call the wrong C function after any reorder.

## Constraint found the hard way

`AudioWorkletGlobalScope` has **no `TextEncoder`** — the first run failed with
`loadModel: TextEncoder is not defined`. The model is now encoded to UTF-8 on the sending side
and transferred as bytes, which is better regardless: no string work in the audio scope.

## Measured headroom (128-frame quantum, real captures)

```
7.4–7.8x realtime · ~13% CPU · worst block 0.88–1.44ms vs 2.67ms budget
```

## Not yet proven

This validates the **DSP path only**. Live guitar input (`getUserMedia`, device selection,
permissions) and end-to-end latency are Phase 3. Expect 20–50ms round trip — Chromium can't use
ASIO on Windows, so the WASAPI path is the ceiling regardless of interface.
