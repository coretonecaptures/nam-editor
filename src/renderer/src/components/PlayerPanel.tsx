import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NamFile } from '../types/nam'
import { detectPreset } from '../utils/detectPreset'
import { getCaptureBestEsr, getEsrTone } from '../utils/esr'
import {
  applyDcBlocker,
  base64ToArrayBuffer,
  captureNeedsCabIr,
  findLoudestWindowStart,
  sortDiCategories,
  normalizeRendered,
  readModelSampleRate
} from '../utils/playerAudio'
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
 * Which IR the user last auditioned, remembered for the session.
 *
 * Module-level rather than a ref because App mounts PlayerPanel with `key={filePath}`, so the
 * component fully remounts on every capture change. Without this, picking an IR and then
 * clicking a different capture would reset the choice every time. (DI choices are persisted
 * per category in localStorage instead — see DI_PREFS_KEY.)
 */
let lastIrPath: string | null = null

/**
 * Which clip each DI category last used, and which category was last active.
 *
 * Persisted to localStorage rather than kept in module state so the choice survives app
 * restarts — "remember my Clean sample" is only useful if it's actually remembered. Keyed by
 * category name, so reorganizing the library degrades gracefully (an unknown key is just
 * ignored and the first clip is used).
 */
const DI_PREFS_KEY = 'nam-player-di-prefs'

interface DiPrefs {
  /** category name -> chosen clip path */
  byCategory: Record<string, string>
  activeCategory: string | null
}

function loadDiPrefs(): DiPrefs {
  try {
    const raw = localStorage.getItem(DI_PREFS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DiPrefs>
      return {
        byCategory: parsed.byCategory ?? {},
        activeCategory: parsed.activeCategory ?? null
      }
    }
  } catch {
    // Corrupt or unavailable storage shouldn't stop the player from working.
  }
  return { byCategory: {}, activeCategory: null }
}

