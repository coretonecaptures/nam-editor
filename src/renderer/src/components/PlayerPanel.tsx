import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NamFile } from '../types/nam'
import { base64ToArrayBuffer, normalizeRendered } from '../utils/playerAudio'
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

type PlayerStatus = 'idle' | 'loading-di' | 'rendering' | 'ready' | 'error'

/**
 * Last DI clip the user auditioned through, remembered for the session.
 *
 * Module-level rather than a ref because App mounts PlayerPanel with `key={filePath}`, so the
 * component fully remounts on every capture change. Without this, picking a DI and then
 * clicking a different capture would drop you back to "no clip selected" every time.
 */
let lastDiPath: string | null = null

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

interface DiCategory {
  name: string
  files: Array<{ name: string; path: string }>
}

interface PlayerPanelProps {
  file: NamFile
  /**
   * Folder of musical guitar DI clips, organized into category subfolders.
   *
   * Deliberately NOT the training Input DI: that's NAM's calibration/reamp signal (sine sweeps
   * and noise bursts), which is correct for training and sounds like static as a preview.
   */
  diLibraryPath?: string | null
}

export function PlayerPanel({ file, onClose, diLibraryPath }: PlayerPanelProps & { onClose: () => void }) {
  const [status, setStatus] = useState<PlayerStatus>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [categories, setCategories] = useState<DiCategory[]>([])
  const [libraryError, setLibraryError] = useState('')
  const [diPath, setDiPath] = useState<string | null>(null)
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

  // Scan the DI library once per library path. Nothing is auto-selected: which clip you want to
  // hear a capture through is a taste decision (a clean model through a metal riff tells you
  // little), so the user picks and we remember it for the session via lastDiPathRef.
  useEffect(() => {
    let cancelled = false
    if (!diLibraryPath) {
      setCategories([])
      setLibraryError('')
      return
    }
    void (async () => {
      const result = await window.api.scanDiLibrary(diLibraryPath)
      if (cancelled) return
      setCategories(result.categories)
      setLibraryError(
        result.error ??
          (result.categories.length === 0 ? 'No .wav files found in the DI library folder.' : '')
      )
      // Re-select the previous clip if it's still present, so switching captures doesn't
      // silently reset which DI you were auditioning through.
      const remembered = lastDiPath
      if (remembered && result.categories.some((c) => c.files.some((f) => f.path === remembered))) {
        setDiPath(remembered)
      }
    })()
    return () => { cancelled = true }
  }, [diLibraryPath])

  // Render as soon as we have a DI to work with.
  useEffect(() => {
    if (diPath) {
      lastDiPath = diPath
      void renderPreview(diPath)
    } else {
      setStatus('idle')
    }
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

  const diLabel = useMemo(() => {
    if (!diPath) return null
    return diPath.replace(/\\/g, '/').split('/').pop() ?? diPath
  }, [diPath])

  const busy = status === 'loading-di' || status === 'rendering'
  const hasLibrary = categories.length > 0

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
        {/* No library configured, or it's empty/unreadable. */}
        {!hasLibrary && (
          <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-800 p-4">
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-1">No DI clips available</p>
            <p className="text-xs text-gray-500">
              {libraryError ||
                'Set a DI Clip Library folder in Settings → Library to preview captures.'}
            </p>
            <p className="text-[11px] text-gray-400 dark:text-gray-600 mt-2 leading-relaxed">
              Put guitar DI recordings in subfolders — e.g. <span className="font-mono">Clean/</span>,{' '}
              <span className="font-mono">Medium Gain/</span>, <span className="font-mono">High Gain/</span>{' '}
              — and each subfolder becomes a category here.
            </p>
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

        {/* DI clip picker — always visible so clips can be A/B'd against the same capture. */}
        {hasLibrary && (
          <div className="space-y-3">
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
              Play Through
            </div>

            {categories.map((category) => (
              <div key={category.name} className="space-y-1.5">
                <div className="text-[11px] font-medium text-gray-400 dark:text-gray-500">
                  {category.name}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {category.files.map((clip) => {
                    const selected = clip.path === diPath
                    return (
                      <button
                        key={clip.path}
                        onClick={() => setDiPath(clip.path)}
                        disabled={busy}
                        title={clip.name}
                        className={`h-7 px-2.5 rounded-md text-xs font-medium border transition-colors disabled:opacity-50 max-w-full truncate ${
                          selected
                            ? 'border-teal-500 bg-teal-500 text-white'
                            : 'border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                        }`}
                      >
                        {clip.name.replace(/\.wav$/i, '')}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}

            {diPath && (
              <p className="text-[11px] text-gray-400 pt-1">
                First {MAX_PREVIEW_SECONDS}s of{' '}
                <span className="font-mono">{diLabel}</span> rendered through this capture
                {renderMs !== null ? ` · took ${(renderMs / 1000).toFixed(1)}s` : ''}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
