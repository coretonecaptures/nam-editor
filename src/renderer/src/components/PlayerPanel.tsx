import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NamFile } from '../types/nam'
import type { NamRenderRequest, NamRenderResponse } from '../workers/namRender.worker'

/**
 * In-app tone preview player.
 *
 * Renders a reference DI clip through the capture's model offline (in a Worker), then plays the
 * result back. It deliberately does NOT do real-time processing: that requires an AudioWorklet
 * fed from a threaded WASM build, whose SharedArrayBuffer can't be transferred into the worklet
 * unless the page is cross-origin isolated — unachievable in Electron. See
 * docs/player-investigation.md and native/nam-wasm/README.md for the full history.
 */

// Cap how much audio we render. At worst measured throughput (~7x realtime for A1 Standard),
// 12s of audio is ~1.7s of compute — long enough to judge a tone, short enough to feel snappy.
const MAX_PREVIEW_SECONDS = 12

// Match the level the shipping NAM plugin normalizes models to.
const TARGET_LOUDNESS_DB = -18

type PlayerStatus = 'idle' | 'loading-di' | 'rendering' | 'ready' | 'error'

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

/**
 * Scale rendered audio to a sane playback level.
 *
 * Model output is NOT normalized — an A2 model can render a peak of ~10.0 from a 0.25-amplitude
 * input, which would be violently loud and clip hard. Prefer the model's own loudness metadata
 * (same approach as the real plugin); fall back to peak normalization when it has none.
 */
function normalizeRendered(
  samples: Float32Array,
  loudnessDb: number | null
): Float32Array<ArrayBuffer> {
  let gain: number

  if (loudnessDb !== null && Number.isFinite(loudnessDb)) {
    gain = Math.pow(10, (TARGET_LOUDNESS_DB - loudnessDb) * 0.05)
  } else {
    let peak = 0
    for (let i = 0; i < samples.length; i++) {
      const abs = Math.abs(samples[i])
      if (abs > peak) peak = abs
    }
    gain = peak > 0 ? 0.7 / peak : 1
  }

  // Safety net: never let an outlier loudness value produce a damaging playback level.
  let peakAfter = 0
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]) * gain
    if (abs > peakAfter) peakAfter = abs
  }
  if (peakAfter > 0.99) gain *= 0.99 / peakAfter

  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain
  return out
}

interface PlayerPanelProps {
  file: NamFile
  /** Reference DI WAV to render through the model. Usually the configured training Input DI. */
  defaultDiPath?: string | null
}

