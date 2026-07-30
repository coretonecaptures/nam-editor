import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ampPlaceholder from '../assets/images/amp_placeholder.png'
import { NamFile } from '../types/nam'
import { detectPreset } from '../utils/detectPreset'
import { getCaptureBestEsr, getEsrTone } from '../utils/esr'
import { LiveEngine, listAudioInputs, type LiveDeviceInfo } from '../utils/liveEngine'
import { readPitch, type PitchReading } from '../utils/tuner'
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
 * In-app tone preview player — REDESIGNED (tape transport + rebuilt DI picker + tuner).
 *
 * Renders a reference DI clip through the capture's model offline (in a Worker), then plays the
 * result back. It deliberately does NOT do real-time processing for the offline preview; Live
 * mode uses the AudioWorklet path in LiveEngine. See docs/player-investigation.md.
 *
 * The audio LOGIC below is the original, extended with: an output AnalyserNode for the playback
 * meter, seek/restart via AudioBufferSourceNode offset playback, and (Live) an input meter +
 * tuner. The render tree is fully new — the running order is picture -> metadata -> transport ->
 * Cab IR -> DI source.
 */

const MAX_PREVIEW_SECONDS = 12

type PlayerStatus = 'idle' | 'loading-di' | 'rendering' | 'ready' | 'error'

let lastIrPath: string | null = null

const DI_PREFS_KEY = 'nam-player-di-prefs'

interface DiPrefs {
  byCategory: Record<string, string>
  activeCategory: string | null
}

function loadDiPrefs(): DiPrefs {
  try {
    const raw = localStorage.getItem(DI_PREFS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DiPrefs>
      return { byCategory: parsed.byCategory ?? {}, activeCategory: parsed.activeCategory ?? null }
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

const LOOP_PREF_KEY = 'nam-player-loop'

function loadLoopPref(): boolean {
  try {
    return localStorage.getItem(LOOP_PREF_KEY) === '1'
  } catch {
    return false
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

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

  const offline = new OfflineAudioContext(1, samples.length + irSamples.length, sampleRate)
  const dryBuffer = offline.createBuffer(1, samples.length, sampleRate)
  dryBuffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0)
  const source = offline.createBufferSource()
  source.buffer = dryBuffer

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
  diLibraryPath?: string | null
  irLibraryPath?: string | null
  irMix?: number
  coverImagePath?: string | null
}

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

/** ── Engraved tape-machine section label. */
function TapeLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="text-gray-400 dark:text-gray-500 uppercase"
      style={{ font: "600 9.5px 'IBM Plex Sans', sans-serif", letterSpacing: '.24em' }}
    >
      {children}
    </span>
  )
}

/** ── One metadata cell (label above value). */
function MetaCell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <div
        className="uppercase text-gray-400 dark:text-gray-500"
        style={{ font: "700 9.5px 'IBM Plex Sans', sans-serif", letterSpacing: '.11em' }}
      >
        {label}
      </div>
      <div className={`text-xs truncate mt-0.5 ${tone ?? 'text-gray-700 dark:text-gray-200'}`} title={value}>
        {value}
      </div>
    </div>
  )
}