function saveDiPrefs(prefs: DiPrefs): void {
  try {
    localStorage.setItem(DI_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Non-fatal.
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Resample mono audio to `targetRate` using an OfflineAudioContext.
 *
 * Web Audio's own resampler is better than anything worth hand-rolling here, and this runs on a
 * short window so the extra render pass is cheap. Returns the input untouched when the rates
 * already match.
 */
async function resampleTo(
  samples: Float32Array,
  sourceRate: number,
  targetRate: number
): Promise<Float32Array<ArrayBuffer>> {
  const copy = new Float32Array(samples.length)
  copy.set(samples)
  if (sourceRate === targetRate || samples.length === 0) return copy

  const targetLength = Math.max(1, Math.round((samples.length * targetRate) / sourceRate))
  const offline = new OfflineAudioContext(1, targetLength, targetRate)

  const sourceBuffer = offline.createBuffer(1, samples.length, sourceRate)
  sourceBuffer.copyToChannel(copy, 0)

  const node = offline.createBufferSource()
  node.buffer = sourceBuffer
  node.connect(offline.destination)
  node.start()

  const resampled = await offline.startRendering()
  const out = new Float32Array(resampled.length)
  resampled.copyFromChannel(out, 0)
  return out
}

/**
 * Convolve `samples` with a cabinet impulse response, blended wet/dry.
 *
 * Mirrors upstream's parallel-path topology (source -> convolver -> wetGain -> out, alongside
 * source -> dryGain -> out with dryGain = 1 - mix) rather than an in-line convolver, so cab
 * amount is blendable. Runs in an OfflineAudioContext and bakes the result into the cached
 * preview buffer, which suits render-then-play: no live node graph to rebuild on every play.
 *
 * `normalize: false` on the ConvolverNode is deliberate — Web Audio's default normalization
 * rescales by the IR's energy, which changes the perceived level between different cabs. We do
 * our own loudness normalization afterwards and want the IR's real relative gain preserved.
 */
async function applyCabinetIr(
  samples: Float32Array,
  sampleRate: number,
  irSamples: Float32Array,
  irSampleRate: number,
  mix: number
): Promise<Float32Array<ArrayBuffer>> {
  const wet = Math.max(0, Math.min(1, mix))
  const dry = 1 - wet
  if (samples.length === 0 || irSamples.length === 0 || wet === 0) {
    const passthrough = new Float32Array(samples.length)
    passthrough.set(samples)
    return passthrough
  }

  // Convolution tail: allow the IR's length so the cab's decay isn't cut off.
  const offline = new OfflineAudioContext(1, samples.length + irSamples.length, sampleRate)

  const dryBuffer = offline.createBuffer(1, samples.length, sampleRate)
  dryBuffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0)
  const source = offline.createBufferSource()
  source.buffer = dryBuffer

  // The IR must be at the graph's rate; OfflineAudioContext won't resample a ConvolverNode
  // buffer for us the way decodeAudioData would.
  // resampleTo always returns a fresh ArrayBuffer-backed array, and it short-circuits when the
  // rates already match, so it doubles as the copy needed for copyToChannel's typing.
  const irAtGraphRate = await resampleTo(irSamples, irSampleRate, sampleRate)
  const irBuffer = offline.createBuffer(1, irAtGraphRate.length, sampleRate)
  irBuffer.copyToChannel(irAtGraphRate, 0)

  const convolver = offline.createConvolver()
  convolver.normalize = false
  convolver.buffer = irBuffer

  const wetGain = offline.createGain()
  wetGain.gain.value = wet
  const dryGain = offline.createGain()
  dryGain.gain.value = dry

  source.connect(convolver)
  convolver.connect(wetGain)
  wetGain.connect(offline.destination)

  source.connect(dryGain)
  dryGain.connect(offline.destination)

  source.start()
  const rendered = await offline.startRendering()
  const out = new Float32Array(rendered.length)
  rendered.copyFromChannel(out, 0)
  return out
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
  /** Folder of cabinet IR wavs, same subfolder-as-category convention as the DI library. */
  irLibraryPath?: string | null
  /** Cabinet wet/dry mix 0..1. */
  irMix?: number
  /** Amp cover photo (`ampcover.*`), resolved by App the same way the metadata editor does. */
  coverImagePath?: string | null
}

/** Matches the metadata editor's local-file:// scheme for serving images off disk. */
function toFileUrl(p: string): string {
  return p.startsWith('/') ? `local-file://${p}` : `local-file:///${p}`
}

const TONE_LABELS: Record<string, string> = {
  clean: 'Clean',
  crunch: 'Crunch',
  hi_gain: 'Hi Gain',
  fuzz: 'Fuzz',
  overdrive: 'Overdrive',
  distortion: 'Distortion',
  other: 'Other'
}

const GEAR_LABELS: Record<string, string> = {
  amp: 'Amp',
  amp_cab: 'Amp + Cab',
  pedal: 'Pedal',
  pedal_amp: 'Pedal + Amp',
  amp_pedal_cab: 'Amp + Pedal + Cab',
  preamp: 'Preamp',
  studio: 'Studio'
}

function SummaryRow({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline gap-2 min-w-0">
      <span className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 w-[4.5rem] flex-shrink-0">
        {label}
      </span>
      <span
        className={`text-xs truncate ${tone ?? 'text-gray-700 dark:text-gray-200'}`}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}

export function PlayerPanel({
  file,
  onClose,
  diLibraryPath,
  irLibraryPath,
  irMix = 1,
  coverImagePath
}: PlayerPanelProps & { onClose: () => void }) {
  const [status, setStatus] = useState<PlayerStatus>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [categories, setCategories] = useState<DiCategory[]>([])
  const [libraryError, setLibraryError] = useState('')
  const [diPath, setDiPath] = useState<string | null>(null)
  const [renderMs, setRenderMs] = useState<number | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)

  const [summaryColumns, setSummaryColumns] = useState(2)
  const [diPrefs, setDiPrefs] = useState<DiPrefs>(loadDiPrefs)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const [irCategories, setIrCategories] = useState<DiCategory[]>([])
  const [irPath, setIrPath] = useState<string | null>(null)
  // Auto-enabled for captures without a cab; user can force either way.
  const [irEnabled, setIrEnabled] = useState(() => captureNeedsCabIr(file.metadata.gear_type))

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

  // Track the panel's own width so the summary can reflow. Each column needs roughly 210px to
  // fit a label plus a readable value without truncating everything.
  useEffect(() => {
    const element = panelRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      setSummaryColumns(width >= 640 ? 3 : width >= 420 ? 2 : 1)
    })
    observer.observe(element)
    return () => observer.disconnect()
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

        const modelJson = new TextDecoder().decode(base64ToArrayBuffer(modelResult.data))

        // 2. Decode the DI. NAM models are mono, so we take the first channel.
        const ctx = getAudioContext()
        const decoded = await ctx.decodeAudioData(base64ToArrayBuffer(diResult.data))
        const diSampleRate = decoded.sampleRate
        const wholeChannel = new Float32Array(decoded.length)
        decoded.copyFromChannel(wholeChannel, 0, 0)

        // 3. Pick the most energetic window rather than the first N seconds. DI tracks commonly
        // open with silence or a quiet count-in, and rendering that reads as "quiet, and the amp
        // has no gain" rather than "you rendered a silent intro".
        const windowSamples = Math.min(
          wholeChannel.length,
          Math.floor(MAX_PREVIEW_SECONDS * diSampleRate)
        )
        const windowStart = findLoudestWindowStart(wholeChannel, windowSamples)
        const diWindow = wholeChannel.subarray(windowStart, windowStart + windowSamples)

        // 4. Resample to the rate the model was trained at. A model's receptive field and
        // filters are fixed at its training rate, so feeding 44.1k audio to a 48k model shifts
        // its entire frequency response — it sounds wrong, not just slightly off.
        const modelSampleRate = readModelSampleRate(modelJson)
        const input = await resampleTo(diWindow, diSampleRate, modelSampleRate)

        // 5. Render through the model off the UI thread.
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

          const request: NamRenderRequest = { modelJson, input, sampleRate: modelSampleRate }
          worker.postMessage(request, [input.buffer])
        })

        if (!rendered.ok) throw new Error(rendered.error)

        // 6. Cabinet IR, if this capture needs one (or the user forced it on). Must come
        // BEFORE normalization: IRs vary wildly in gain, so normalizing first would leave
        // playback level jumping around as you switch cabs.
        let processed: Float32Array = rendered.output
        let usedIrPath: string | null = null
        if (irEnabled && irPath) {
          const irResult = await window.api.readFileBinary(irPath)
          if (irResult.error || !irResult.data) {
            throw new Error(`Could not read the cabinet IR: ${irResult.error ?? 'no data'}`)
          }
          const irDecoded = await ctx.decodeAudioData(base64ToArrayBuffer(irResult.data))
          const irMono = new Float32Array(irDecoded.length)
          irDecoded.copyFromChannel(irMono, 0, 0)
          processed = await applyCabinetIr(
            processed,
            modelSampleRate,
            irMono,
            irDecoded.sampleRate,
            irMix
          )
          usedIrPath = irPath
        }

        // 7. DC-block, then normalize — same output stage order as the real plugin. Blocking
        // after normalizing would leave the offset scaled into the signal.
        applyDcBlocker(processed, modelSampleRate)
        // Loudness metadata describes the model's own output, so it no longer characterises the
        // signal once a cab has been convolved in. Fall back to peak normalization in that case.
        const normalized = normalizeRendered(processed, usedIrPath ? null : rendered.loudnessDb)

        // Buffer carries the model's rate; Web Audio resamples to the device on playback.
        const audioBuffer = ctx.createBuffer(1, normalized.length, modelSampleRate)
        audioBuffer.copyToChannel(normalized, 0)

        bufferRef.current = audioBuffer
        setRenderMs(rendered.renderMs)
        setStatus('ready')
      } catch (error) {
        setErrorMsg(formatError(error))
        setStatus('error')
      }
    },
    [file.filePath, getAudioContext, stopPlayback, irEnabled, irPath, irMix]
  )

  // Scan the IR library and auto-select a cab, mirroring the DI library flow.
  useEffect(() => {
    let cancelled = false
    if (!irLibraryPath) {
      setIrCategories([])
      return
    }
    void (async () => {
      const result = await window.api.scanWavLibrary(irLibraryPath)
      if (cancelled) return
      setIrCategories(result.categories)
      const allIrs = result.categories.flatMap((c) => c.files)
      if (allIrs.length === 0) return
      const remembered = allIrs.find((f) => f.path === lastIrPath)
      setIrPath(remembered?.path ?? allIrs[0].path)
    })()
    return () => { cancelled = true }
  }, [irLibraryPath])

  // Scan the DI library, then auto-select a clip so the preview renders immediately. Requiring
  // a click first made the panel look broken on open.
  useEffect(() => {
    let cancelled = false
    if (!diLibraryPath) {
      setCategories([])
      setLibraryError('')
      return
    }
    void (async () => {
      const result = await window.api.scanWavLibrary(diLibraryPath)
      if (cancelled) return

      // Ordered cleanest -> heaviest so the pill row reads as a gain progression.
      const ordered = sortDiCategories(result.categories)
      setCategories(ordered)
      setLibraryError(
        result.error ??
          (ordered.length === 0 ? 'No .wav files found in the DI library folder.' : '')
      )
      if (ordered.length === 0) return

      // Restore the last active category if it still exists, else start at the cleanest.
      const prefs = loadDiPrefs()
      const activeCategory =
        (prefs.activeCategory && ordered.some((c) => c.name === prefs.activeCategory)
          ? prefs.activeCategory
          : null) ?? ordered[0].name

      const category = ordered.find((c) => c.name === activeCategory) ?? ordered[0]
      // Per-category remembered clip, falling back to that category's first.
      const rememberedPath = prefs.byCategory[category.name]
      const clip = category.files.find((f) => f.path === rememberedPath) ?? category.files[0]
      if (!clip) return

      setDiPrefs({ ...prefs, activeCategory: category.name })
      setDiPath(clip.path)
    })()
    return () => { cancelled = true }
  }, [diLibraryPath])

  // Render as soon as we have a DI to work with.
  useEffect(() => {
    if (diPath) {
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

  /** The clip a given category should use: remembered choice, else its first. */
  const clipForCategory = useCallback(
    (category: DiCategory): string | null => {
      const remembered = diPrefs.byCategory[category.name]
      const match = category.files.find((f) => f.path === remembered)
      return (match ?? category.files[0])?.path ?? null
    },
    [diPrefs.byCategory]
  )

  /** Click a pill: make that category active and play its remembered clip. */
  const handleSelectCategory = useCallback(
    (category: DiCategory) => {
      const path = clipForCategory(category)
      if (!path) return
      const next: DiPrefs = { ...diPrefs, activeCategory: category.name }
      setDiPrefs(next)
      saveDiPrefs(next)
      setDiPath(path)
    },
    [clipForCategory, diPrefs]
  )

  /** Change which clip a category uses. Re-renders immediately if it's the active one. */
  const handleSelectClip = useCallback(
    (category: DiCategory, path: string) => {
      const next: DiPrefs = {
        ...diPrefs,
        byCategory: { ...diPrefs.byCategory, [category.name]: path },
        activeCategory: category.name
      }
      setDiPrefs(next)
      saveDiPrefs(next)
      setDiPath(path)
    },
    [diPrefs]
  )

  // Top-line metadata, mirroring the fields the metadata editor leads with. Only rows that
  // actually have a value are shown, so a sparsely-tagged capture doesn't render a wall of "—".
  const summaryRows = useMemo(() => {
    const rows: Array<{ label: string; value: string; tone?: string }> = []
    const gear = [m.gear_make, m.gear_model].filter(Boolean).join(' ')
    if (gear) rows.push({ label: 'Gear', value: gear })
    if (m.gear_type) rows.push({ label: 'Type', value: GEAR_LABELS[m.gear_type] ?? m.gear_type })
    if (m.tone_type) rows.push({ label: 'Tone', value: TONE_LABELS[m.tone_type] ?? m.tone_type })

    // Preset (A2 / Standard / Lite / ...) is fingerprinted from the model config, not metadata.
    const preset = detectPreset(file.config)
    if (preset) rows.push({ label: 'Preset', value: preset })

    // ESR: reuse the shared helper so the player agrees with the grid on which ESR to show
    // for A2 captures (full vs aggregate), and colour it with the same thresholds.
    const esr = getCaptureBestEsr({
      ...(m as Record<string, unknown>),
      architecture: file.architecture,
      config: file.config
    })
    if (esr.value != null) {
      const toneInfo = getEsrTone(esr.value, esr.kind)
      const toneClass =
        toneInfo.tone === 'green'
          ? 'text-emerald-600 dark:text-emerald-400'
          : toneInfo.tone === 'amber'
            ? 'text-amber-600 dark:text-amber-400'
            : toneInfo.tone === 'red'
              ? 'text-red-600 dark:text-red-400'
              : undefined
      rows.push({ label: 'ESR', value: esr.value.toFixed(6), tone: toneClass })
    }

    if (m.nl_amp_channel) rows.push({ label: 'Channel', value: String(m.nl_amp_channel) })
    if (m.nl_cabinet) rows.push({ label: 'Cabinet', value: String(m.nl_cabinet) })
    if (m.nl_mics) rows.push({ label: 'Mics', value: String(m.nl_mics) })
    if (m.nl_amp_settings) rows.push({ label: 'Settings', value: String(m.nl_amp_settings) })
    if (m.nl_amp_switches) rows.push({ label: 'Switches', value: String(m.nl_amp_switches) })
    if (m.nl_boost_pedal) rows.push({ label: 'Boost', value: String(m.nl_boost_pedal) })
    if (m.modeled_by) rows.push({ label: 'Modeled by', value: String(m.modeled_by) })
    return rows
  }, [m, file.config, file.architecture])

  const needsCabIr = captureNeedsCabIr(m.gear_type)
  const irClips = useMemo(() => irCategories.flatMap((c) => c.files), [irCategories])

  return (
    <div ref={panelRef} className="flex flex-col h-full bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100 select-none">
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
            {/* Amp cover photo — same image and source the metadata editor shows. */}
            {coverImagePath && (
              <div className="rounded-xl overflow-hidden border border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-900">
                <div className="aspect-[3/1] w-full">
                  <img
                    src={toFileUrl(coverImagePath)}
                    alt="Amp cover"
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
              </div>
            )}

            {/* Top metadata summary. Columns follow the PANEL's measured width, not the
                viewport — the right panel is user-resizable, so viewport breakpoints would be
                wrong at exactly the widths that matter. 1 col when narrow, up to 3 when wide. */}
            {summaryRows.length > 0 && (
              <div
                className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/40 px-3 py-2.5 grid gap-x-5 gap-y-1.5"
                style={{ gridTemplateColumns: `repeat(${summaryColumns}, minmax(0, 1fr))` }}
              >
                {summaryRows.map((row) => (
                  <SummaryRow key={row.label} label={row.label} value={row.value} tone={row.tone} />
                ))}
              </div>
            )}

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

            {/* Cabinet IR */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={irEnabled}
                    onChange={(e) => setIrEnabled(e.target.checked)}
                    disabled={busy || irClips.length === 0}
                    className="w-3.5 h-3.5 rounded accent-teal-500"
                  />
                  <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                    Cabinet IR
                  </span>
                </label>
                {needsCabIr && !irEnabled && (
                  <span className="text-[10px] text-amber-600 dark:text-amber-500">
                    recommended for {GEAR_LABELS[m.gear_type as string] ?? m.gear_type}
                  </span>
                )}
                {!needsCabIr && irEnabled && (
                  <span className="text-[10px] text-amber-600 dark:text-amber-500">
                    capture already has a cab
                  </span>
                )}
              </div>

              {irClips.length === 0 ? (
                <p className="text-[11px] text-gray-400 dark:text-gray-600 leading-relaxed">
                  {needsCabIr
                    ? `This capture has no cabinet (${GEAR_LABELS[m.gear_type as string] ?? m.gear_type}), so it will sound harsh without an IR. Set an IR Library folder in Settings → Library.`
                    : 'Set an IR Library folder in Settings → Library to audition cabinets.'}
                </p>
              ) : (
                irEnabled && (
                  <select
                    value={irPath ?? ''}
                    onChange={(e) => setIrPath(e.target.value || null)}
                    disabled={busy}
                    className="w-full h-7 px-2 rounded-md text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:border-teal-500 disabled:opacity-50"
                  >
                    {irCategories.map((category) => (
                      <optgroup key={category.name} label={category.name}>
                        {category.files.map((ir) => (
                          <option key={ir.path} value={ir.path}>
                            {ir.name.replace(/\.wav$/i, '')}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                )
              )}
            </div>
          </>
        )}

        {/* DI clip picker: one pill per category (cleanest -> heaviest), each with a dropdown
            for which sample that category uses. Clicking a pill plays that category's remembered
            clip, so you can click straight down the row to hear a capture at rising gain. */}
        {hasLibrary && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                Play Through
              </span>
            </div>

            <div className="space-y-1.5">
              {categories.map((category) => {
                const categoryClip = clipForCategory(category)
                const isActive = category.name === diPrefs.activeCategory
                return (
                  <div key={category.name} className="flex items-center gap-2">
                    <button
                      onClick={() => handleSelectCategory(category)}
                      disabled={busy || !categoryClip}
                      title={`Play through ${category.name}`}
                      className={`h-7 px-3 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors disabled:opacity-50 flex-shrink-0 ${
                        isActive
                          ? 'bg-teal-500 text-white'
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                    >
                      {category.name}
                    </button>

                    {/* Only worth a dropdown when there's actually a choice to make. */}
                    {category.files.length > 1 ? (
                      <select
                        value={categoryClip ?? ''}
                        onChange={(e) => handleSelectClip(category, e.target.value)}
                        disabled={busy}
                        className="flex-1 min-w-0 h-7 px-2 rounded-md text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:border-teal-500 disabled:opacity-50"
                      >
                        {category.files.map((clip) => (
                          <option key={clip.path} value={clip.path}>
                            {clip.name.replace(/\.wav$/i, '')}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span
                        className="flex-1 min-w-0 truncate text-xs text-gray-400 dark:text-gray-500"
                        title={category.files[0]?.name}
                      >
                        {category.files[0]?.name.replace(/\.wav$/i, '') ?? '—'}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            {diPath && (
              <p className="text-[11px] text-gray-400">
                Loudest {MAX_PREVIEW_SECONDS}s of{' '}
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
