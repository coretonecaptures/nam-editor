/**
 * Real-time NAM engine: guitar in -> model -> cabinet IR -> speakers.
 *
 * Signal path, all live Web Audio nodes:
 *
 *   MediaStreamSource -> [NAM AudioWorklet] -> [ConvolverNode wet] -+-> outputGain -> destination
 *                                          \-> dryGain ------------/
 *
 * The NAM worklet instantiates our single-threaded WASM module directly (see
 * public/nam-worklet.js). It deliberately avoids Emscripten's AudioWorklet support, which needs
 * a threaded build whose SharedArrayBuffer can't be transferred into a worklet without
 * cross-origin isolation — unachievable in Electron. Phase 1 proved this path works; see
 * native/nam-wasm/test/live-spike.
 *
 * Kept out of the React component because an audio graph is imperative, long-lived, and must not
 * be torn down and rebuilt by re-renders.
 */

export interface LiveDeviceInfo {
  deviceId: string
  label: string
}

export interface LiveEngineState {
  running: boolean
  /** Round-trip latency estimate in ms, or null before the context exists. */
  latencyMs: number | null
  sampleRate: number | null
  error: string | null
}

export interface LiveStartOptions {
  /** Input device to capture from; omit for the system default. */
  deviceId?: string | null
  /** .nam file contents. */
  modelJson: string
  /** Decoded cabinet IR, or null for none. */
  ir?: { samples: Float32Array; sampleRate: number } | null
  /** Cabinet wet/dry mix 0..1. */
  irMix?: number
  inputGain?: number
  outputGain?: number
}

/**
 * Enumerate audio input devices.
 *
 * Labels are empty until permission has been granted at least once, so this asks for a stream
 * first and immediately discards it — the standard workaround, and harmless because the live
 * player is about to want that permission anyway.
 */
export async function listAudioInputs(): Promise<LiveDeviceInfo[]> {
  try {
    const probe = await navigator.mediaDevices.getUserMedia({ audio: true })
    probe.getTracks().forEach((t) => t.stop())
  } catch {
    // Denied or no device — still try to enumerate so the UI can show what it can.
  }

  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d, index) => ({
      deviceId: d.deviceId,
      label: d.label || `Input ${index + 1}`
    }))
}

export class LiveEngine {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private worklet: AudioWorkletNode | null = null
  private convolver: ConvolverNode | null = null
  private wetGain: GainNode | null = null
  private dryGain: GainNode | null = null
  private outputGain: GainNode | null = null
  private analyser: AnalyserNode | null = null
  private meterBuffer: Float32Array<ArrayBuffer> = new Float32Array(1024)
  /** Gain compensating the active IR's own level; see where it is computed in start(). */
  private irMakeup = 1

  /** Cached so repeated starts don't refetch/recompile the module. */
  private static wasmModule: WebAssembly.Module | null = null
  private static manifest: unknown = null

  private onError: (message: string) => void

  constructor(onError: (message: string) => void = () => {}) {
    this.onError = onError
  }

  get running(): boolean {
    return this.ctx !== null && this.ctx.state === 'running'
  }

  get sampleRate(): number | null {
    return this.ctx?.sampleRate ?? null
  }

  /**
   * Round-trip latency estimate.
   *
   * baseLatency covers the graph's own buffering; outputLatency covers the device/driver side.
   * Chromium can't use ASIO on Windows, so this typically lands at 20-50ms regardless of the
   * interface — worth surfacing so the number isn't a mystery.
   */
  get latencyMs(): number | null {
    if (!this.ctx) return null
    const base = this.ctx.baseLatency ?? 0
    const output = this.ctx.outputLatency ?? 0
    return (base + output) * 1000
  }

