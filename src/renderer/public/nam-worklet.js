/**
 * NAM live AudioWorkletProcessor.
 *
 * Runs NAM inference on the real-time audio thread by instantiating our single-threaded WASM
 * module directly inside AudioWorkletGlobalScope.
 *
 * WHY IT'S BUILT THIS WAY
 * -----------------------
 * The obvious approach — Tone3000's module + Emscripten's own AudioWorklet support — is
 * impossible in Electron. That build needs `-pthread -sAUDIO_WORKLET -sWASM_WORKERS`, which
 * makes the module's memory a SharedArrayBuffer, and Chromium refuses to transfer a
 * SharedArrayBuffer into an AudioWorklet unless the page is genuinely cross-origin isolated.
 * We could never achieve that here (see docs/player-investigation.md).
 *
 * The way through: our module is built WITHOUT threads, so
 *   - its memory is an ordinary ArrayBuffer created inside this scope, never transferred, and
 *   - what we DO transfer is a compiled `WebAssembly.Module`, which is structured-cloneable.
 * So the thing that blocked the original attempt never arises.
 *
 * Emscripten's JS glue can't run here either: AudioWorkletGlobalScope is a classic script
 * context with no `import`, no `importScripts`, no `fetch` and no DOM. So this file instantiates
 * the wasm itself against a small import shim, using a build-time-generated name manifest
 * (see native/nam-wasm/tools/gen-worklet-manifest.cjs) because -O3 minifies the wasm boundary
 * to single letters.
 *
 * REAL-TIME RULES followed below: no allocation, no exceptions crossing the boundary, and no
 * model loading inside process(). Anything expensive happens on a message beforehand.
 */

/** Frames per render quantum. Fixed by the Web Audio spec. */
const QUANTUM = 128

class NamProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()

    const opts = (options && options.processorOptions) || {}
    this.ready = false
    this.failed = null
    this.modelHandle = 0
    this.bypass = false
    this.inputGain = 1
    this.outputGain = 1

    try {
      this._instantiate(opts.wasmModule, opts.manifest)
      this.ready = true
      this.port.postMessage({ type: 'instantiated' })
      // Report the memory backing. This is the property the whole approach rests on: a
      // SharedArrayBuffer here would mean a threaded build crept back in, reintroducing the
      // crossOriginIsolated requirement that makes the live player impossible in Electron.
      this.port.postMessage({
        type: 'memory',
        kind: this.memory.buffer.constructor.name,
        bytes: this.memory.buffer.byteLength
      })
    } catch (error) {
      this.failed = String((error && error.message) || error)
      this.port.postMessage({ type: 'error', stage: 'instantiate', error: this.failed })
    }

    this.port.onmessage = (event) => this._onMessage(event.data)
  }

  /**
   * Instantiate the wasm synchronously from a pre-compiled module.
   *
   * `new WebAssembly.Instance` is the synchronous form — required here because a constructor
   * can't await, and process() may be called immediately after.
   */
  _instantiate(wasmModule, manifest) {
    if (!wasmModule) throw new Error('No compiled WebAssembly.Module supplied')
    if (!manifest || !manifest.exports || !manifest.imports) {
      throw new Error('No export/import manifest supplied')
    }

    // The 9 imports the module needs. All are either never called in our code paths or are
    // fatal-error reporting; none need DOM, fetch, or a filesystem. Deliberately silent rather
    // than throwing: an exception raised here would surface on the audio thread.
    const abort = (reason) => {
      this.failed = reason
      this.ready = false
      try {
        this.port.postMessage({ type: 'error', stage: 'runtime', error: reason })
      } catch {
        // Port may be closed during teardown; nothing useful to do.
      }
    }

    const stubs = {
      ___assert_fail: () => abort('wasm assertion failed'),
      __abort_js: () => abort('wasm abort'),
      // Memory growth is disabled in the worklet build (growing the heap mid-callback is not
      // real-time safe), so this must refuse rather than pretend to succeed.
      _emscripten_resize_heap: () => 0,
      _environ_get: () => 0,
      _environ_sizes_get: () => 0,
      _fd_close: () => 0,
      _fd_read: () => 0,
      _fd_seek: () => 0,
      // stdio: the DSP shouldn't print, but swallow rather than trap if it ever does.
      _fd_write: () => 0
    }

    const importObject = { a: {} }
    for (const realName of Object.keys(manifest.imports)) {
      const letter = manifest.imports[realName]
      const fn = stubs[realName]
      if (!fn) throw new Error(`No stub for required wasm import "${realName}"`)
      importObject.a[letter] = fn
    }

    const instance = new WebAssembly.Instance(wasmModule, importObject)
    const raw = instance.exports

    const pick = (name) => {
      const letter = manifest.exports[name]
      const fn = letter && raw[letter]
      if (!fn) throw new Error(`Export "${name}" missing from wasm instance`)
      return fn
    }

    this.memory = raw[manifest.exports.memory] || raw.memory
    // Emscripten names the memory export too; fall back to scanning if the manifest lacks it.
    if (!this.memory) {
      for (const key of Object.keys(raw)) {
        if (raw[key] instanceof WebAssembly.Memory) {
          this.memory = raw[key]
          break
        }
      }
    }
    if (!this.memory) throw new Error('wasm memory export not found')

    // Run C++ static initializers before calling anything else.
    pick('__wasm_call_ctors')()

    this.fn = {
      loadModel: pick('_namLoadModel'),
      processBuffer: pick('_namProcessBuffer'),
      resetModel: pick('_namResetModel'),
      freeModel: pick('_namFreeModel'),
      getLoudness: pick('_namGetLoudness'),
      hasLoudness: pick('_namHasLoudness'),
      setSlimmableSize: pick('_namSetSlimmableSize'),
      getLastError: pick('_namGetLastError'),
      malloc: pick('_malloc'),
      free: pick('_free')
    }

    this.heapF32 = new Float32Array(this.memory.buffer)
    this.heapU8 = new Uint8Array(this.memory.buffer)

    // Scratch buffers for one quantum, allocated once here — never during process().
    this.inPtr = this.fn.malloc(QUANTUM * 4)
    this.outPtr = this.fn.malloc(QUANTUM * 4)
    if (!this.inPtr || !this.outPtr) throw new Error('Failed to allocate worklet scratch buffers')
  }

  /** Read a NUL-terminated UTF-8 string out of the wasm heap. */
  _readCString(ptr) {
    if (!ptr) return ''
    let end = ptr
    while (this.heapU8[end] !== 0) end++
    let out = ''
    for (let i = ptr; i < end; i++) out += String.fromCharCode(this.heapU8[i])
    return out
  }

  _lastError(fallback) {
    try {
      return this._readCString(this.fn.getLastError()) || fallback
    } catch {
      return fallback
    }
  }

  _onMessage(msg) {
    if (!msg || typeof msg !== 'object') return

    switch (msg.type) {
      case 'loadModel':
        this._loadModel(msg.modelBytes, msg.slimmableSize)
        break
      case 'setBypass':
        this.bypass = !!msg.bypass
        break
      case 'setGain':
        if (typeof msg.inputGain === 'number') this.inputGain = msg.inputGain
        if (typeof msg.outputGain === 'number') this.outputGain = msg.outputGain
        break
      case 'unloadModel':
        this._freeModel()
        break
      default:
        break
    }
  }

  _freeModel() {
    if (this.modelHandle) {
      this.fn.freeModel(this.modelHandle)
      this.modelHandle = 0
    }
  }

  /**
   * Load a .nam model. Runs on a message, never inside process() — parsing JSON and allocating
   * weights would blow the audio deadline many times over.
   *
   * Takes already-UTF-8-encoded bytes rather than a string: AudioWorkletGlobalScope has no
   * TextEncoder (verified — it throws "TextEncoder is not defined"), and encoding belongs on the
   * sending side anyway so no string work happens in the audio scope at all.
   */
  _loadModel(modelBytes, slimmableSize) {
    if (!this.ready) return
    try {
      this._freeModel()

      const bytes = modelBytes instanceof Uint8Array ? modelBytes : new Uint8Array(modelBytes)
      const ptr = this.fn.malloc(bytes.length + 1)
      if (!ptr) throw new Error('Out of wasm memory loading model')
      this.heapU8.set(bytes, ptr)
      this.heapU8[ptr + bytes.length] = 0

      const handle = this.fn.loadModel(ptr)
      this.fn.free(ptr)

      if (!handle) {
        this.port.postMessage({
          type: 'error',
          stage: 'loadModel',
          error: this._lastError('Model could not be loaded')
        })
        return
      }

      if (typeof slimmableSize === 'number') this.fn.setSlimmableSize(handle, slimmableSize)

      // Prewarm here too: it allocates and runs the network, so it must not happen mid-callback.
      if (this.fn.resetModel(handle, sampleRate, QUANTUM) === 0) {
        this.fn.freeModel(handle)
        this.port.postMessage({
          type: 'error',
          stage: 'resetModel',
          error: this._lastError('Model could not be prepared')
        })
        return
      }

      this.modelHandle = handle
      const hasLoudness = this.fn.hasLoudness(handle) !== 0
      this.port.postMessage({
        type: 'modelLoaded',
        loudnessDb: hasLoudness ? this.fn.getLoudness(handle) : null,
        sampleRate
      })
    } catch (error) {
      this.port.postMessage({
        type: 'error',
        stage: 'loadModel',
        error: String((error && error.message) || error)
      })
    }
  }

  process(inputs, outputs) {
    const output = outputs[0] && outputs[0][0]
    if (!output) return true

    const input = inputs[0] && inputs[0][0]

    // Nothing to run: emit silence rather than leaving the buffer stale.
    if (!input || !this.ready || !this.modelHandle || this.bypass) {
      if (input && (this.bypass || !this.modelHandle)) {
        for (let i = 0; i < output.length; i++) output[i] = input[i] * this.inputGain
      } else {
        output.fill(0)
      }
      // Keep the node alive even while idle so arming/disarming doesn't require a new node.
      return true
    }

    const n = Math.min(output.length, QUANTUM)
    const inBase = this.inPtr >> 2
    const outBase = this.outPtr >> 2

    // Memory growth is off, so heapF32 can't be detached — safe to hold across calls.
    for (let i = 0; i < n; i++) this.heapF32[inBase + i] = input[i] * this.inputGain

    if (this.fn.processBuffer(this.modelHandle, this.inPtr, this.outPtr, n) === 0) {
      output.fill(0)
      return true
    }

    const gain = this.outputGain
    for (let i = 0; i < n; i++) output[i] = this.heapF32[outBase + i] * gain

    return true
  }
}

registerProcessor('nam-processor', NamProcessor)
