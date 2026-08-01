import { describe, it, expect, vi } from 'vitest'
import { renderWithModule } from './namRender.worker'
import type { NamRenderRequest, NamRenderResponse, NamWasmModule } from './namRender.worker'

/**
 * Contract tests for the offline render worker.
 *
 * These exercise the worker's message handling against a fake WASM module, so they run without
 * Emscripten output and without a browser. What they protect:
 *   - a model that fails to load reports an error instead of hanging the player
 *   - allocated heap memory is always freed, including on the failure paths
 *   - the rendered buffer is copied out of the heap before it can be detached
 *
 * The DSP itself is covered separately by native/nam-wasm/test/test.cjs, which runs real models
 * through the real compiled module.
 */

interface FakeModuleOptions {
  /** Return 0 from namLoadModel, as the real module does for unsupported architectures. */
  failLoad?: boolean
  /** Return 0 from namResetModel. */
  failReset?: boolean
  /** Return 0 from namProcessBuffer. */
  failProcess?: boolean
  loudnessDb?: number | null
  /** Value written to every output sample. */
  outputValue?: number
  /** What namGetLastError() reports after a failure. */
  lastError?: string
}

function createFakeModule(options: FakeModuleOptions = {}) {
  const {
    failLoad = false,
    failReset = false,
    failProcess = false,
    loudnessDb = null,
    outputValue = 0.5,
    lastError = 'fake module error',
  } = options

  const HEAP_FLOATS = 1 << 20
  const heap = new Float32Array(HEAP_FLOATS)
  let nextPtr = 16
  const allocations = new Map<number, number>()
  const freed: number[] = []
  const freedModels: number[] = []
  /** Every size ever passed to _malloc, so tests can assert scratch stays bounded. */
  const allocSizes: number[] = []

  return {
    HEAPF32: heap,
    allocations,
    allocSizes,
    freed,
    freedModels,

    _malloc(size: number) {
      const ptr = nextPtr
      nextPtr += Math.ceil(size / 4) * 4 + 16
      allocations.set(ptr, size)
      allocSizes.push(size)
      return ptr
    },
    _free(ptr: number) {
      freed.push(ptr)
      allocations.delete(ptr)
    },
    _namLoadModel() {
      return failLoad ? 0 : 0xbeef
    },
    _namFreeModel(handle: number) {
      if (handle !== 0) freedModels.push(handle)
    },
    // Args typed explicitly so tests can read mock.calls[n][2] (the maxBlock argument).
    _namResetModel: vi.fn((_handle: number, _sampleRate: number, _maxBlock: number) =>
      failReset ? 0 : 1
    ),
    _namProcessBuffer(_h: number, _in: number, outPtr: number, n: number) {
      if (failProcess) return 0
      for (let i = 0; i < n; i++) heap[(outPtr >> 2) + i] = outputValue
      return 1
    },
    _namGetLoudness() {
      return loudnessDb ?? 0
    },
    _namHasLoudness() {
      return loudnessDb === null ? 0 : 1
    },
    _namSetSlimmableSize: vi.fn(),
    // Real namGetLastError() returns a heap pointer; UTF8ToString decodes it. The fake skips
    // the pointer indirection and has UTF8ToString ignore its argument and return the fixed
    // message directly -- what matters here is the worker reads and surfaces it, not how the
    // real module encodes strings on the heap (that's covered by native/nam-wasm/test/test.cjs).
    _namGetLastError: vi.fn(() => -1),
    UTF8ToString: vi.fn(() => lastError),
    stringToUTF8: vi.fn(),
    lengthBytesUTF8: (s: string) => s.length,
  }
}

function runWorker(
  request: NamRenderRequest,
  fakeModule: ReturnType<typeof createFakeModule>
): NamRenderResponse {
  return renderWithModule(fakeModule as unknown as NamWasmModule, request)
}

