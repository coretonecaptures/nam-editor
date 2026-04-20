import { useEffect, useRef, useState, useCallback } from 'react'
import { T3kPlayerContextProvider, useT3kPlayerContext } from 'neural-amp-modeler-wasm'
import { NamFile } from '../types/nam'

function getSharedArrayBufferCtor(): typeof SharedArrayBuffer | undefined {
  if (typeof SharedArrayBuffer !== 'undefined') return SharedArrayBuffer

  try {
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true })
    const ctor = memory.buffer.constructor as typeof SharedArrayBuffer
    if (ctor?.name && ctor.name !== 'ArrayBuffer') return ctor
  } catch {
    // Ignore and fall back to the normal failure path below.
  }

  return undefined
}

function canUseSharedWasmMemory() {
  try {
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true })
    return {
      supported: true,
      buffer: memory.buffer,
      ctor: memory.buffer.constructor as typeof SharedArrayBuffer
    }
  } catch (error) {
    return {
      supported: false,
      error
    }
  }
}

function formatPlayerError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`
  if (typeof error === 'number') return `WASM exception pointer: ${error}`
  return String(error)
}

function serializePlayerLogValue(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}\n${value.stack ?? ''}`
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function appendPlayerLog(level: 'info' | 'warn' | 'error', message: string, details?: unknown) {
  const suffix = details === undefined ? '' : ` | ${serializePlayerLogValue(details)}`
  void window.api.appendRendererLog(`[Player][${level}] ${message}${suffix}`)
}

function installAudioWorkletDebugHooks() {
  const restorers: Array<() => void> = []

  if (typeof AudioWorklet !== 'undefined') {
    const originalAddModule = AudioWorklet.prototype.addModule
    AudioWorklet.prototype.addModule = function addModuleWithLogging(moduleURL: string | URL, options?: WorkletOptions) {
      console.log('[Player] AudioWorklet.addModule ->', String(moduleURL))
      return originalAddModule.call(this, moduleURL, options)
        .then((result) => {
          console.log('[Player] AudioWorklet.addModule ok <-', String(moduleURL))
          return result
        })
        .catch((error) => {
          console.error('[Player] AudioWorklet.addModule failed <-', String(moduleURL), error)
          appendPlayerLog('error', `AudioWorklet.addModule failed <- ${String(moduleURL)}`, error)
          throw error
        })
    }
    restorers.push(() => {
      AudioWorklet.prototype.addModule = originalAddModule
    })
  }

  if (typeof AudioWorkletNode !== 'undefined') {
    const NativeAudioWorkletNode = AudioWorkletNode
    const LoggedAudioWorkletNode = class extends NativeAudioWorkletNode {
      constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
        console.log(
          '[Player] new AudioWorkletNode ->',
          name,
          options,
          '| window.crossOriginIsolated:',
          window.crossOriginIsolated,
          '| globalThis.crossOriginIsolated:',
          globalThis.crossOriginIsolated
        )
        try {
          super(context, name, options)
          console.log('[Player] new AudioWorkletNode ok <-', name)
        } catch (error) {
          console.error('[Player] new AudioWorkletNode failed <-', name, error)
          appendPlayerLog('error', `new AudioWorkletNode failed <- ${name}`, {
            error: serializePlayerLogValue(error),
            windowCrossOriginIsolated: window.crossOriginIsolated,
            globalCrossOriginIsolated: globalThis.crossOriginIsolated
          })
          throw error
        }
      }
    }

    Object.defineProperty(window, 'AudioWorkletNode', {
      configurable: true,
      writable: true,
      value: LoggedAudioWorkletNode
    })

    restorers.push(() => {
      Object.defineProperty(window, 'AudioWorkletNode', {
        configurable: true,
        writable: true,
        value: NativeAudioWorkletNode
      })
    })
  }

  return () => {
    for (const restore of restorers.reverse()) restore()
  }
}

const sharedArrayBufferCtor = getSharedArrayBufferCtor()
if (typeof SharedArrayBuffer === 'undefined' && sharedArrayBufferCtor) {
  ;(globalThis as typeof globalThis & { SharedArrayBuffer?: typeof SharedArrayBuffer }).SharedArrayBuffer = sharedArrayBufferCtor
}

// ─── Level meter hook ────────────────────────────────────────────────────────

