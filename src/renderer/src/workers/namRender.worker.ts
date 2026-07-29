/**
 * Offline NAM inference worker.
 *
 * Loads the single-threaded WASM module built from native/nam-wasm and renders a whole buffer
 * of audio through a NAM model in one pass, off the UI thread.
 *
 * This is a plain Worker, NOT an AudioWorklet, and the module it loads is built without
 * -pthread. That's deliberate: a threaded build would make the module's memory a
 * SharedArrayBuffer, which Chromium refuses to transfer into an AudioWorklet unless the page is
 * cross-origin isolated — something we could never achieve in Electron (see
 * docs/player-investigation.md). Rendering ahead of time instead of in real time removes the
 * need for any of that.
 */

export interface NamRenderRequest {
  /** Full text of the .nam file (it's JSON). */
  modelJson: string
  /** Mono input samples to render through the model. */
  input: Float32Array
  sampleRate: number
  /** For A2/Slimmable models: 0 = smallest sub-model, 1 = largest. Ignored otherwise. */
  slimmableSize?: number
}

export type NamRenderResponse =
  | {
      ok: true
      output: Float32Array
      /** Model's self-reported loudness in dB, or null when it carries no loudness metadata. */
      loudnessDb: number | null
      renderMs: number
    }
  | { ok: false; error: string }

export interface NamWasmModule {
  _malloc(size: number): number
  _free(ptr: number): void
  _namLoadModel(jsonPtr: number): number
  _namFreeModel(handle: number): void
  _namResetModel(handle: number, sampleRate: number, maxBlock: number): void
  _namProcessBuffer(handle: number, inPtr: number, outPtr: number, numSamples: number): number
  _namGetLoudness(handle: number): number
  _namHasLoudness(handle: number): number
  _namSetSlimmableSize(handle: number, size: number): void
  HEAPF32: Float32Array
  stringToUTF8(str: string, ptr: number, maxBytes: number): void
  lengthBytesUTF8(str: string): number
}

type ModuleFactory = () => Promise<NamWasmModule>

let modulePromise: Promise<NamWasmModule> | null = null

async function getModule(): Promise<NamWasmModule> {
  if (modulePromise === null) {
    modulePromise = (async () => {
      // Built by native/nam-wasm/build.sh into renderer/public, so it's served at the app root.
      const factory: ModuleFactory = (await import(
        /* @vite-ignore */ new URL('/nam-offline.js', self.location.origin).href
      )).default
      return factory()
    })()
  }
  return modulePromise
}

/**
 * Run one render against an already-loaded module.
 *
 * Split out from the message handler (and exported) so it can be unit tested against a fake
 * module without Emscripten output or a browser — see namRender.worker.test.ts.
 */
export function renderWithModule(
  Module: NamWasmModule,
  request: NamRenderRequest
): NamRenderResponse {
  const { modelJson, input, sampleRate, slimmableSize } = request

  let handle = 0
  let inPtr = 0
  let outPtr = 0

  try {
    const jsonBytes = Module.lengthBytesUTF8(modelJson) + 1
    const jsonPtr = Module._malloc(jsonBytes)
    Module.stringToUTF8(modelJson, jsonPtr, jsonBytes)
    handle = Module._namLoadModel(jsonPtr)
    Module._free(jsonPtr)

    if (handle === 0) {
      return {
        ok: false,
        error:
          'This model could not be loaded. Its architecture or file version may not be supported by the bundled NAM core.'
      }
    }

    if (typeof slimmableSize === 'number') {
      Module._namSetSlimmableSize(handle, slimmableSize)
    }

    const hasLoudness = Module._namHasLoudness(handle) !== 0
    const loudnessDb = hasLoudness ? Module._namGetLoudness(handle) : null

    // Resets AND prewarms, so output is correct from sample 0 with no frames to discard.
    Module._namResetModel(handle, sampleRate, input.length)

    const bytes = input.length * 4
    inPtr = Module._malloc(bytes)
    outPtr = Module._malloc(bytes)
    Module.HEAPF32.set(input, inPtr >> 2)

    const started = performance.now()
    const ok = Module._namProcessBuffer(handle, inPtr, outPtr, input.length)
    const renderMs = performance.now() - started

    if (ok === 0) {
      return { ok: false, error: 'The model failed to process the input buffer.' }
    }

    // Copy out of the heap immediately — any later allocation can grow (and detach) the view.
    const output = new Float32Array(
      Module.HEAPF32.subarray(outPtr >> 2, (outPtr >> 2) + input.length)
    )

    return { ok: true, output, loudnessDb, renderMs }
  } catch (error) {
    return { ok: false, error: `Rendering failed: ${String(error)}` }
  } finally {
    if (inPtr !== 0) Module._free(inPtr)
    if (outPtr !== 0) Module._free(outPtr)
    if (handle !== 0) Module._namFreeModel(handle)
  }
}

async function render(request: NamRenderRequest): Promise<NamRenderResponse> {
  let Module: NamWasmModule
  try {
    Module = await getModule()
  } catch (error) {
    return { ok: false, error: `Failed to load the NAM inference module: ${String(error)}` }
  }
  return renderWithModule(Module, request)
}

// Guarded so the module can be imported by unit tests under Node, where there is no worker
// global. In a real Worker this always registers.
if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = async (event: MessageEvent<NamRenderRequest>) => {
    const response = await render(event.data)
    if (response.ok) {
      // Transfer the rendered buffer rather than copying it across the boundary.
      self.postMessage(response, { transfer: [response.output.buffer] })
    } else {
      self.postMessage(response)
    }
  }
}
