/**
 * Phase 1 feasibility spike for the live (real-time) player.
 *
 * Answers one question: can our single-threaded NAM WASM module be instantiated and run inside
 * Electron's AudioWorkletGlobalScope, without tripping the SharedArrayBuffer /
 * crossOriginIsolated wall that killed the original real-time attempt?
 *
 * Deliberately does NOT touch getUserMedia — no microphone, no device permissions. It drives the
 * worklet from a synthetic oscillator into an OfflineAudioContext, so it can run headlessly and
 * prove the DSP path alone. Live input is Phase 3.
 *
 * Results go to the renderer log (userData/renderer.log) because AudioWorkletGlobalScope has no
 * reachable console.
 */

export interface SpikeResult {
  ok: boolean
  steps: string[]
  error?: string
  /** True when the worklet reported a successfully instantiated wasm instance. */
  instantiated: boolean
  /** True when the worklet loaded a real .nam model. */
  modelLoaded: boolean
  /** Peak absolute sample of the rendered output — proves audio actually flowed. */
  outputPeak: number
  crossOriginIsolated: boolean
  usedSharedArrayBuffer: boolean
}

async function log(line: string): Promise<void> {
  try {
    await window.api.appendRendererLog(`[LiveSpike] ${line}`)
  } catch {
    // Logging must never be the reason the spike fails.
  }
}

/**
 * Run the spike.
 *
 * @param modelJson Full text of a .nam file to load in the worklet.
 */
export async function runLiveWorkletSpike(modelJson: string): Promise<SpikeResult> {
  const steps: string[] = []
  const result: SpikeResult = {
    ok: false,
    steps,
    instantiated: false,
    modelLoaded: false,
    outputPeak: 0,
    crossOriginIsolated: !!(globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated,
    usedSharedArrayBuffer: false
  }

  const step = (line: string) => {
    steps.push(line)
    void log(line)
  }

  step(`start — crossOriginIsolated=${result.crossOriginIsolated}`)

  try {
    // 1. Fetch and compile the wasm on this thread. WebAssembly.Module is structured-cloneable,
    //    which is the whole reason this approach works where the SAB one didn't.
    const [wasmResponse, manifestResponse] = await Promise.all([
      fetch('/nam-worklet.wasm'),
      fetch('/nam-worklet.manifest.json')
    ])
    if (!wasmResponse.ok) throw new Error(`fetch nam-worklet.wasm: ${wasmResponse.status}`)
    if (!manifestResponse.ok) {
      throw new Error(`fetch nam-worklet.manifest.json: ${manifestResponse.status}`)
    }
    const wasmBytes = await wasmResponse.arrayBuffer()
    const manifest = await manifestResponse.json()
    step(`fetched wasm (${(wasmBytes.byteLength / 1024).toFixed(0)}KB) + manifest`)

    const wasmModule = await WebAssembly.compile(wasmBytes)
    step('compiled WebAssembly.Module')

    // 2. Render offline so the spike needs no audio device and no user gesture.
    const sampleRate = 48000
    const seconds = 1
    const ctx = new OfflineAudioContext(1, sampleRate * seconds, sampleRate)

    await ctx.audioWorklet.addModule('/nam-worklet.js')
    step('audioWorklet.addModule OK')

    // 3. The step that failed before: constructing the node with a wasm payload. Previously
    //    this threw DataCloneError because Emscripten passed shared memory.
    const node = new AudioWorkletNode(ctx, 'nam-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { wasmModule, manifest }
    })
    step('AudioWorkletNode constructed (no DataCloneError)')

    // 4. Collect worklet messages.
    const messages: Array<Record<string, unknown>> = []
    let workletError: string | null = null
    const modelLoadedPromise = new Promise<void>((resolve) => {
      node.port.onmessage = (event: MessageEvent) => {
        const data = event.data as Record<string, unknown>
        messages.push(data)
        if (data.type === 'instantiated') {
          result.instantiated = true
          step('worklet reported: wasm instantiated')
        } else if (data.type === 'modelLoaded') {
          result.modelLoaded = true
          step(`worklet reported: model loaded (loudness=${String(data.loudnessDb)})`)
          resolve()
        } else if (data.type === 'error') {
          workletError = `${String(data.stage)}: ${String(data.error)}`
          step(`worklet error — ${workletError}`)
          resolve()
        }
      }
    })

    // Encode here, not in the worklet: AudioWorkletGlobalScope has no TextEncoder (verified —
    // it throws "TextEncoder is not defined"), and this keeps string work off the audio scope.
    const modelBytes = new TextEncoder().encode(modelJson)
    node.port.postMessage({ type: 'loadModel', modelBytes }, [modelBytes.buffer])

    // Don't hang forever if the worklet never answers.
    await Promise.race([
      modelLoadedPromise,
      new Promise<void>((resolve) => setTimeout(resolve, 5000))
    ])

    if (workletError) throw new Error(workletError)
    if (!result.instantiated) throw new Error('worklet never reported instantiation')
    if (!result.modelLoaded) throw new Error('worklet never reported a loaded model')

    // 5. Drive real audio through it: 220Hz sine in, inference out.
    const osc = ctx.createOscillator()
    osc.frequency.value = 220
    const level = ctx.createGain()
    level.gain.value = 0.3
    osc.connect(level)
    level.connect(node)
    node.connect(ctx.destination)
    osc.start()

    const rendered = await ctx.startRendering()
    const channel = rendered.getChannelData(0)
    let peak = 0
    let nonFinite = 0
    for (let i = 0; i < channel.length; i++) {
      const v = channel[i]
      if (!Number.isFinite(v)) { nonFinite++; continue }
      const a = Math.abs(v)
      if (a > peak) peak = a
    }
    result.outputPeak = peak
    step(`rendered ${channel.length} frames — peak ${peak.toFixed(5)}, nonFinite ${nonFinite}`)

    if (nonFinite > 0) throw new Error(`${nonFinite} non-finite output samples`)
    if (peak === 0) throw new Error('output was pure silence — inference did not run')

    result.ok = true
    step('PASS — real-time NAM inference runs inside an AudioWorklet in Electron')
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
    step(`FAIL — ${result.error}`)
  }

  return result
}