/** ── A physical tape-transport cap. */
function TapeCap({
  label,
  wide,
  variant,
  active,
  onClick,
  disabled,
  children,
  title
}: {
  label: string
  wide?: boolean
  variant: 'neutral' | 'play' | 'stop' | 'loop'
  active?: boolean
  onClick?: () => void
  disabled?: boolean
  children: React.ReactNode
  title?: string
}) {
  const faces: Record<string, React.CSSProperties> = {
    neutral: {
      background: 'linear-gradient(180deg,#2b333d,#1a1f27)',
      border: '1px solid #39424e',
      boxShadow: '0 3px 0 #0d1116, inset 0 1px 0 rgba(255,255,255,.08)',
      color: '#c3cad3'
    },
    play: {
      background: 'linear-gradient(180deg,#3ddc9a,#17a86f)',
      border: '1px solid #0f8a5a',
      boxShadow: `0 3px 0 #0a5c3c, inset 0 1px 0 rgba(255,255,255,.4)${active ? ', 0 0 0 3px rgba(45,212,191,.35)' : ''}`,
      color: '#053725'
    },
    stop: {
      background: 'linear-gradient(180deg,#3a424c,#232a32)',
      border: '1px solid #454e59',
      boxShadow: '0 3px 0 #12161a, inset 0 1px 0 rgba(255,255,255,.08)',
      color: '#e26d63'
    },
    loop: active
      ? {
          background: 'linear-gradient(180deg,#f0b84a,#d1922a)',
          border: '1px solid #b47c1f',
          boxShadow: '0 3px 0 #7c520f, inset 0 1px 0 rgba(255,255,255,.45)',
          color: '#4a3208'
        }
      : {
          background: 'linear-gradient(180deg,#2b333d,#1a1f27)',
          border: '1px solid #39424e',
          boxShadow: '0 3px 0 #0d1116, inset 0 1px 0 rgba(255,255,255,.08)',
          color: '#8a929b'
        }
  }
  const labelColor =
    variant === 'play' ? '#7fd7ad' : variant === 'loop' && active ? '#d8a94a' : 'var(--text-3)'
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        onClick={onClick}
        disabled={disabled}
        title={title}
        className="flex items-center justify-center transition-transform active:translate-y-[2px] active:shadow-none disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ width: wide ? 64 : 52, height: 38, borderRadius: 7, cursor: 'pointer', ...faces[variant] }}
      >
        {children}
      </button>
      <span style={{ font: "600 7.5px 'IBM Plex Sans', sans-serif", letterSpacing: '.16em', color: labelColor }}>
        {label}
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
  const [outputMeter, setOutputMeter] = useState(0)
  const [loopEnabled, setLoopEnabled] = useState(loadLoopPref)

  // Metadata columns follow the PANEL's measured width, not the viewport: the right panel is
  // user-resizable, so a viewport media query would be wrong at exactly the widths that matter.
  const [summaryColumns, setSummaryColumns] = useState(2)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const [liveMode, setLiveMode] = useState(false)
  const [liveRunning, setLiveRunning] = useState(false)
  const [liveError, setLiveError] = useState('')
  const [liveStarting, setLiveStarting] = useState(false)
  const [inputDevices, setInputDevices] = useState<LiveDeviceInfo[]>([])
  const [inputDeviceId, setInputDeviceId] = useState<string | null>(null)
  const [liveInputGainDb, setLiveInputGainDb] = useState(0)
  const [liveBypass, setLiveBypass] = useState(false)
  const [liveLatencyMs, setLiveLatencyMs] = useState<number | null>(null)
  const [liveMeter, setLiveMeter] = useState(0)
  const [liveInputMeter, setLiveInputMeter] = useState(0)
  const [liveTuner, setLiveTuner] = useState<PitchReading | null>(null)
  const liveEngineRef = useRef<LiveEngine | null>(null)
  const liveMeterRafRef = useRef<number | null>(null)

  const [diPrefs, setDiPrefs] = useState<DiPrefs>(loadDiPrefs)

  const [irCategories, setIrCategories] = useState<DiCategory[]>([])
  const [irPath, setIrPath] = useState<string | null>(null)
  const [irEnabled, setIrEnabled] = useState(() => captureNeedsCabIr(file.metadata.gear_type))
  const irManuallySetRef = useRef(false)

  const renderGenerationRef = useRef(0)

  const audioCtxRef = useRef<AudioContext | null>(null)
  const bufferRef = useRef<AudioBuffer | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const startedAtRef = useRef(0)
  const rafRef = useRef<number | null>(null)

  const m = file.metadata
  const captureLabel = m.name || file.fileName

  useEffect(() => {
    const element = panelRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0
      // ~210px per column to fit a label plus a readable value without truncating everything.
      setSummaryColumns(width >= 640 ? 3 : width >= 420 ? 2 : 1)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

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
        // Already stopped.
      }
      sourceRef.current = null
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    setIsPlaying(false)
    setProgress(0)
    setOutputMeter(0)
  }, [])

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
      const generation = ++renderGenerationRef.current
      const isStale = () => renderGenerationRef.current !== generation

      stopPlayback()
      bufferRef.current = null
      setErrorMsg('')
      setRenderMs(null)
      setStatus('loading-di')

      try {
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

        const ctx = getAudioContext()
        const decoded = await ctx.decodeAudioData(base64ToArrayBuffer(diResult.data))
        const diSampleRate = decoded.sampleRate
        const wholeChannel = new Float32Array(decoded.length)
        decoded.copyFromChannel(wholeChannel, 0, 0)

        const windowSamples = Math.min(
          wholeChannel.length,
          Math.floor(MAX_PREVIEW_SECONDS * diSampleRate)
        )
        const windowStart = findLoudestWindowStart(wholeChannel, windowSamples)
        const diWindow = wholeChannel.subarray(windowStart, windowStart + windowSamples)

        const modelSampleRate = readModelSampleRate(modelJson)
        const input = await resampleTo(diWindow, diSampleRate, modelSampleRate)

        setStatus('rendering')
        const rendered = await new Promise<NamRenderResponse>((resolve, reject) => {
          workerRef.current?.terminate()
          const worker = new Worker(new URL('../workers/namRender.worker.ts', import.meta.url), {
            type: 'module'
          })
          workerRef.current = worker
          worker.onmessage = (event: MessageEvent<NamRenderResponse>) => resolve(event.data)
          worker.onerror = (event) => reject(new Error(event.message || 'Render worker crashed'))
          const request: NamRenderRequest = { modelJson, input, sampleRate: modelSampleRate }
          worker.postMessage(request, [input.buffer])
        })
        if (!rendered.ok) throw new Error(rendered.error)

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
          processed = await applyCabinetIr(processed, modelSampleRate, irMono, irDecoded.sampleRate, irMix)
          usedIrPath = irPath
        }

        applyDcBlocker(processed, modelSampleRate)
        const normalized = normalizeRendered(processed, usedIrPath ? null : rendered.loudnessDb)

        const audioBuffer = ctx.createBuffer(1, normalized.length, modelSampleRate)
        audioBuffer.copyToChannel(normalized, 0)

        if (isStale()) return

        bufferRef.current = audioBuffer
        setRenderMs(rendered.renderMs)
        setStatus('ready')
      } catch (error) {
        if (isStale()) return
        setErrorMsg(formatError(error))
        setStatus('error')
      }
    },
    [file.filePath, getAudioContext, stopPlayback, irEnabled, irPath, irMix]
  )

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
    return () => {
      cancelled = true
    }
  }, [irLibraryPath])

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
      const ordered = sortDiCategories(result.categories)
      setCategories(ordered)
      setLibraryError(
        result.error ?? (ordered.length === 0 ? 'No .wav files found in the DI library folder.' : '')
      )
      if (ordered.length === 0) return

      const prefs = loadDiPrefs()
      const activeCategory =
        (prefs.activeCategory && ordered.some((c) => c.name === prefs.activeCategory)
          ? prefs.activeCategory
          : null) ?? ordered[0].name
      const category = ordered.find((c) => c.name === activeCategory) ?? ordered[0]
      const rememberedPath = prefs.byCategory[category.name]
      const clip = category.files.find((f) => f.path === rememberedPath) ?? category.files[0]
      if (!clip) return
      setDiPrefs({ ...prefs, activeCategory: category.name })
      setDiPath(clip.path)
    })()
    return () => {
      cancelled = true
    }
  }, [diLibraryPath])

  useEffect(() => {
    if (irManuallySetRef.current) return
    setIrEnabled(captureNeedsCabIr(file.metadata.gear_type))
  }, [file.metadata.gear_type])

  useEffect(() => {
    if (diPath) void renderPreview(diPath)
    else setStatus('idle')
  }, [diPath, renderPreview])

  /**
   * Start (or restart) playback from `offsetSec`, routing through an AnalyserNode so the output
   * meter reflects what reaches the speakers. Replaces the original play-from-zero-only path;
   * offset playback is what makes the scrub bar and Restart work.
   */
  const startPlaybackAt = useCallback(
    (offsetSec: number) => {
      const buffer = bufferRef.current
      if (!buffer) return
      const ctx = getAudioContext()
      void ctx.resume()

      if (sourceRef.current) {
        try {
          sourceRef.current.onended = null
          sourceRef.current.stop()
        } catch {
          // Already stopped.
        }
        sourceRef.current = null
      }

      if (!analyserRef.current) {
        const a = ctx.createAnalyser()
        a.fftSize = 1024
        analyserRef.current = a
      }
      const analyser = analyserRef.current

      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.loop = loopEnabled
      source.connect(analyser)
      analyser.connect(ctx.destination)
      source.onended = () => stopPlayback()

      const clamped = Math.max(0, Math.min(offsetSec, buffer.duration - 0.01))
      source.start(0, clamped)
      sourceRef.current = source
      startedAtRef.current = ctx.currentTime - clamped
      setIsPlaying(true)

      const data = new Float32Array(analyser.fftSize)
      const tick = () => {
        const elapsed = ctx.currentTime - startedAtRef.current
        setProgress(
          source.loop
            ? (elapsed % buffer.duration) / buffer.duration
            : Math.min(1, elapsed / buffer.duration)
        )
        // Peak with a decay, not RMS. A normalized guitar signal has RMS ~0.1-0.25 against a
        // peak near 0.9, so an RMS-driven bar sits at a fifth of its width at full volume and
        // reads as "no output". The decay is what stops peak metering flickering.
        analyser.getFloatTimeDomainData(data)
        let peak = 0
        for (let i = 0; i < data.length; i++) {
          const v = Math.abs(data[i])
          if (v > peak) peak = v
        }
        setOutputMeter((previous) => (peak >= previous ? peak : previous * 0.82 + peak * 0.18))
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    },
    [getAudioContext, stopPlayback, loopEnabled]
  )

  const handlePlayStop = useCallback(() => {
    if (isPlaying) {
      stopPlayback()
      return
    }
    startPlaybackAt(progress * (bufferRef.current?.duration ?? 0))
  }, [isPlaying, stopPlayback, startPlaybackAt, progress])

  const restart = useCallback(() => {
    startPlaybackAt(0)
  }, [startPlaybackAt])

  const seekTo = useCallback(
    (fraction: number) => {
      const buffer = bufferRef.current
      if (!buffer) return
      const clamped = Math.max(0, Math.min(1, fraction))
      if (isPlaying) startPlaybackAt(clamped * buffer.duration)
      else setProgress(clamped)
    },
    [isPlaying, startPlaybackAt]
  )

  useEffect(() => {
    if (sourceRef.current) sourceRef.current.loop = loopEnabled
  }, [loopEnabled])

  const toggleLoop = useCallback(() => {
    setLoopEnabled((prev) => {
      const next = !prev
      try {
        localStorage.setItem(LOOP_PREF_KEY, next ? '1' : '0')
      } catch {
        // Non-fatal.
      }
      return next
    })
  }, [])

  const stopLive = useCallback(async () => {
    if (liveMeterRafRef.current !== null) {
      cancelAnimationFrame(liveMeterRafRef.current)
      liveMeterRafRef.current = null
    }
    await liveEngineRef.current?.stop()
    liveEngineRef.current = null
    setLiveRunning(false)
    setLiveMeter(0)
    setLiveInputMeter(0)
    setLiveTuner(null)
    setLiveLatencyMs(null)
  }, [])

  const startLive = useCallback(async () => {
    setLiveError('')
    setLiveStarting(true)
    try {
      await stopLive()

      const modelResult = await window.api.readFileBinary(file.filePath)
      if (modelResult.error || !modelResult.data) {
        throw new Error(`Could not read the capture: ${modelResult.error ?? 'no data'}`)
      }
      const modelJson = new TextDecoder().decode(base64ToArrayBuffer(modelResult.data))

      let ir: { samples: Float32Array; sampleRate: number } | null = null
      if (irEnabled && irPath) {
        const irResult = await window.api.readFileBinary(irPath)
        if (irResult.error || !irResult.data) {
          throw new Error(`Could not read the cabinet IR: ${irResult.error ?? 'no data'}`)
        }
        const decoded = await getAudioContext().decodeAudioData(base64ToArrayBuffer(irResult.data))
        const mono = new Float32Array(decoded.length)
        decoded.copyFromChannel(mono, 0, 0)
        ir = { samples: mono, sampleRate: decoded.sampleRate }
      }

      const engine = new LiveEngine((message) => setLiveError(message))
      liveEngineRef.current = engine
      await engine.start({
        deviceId: inputDeviceId,
        modelJson,
        ir,
        irMix,
        inputGain: Math.pow(10, liveInputGainDb * 0.05)
      })
      engine.setBypass(liveBypass)

      setLiveRunning(true)
      setLiveLatencyMs(engine.latencyMs)

      // Tuner + input meter read the raw (dry) input tap. Requires the LiveEngine patch documented
      // in the handoff README (input AnalyserNode + readInputPeak/getInputTimeDomain). Guarded so
      // the panel still runs against an un-patched engine (tuner just stays idle).
      const eng = engine as unknown as {
        readInputPeak?: () => number
        getInputTimeDomain?: (out: Float32Array) => void
      }
      const inBuf = new Float32Array(2048)
      const tick = () => {
        setLiveMeter(engine.readOutputPeak())
        if (eng.readInputPeak) setLiveInputMeter(eng.readInputPeak())
        if (eng.getInputTimeDomain) {
          eng.getInputTimeDomain(inBuf)
          setLiveTuner(readPitch(inBuf, engine.sampleRate ?? 48000))
        }
        liveMeterRafRef.current = requestAnimationFrame(tick)
      }
      liveMeterRafRef.current = requestAnimationFrame(tick)
    } catch (error) {
      await stopLive()
      setLiveError(formatError(error))
    } finally {
      setLiveStarting(false)
    }
  }, [file.filePath, inputDeviceId, irEnabled, irPath, irMix, liveInputGainDb, liveBypass, getAudioContext, stopLive])

  useEffect(() => {
    if (!liveMode) return
    let cancelled = false
    void (async () => {
      try {
        const devices = await listAudioInputs()
        if (!cancelled) setInputDevices(devices)
      } catch (error) {
        if (!cancelled) setLiveError(formatError(error))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [liveMode])

  useEffect(() => {
    if (!liveMode) void stopLive()
  }, [liveMode, stopLive])

  useEffect(() => {
    return () => {
      void liveEngineRef.current?.stop()
    }
  }, [])

  useEffect(() => {
    liveEngineRef.current?.setBypass(liveBypass)
  }, [liveBypass])

  useEffect(() => {
    liveEngineRef.current?.setGains(Math.pow(10, liveInputGainDb * 0.05), 1)
  }, [liveInputGainDb])

  useEffect(() => {
    liveEngineRef.current?.setIrMix(irMix)
  }, [irMix])

  useEffect(() => {
    if (liveRunning) void startLive()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.filePath])

  const diLabel = useMemo(() => {
    if (!diPath) return null
    return diPath.replace(/\\/g, '/').split('/').pop() ?? diPath
  }, [diPath])

  const busy = status === 'loading-di' || status === 'rendering'
  const hasLibrary = categories.length > 0

  const clipForCategory = useCallback(
    (category: DiCategory): string | null => {
      const remembered = diPrefs.byCategory[category.name]
      const match = category.files.find((f) => f.path === remembered)
      return (match ?? category.files[0])?.path ?? null
    },
    [diPrefs.byCategory]
  )

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

  const activeCategory = useMemo(
    () => categories.find((c) => c.name === diPrefs.activeCategory) ?? categories[0] ?? null,
    [categories, diPrefs.activeCategory]
  )
  const activeClipPath = activeCategory ? clipForCategory(activeCategory) : null

  const summaryRows = useMemo(() => {
    const rows: Array<{ label: string; value: string; tone?: string }> = []
    const gear = [m.gear_make, m.gear_model].filter(Boolean).join(' ')
    if (gear) rows.push({ label: 'Gear', value: gear })
    if (m.gear_type) rows.push({ label: 'Type', value: GEAR_LABELS[m.gear_type] ?? m.gear_type })
    if (m.tone_type) rows.push({ label: 'Tone', value: TONE_LABELS[m.tone_type] ?? m.tone_type })

    const preset = detectPreset(file.config)
    if (preset) rows.push({ label: 'Preset', value: preset })

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
    if (m.nl_amp_settings) rows.push({ label: 'Settings', value: String(m.nl_amp_settings) })
    if (m.nl_boost_pedal) rows.push({ label: 'Boost', value: String(m.nl_boost_pedal) })
    if (m.modeled_by) rows.push({ label: 'Modeled by', value: String(m.modeled_by) })
    return rows
  }, [m, file.config, file.architecture])

  const needsCabIr = captureNeedsCabIr(m.gear_type)
  const irClips = useMemo(() => irCategories.flatMap((c) => c.files), [irCategories])

  const outputDb = outputMeter > 0 ? `${(20 * Math.log10(outputMeter)).toFixed(1)} dB` : '—'
  // 160% headroom was tuned for an RMS reading; with peak metering the bar is already near full
  // scale at a normalized peak, so it maps close to 1:1 with a little headroom for the top LEDs.
  const outputPct = Math.min(100, outputMeter * 105)
  const inputDb = liveInputMeter > 0 ? `${(20 * Math.log10(liveInputMeter)).toFixed(1)} dB` : '—'

  const coverSrc = coverImagePath ? toFileUrl(coverImagePath) : ampPlaceholder
  const onCoverError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    if (img.src !== ampPlaceholder) img.src = ampPlaceholder
  }

  return (
    <div ref={panelRef} className="flex flex-col h-full bg-white dark:bg-[var(--panel)] text-gray-900 dark:text-gray-100 select-none">
      {/* ── Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-gray-200 dark:border-[var(--border-soft)] flex-shrink-0">
        <div className="flex-1 min-w-0">
          <div
            className={`uppercase mb-0.5 ${liveMode ? 'text-amber-500 dark:text-amber-400' : 'text-[var(--accent)] dark:text-[var(--accent)]'}`}
            style={{ font: "700 10.5px 'IBM Plex Sans', sans-serif", letterSpacing: '.1em' }}
          >
            {liveMode ? 'Live Input' : 'Tone Preview'}
          </div>
          <div className="text-sm font-semibold truncate">{captureLabel}</div>
          {(m.gear_make || m.gear_model) && (
            <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
              {[m.gear_make, m.gear_model].filter(Boolean).join(' ')}
            </div>
          )}
        </div>
        <div className="flex-shrink-0 flex rounded-[9px] bg-gray-100 dark:bg-[var(--field)] border border-gray-200 dark:border-[var(--border)] p-0.5">
          {([false, true] as const).map((mode) => (
            <button
              key={String(mode)}
              onClick={() => setLiveMode(mode)}
              className={`h-6 px-2.5 rounded-md text-[11px] font-medium transition-colors ${
                liveMode === mode
                  ? 'bg-white dark:bg-[#232c36] text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {mode ? 'Live' : 'Preview'}
            </button>
          ))}
        </div>
        <button
          onClick={onClose}
          className="flex-shrink-0 w-[26px] h-[26px] flex items-center justify-center rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-[var(--hover)] transition-colors"
          title="Close player"
        >
          <svg viewBox="0 0 24 24" className="w-[15px] h-[15px]" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* ── Body */}
      <div className="flex-1 overflow-y-auto">
        {liveMode ? (
          /* ══════════ LIVE MODE — recording lightbox + tuner + meters ══════════ */
          <>
            {/* Illuminated RECORDING sign doubles as the arm control. */}
            <div
              className="px-4 py-[18px] flex justify-center border-b border-gray-200 dark:border-[var(--border-soft)]"
              style={{ background: 'radial-gradient(120% 90% at 50% 40%, #1a130c, #0b0e12)' }}
            >
              <button
                onClick={() => (liveRunning ? void stopLive() : void startLive())}
                disabled={liveStarting}
                title={liveRunning ? 'Stop live input' : 'Start live input'}
                className="w-full rounded-[9px] p-[9px] disabled:opacity-70 transition-transform active:scale-[.99]"
                style={{ background: 'linear-gradient(180deg,#4a3320,#2c1d10)', boxShadow: '0 10px 26px rgba(0,0,0,.6)', cursor: 'pointer', border: 'none' }}
              >
                <div
                  className="rounded-[5px] py-5 px-3.5 text-center"
                  style={{
                    background: liveRunning
                      ? 'linear-gradient(180deg,#fbefc7,#f2db9a)'
                      : 'linear-gradient(180deg,#4a4436,#3a3428)',
                    boxShadow: liveRunning
                      ? '0 0 44px 8px rgba(255,72,48,.45), inset 0 0 34px rgba(255,185,125,.45)'
                      : 'inset 0 0 20px rgba(0,0,0,.4)',
                    transition: 'background .25s, box-shadow .25s'
                  }}
                >
                  <div
                    style={{
                      font: "700 34px/0.92 'Barlow Semi Condensed', sans-serif",
                      letterSpacing: '-.01em',
                      textTransform: 'uppercase',
                      color: liveRunning ? '#d8352a' : '#6b5a3e'
                    }}
                  >
                    Recording
                  </div>
                  <div className="mx-auto my-1.5" style={{ height: 2, width: '60%', background: liveRunning ? '#d8352a' : '#6b5a3e' }} />
                  <div style={{ font: "700 13px 'Barlow Semi Condensed', sans-serif", letterSpacing: '.12em', textTransform: 'uppercase', color: liveRunning ? '#4a3a1e' : '#5a4f3a' }}>
                    {liveStarting ? 'Starting…' : 'Studio in Use'}
                  </div>
                </div>
              </button>
            </div>
            <div className="px-4 py-[11px] text-center border-b border-gray-200 dark:border-[var(--border-soft)]">
              <span className="text-[11.5px] text-gray-500 dark:text-gray-400">
                {liveRunning ? 'Monitoring live — tap the sign to stop' : 'Tap the sign to play guitar through this capture'}
              </span>
            </div>

            {liveError && (
              <div className="mx-4 my-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3">
                <p className="text-xs font-medium text-red-700 dark:text-red-400 mb-0.5">Live input failed</p>
                <p className="text-[11px] text-red-600 dark:text-red-500 font-mono break-all">{liveError}</p>
              </div>
            )}

            {/* Tuner */}
            <div className="px-4 py-3.5 border-b border-gray-200 dark:border-[var(--border-soft)]">
              <div className="flex items-center justify-between mb-2.5">
                <TapeLabel>Tuner</TapeLabel>
                <span className={`font-mono text-[10px] ${liveTuner?.inTune ? 'text-emerald-500 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-500'}`}>
                  {liveTuner?.note ? (liveTuner.inTune ? 'in tune' : liveTuner.cents > 0 ? 'sharp' : 'flat') : '—'}
                </span>
              </div>
              <div className="flex items-center gap-3.5">
                <div className="font-semibold leading-none text-gray-900 dark:text-gray-100" style={{ fontSize: 34, minWidth: 48 }}>
                  {liveTuner?.note ?? '—'}
                  {liveTuner?.octave != null && <span className="text-gray-500 dark:text-gray-400 align-super" style={{ fontSize: 14 }}>{liveTuner.octave}</span>}
                </div>
                <div className="flex-1">
                  <div className="relative h-[26px]">
                    <div className="absolute left-0 right-0 top-1/2 h-0.5 bg-gray-200 dark:bg-[var(--border)]" />
                    <div className="absolute left-1/2 top-0.5 bottom-0.5 w-0.5 -ml-px bg-emerald-400" />
                    <div
                      className="absolute top-1/2 w-3.5 h-3.5 -mt-[7px] -ml-[7px] rounded-full"
                      style={{
                        left: `${50 + Math.max(-50, Math.min(50, liveTuner?.cents ?? 0))}%`,
                        background: liveTuner?.inTune ? '#34d399' : '#f0b84a',
                        boxShadow: `0 0 10px ${liveTuner?.inTune ? 'rgba(52,211,153,.6)' : 'rgba(240,184,74,.5)'}`,
                        transition: 'left .09s linear'
                      }}
                    />
                  </div>
                  <div className="font-mono text-center text-[9.5px] text-gray-400 dark:text-gray-500 mt-0.5">
                    {liveTuner?.note ? `${liveTuner.cents > 0 ? '+' : ''}${liveTuner.cents} cents` : 'play a note'}
                  </div>
                </div>
              </div>
            </div>

            {/* Meters + bypass */}
            <div className="px-4 py-3.5 flex flex-col gap-3 border-b border-gray-200 dark:border-[var(--border-soft)]">
              <Meter label="Input (dry)" hint="set gain before arming" value={liveInputMeter} db={inputDb} />
              <Meter label="Output" value={liveMeter} db={liveMeter > 0 ? `${(20 * Math.log10(liveMeter)).toFixed(1)} dB` : '—'} />
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={liveBypass} onChange={(e) => setLiveBypass(e.target.checked)} className="w-3.5 h-3.5 rounded accent-[var(--accent)]" />
                <span className="text-xs text-gray-600 dark:text-gray-300">Bypass model (hear the dry input)</span>
              </label>
            </div>

            {/* Device + gain — moved to the bottom */}
            <div className="px-4 py-3.5 flex flex-col gap-3.5">
              <div>
                <TapeLabel>Input Device</TapeLabel>
                <select
                  value={inputDeviceId ?? ''}
                  onChange={(e) => setInputDeviceId(e.target.value || null)}
                  className="mt-1.5 w-full h-[34px] px-3 rounded-[9px] text-xs bg-gray-50 dark:bg-[var(--field)] border border-gray-200 dark:border-[var(--field-border)] text-gray-700 dark:text-gray-200 focus:outline-none focus:border-[var(--accent)]"
                >
                  <option value="">System default</option>
                  {inputDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <TapeLabel>Input Gain</TapeLabel>
                  <span className="font-mono text-[10px] text-gray-400 dark:text-gray-500">{liveInputGainDb > 0 ? '+' : ''}{liveInputGainDb.toFixed(1)} dB</span>
                </div>
                <input type="range" min={-24} max={24} step={0.5} value={liveInputGainDb} onChange={(e) => setLiveInputGainDb(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
                <p className="text-[10.5px] text-gray-400 dark:text-gray-600 mt-1.5 leading-relaxed">
                  How hard the model is driven — the gain that matters on a high-gain capture, not the output level.
                </p>
              </div>
              {liveLatencyMs !== null && (
                <p className="text-[10.5px] text-gray-400 dark:text-gray-600 leading-relaxed">
                  Round-trip latency ≈ {liveLatencyMs.toFixed(0)}ms
                  {liveEngineRef.current?.sampleRate ? ` · ${liveEngineRef.current.sampleRate} Hz` : ''}. Use headphones to avoid feedback.
                </p>
              )}
            </div>
          </>
        ) : (
          /* ══════════ PREVIEW MODE — picture → metadata → transport → Cab IR → DI ══════════ */
          <>
            {/* Picture */}
            {/* Constrain WIDTH, not height. `aspectRatio: 3/1` plus `maxHeight` fight each other
                on a wide panel: at 700px the box wants 233px tall, gets clamped to 170, and the
                ratio silently becomes ~4:1 — so object-cover crops far more of the amp the wider
                you drag the panel. Capping width at 3 x the max height keeps the crop identical at
                every panel size, and the letterbox fills with the surrounding surface. */}
            <div className="bg-gray-100 dark:bg-[var(--field)] flex justify-center">
              <div className="w-full" style={{ aspectRatio: '3 / 1', maxWidth: 170 * 3 }}>
                <img
                  src={coverSrc}
                  alt={coverImagePath ? 'Amp cover' : 'No amp cover'}
                  className="w-full h-full object-cover block"
                  loading="lazy"
                  onError={onCoverError}
                />
              </div>
            </div>

            {/* Metadata */}
            {summaryRows.length > 0 && (
              <div
              className="grid gap-x-5 gap-y-2.5 px-4 py-3.5 border-b border-gray-200 dark:border-[var(--border-soft)]"
              style={{ gridTemplateColumns: `repeat(${summaryColumns}, minmax(0, 1fr))` }}
            >
                {summaryRows.map((row) => (
                  <MetaCell key={row.label} label={row.label} value={row.value} tone={row.tone} />
                ))}
              </div>
            )}

            {/* No library / error states */}
            {!hasLibrary && (
              <div className="m-4 rounded-lg bg-gray-50 dark:bg-[var(--field)] border border-gray-200 dark:border-[var(--border)] p-4">
                <p className="text-sm text-gray-600 dark:text-gray-300 mb-1">No DI clips available</p>
                <p className="text-xs text-gray-500">{libraryError || 'Set a DI Clip Library folder in Settings → Library to preview captures.'}</p>
              </div>
            )}

            {/* ── TRANSPORT (tape faceplate) */}
            <div className="px-4 pt-3.5 pb-4 border-b border-gray-200 dark:border-[var(--border-soft)]">
              <div className="flex items-center justify-between mb-3">
                <TapeLabel>Transport</TapeLabel>
                <span className="font-mono text-[10px] text-gray-400 dark:text-gray-500">
                  {formatTime((bufferRef.current?.duration ?? 0) * progress)} / {formatTime(bufferRef.current?.duration ?? MAX_PREVIEW_SECONDS)}
                </span>
              </div>
              <div
                className="rounded-xl p-3.5"
                style={{ background: 'linear-gradient(180deg, var(--raised), var(--panel-2))', border: '1px solid var(--field-border)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,.05), inset 0 -6px 14px rgba(0,0,0,.35)' }}
              >
                {/* counter + scrub */}
                <div className="flex items-center gap-3 mb-3.5">
                  <div className="font-mono" style={{ background: 'var(--field)', color: 'var(--accent)', border: '1px solid var(--field-border)', borderRadius: 5, padding: '4px 8px', fontSize: 12, letterSpacing: '.05em', boxShadow: 'inset 0 0 8px color-mix(in srgb, var(--accent) 30%, transparent)' }}>
                    {formatTime((bufferRef.current?.duration ?? 0) * progress)}
                  </div>
                  <div
                    className="flex-1 relative cursor-pointer"
                    style={{ height: 8, borderRadius: 5, background: 'var(--field)', boxShadow: 'inset 0 1px 3px rgba(0,0,0,.7)' }}
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect()
                      seekTo((e.clientX - r.left) / r.width)
                    }}
                  >
                    <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: `${progress * 100}%`, background: 'linear-gradient(90deg,var(--accent),var(--accent))', borderRadius: 5 }} />
                    <div style={{ position: 'absolute', left: `${progress * 100}%`, top: '50%', width: 16, height: 22, margin: '-11px 0 0 -8px', borderRadius: 4, background: 'linear-gradient(180deg,#e9edf2,#aab2bd)', boxShadow: '0 2px 5px rgba(0,0,0,.6), inset 0 1px 0 #fff', border: '1px solid #7d8590' }} />
                  </div>
                </div>

                {/* caps */}
                <div className="flex gap-2.5 justify-center">
                  <TapeCap label="RESTART" variant="neutral" onClick={restart} disabled={status !== 'ready'} title="Restart from the top">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round"><path d="M11 19l-7-7 7-7" /><path d="M20 19l-7-7 7-7" /></svg>
                  </TapeCap>
                  <TapeCap label="PLAY" wide variant="play" active={isPlaying} onClick={handlePlayStop} disabled={status !== 'ready'} title={isPlaying ? 'Pause' : 'Play'}>
                    {busy ? (
                      <svg className="w-[18px] h-[18px] animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" /></svg>
                    ) : isPlaying ? (
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
                    ) : (
                      <svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor"><path d="M8 5.14v14l11-7-11-7z" /></svg>
                    )}
                  </TapeCap>
                  <TapeCap label="STOP" variant="stop" onClick={stopPlayback} disabled={!isPlaying} title="Stop">
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>
                  </TapeCap>
                  <TapeCap label="LOOP" variant="loop" active={loopEnabled} onClick={toggleLoop} title={loopEnabled ? 'Looping — click for once' : 'Play once — click to loop'}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round"><path d="M17 2l4 4-4 4" /><path d="M3 11V9a4 4 0 014-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v2a4 4 0 01-4 4H3" /></svg>
                  </TapeCap>
                </div>

                {/* output meter */}
                <div className="mt-3.5">
                  <div className="flex items-center justify-between mb-1">
                    <span style={{ font: "600 7.5px 'IBM Plex Sans', sans-serif", letterSpacing: '.16em', color: 'var(--text-3)' }}>OUTPUT</span>
                    <span className="font-mono text-[9.5px] text-gray-400 dark:text-gray-500">{outputDb}</span>
                  </div>
                  <div style={{ height: 9, borderRadius: 5, background: 'var(--field)', boxShadow: 'inset 0 1px 3px rgba(0,0,0,.7)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${outputPct}%`, background: 'linear-gradient(90deg,#17a86f 0%,#3ddc9a 55%,#f0b84a 80%,#e2483a 100%)', transition: 'width .06s linear' }} />
                  </div>
                </div>
              </div>

              {status === 'error' && (
                <div className="mt-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3">
                  <p className="text-xs font-medium text-red-700 dark:text-red-400 mb-1">Preview failed</p>
                  <p className="text-[11px] text-red-600 dark:text-red-500 font-mono break-all">{errorMsg}</p>
                  <button onClick={() => diPath && void renderPreview(diPath)} className="mt-2 h-7 px-3 rounded-md text-xs font-medium border border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40">Retry</button>
                </div>
              )}
            </div>

            {/* ── CAB IR */}
            <div className="px-4 py-3.5 border-b border-gray-200 dark:border-[var(--border-soft)]">
              <div className="flex items-center justify-between mb-2.5">
                <TapeLabel>Cab IR</TapeLabel>
                <div className="flex items-center gap-2">
                  {needsCabIr && !irEnabled && <span className="text-[10px] text-amber-500">recommended</span>}
                  {!needsCabIr && irEnabled && <span className="text-[10px] text-amber-500">already has a cab</span>}
                  <span className={`text-[10px] font-semibold ${irEnabled ? 'text-[var(--accent)]' : 'text-gray-500'}`}>{irEnabled ? 'ON' : 'OFF'}</span>
                  <button
                    role="switch"
                    aria-checked={irEnabled}
                    onClick={() => { irManuallySetRef.current = true; setIrEnabled((v) => !v) }}
                    disabled={busy || irClips.length === 0}
                    className="relative disabled:opacity-40"
                    style={{ width: 34, height: 19, borderRadius: 10, background: irEnabled ? 'rgba(45,212,191,.3)' : 'var(--field)', border: `1px solid ${irEnabled ? 'rgba(45,212,191,.5)' : 'var(--field-border)'}`, cursor: 'pointer' }}
                  >
                    <span style={{ position: 'absolute', top: 1.5, left: irEnabled ? 16.5 : 1.5, width: 14, height: 14, borderRadius: '50%', background: irEnabled ? 'var(--accent)' : 'var(--text-3)', transition: 'left .15s' }} />
                  </button>
                </div>
              </div>
              {irClips.length === 0 ? (
                <p className="text-[11px] text-gray-400 dark:text-gray-600 leading-relaxed">
                  {needsCabIr
                    ? `This capture has no cabinet (${GEAR_LABELS[m.gear_type as string] ?? m.gear_type}), so it will sound harsh without an IR. Set an IR Library folder in Settings → Library.`
                    : 'Set an IR Library folder in Settings → Library to audition cabinets.'}
                </p>
              ) : (
                irEnabled && (
                  <div className="flex items-center gap-2.5 h-9 px-3 rounded-[9px] bg-gray-50 dark:bg-[var(--field)] border border-gray-200 dark:border-[var(--field-border)]">
                    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--text-3)" strokeWidth={1.8}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="12" r="3.2" /><circle cx="16.5" cy="12" r="1.6" /></svg>
                    <select
                      value={irPath ?? ''}
                      onChange={(e) => { setIrPath(e.target.value || null); lastIrPath = e.target.value || null }}
                      disabled={busy}
                      className="flex-1 min-w-0 bg-transparent text-xs text-gray-800 dark:text-gray-100 focus:outline-none"
                    >
                      {irCategories.map((category) => (
                        <optgroup key={category.name} label={category.name}>
                          {category.files.map((ir) => (
                            <option key={ir.path} value={ir.path}>{ir.name.replace(/\.wav$/i, '')}</option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                )
              )}
            </div>

            {/* ── DI SOURCE */}
            {hasLibrary && (
              <div className="px-4 py-3.5">
                <div className="flex items-center justify-between mb-2.5">
                  <TapeLabel>DI Source</TapeLabel>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">
                    {categories.length} folder{categories.length === 1 ? '' : 's'}{categories.length > 4 ? ' · scroll ↔' : ''}
                  </span>
                </div>

                {/* Category pills — horizontal scroll, unbounded folder count */}
                <div className="relative mb-3">
                  <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'thin' }}>
                    {categories.map((category) => {
                      const active = category.name === diPrefs.activeCategory
                      return (
                        <button
                          key={category.name}
                          onClick={() => handleSelectCategory(category)}
                          disabled={busy || !clipForCategory(category)}
                          className={`flex-none h-7 px-3.5 rounded-full text-[11.5px] whitespace-nowrap transition-colors disabled:opacity-50 ${
                            active ? 'font-semibold text-[#06201d] bg-[var(--accent)]' : 'text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-[var(--field)] border border-gray-200 dark:border-[var(--border)] hover:bg-gray-200 dark:hover:bg-[var(--hover)]'
                          }`}
                        >
                          {category.name}
                        </button>
                      )
                    })}
                  </div>
                  {categories.length > 4 && (
                    <div className="absolute right-0 top-0 bottom-1.5 w-9 flex items-center justify-end pointer-events-none" style={{ background: 'linear-gradient(90deg,transparent,var(--panel))' }}>
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--text-2)" strokeWidth={2}><path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </div>
                  )}
                </div>

                {/* Clip list for the active category */}
                {activeCategory && (
                  <div className="rounded-[10px] overflow-hidden border border-gray-200 dark:border-[var(--border)] bg-gray-50 dark:bg-[var(--field)] max-h-[190px] overflow-y-auto">
                    {activeCategory.files.map((clip, i) => {
                      const selected = clip.path === activeClipPath
                      return (
                        <button
                          key={clip.path}
                          onClick={() => handleSelectClip(activeCategory, clip.path)}
                          disabled={busy}
                          className={`w-full flex items-center gap-2.5 h-[38px] px-3 text-left transition-colors disabled:opacity-50 ${i > 0 ? 'border-t border-gray-200 dark:border-[#1a2027]' : ''} ${
                            selected ? 'bg-[var(--active)]' : 'hover:bg-gray-100 dark:hover:bg-[#151b22]'
                          }`}
                          style={selected ? { boxShadow: 'inset 3px 0 0 var(--accent)' } : undefined}
                        >
                          <svg viewBox="0 0 24 24" width="14" height="14" fill={selected ? 'var(--accent)' : 'currentColor'} className={selected ? '' : 'text-gray-400 dark:text-gray-500'}><path d="M8 5.14v14l11-7-11-7z" /></svg>
                          <span className={`flex-1 text-[12.5px] truncate ${selected ? 'text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-300'}`}>{clip.name.replace(/\.wav$/i, '')}</span>
                          {selected && isPlaying && <span className="text-[9px] font-mono text-[var(--accent)]">▶ playing</span>}
                          {selected && (
                            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--accent)" strokeWidth={2.2}><path d="M5 12l5 5 9-11" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}

                {diPath && (
                  <p className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-2.5">
                    Loudest {MAX_PREVIEW_SECONDS}s of <span className="font-mono text-gray-500 dark:text-gray-400">{diLabel}</span> rendered through this capture
                    {renderMs !== null ? ` · took ${(renderMs / 1000).toFixed(1)}s` : ''}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** ── Slim horizontal level meter (Live mode). */
function Meter({ label, hint, value, db }: { label: string; hint?: string; value: number; db: string }) {
  const pct = Math.min(100, value * 160)
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <TapeLabel>{label}</TapeLabel>
        <span className="font-mono text-[10px] text-gray-400 dark:text-gray-500">{hint ? `${hint} · ${db}` : db}</span>
      </div>
      <div style={{ height: 7, borderRadius: 4, background: 'var(--field)', border: '1px solid var(--border)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'linear-gradient(90deg,var(--accent) 0%,var(--accent) 62%,#fbbf24 82%,#f87171 100%)', transition: 'width .06s linear' }} />
      </div>
    </div>
  )
}

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