function useLevelMeter(analyserNode: AnalyserNode | null) {
  const [level, setLevel] = useState(0)
  const rafRef = useRef<number | null>(null)
  const bufRef = useRef<Float32Array | null>(null)

  useEffect(() => {
    if (!analyserNode) { setLevel(0); return }
    const buf = new Float32Array(analyserNode.fftSize)
    bufRef.current = buf

    const tick = () => {
      analyserNode.getFloatTimeDomainData(buf)
      let peak = 0
      for (let i = 0; i < buf.length; i++) {
        const abs = Math.abs(buf[i])
        if (abs > peak) peak = abs
      }
      setLevel(peak)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [analyserNode])

  return level
}

// ─── Level bar component ─────────────────────────────────────────────────────

function LevelBar({ level, label }: { level: number; label: string }) {
  // Convert linear amplitude to dB, clamp to -60..0
  const db = level > 0 ? Math.max(-60, 20 * Math.log10(level)) : -60
  const pct = Math.max(0, Math.min(100, (db + 60) / 60 * 100))

  const color =
    db > -6 ? 'bg-red-500' :
    db > -18 ? 'bg-amber-400' :
    'bg-teal-400'

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 w-6 flex-shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-none ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-gray-500 w-10 text-right tabular-nums">
        {db > -60 ? `${db.toFixed(1)}` : '—'}
      </span>
    </div>
  )
}

// ─── Inner panel (uses context) ───────────────────────────────────────────────

interface PlayerPanelInnerProps {
  file: NamFile
  onClose: () => void
}

function PlayerPanelInner({ file, onClose }: PlayerPanelInnerProps) {
  const {
    init,
    loadModel,
    startLiveInput,
    stopLiveInput,
    getAudioNodes,
    audioState,
    microphonePermission,
    requestMicrophonePermission,
    refreshAudioInputDevices,
    audioInputDevices,
    setBypass,
    setLiveInputGain,
  } = useT3kPlayerContext()

  type Status = 'idle' | 'loading' | 'ready' | 'error'
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [isLive, setIsLive] = useState(false)
  const [isBypassed, setIsBypassed] = useState(false)
  const [inputGainDb, setInputGainDb] = useState(0)
  const blobUrlRef = useRef<string | null>(null)

  // Load the file on mount
  useEffect(() => {
    const wasmMemoryProbe = canUseSharedWasmMemory()
    const hasSharedArrayBufferCtor = typeof SharedArrayBuffer !== 'undefined'
    const canProceed = window.crossOriginIsolated || wasmMemoryProbe.supported

    console.log(
      '[Player] crossOriginIsolated:',
      window.crossOriginIsolated,
      '| SharedArrayBuffer:',
      typeof SharedArrayBuffer,
      '| sharedWasmMemory:',
      wasmMemoryProbe.supported
    )
    appendPlayerLog('info', 'initial isolation probe', {
      crossOriginIsolated: window.crossOriginIsolated,
      sharedArrayBufferType: typeof SharedArrayBuffer,
      sharedWasmMemory: wasmMemoryProbe.supported
    })

    if (!canProceed) {
      const message = 'NAM player requires shared WebAssembly memory, but this renderer cannot create it yet.'
      console.error('[Player]', message)
      appendPlayerLog('error', message, 'error' in wasmMemoryProbe ? wasmMemoryProbe.error : undefined)
      if ('error' in wasmMemoryProbe) {
        console.error('[Player] WebAssembly.Memory(shared) failed:', wasmMemoryProbe.error)
      }
      setErrorMsg(message)
      setStatus('error')
      return
    }

    if (wasmMemoryProbe.supported) {
      console.log(
        '[Player] WebAssembly.Memory(shared) buffer type:',
        wasmMemoryProbe.buffer.constructor.name,
        '| instanceof SAB:',
        hasSharedArrayBufferCtor ? wasmMemoryProbe.buffer instanceof SharedArrayBuffer : 'n/a'
      )
    }

    console.log('[Player] typeof Atomics:', typeof Atomics)
    let cancelled = false
    let workletCallbackSeen = false
    const restoreAudioWorkletDebugHooks = installAudioWorkletDebugHooks()
    const workletCallbackTimeout = window.setTimeout(() => {
      if (!cancelled && !workletCallbackSeen) {
        console.warn('[Player] wasmAudioWorkletCreated has not fired yet')
        appendPlayerLog('warn', 'wasmAudioWorkletCreated has not fired yet')
      }
    }, 5000)

    const windowWithCallback = window as Window & {
      wasmAudioWorkletCreated?: ((node: AudioWorkletNode, context: AudioContext) => void) | undefined
    }
    const originalDescriptor = Object.getOwnPropertyDescriptor(windowWithCallback, 'wasmAudioWorkletCreated')

    Object.defineProperty(windowWithCallback, 'wasmAudioWorkletCreated', {
      configurable: true,
      enumerable: true,
      get() {
        return undefined
      },
      set(callback) {
        const wrappedCallback = typeof callback === 'function'
          ? ((node: AudioWorkletNode, context: AudioContext) => {
              workletCallbackSeen = true
              console.log('[Player] wasmAudioWorkletCreated fired')
              appendPlayerLog('info', 'wasmAudioWorkletCreated fired')
              return callback(node, context)
            })
          : callback

        Object.defineProperty(windowWithCallback, 'wasmAudioWorkletCreated', {
          configurable: true,
          enumerable: true,
          writable: true,
          value: wrappedCallback
        })
      }
    })

    const load = async () => {
      setStatus('loading')
      try {
        const result = await window.api.readFileBinary(file.filePath)
        if (result.error || !result.data) throw new Error(result.error ?? 'Read failed')

        // base64 → Uint8Array → blob URL
        const raw = atob(result.data)
        const buf = new Uint8Array(raw.length)
        for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i)
        const url = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' }))
        blobUrlRef.current = url

        if (cancelled) { URL.revokeObjectURL(url); return }

        console.log('[Player] calling init()...')
        appendPlayerLog('info', 'calling init()')
        await init({ modelUrl: url })
        console.log('[Player] init() resolved — ready')
        appendPlayerLog('info', 'init() resolved — ready')
        if (cancelled) return
        setStatus('ready')
        // Fetch device list once ready
        refreshAudioInputDevices()
      } catch (err) {
        if (!cancelled) {
          console.error('[Player] init failed:', err)
          appendPlayerLog('error', 'init failed', err)
          setErrorMsg(formatPlayerError(err))
          setStatus('error')
        }
      }
    }
    load()
    return () => {
      cancelled = true
      window.clearTimeout(workletCallbackTimeout)
      restoreAudioWorkletDebugHooks()
      if (originalDescriptor) {
        Object.defineProperty(windowWithCallback, 'wasmAudioWorkletCreated', originalDescriptor)
      } else {
        delete windowWithCallback.wasmAudioWorkletCreated
      }
      if (blobUrlRef.current) { URL.revokeObjectURL(blobUrlRef.current); blobUrlRef.current = null }
    }
  }, [file.filePath])

  // Swap model if file changes while player is open
  useEffect(() => {
    if (status !== 'ready') return
    let cancelled = false
    const swap = async () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current)
      const result = await window.api.readFileBinary(file.filePath)
      if (cancelled || result.error || !result.data) return
      const raw = atob(result.data)
      const buf = new Uint8Array(raw.length)
      for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i)
      const url = URL.createObjectURL(new Blob([buf], { type: 'application/octet-stream' }))
      blobUrlRef.current = url
      await loadModel(url)
    }
    swap()
    return () => { cancelled = true }
  }, [file.filePath, status]) // eslint-disable-line react-hooks/exhaustive-deps

  const handlePlayStop = useCallback(async () => {
    if (isLive) {
      stopLiveInput()
      setIsLive(false)
    } else {
      if (microphonePermission.status !== 'granted') {
        await requestMicrophonePermission()
      }
      await startLiveInput()
      setIsLive(true)
    }
  }, [isLive, microphonePermission.status, requestMicrophonePermission, startLiveInput, stopLiveInput])

  const handleBypassToggle = useCallback(() => {
    const next = !isBypassed
    setIsBypassed(next)
    setBypass(next)
  }, [isBypassed, setBypass])

  const handleGainChange = useCallback((db: number) => {
    setInputGainDb(db)
    setLiveInputGain(db)
  }, [setLiveInputGain])

  // Level meters
  const nodes = status === 'ready' ? getAudioNodes() : null
  const inputLevel = useLevelMeter(nodes?.inputMeterNode ?? null)
  const outputLevel = useLevelMeter(nodes?.outputMeterNode ?? null)

  // Metadata fields for display
  const m = file.metadata
  const captureLabel = m.name || file.fileName

  // Calibration info (display only for now — manual gain is the control)
  const hasCalData = m.input_level_dbu != null || m.output_level_dbu != null

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 select-none">

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-teal-500 dark:text-teal-400 uppercase tracking-wide mb-0.5">Now Playing</div>
          <div className="text-sm font-semibold truncate">{captureLabel}</div>
          {(m.gear_make || m.gear_model) && (
            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {[m.gear_make, m.gear_model].filter(Boolean).join(' ')}
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          title="Close player"
        >
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/>
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

        {/* Status / Loading */}
        {status === 'loading' && (
          <div className="flex flex-col items-center justify-center py-10 gap-3 text-gray-400">
            <svg className="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            <span className="text-sm">Loading model…</span>
          </div>
        )}

        {status === 'error' && (
          <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
            <p className="text-sm font-medium text-red-700 dark:text-red-400 mb-1">Failed to load model</p>
            <p className="text-xs text-red-600 dark:text-red-500 font-mono break-all">{errorMsg}</p>
            <p className="text-xs text-gray-500 mt-2">This architecture may not be supported by the WASM player.</p>
          </div>
        )}

        {status === 'ready' && (
          <>
            {/* Play / Stop */}
            <div className="flex items-center justify-center">
              <button
                onClick={handlePlayStop}
                className={`w-16 h-16 rounded-full flex items-center justify-center shadow-lg transition-all ${
                  isLive
                    ? 'bg-red-500 hover:bg-red-600 text-white'
                    : 'bg-teal-500 hover:bg-teal-600 text-white'
                }`}
                title={isLive ? 'Stop' : 'Start live input'}
              >
                {isLive ? (
                  // Stop square
                  <svg viewBox="0 0 24 24" className="w-7 h-7" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="1"/>
                  </svg>
                ) : (
                  // Play triangle
                  <svg viewBox="0 0 24 24" className="w-7 h-7" fill="currentColor">
                    <path d="M8 5.14v14l11-7-11-7z"/>
                  </svg>
                )}
              </button>
            </div>

            {/* Mic permission warning */}
            {microphonePermission.status === 'denied' || microphonePermission.status === 'blocked' ? (
              <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 p-3 text-xs text-amber-700 dark:text-amber-400">
                Microphone access was denied. Allow microphone access in your OS settings and restart the app.
              </div>
            ) : null}

            {/* Level meters */}
            <div className="space-y-2">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Levels</div>
              <LevelBar level={inputLevel} label="In" />
              <LevelBar level={outputLevel} label="Out" />
            </div>

            {/* Input gain */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Input Gain</span>
                <span className="text-xs tabular-nums text-gray-400">{inputGainDb > 0 ? '+' : ''}{inputGainDb} dB</span>
              </div>
              <input
                type="range"
                min={-24}
                max={24}
                step={0.5}
                value={inputGainDb}
                onChange={(e) => handleGainChange(Number(e.target.value))}
                className="w-full accent-teal-500"
              />
            </div>

            {/* Bypass */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Bypass</span>
              <button
                onClick={handleBypassToggle}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                  isBypassed ? 'bg-amber-400' : 'bg-gray-300 dark:bg-gray-600'
                }`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${isBypassed ? 'translate-x-[18px]' : 'translate-x-0.5'}`}/>
              </button>
            </div>

            {/* Calibration info */}
            {hasCalData && (
              <div className="rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-3 space-y-1">
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Capture Levels</div>
                {m.input_level_dbu != null && (
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Reamp send</span>
                    <span className="tabular-nums font-mono">{m.input_level_dbu} dBu</span>
                  </div>
                )}
                {m.output_level_dbu != null && (
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Reamp return</span>
                    <span className="tabular-nums font-mono">{m.output_level_dbu} dBu</span>
                  </div>
                )}
                {m.loudness != null && (
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Loudness</span>
                    <span className="tabular-nums font-mono">{m.loudness.toFixed(1)} LUFS</span>
                  </div>
                )}
                <p className="text-xs text-gray-400 pt-1">Adjust Input Gain to match your interface's reamp send level.</p>
              </div>
            )}

            {/* Device selector */}
            {audioInputDevices.devices.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Input Device</div>
                <select
                  className="w-full text-xs px-2 py-1.5 rounded-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100"
                  onChange={(e) => {
                    if (isLive) {
                      stopLiveInput()
                      startLiveInput(e.target.value).then(() => setIsLive(true))
                    }
                  }}
                >
                  {audioInputDevices.devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>
                  ))}
                </select>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer hint */}
      {status === 'ready' && (
        <div className="px-4 py-2 border-t border-gray-200 dark:border-gray-800 flex-shrink-0">
          <p className="text-xs text-gray-400 text-center">
            {isLive ? 'Live — guitar signal processed through model' : 'Press play to start live guitar input'}
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Public export — wraps with context provider ──────────────────────────────

interface PlayerPanelProps {
  file: NamFile
  onClose: () => void
}

export function PlayerPanel({ file, onClose }: PlayerPanelProps) {
  return (
    <T3kPlayerContextProvider>
      <PlayerPanelInner file={file} onClose={onClose} />
    </T3kPlayerContextProvider>
  )
}