function makeRequest(overrides: Partial<NamRenderRequest> = {}): NamRenderRequest {
  return {
    modelJson: '{"architecture":"WaveNet"}',
    input: new Float32Array(128).fill(0.25),
    sampleRate: 48000,
    ...overrides,
  }
}

describe('namRender worker', () => {
  it('renders a buffer and reports success', () => {
    const mod = createFakeModule({ outputValue: 0.5 })
    const response = runWorker(makeRequest(), mod)

    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.output).toHaveLength(128)
    expect(Array.from(response.output).every((v) => v === 0.5)).toBe(true)
    expect(typeof response.renderMs).toBe('number')
  })

  it('surfaces loudness metadata when the model has it', () => {
    const response = runWorker(makeRequest(), createFakeModule({ loudnessDb: -20 }))
    expect(response.ok && response.loudnessDb).toBe(-20)
  })

  it('reports null loudness when the model has none', () => {
    const response = runWorker(makeRequest(), createFakeModule({ loudnessDb: null }))
    expect(response.ok && response.loudnessDb).toBeNull()
  })

  // These four all cover the same real bug: a user saw "Rendering failed: [object Object]"
  // because a C++-side failure crossed the Emscripten boundary as an opaque, unstringifiable
  // JS value. Every failure path must now surface namGetLastError()'s real message instead.
  it('surfaces the module\'s real error message when the model cannot be loaded', () => {
    const response = runWorker(
      makeRequest(),
      createFakeModule({ failLoad: true, lastError: 'Unsupported architecture: FooNet' })
    )
    expect(response.ok).toBe(false)
    if (!response.ok) expect(response.error).toBe('Unsupported architecture: FooNet')
  })

  it('surfaces the module\'s real error message when reset fails', () => {
    const response = runWorker(
      makeRequest(),
      createFakeModule({ failReset: true, lastError: 'Prewarm threw: bad sample rate' })
    )
    expect(response.ok).toBe(false)
    if (!response.ok) expect(response.error).toBe('Prewarm threw: bad sample rate')
  })

  it('surfaces the module\'s real error message when processing fails', () => {
    const response = runWorker(
      makeRequest(),
      createFakeModule({ failProcess: true, lastError: 'process() threw: dimension mismatch' })
    )
    expect(response.ok).toBe(false)
    if (!response.ok) expect(response.error).toBe('process() threw: dimension mismatch')
  })

  it('falls back to a generic message when the module reports no error text', () => {
    const response = runWorker(makeRequest(), createFakeModule({ failLoad: true, lastError: '' }))
    expect(response.ok).toBe(false)
    if (!response.ok) {
      expect(response.error).toMatch(/could not be loaded/i)
      // Must never be the raw, unhelpful stringification that motivated this whole mechanism.
      expect(response.error).not.toBe('[object Object]')
    }
  })

  it('frees every heap allocation it makes on the success path', () => {
    const mod = createFakeModule()
    runWorker(makeRequest(), mod)
    expect(mod.allocations.size, 'leaked heap allocations').toBe(0)
  })

  it('frees allocations even when the model fails to load', () => {
    const mod = createFakeModule({ failLoad: true })
    runWorker(makeRequest(), mod)
    expect(mod.allocations.size, 'leaked the model JSON allocation').toBe(0)
  })

  it('frees allocations even when processing fails', () => {
    const mod = createFakeModule({ failProcess: true })
    runWorker(makeRequest(), mod)
    expect(mod.allocations.size, 'leaked input/output buffers').toBe(0)
  })

  it('frees the model handle on both success and processing failure', () => {
    const ok = createFakeModule()
    runWorker(makeRequest(), ok)
    expect(ok.freedModels).toContain(0xbeef)

    const bad = createFakeModule({ failProcess: true })
    runWorker(makeRequest(), bad)
    expect(bad.freedModels).toContain(0xbeef)
  })

  it('copies output out of the WASM heap rather than returning a heap view', () => {
    const mod = createFakeModule({ outputValue: 0.5 })
    const response = runWorker(makeRequest(), mod)
    expect(response.ok).toBe(true)
    if (!response.ok) return

    // Scribble over the whole heap; a returned view would change with it.
    mod.HEAPF32.fill(-999)
    expect(Array.from(response.output).every((v) => v === 0.5)).toBe(true)
    expect(response.output.buffer).not.toBe(mod.HEAPF32.buffer)
  })

  it('applies slimmable size only when one is requested', () => {
    const withSize = createFakeModule()
    runWorker(makeRequest({ slimmableSize: 0 }), withSize)
    expect(withSize._namSetSlimmableSize).toHaveBeenCalledWith(0xbeef, 0)

    const without = createFakeModule()
    runWorker(makeRequest(), without)
    expect(without._namSetSlimmableSize).not.toHaveBeenCalled()
  })

  it('resets (and prewarms) the model before rendering', () => {
    const mod = createFakeModule()
    runWorker(makeRequest({ sampleRate: 44100 }), mod)
    expect(mod._namResetModel).toHaveBeenCalledWith(0xbeef, 44100, expect.any(Number))
  })

  // Regression: the reset block size was originally the whole clip length. Reset() sizes
  // per-layer scratch from it, so every conv layer allocated channels x totalSamples floats
  // and a 12s clip died with std::bad_alloc. It must stay bounded and independent of length.
  it('resets with a bounded block size, not the clip length', () => {
    const mod = createFakeModule()
    const longClip = new Float32Array(48000 * 12) // 12s at 48k, the real preview length
    runWorker(makeRequest({ input: longClip, sampleRate: 48000 }), mod)

    const maxBlock = mod._namResetModel.mock.calls[0][2]
    expect(maxBlock).toBeLessThanOrEqual(8192)
    expect(maxBlock).toBeLessThan(longClip.length)
  })

  it('keeps heap scratch bounded regardless of clip length', () => {
    const longMod = createFakeModule()
    runWorker(makeRequest({ input: new Float32Array(48000 * 12) }), longMod)

    // Largest single allocation must be block-sized scratch, not the whole 12s clip
    // (576k samples x 4 bytes = 2.3MB) -- and nowhere near the per-layer blowup that
    // caused std::bad_alloc.
    expect(Math.max(...longMod.allocSizes)).toBeLessThanOrEqual(8192 * 4)
  })

  it('renders long clips in consecutive blocks covering every sample', () => {
    const mod = createFakeModule({ outputValue: 0.25 })
    const samples = 48000 * 12
    const response = runWorker(makeRequest({ input: new Float32Array(samples) }), mod)

    expect(response.ok).toBe(true)
    if (!response.ok) return
    expect(response.output).toHaveLength(samples)
    // Every sample written, including the final partial block.
    expect(response.output.every((v) => v === 0.25)).toBe(true)
  })

  // The outer catch is defense-in-depth for anything that throws before/outside the C++
  // boundary (e.g. a malloc call itself). It must never regress to raw String(error).
  it('never lets an outer-catch failure surface as "[object Object]"', () => {
    const mod = createFakeModule()
    mod._malloc = () => {
      // A plain thrown object, as some browser APIs do instead of throwing a real Error.
      throw { code: 'OOM', detail: 'heap exhausted' }
    }
    const response = runWorker(makeRequest(), mod)
    expect(response.ok).toBe(false)
    if (!response.ok) {
      expect(response.error).not.toBe('Rendering failed: [object Object]')
      expect(response.error).toContain('OOM')
    }
  })

  it('unwraps a real Error thrown outside the C++ boundary to its message, not its toString', () => {
    const mod = createFakeModule()
    mod._malloc = () => {
      throw new RangeError('requested size exceeds heap')
    }
    const response = runWorker(makeRequest(), mod)
    expect(response.ok).toBe(false)
    if (!response.ok) expect(response.error).toBe('Rendering failed: requested size exceeds heap')
  })
})
