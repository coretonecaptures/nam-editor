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

/**
 * Samples per process() call.
 *
 * Matches NAM's own NAM_DEFAULT_MAX_BUFFER_SIZE. This is a memory ceiling, not just a tuning
 * knob: the model allocates per-layer scratch proportional to this value, so it must stay small
 * regardless of how long the clip is.
 */
const RENDER_BLOCK_SIZE = 4096

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
  _namResetModel(handle: number, sampleRate: number, maxBlock: number): number
  _namProcessBuffer(handle: number, inPtr: number, outPtr: number, numSamples: number): number
  _namGetLoudness(handle: number): number
  _namHasLoudness(handle: number): number
  _namSetSlimmableSize(handle: number, size: number): void
  _namGetLastError(): number
  HEAPF32: Float32Array
  stringToUTF8(str: string, ptr: number, maxBytes: number): void
  lengthBytesUTF8(str: string): number
  UTF8ToString(ptr: number): string
}

/**
 * Read the module's last-error message (set by namLoadModel/namResetModel/namProcessBuffer on
 * failure). This is what makes render failures readable — without it, an exception thrown deep
 * in the C++ DSP crosses the Emscripten export boundary as an opaque JS value that stringifies
 * to "[object Object]" instead of a real message.
 */
function readLastError(Module: NamWasmModule, fallback: string): string {
  try {
    const message = Module.UTF8ToString(Module._namGetLastError())
    return message || fallback
  } catch {
    return fallback
  }
}

/**
 * Stringify a caught value defensively. `String(error)` on a plain object (which is what some
 * failure paths — e.g. a rejected wasm instantiation — can throw instead of a real Error)
 * produces the useless "[object Object]". Try the fields an Error-like value would have before
 * falling back to JSON, so a future unexpected failure is still readable instead of opaque.
 */
function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (typeof error === 'number' || typeof error === 'boolean') return String(error)
  if (error && typeof error === 'object') {
    const withMessage = error as { message?: unknown; name?: unknown }
    if (typeof withMessage.message === 'string' && withMessage.message) {
      return typeof withMessage.name === 'string' ? `${withMessage.name}: ${withMessage.message}` : withMessage.message
    }
    try {
      return JSON.stringify(error)
    } catch {
      return Object.prototype.toString.call(error)
    }
  }
  return String(error)
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
        error: readLastError(
          Module,
          'This model could not be loaded. Its architecture or file version may not be supported by the bundled NAM core.'
        )
      }
    }

    if (typeof slimmableSize === 'number') {
      Module._namSetSlimmableSize(handle, slimmableSize)
    }

    const hasLoudness = Module._namHasLoudness(handle) !== 0
    const loudnessDb = hasLoudness ? Module._namGetLoudness(handle) : null

    // Resets AND prewarms, so output is correct from sample 0 with no frames to discard.
    //
    // maxBlock is RENDER_BLOCK_SIZE, not input.length. Reset() propagates its maxBufferSize
    // down to every Conv1x1, each of which does _output.resize(channels, maxBufferSize) --
    // so passing the whole 12s buffer (576k samples) made every conv layer in the network try
    // to allocate channels x 576000 x 4 bytes. Across a WaveNet's dozens of layers that's
    // gigabytes, and it threw std::bad_alloc.
    if (Module._namResetModel(handle, sampleRate, RENDER_BLOCK_SIZE) === 0) {
      return { ok: false, error: readLastError(Module, 'Failed to reset the model for rendering.') }
    }

    // Only ever RENDER_BLOCK_SIZE of scratch on the heap, regardless of clip length.
    const blockBytes = RENDER_BLOCK_SIZE * 4
    inPtr = Module._malloc(blockBytes)
    outPtr = Module._malloc(blockBytes)

    const output = new Float32Array(input.length)
    const started = performance.now()

    // Chunked, but NOT independent chunks: the model carries its internal state (ring buffers,
    // recurrent state) across process() calls, which is exactly how it runs in a real-time
    // host. Feeding consecutive blocks yields the same samples a single giant call would.
    for (let offset = 0; offset < input.length; offset += RENDER_BLOCK_SIZE) {
      const blockLength = Math.min(RENDER_BLOCK_SIZE, input.length - offset)

      Module.HEAPF32.set(input.subarray(offset, offset + blockLength), inPtr >> 2)

      if (Module._namProcessBuffer(handle, inPtr, outPtr, blockLength) === 0) {
        return {
          ok: false,
          error: readLastError(Module, 'The model failed to process the input buffer.')
        }
      }

      // Copy each block out before the next iteration overwrites the scratch buffer.
      output.set(Module.HEAPF32.subarray(outPtr >> 2, (outPtr >> 2) + blockLength), offset)
    }

    const renderMs = performance.now() - started

    return { ok: true, output, loudnessDb, renderMs }
  } catch (error) {
    return { ok: false, error: `Rendering failed: ${describeUnknownError(error)}` }
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
    return { ok: false, error: `Failed to load the NAM inference module: ${describeUnknownError(error)}` }
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
