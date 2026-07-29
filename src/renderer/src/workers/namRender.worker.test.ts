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
  /** Return 0 from namProcessBuffer. */
  failProcess?: boolean
  loudnessDb?: number | null
  /** Value written to every output sample. */
  outputValue?: number
}

function createFakeModule(options: FakeModuleOptions = {}) {
  const { failLoad = false, failProcess = false, loudnessDb = null, outputValue = 0.5 } = options

  const HEAP_FLOATS = 1 << 20
  const heap = new Float32Array(HEAP_FLOATS)
  let nextPtr = 16
  const allocations = new Map<number, number>()
  const freed: number[] = []
  const freedModels: number[] = []

  return {
    HEAPF32: heap,
    allocations,
    freed,
    freedModels,

    _malloc(size: number) {
      const ptr = nextPtr
      nextPtr += Math.ceil(size / 4) * 4 + 16
      allocations.set(ptr, size)
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
    _namResetModel: vi.fn(),
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

  it('returns a readable error when the model cannot be loaded', () => {
    const response = runWorker(makeRequest(), createFakeModule({ failLoad: true }))

    expect(response.ok).toBe(false)
    if (response.ok) return
    // The player shows this verbatim, so it has to explain itself to a user.
    expect(response.error).toMatch(/could not be loaded/i)
    expect(response.error).toMatch(/architecture|version/i)
  })

  it('returns an error when processing fails', () => {
    const response = runWorker(makeRequest(), createFakeModule({ failProcess: true }))
    expect(response.ok).toBe(false)
    if (!response.ok) expect(response.error).toMatch(/failed to process/i)
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
    expect(mod._namResetModel).toHaveBeenCalledWith(0xbeef, 44100, 128)
  })
})