export function PlayerPanel({ file, onClose, defaultDiPath }: PlayerPanelProps & { onClose: () => void }) {
  const [status, setStatus] = useState<PlayerStatus>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [diPath, setDiPath] = useState<string | null>(defaultDiPath ?? null)
  const [renderMs, setRenderMs] = useState<number | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const bufferRef = useRef<AudioBuffer | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const startedAtRef = useRef(0)
  const rafRef = useRef<number | null>(null)

  const m = file.metadata
  const captureLabel = m.name || file.fileName

  const getAudioContext = useCallback(() => {
    if (audioCtxRef.current === null || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext()
    }
    return audioCtxRef.current
  }, [])

  const stopPlayback = useCallback(() => {
    if (sourceRef.current) {
      try {
        sourceRef.current.onended = null
        sourceRef.current.stop()
      } catch {
        // Already stopped — nothing to do.
      }
      sourceRef.current = null
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    setIsPlaying(false)
    setProgress(0)
  }, [])

  // Tear everything down on unmount so a closed panel can't keep audio or a worker alive.
  useEffect(() => {
    return () => {
      stopPlayback()
      workerRef.current?.terminate()
      workerRef.current = null
      void audioCtxRef.current?.close()
      audioCtxRef.current = null
    }
  }, [stopPlayback])

  const renderPreview = useCallback(
    async (sourceDiPath: string) => {
      stopPlayback()
      bufferRef.current = null
      setErrorMsg('')
      setRenderMs(null)
      setStatus('loading-di')

      try {
        // 1. Read the reference DI and the model, both through main-process IPC.
        const [diResult, modelResult] = await Promise.all([
          window.api.readFileBinary(sourceDiPath),
          window.api.readFileBinary(file.filePath)
        ])

        if (diResult.error || !diResult.data) {
          throw new Error(`Could not read the reference DI: ${diResult.error ?? 'no data'}`)
        }
        if (modelResult.error || !modelResult.data) {
          throw new Error(`Could not read the capture: ${modelResult.error ?? 'no data'}`)
        }

        // 2. Decode the DI to raw samples, trimmed to the preview length.
        const ctx = getAudioContext()
        const decoded = await ctx.decodeAudioData(base64ToArrayBuffer(diResult.data))
        const sampleRate = decoded.sampleRate
        const maxSamples = Math.min(decoded.length, Math.floor(MAX_PREVIEW_SECONDS * sampleRate))
        // NAM models are mono; use the first channel. copyFromChannel fills at most
        // input.length samples, which is already clamped to the preview length.
        const input = new Float32Array(maxSamples)
        decoded.copyFromChannel(input, 0, 0)

        const modelJson = new TextDecoder().decode(base64ToArrayBuffer(modelResult.data))

        // 3. Render through the model off the UI thread.
        setStatus('rendering')
        const rendered = await new Promise<NamRenderResponse>((resolve, reject) => {
          workerRef.current?.terminate()
          const worker = new Worker(
            new URL('../workers/namRender.worker.ts', import.meta.url),
            { type: 'module' }
          )
          workerRef.current = worker
          worker.onmessage = (event: MessageEvent<NamRenderResponse>) => resolve(event.data)
          worker.onerror = (event) => reject(new Error(event.message || 'Render worker crashed'))

          const request: NamRenderRequest = { modelJson, input, sampleRate }
          worker.postMessage(request, [input.buffer])
        })

        if (!rendered.ok) throw new Error(rendered.error)

        // 4. Normalize and hand to Web Audio.
        const normalized = normalizeRendered(rendered.output, rendered.loudnessDb)
        const audioBuffer = ctx.createBuffer(1, normalized.length, sampleRate)
        audioBuffer.copyToChannel(normalized, 0)

        bufferRef.current = audioBuffer
        setRenderMs(rendered.renderMs)
        setStatus('ready')
      } catch (error) {
        setErrorMsg(formatError(error))
        setStatus('error')
      }
    },
    [file.filePath, getAudioContext, stopPlayback]
  )

  // Render as soon as we have a DI to work with.
  useEffect(() => {
    if (diPath) void renderPreview(diPath)
    else setStatus('idle')
  }, [diPath, renderPreview])

  const handlePlayStop = useCallback(() => {
    if (isPlaying) {
      stopPlayback()
      return
    }
    const buffer = bufferRef.current
    if (!buffer) return

    const ctx = getAudioContext()
    void ctx.resume()

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    source.onended = () => stopPlayback()
    source.start()

    sourceRef.current = source
    startedAtRef.current = ctx.currentTime
    setIsPlaying(true)

    const tick = () => {
      const elapsed = ctx.currentTime - startedAtRef.current
      setProgress(Math.min(1, elapsed / buffer.duration))
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [isPlaying, getAudioContext, stopPlayback])

  const handleChooseDi = useCallback(async () => {
    const picked = await window.api.openAudioFile()
    if (picked) setDiPath(picked)
  }, [])

  const diLabel = useMemo(() => {
    if (!diPath) return null
    return diPath.replace(/\\/g, '/').split('/').pop() ?? diPath
  }, [diPath])

  const busy = status === 'loading-di' || status === 'rendering'

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 select-none">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-teal-500 dark:text-teal-400 uppercase tracking-wide mb-0.5">
            Tone Preview
          </div>
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
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
        {status === 'idle' && (
          <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-800 p-4 text-center">
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-1">No reference DI selected</p>
            <p className="text-xs text-gray-500 mb-3">
              Pick a clean DI WAV to hear this capture. Set a default in Settings → Training.
            </p>
            <button
              onClick={handleChooseDi}
              className="h-8 px-3 rounded-lg text-xs font-medium bg-teal-500 hover:bg-teal-600 text-white transition-colors"
            >
              Choose DI WAV…
            </button>
          </div>
        )}

        {busy && (
          <div className="flex flex-col items-center justify-center py-10 gap-3 text-gray-400">
            <svg className="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            <span className="text-sm">
              {status === 'loading-di' ? 'Loading reference DI…' : 'Rendering tone…'}
            </span>
          </div>
        )}

        {status === 'error' && (
          <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
            <p className="text-sm font-medium text-red-700 dark:text-red-400 mb-1">Preview failed</p>
            <p className="text-xs text-red-600 dark:text-red-500 font-mono break-all">{errorMsg}</p>
            <button
              onClick={() => diPath && void renderPreview(diPath)}
              className="mt-3 h-7 px-3 rounded-md text-xs font-medium border border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {status === 'ready' && (
          <>
            {/* Play / Stop */}
            <div className="flex items-center justify-center">
              <button
                onClick={handlePlayStop}
                className={`w-16 h-16 rounded-full flex items-center justify-center shadow-lg transition-all ${
                  isPlaying
                    ? 'bg-red-500 hover:bg-red-600 text-white'
                    : 'bg-teal-500 hover:bg-teal-600 text-white'
                }`}
                title={isPlaying ? 'Stop' : 'Play preview'}
              >
                {isPlaying ? (
                  <svg viewBox="0 0 24 24" className="w-7 h-7" fill="currentColor">
                    <rect x="6" y="6" width="12" height="12" rx="1" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="w-7 h-7" fill="currentColor">
                    <path d="M8 5.14v14l11-7-11-7z" />
                  </svg>
                )}
              </button>
            </div>

            {/* Progress */}
            <div className="h-1.5 bg-gray-200 dark:bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-teal-400 rounded-full"
                style={{ width: `${progress * 100}%`, transition: isPlaying ? 'none' : 'width 150ms' }}
              />
            </div>
          </>
        )}

        {/* Reference DI — always visible once one is chosen, so it can be swapped. */}
        {diPath && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Reference DI
            </div>
            <div className="flex items-center gap-2">
              <span
                className="flex-1 min-w-0 truncate text-xs font-mono text-gray-600 dark:text-gray-300"
                title={diPath}
              >
                {diLabel}
              </span>
              <button
                onClick={handleChooseDi}
                disabled={busy}
                className="flex-shrink-0 h-7 px-2.5 rounded-md text-xs font-medium border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                Change…
              </button>
            </div>
            <p className="text-[11px] text-gray-400">
              First {MAX_PREVIEW_SECONDS}s rendered through the model
              {renderMs !== null ? ` · took ${(renderMs / 1000).toFixed(1)}s` : ''}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
