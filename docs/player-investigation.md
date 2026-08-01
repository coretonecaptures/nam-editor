# In-App NAM Player Investigation

Date: 2026-04-28
Branch: `feature/player`
Launchable checkpoint: `5c84181` (`Merge master into feature/player`)

## Goal

Get `neural-amp-modeler-wasm` working inside NAM Lab's Electron renderer so a local `.nam` file can be previewed in-app through an AudioWorklet-based player.

## What worked

- The player UI branch builds.
- `SharedArrayBuffer` exists in the renderer.
- `WebAssembly.Memory({ shared: true })` succeeds.
- `Atomics` exists.
- Tone3000/T3K worklet assets load:
  - `/t3k-wasm-module.aw.js`
  - `/t3k-wasm-module.js`
  - `/t3k-wasm-module.wasm`

## What failed

- `AudioWorkletNode` construction fails with:
  - `DataCloneError: Failed to construct 'AudioWorkletNode': SharedArrayBuffer transfer requires self.crossOriginIsolated.`
- Runtime logs at the exact failure point show:
  - `window.crossOriginIsolated === false`
  - `globalThis.crossOriginIsolated === false`

## Key conclusion so far

This does not currently look like a generic WASM-memory problem. The renderer can create shared WASM memory, but Chromium still refuses to transfer the `SharedArrayBuffer` into the `AudioWorklet` thread because the page is not truly cross-origin isolated.

## Attempts made

1. Added detailed player debug logging around:
   - `SharedArrayBuffer`
   - shared `WebAssembly.Memory`
   - `AudioWorklet.addModule`
   - `AudioWorkletNode`
   - `wasmAudioWorkletCreated`

2. Restored missing log IPC support during debugging:
   - `log:getRendererLogPath`
   - `log:appendRendererLog`
   This fixed noisy debug failures but was not the root cause.

3. Tried moving the packaged renderer off `file://` to a local `http://127.0.0.1` wrapper origin with COOP/COEP headers.
   - Did not get past the core `crossOriginIsolated` failure in the working player path.

4. Tried wrapping dev through the same local origin so dev and packaged builds would share the same isolation story.
   - This introduced Vite websocket/HMR issues.
   - It still did not prove a working `crossOriginIsolated === true` path for the player.

5. Tried changing the Electron renderer to `sandbox: true` to be closer to a normal Chromium renderer.
   - This broke preload startup because the current preload uses `fs`, `path`, and synchronous settings bootstrap that are not compatible with the sandboxed preload environment as currently wired.

## Current practical state

- The branch has been restored to the last known launchable checkpoint:
  - `5c84181`
- This keeps the app usable while preserving the player branch work done so far.

## Open questions for Tone3000

1. Is `neural-amp-modeler-wasm` expected to work inside Electron renderers at all?
2. If yes, what exact hosting model is required?
   - standard browser page only?
   - Electron with sandboxed renderer?
   - custom protocol vs localhost vs file?
3. Is true `crossOriginIsolated` required specifically for the AudioWorklet handoff even when shared WASM memory can already be created?
4. Do they have a known-working Electron sample or recommended BrowserWindow/preload configuration?
