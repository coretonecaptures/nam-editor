# nam-wasm — offline NAM inference for NAM Lab

Builds a **single-threaded** WebAssembly module that runs Neural Amp Modeler inference over a
whole audio buffer at once, for the in-app tone preview player.

## Why this exists (read before "fixing" the build flags)

The obvious approach — use Tone3000's published
[`neural-amp-modeler-wasm`](https://github.com/tone-3000/neural-amp-modeler-wasm) package and its
`T3kPlayer` React component — **does not work inside Electron**, and it isn't a bug we can patch
around. That package's WASM module is built with `-pthread -sAUDIO_WORKLET -sWASM_WORKERS`,
because it does *real-time* processing on the Web Audio render thread. A threaded WASM build
means the module's memory is a `SharedArrayBuffer`, and Chromium refuses to transfer a
`SharedArrayBuffer` into an `AudioWorklet` unless the page is genuinely cross-origin isolated
(`self.crossOriginIsolated === true`).

We could not make `crossOriginIsolated` true in Electron. `docs/player-investigation.md` records
the full attempt list (COOP/COEP headers via `onHeadersReceived`, a custom `app://` protocol,
Vite dev middleware, `sandbox: true`, packaged vs dev builds, `credentialless` COEP, manually
recovering the `SharedArrayBuffer` constructor). The failure is always the same
`DataCloneError` at `new AudioWorkletNode(...)`.

The way out: **a preview player doesn't need real-time processing.** It can render the whole
buffer once and then play the result. And the inference itself never needed threads — it's one
synchronous `nam::DSP::process()` call. The threading only ever existed to service the real-time
audio callback every 128 samples.

So this module keeps upstream's DSP (same C++ core, so output is bit-accurate to the real NAM
plugin) and throws away the real-time scaffolding. Built without `-pthread`, nothing ever
allocates a `SharedArrayBuffer`, so cross-origin isolation is never consulted and the module
loads in an ordinary Web Worker.

**This is not a security workaround.** COOP/COEP gate shared memory because shared memory plus
high-resolution timers enable Spectre-class side-channel attacks. We aren't bypassing that
gate — we're not using the feature it guards. Do **not** try to "fix" this by forcing
`crossOriginIsolated` on via Chromium launch flags; that disables a real mitigation, and it's
also what the previous attempt already failed to achieve.

## Layout

```
NAM/                  Vendored DSP core from tone-3000/neural-amp-modeler-wasm (MIT)
vendor/nlohmann/      Vendored nlohmann/json single header
src/nam_offline.cpp   Our entry point — the only file that isn't upstream
CMakeLists.txt        Single-threaded Emscripten target
build.sh              Fetches Eigen, configures, builds, copies output
deps/                 Eigen, fetched by build.sh (gitignored)
build/                Build output (gitignored)
```

Vendored from upstream commit `755686ee86894d89f463200f4574764dd1dd4290`. Upstream is MIT
licensed; see `LICENSE.upstream`.

## Building

Needs the [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html):

```bash
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk && ./emsdk install latest && ./emsdk activate latest
source ./emsdk_env.sh
```

Then:

```bash
./build.sh
```

Writes `nam-offline.js` + `nam-offline.wasm` into `src/renderer/public/`.

The build output is committed so contributors don't all need Emscripten installed — only rerun
`build.sh` when `src/nam_offline.cpp` or the vendored `NAM/` sources change.

## API

All functions are plain C, callable via `ccall`/`cwrap`. Pointers are offsets into the WASM
heap; allocate with `_malloc` and write samples through `HEAPF32`.

| Function | Signature | Notes |
|---|---|---|
| `namLoadModel` | `(const char* json) -> void*` | Parses `.nam` file contents. Returns `nullptr` on failure (unsupported version, bad JSON). |
| `namResetModel` | `(void* h, float sampleRate, int maxBlock)` | Resets **and prewarms**. Call before each render. |
| `namProcessBuffer` | `(void* h, float* in, float* out, int n) -> int` | Mono. `in` and `out` may be the same pointer. Returns 1 on success. |
| `namGetLoudness` | `(void* h) -> float` | dB. Check `namHasLoudness` first. |
| `namHasLoudness` | `(void* h) -> int` | Distinguishes "0 dB" from "unknown". |
| `namSetSlimmableSize` | `(void* h, float size)` | A2/Slimmable sub-model select; `0.0` = nano, `1.0` = full. No-op otherwise. |
| `namFreeModel` | `(void* h)` | Safe with `nullptr`. |

### Usage sketch

```js
const Module = await createNamModule()

const jsonBytes = Module.lengthBytesUTF8(namFileText) + 1
const jsonPtr = Module._malloc(jsonBytes)
Module.stringToUTF8(namFileText, jsonPtr, jsonBytes)
const model = Module._namLoadModel(jsonPtr)
Module._free(jsonPtr)
if (!model) throw new Error('Unsupported or invalid .nam model')

Module._namResetModel(model, sampleRate, input.length)

const inPtr = Module._malloc(input.length * 4)
const outPtr = Module._malloc(input.length * 4)
Module.HEAPF32.set(input, inPtr >> 2)
Module._namProcessBuffer(model, inPtr, outPtr, input.length)
// Copy out — the heap view can be detached by later allocations if memory grows.
const rendered = new Float32Array(
  Module.HEAPF32.subarray(outPtr >> 2, (outPtr >> 2) + input.length)
)

Module._free(inPtr)
Module._free(outPtr)
Module._namFreeModel(model)
```

`prewarm()` runs inside `namResetModel`, so `rendered` is correct from sample 0 — no need to
discard leading frames.