  private static async loadWasm(): Promise<{ module: WebAssembly.Module; manifest: unknown }> {
    if (LiveEngine.wasmModule && LiveEngine.manifest) {
      return { module: LiveEngine.wasmModule, manifest: LiveEngine.manifest }
    }
    const [wasmRes, manifestRes] = await Promise.all([
      fetch('/nam-worklet.wasm'),
      fetch('/nam-worklet.manifest.json')
    ])
    if (!wasmRes.ok) throw new Error(`Could not load nam-worklet.wasm (${wasmRes.status})`)
    if (!manifestRes.ok) {
      throw new Error(`Could not load nam-worklet.manifest.json (${manifestRes.status})`)
    }
    LiveEngine.wasmModule = await WebAssembly.compile(await wasmRes.arrayBuffer())
    LiveEngine.manifest = await manifestRes.json()
    return { module: LiveEngine.wasmModule, manifest: LiveEngine.manifest }
  }

  async start(options: LiveStartOptions): Promise<void> {
    await this.stop()

    try {
      const { module, manifest } = await LiveEngine.loadWasm()

      // Ask for the model's rate so the DSP runs at what it was trained for. The browser may
      // refuse and pick the device rate; that's reported rather than fought.
      const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })
      this.ctx = ctx

      // Every voice-call DSP must be off or it mangles a guitar signal: AGC pumps the level,
      // noise suppression eats sustain and pick attack, echo cancellation gates entirely.
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : {}),
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1
        },
        video: false
      })

      await ctx.audioWorklet.addModule('/nam-worklet.js')

      this.worklet = new AudioWorkletNode(ctx, 'nam-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        // A compiled WebAssembly.Module is structured-cloneable; a SharedArrayBuffer is not.
        // That distinction is the reason this works at all.
        processorOptions: { wasmModule: module, manifest }
      })

      this.worklet.port.onmessage = (event: MessageEvent) => {
        const data = event.data as { type?: string; error?: string; stage?: string }
        if (data.type === 'error') {
          this.onError(`${data.stage ?? 'worklet'}: ${data.error ?? 'unknown error'}`)
        }
      }

      // Encode here: AudioWorkletGlobalScope has no TextEncoder.
      const modelBytes = new TextEncoder().encode(options.modelJson)
      this.worklet.port.postMessage({ type: 'loadModel', modelBytes }, [modelBytes.buffer])
      this.worklet.port.postMessage({
        type: 'setGain',
        inputGain: options.inputGain ?? 1,
        outputGain: options.outputGain ?? 1
      })

      this.outputGain = ctx.createGain()
      this.outputGain.gain.value = 1

      this.source = ctx.createMediaStreamSource(this.stream)
      this.source.connect(this.worklet)

      const mix = Math.max(0, Math.min(1, options.irMix ?? 1))
      if (options.ir && options.ir.samples.length > 0 && mix > 0) {
        // Parallel wet/dry so cab amount stays blendable, matching the offline path.
        this.convolver = ctx.createConvolver()
        this.convolver.normalize = false

        // Always route through resampleForContext: it short-circuits when the rates match, and
        // returns a fresh ArrayBuffer-backed array, which copyToChannel's typing requires.
        const irSamples = await resampleForContext(
          options.ir.samples,
          options.ir.sampleRate,
          ctx.sampleRate
        )
        const irBuffer = ctx.createBuffer(1, irSamples.length, ctx.sampleRate)
        irBuffer.copyToChannel(irSamples, 0)
        this.convolver.buffer = irBuffer

        // Compensate for the IR's own gain.
        //
        // normalize=false preserves each cab's real relative level, which the OFFLINE path wants
        // because it runs a loudness normalization afterwards. Live has no such stage, so without
        // makeup gain enabling a cab jumps the output level hard — measured 0.25 -> 2.06 peak
        // with a real 200ms IR, i.e. ~8x louder and clipping.
        //
        // Dividing by the IR's L2 norm is the same energy normalization ConvolverNode's
        // normalize=true approximates, but applied where we can see and adjust it.
        let irEnergy = 0
        for (let i = 0; i < irSamples.length; i++) irEnergy += irSamples[i] * irSamples[i]
        const irMakeup = irEnergy > 0 ? 1 / Math.sqrt(irEnergy) : 1
        this.irMakeup = irMakeup

        this.wetGain = ctx.createGain()
        this.wetGain.gain.value = mix * irMakeup
        this.dryGain = ctx.createGain()
        this.dryGain.gain.value = 1 - mix

        this.worklet.connect(this.convolver)
        this.convolver.connect(this.wetGain)
        this.wetGain.connect(this.outputGain)

        this.worklet.connect(this.dryGain)
        this.dryGain.connect(this.outputGain)
      } else {
        this.worklet.connect(this.outputGain)
      }

      // Post-everything, so the meter shows what actually reaches the speakers.
      this.analyser = ctx.createAnalyser()
      this.analyser.fftSize = 2048
      this.outputGain.connect(this.analyser)
      this.outputGain.connect(ctx.destination)

      await ctx.resume()
    } catch (error) {
      await this.stop()
      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  /** Current output peak, 0..1. Cheap enough to poll from an animation frame. */
  readOutputPeak(): number {
    if (!this.analyser) return 0
    if (this.meterBuffer.length !== this.analyser.fftSize) {
      this.meterBuffer = new Float32Array(this.analyser.fftSize)
    }
    this.analyser.getFloatTimeDomainData(this.meterBuffer)
    let peak = 0
    for (let i = 0; i < this.meterBuffer.length; i++) {
      const v = Math.abs(this.meterBuffer[i])
      if (v > peak) peak = v
    }
    return peak
  }

  setBypass(bypass: boolean): void {
    this.worklet?.port.postMessage({ type: 'setBypass', bypass })
  }

  setGains(inputGain: number, outputGain: number): void {
    this.worklet?.port.postMessage({ type: 'setGain', inputGain, outputGain })
  }

  /** Change cabinet blend without rebuilding the graph. */
  setIrMix(mix: number): void {
    const wet = Math.max(0, Math.min(1, mix))
    // Keep the IR makeup applied, or sliding the mix would reintroduce the level jump.
    if (this.wetGain) this.wetGain.gain.value = wet * this.irMakeup
    if (this.dryGain) this.dryGain.gain.value = 1 - wet
  }

  async stop(): Promise<void> {
    // Release the mic promptly — an open input device is user-visible (OS indicators) and can
    // block other apps from grabbing the interface.
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null

    try {
      this.worklet?.port.postMessage({ type: 'unloadModel' })
    } catch {
      // Port already closed.
    }

    for (const node of [
      this.source,
      this.worklet,
      this.convolver,
      this.wetGain,
      this.dryGain,
      this.outputGain,
      this.analyser
    ]) {
      try {
        node?.disconnect()
      } catch {
        // Already disconnected.
      }
    }
    this.source = null
    this.worklet = null
    this.convolver = null
    this.wetGain = null
    this.dryGain = null
    this.outputGain = null
    this.analyser = null
    this.irMakeup = 1

    if (this.ctx) {
      try {
        await this.ctx.close()
      } catch {
        // Already closed.
      }
      this.ctx = null
    }
  }
}

/** Resample an IR to the live context's rate via OfflineAudioContext. */
async function resampleForContext(
  samples: Float32Array,
  sourceRate: number,
  targetRate: number
): Promise<Float32Array<ArrayBuffer>> {
  const copy = new Float32Array(samples.length)
  copy.set(samples)
  if (sourceRate === targetRate || samples.length === 0) return copy

  const targetLength = Math.max(1, Math.round((samples.length * targetRate) / sourceRate))
  const offline = new OfflineAudioContext(1, targetLength, targetRate)
  const buffer = offline.createBuffer(1, samples.length, sourceRate)
  buffer.copyToChannel(copy, 0)
  const node = offline.createBufferSource()
  node.buffer = buffer
  node.connect(offline.destination)
  node.start()
  const rendered = await offline.startRendering()
  const out = new Float32Array(rendered.length)
  rendered.copyFromChannel(out, 0)
  return out
}
