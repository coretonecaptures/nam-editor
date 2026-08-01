import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ampPlaceholder from '../assets/images/amp_placeholder.png'
import restartUnlit from '../assets/transport/restart-unlit.png'
import restartLit from '../assets/transport/restart-lit.png'
import playUnlit from '../assets/transport/play-unlit.png'
import playLit from '../assets/transport/play-lit.png'
import stopUnlit from '../assets/transport/stop-unlit.png'
import stopLit from '../assets/transport/stop-lit.png'
import loopUnlit from '../assets/transport/loop-unlit.png'
import loopLit from '../assets/transport/loop-lit.png'
import restartBarUnlit from '../assets/transport/restart-bar-unlit.png'
import restartBarLit from '../assets/transport/restart-bar-lit.png'
import playBarUnlit from '../assets/transport/play-bar-unlit.png'
import playBarLit from '../assets/transport/play-bar-lit.png'
import stopBarUnlit from '../assets/transport/stop-bar-unlit.png'
import stopBarLit from '../assets/transport/stop-bar-lit.png'
import loopBarUnlit from '../assets/transport/loop-bar-unlit.png'
import loopBarLit from '../assets/transport/loop-bar-lit.png'
import transportPanelBg from '../assets/transport/panel-bg.jpg'
import { NamFile } from '../types/nam'
import { detectPreset } from '../utils/detectPreset'
import { getCaptureBestEsr, getEsrTone } from '../utils/esr'
import {
  DEFAULT_CHORUS,
  DEFAULT_DELAY,
  DEFAULT_EQ,
  DEFAULT_REVERB,
  EQ_BASS_HZ,
  EQ_MAX_DB,
  EQ_MID_HZ,
  EQ_TREBLE_HZ,
  LiveEngine,
  MAX_FEEDBACK,
  MAX_MOD_DEPTH_MS,
  REVERB_EQ_MAX_DB,
  REVERB_HIGH_SHELF_HZ,
  REVERB_LOW_SHELF_HZ,
  listAudioInputs,
  listAudioOutputs,
  type ChorusSettings,
  type DelaySettings,
  type EqSettings,
  type LiveDeviceInfo,
  type ReverbSettings
} from '../utils/liveEngine'
import { PitchTracker, type PitchReading } from '../utils/tuner'
import {
  applyDcBlocker,
  base64ToArrayBuffer,
  captureNeedsCabIr,
  findLoudestWindowStart,
  sortDiCategories,
  computeLiveNormalizeGain,
  loudnessAfterIr,
  normalizeRendered,
  readModelSampleRate,
  resumeOffsetSec
} from '../utils/playerAudio'
import { resolveRememberedIr, saveIrPath } from '../utils/diSelection'
import { IrPicker } from './IrPicker'
import { loadIrFavorites } from '../utils/irLibrary'
import type { ImpulseResponse } from '../utils/impulseTrim'
import { fxGridTemplate, fxLayoutFor } from '../utils/fxLayout'
import { applyCabinetIr, resampleTo } from '../utils/audioGraph'
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

export type PlayerMode = 'preview' | 'live'

// Both modes are about the ONE selected capture. Auditioning many captures lives in the Tone Map
// instead - putting it here implied a relationship to the current capture that never existed.
const PLAYER_MODES: { id: PlayerMode; label: string; hint: string }[] = [
  { id: 'preview', label: 'Preview', hint: 'Render this capture and play it back' },
  { id: 'live', label: 'Live', hint: 'Play through this capture in real time' }
]

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

/** How often to run pitch detection. See the tick loop for why this is not every frame. */
const TUNER_INTERVAL_MS = 50

const LOOP_PREF_KEY = 'nam-player-loop'
const VOLUME_PREF_KEY = 'nam-player-volume-db'
const INPUT_CHANNEL_PREF_KEY = 'nam-player-input-channel'
const OUTPUT_DEVICE_PREF_KEY = 'nam-player-output-device'
const DELAY_PREF_KEY = 'nam-player-delay'
const REVERB_PREF_KEY = 'nam-player-reverb'
const REVERB_SETTINGS_PREF_KEY = 'nam-player-reverb-settings'
const CHORUS_PREF_KEY = 'nam-player-chorus'
const EQ_PREF_KEY = 'nam-player-eq'
const DEVICES_OPEN_PREF_KEY = 'nam-player-devices-open'

/** Devices start expanded; once a rig is set up, collapsing it sticks. */
function loadDevicesOpen(): boolean {
  try {
    return localStorage.getItem(DEVICES_OPEN_PREF_KEY) !== '0'
  } catch {
    return true
  }
}

/**
 * Every FX control is persisted, so a rig survives closing the player.
 *
 * Stored as one blob rather than a key each: they are set together, read together, and a partial
 * restore (delay back but its mix lost) would be worse than none. Defaults are spread underneath
 * so a settings file written before a control existed still loads.
 */
function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return { ...fallback, ...(JSON.parse(raw) as Partial<T>) }
  } catch {
    // Non-fatal.
  }
  return { ...fallback }
}

function savePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Non-fatal.
  }
}

function loadStoredNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw === null ? NaN : Number(raw)
    return Number.isFinite(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

/** Bottom of the volume range; below this the fader snaps to silence. */
const VOLUME_MIN_DB = -40

/**
 * Player volume, in dB, shared by preview playback and live monitoring.
 *
 * Normalization decides how loud a capture is RELATIVE to other captures; it cannot know how loud
 * your headphones are. Without a trim the only volume control was the system one, which also
 * moves everything else.
 */
function loadVolumeDb(): number {
  try {
    const raw = localStorage.getItem(VOLUME_PREF_KEY)
    if (raw !== null) {
      const parsed = Number(raw)
      if (Number.isFinite(parsed)) return Math.max(VOLUME_MIN_DB, Math.min(0, parsed))
    }
  } catch {
    // Non-fatal.
  }
  return 0
}

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

interface DiCategory {
  name: string
  files: Array<{ name: string; path: string }>
}

interface PlayerPanelProps {
  file: NamFile
  diLibraryPath?: string | null
  irLibraryPath?: string | null
  reverbLibraryPath?: string | null
  irMix?: number
  coverImagePath?: string | null
  /** Move to the previous (-1) or next (+1) capture in the folder currently in scope. */
  onStep?: (delta: number) => void
  /** Position of this capture in that scope, and its size, for the "3 / 42" readout. */
  stepIndex?: number
  stepCount?: number
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
// variant -> [unlit image, lit image], cut from the photographed panel reference
// (src/assets/transport/*.png). RESTART has no on/off state today; it always renders unlit.
const TAPE_CAP_FACES: Record<'neutral' | 'play' | 'stop' | 'loop', [string, string]> = {
  neutral: [restartUnlit, restartLit],
  play: [playUnlit, playLit],
  stop: [stopUnlit, stopLit],
  loop: [loopUnlit, loopLit]
}
const TAPE_CAP_BARS: Record<'neutral' | 'play' | 'stop' | 'loop', [string, string]> = {
  neutral: [restartBarUnlit, restartBarLit],
  play: [playBarUnlit, playBarLit],
  stop: [stopBarUnlit, stopBarLit],
  loop: [loopBarUnlit, loopBarLit]
}
const TAPE_CAP_SIZE = 78
const TAPE_CAP_GAP = 8

/**
 * Narrowest the player panel may be dragged.
 *
 * Derived from the transport rather than picked by eye, so resizing the caps cannot silently
 * reintroduce the overflow: four caps plus their gaps, the faceplate's own padding (p-3.5), the
 * section padding (px-4), and a margin so they sit comfortably inside the metal rather than
 * touching its edges.
 */
export const PLAYER_MIN_WIDTH =
  TAPE_CAP_SIZE * 4 + TAPE_CAP_GAP * 3 + 14 * 2 + 16 * 2 + 24
const TAPE_CAP_FLASH_MS = 180

function TapeCap({
  label,
  variant,
  active,
  momentary,
  onClick,
  disabled,
  title
}: {
  label: string
  variant: 'neutral' | 'play' | 'stop' | 'loop'
  /** Persistent on/off state (PLAY while playing, LOOP while looping). Ignored when `momentary`. */
  active?: boolean
  /** RESTART/STOP: no persistent state — light briefly on click instead of tracking `active`. */
  momentary?: boolean
  onClick?: () => void
  disabled?: boolean
  title?: string
}) {
  const [flash, setFlash] = useState(false)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current)
  }, [])

  const lit = momentary ? flash : Boolean(active)
  const [faceUnlit, faceLit] = TAPE_CAP_FACES[variant]
  const [barUnlit, barLit] = TAPE_CAP_BARS[variant]

  const handleClick = (): void => {
    onClick?.()
    if (!momentary) return
    setFlash(true)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(false), TAPE_CAP_FLASH_MS)
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <span
        style={{
          font: "600 8.5px 'IBM Plex Sans', sans-serif",
          letterSpacing: '.16em',
          color: '#e5e5e2',
          background: '#161615',
          borderRadius: 4,
          padding: '3px 8px'
        }}
      >
        {label}
      </span>
      <button
        onClick={handleClick}
        disabled={disabled}
        title={title}
        // Only a gentle dim when disabled: the unlit artwork already reads as "off", so the old
        // 40% wash made an idle-but-usable button look broken.
        className="transition-[transform] active:translate-y-[1px] disabled:opacity-70 disabled:cursor-not-allowed"
        style={{
          width: TAPE_CAP_SIZE,
          height: TAPE_CAP_SIZE,
          border: 'none',
          background: `url(${lit ? faceLit : faceUnlit}) center / contain no-repeat`,
          cursor: 'pointer'
        }}
      />
      <div
        style={{
          width: TAPE_CAP_SIZE * 0.62,
          height: TAPE_CAP_SIZE * 0.16,
          background: `url(${lit ? barLit : barUnlit}) center / contain no-repeat`
        }}
      />
    </div>
  )
}

export function PlayerPanel({
  file,
  onClose,
  diLibraryPath,
  irLibraryPath,
  reverbLibraryPath,
  irMix = 1,
  onStep,
  stepIndex = -1,
  stepCount = 0,
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

  const [mode, setMode] = useState<PlayerMode>('preview')
  // Derived, so every existing Live branch keeps working unchanged now that there are three modes.
  const liveMode = mode === 'live'
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
  const tunerTrackerRef = useRef<PitchTracker | null>(null)
  const volumeRef = useRef<GainNode | null>(null)
  const [volumeDb, setVolumeDb] = useState<number>(() => loadVolumeDb())
  const [outputDevices, setOutputDevices] = useState<LiveDeviceInfo[]>([])
  const [outputDeviceId, setOutputDeviceId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(OUTPUT_DEVICE_PREF_KEY)
    } catch {
      return null
    }
  })
  const [inputChannel, setInputChannel] = useState<number>(() => loadStoredNumber(INPUT_CHANNEL_PREF_KEY, 0))
  const [channelPeaks, setChannelPeaks] = useState<number[]>([])
  const [delay, setDelayState] = useState<DelaySettings>(() => loadPref(DELAY_PREF_KEY, DEFAULT_DELAY))
  const [reverb, setReverbState] = useState<ReverbSettings>(() => loadPref(REVERB_SETTINGS_PREF_KEY, DEFAULT_REVERB))
  const [chorus, setChorusState] = useState<ChorusSettings>(() => loadPref(CHORUS_PREF_KEY, DEFAULT_CHORUS))
  const [eq, setEqState] = useState<EqSettings>(() => loadPref(EQ_PREF_KEY, DEFAULT_EQ))
  const [reverbPath, setReverbPath] = useState<string | null>(null)
  const [reverbCount, setReverbCount] = useState(0)
  const [reverbSeconds, setReverbSeconds] = useState(0)

  // The FX grid is chosen from the measured panel width. Same reasoning as the scan list: this
  // panel is dragged, so a viewport breakpoint says nothing about the room it actually has.
  const fxRef = useRef<HTMLDivElement | null>(null)
  const [fxWidth, setFxWidth] = useState(0)
  const [devicesOpen, setDevicesOpen] = useState<boolean>(() => loadDevicesOpen())
  const [poppedOut, setPoppedOut] = useState(false)
  const volumeGain = volumeDb <= VOLUME_MIN_DB ? 0 : Math.pow(10, volumeDb * 0.05)

  const [diPrefs, setDiPrefs] = useState<DiPrefs>(loadDiPrefs)

  const [irCount, setIrCount] = useState(0)
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
        // Applying a cab changes the level, so the model's declared loudness has to be corrected
        // by however much the IR moved it — otherwise captures with a cab play back far louder
        // than the same capture without one.
        let effectiveLoudnessDb = rendered.loudnessDb
        if (irEnabled && irPath) {
          const irResult = await window.api.readFileBinary(irPath)
          if (irResult.error || !irResult.data) {
            throw new Error(`Could not read the cabinet IR: ${irResult.error ?? 'no data'}`)
          }
          const irDecoded = await ctx.decodeAudioData(base64ToArrayBuffer(irResult.data))
          const irMono = new Float32Array(irDecoded.length)
          irDecoded.copyFromChannel(irMono, 0, 0)
          const dry = processed
          processed = await applyCabinetIr(dry, modelSampleRate, irMono, irDecoded.sampleRate, irMix)
          effectiveLoudnessDb = loudnessAfterIr(rendered.loudnessDb, dry, processed)
        }

        applyDcBlocker(processed, modelSampleRate)
        const normalized = normalizeRendered(processed, effectiveLoudnessDb)

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

  // The IR library is indexed, not listed: a bought pack runs to hundreds of thousands of files
  // across a deep folder tree, so IrPicker searches an index held in the main process rather than
  // this component holding the library. All that is needed here is how many there are (to tell
  // "no library" from "library with nothing in it") and which one is currently chosen.
  useEffect(() => {
    let cancelled = false
    if (!reverbLibraryPath) {
      setReverbCount(0)
      return
    }
    void (async () => {
      const result = await window.api.indexIrLibrary(reverbLibraryPath)
      if (cancelled) return
      setReverbCount(result.count)
      try {
        const remembered = localStorage.getItem(REVERB_PREF_KEY)
        if (remembered) setReverbPath(remembered)
      } catch {
        // Non-fatal.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reverbLibraryPath])

  useEffect(() => {
    let cancelled = false
    if (!irLibraryPath) {
      setIrCount(0)
      return
    }
    void (async () => {
      const result = await window.api.indexIrLibrary(irLibraryPath)
      if (cancelled) return
      setIrCount(result.count)
      if (result.count === 0) return
      // Persisted and shared, so the Tone Map's auditioning applies the same cab.
      setIrPath(lastIrPath ?? resolveRememberedIr(loadIrFavorites()))
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

      // Volume sits AFTER the meter, so the meter keeps showing the capture's normalized level
      // rather than how far you happened to turn the knob down.
      if (!volumeRef.current) volumeRef.current = ctx.createGain()
      const volume = volumeRef.current
      volume.gain.value = volumeGain

      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.loop = loopEnabled
      source.connect(analyser)
      analyser.connect(volume)
      volume.connect(ctx.destination)
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

  /**
   * Play is not a toggle — Stop is the only thing that ends playback.
   *
   * It used to stop when pressed mid-play, which made the two buttons feel wired together:
   * Play sometimes acted as Stop, and Stop sometimes looked redundant.
   */
  const handlePlay = useCallback(() => {
    if (isPlaying) return
    startPlaybackAt(resumeOffsetSec(progress, bufferRef.current?.duration ?? 0))
  }, [isPlaying, startPlaybackAt, progress])

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
    tunerTrackerRef.current?.reset()
    tunerTrackerRef.current = null
    setLiveRunning(false)
    setLiveMeter(0)
    setLiveInputMeter(0)
    setLiveTuner(null)
    setLiveLatencyMs(null)
    setChannelPeaks([])
    setReverbSeconds(0)
  }, [])

  /**
   * Decode a .wav impulse, keeping every channel.
   *
   * Reverb impulses are stereo and the width between the sides is the point, so unlike the
   * cabinet path this must not collapse to mono.
   */
  const decodeImpulse = useCallback(
    async (path: string): Promise<ImpulseResponse> => {
      const result = await window.api.readFileBinary(path)
      if (result.error || !result.data) {
        throw new Error(`Could not read the impulse: ${result.error ?? 'no data'}`)
      }
      const decoded = await getAudioContext().decodeAudioData(base64ToArrayBuffer(result.data))
      const channels: Float32Array[] = []
      for (let c = 0; c < decoded.numberOfChannels; c++) {
        const data = new Float32Array(decoded.length)
        decoded.copyFromChannel(data, c, 0)
        channels.push(data)
      }
      return { channels, sampleRate: decoded.sampleRate }
    },
    [getAudioContext]
  )

  /** Decode the chosen cabinet for the live graph, or null when the cab is off / unset. */
  const loadLiveIr = useCallback(async (): Promise<{ samples: Float32Array; sampleRate: number } | null> => {
    if (!irEnabled || !irPath) return null
    const irResult = await window.api.readFileBinary(irPath)
    if (irResult.error || !irResult.data) {
      throw new Error(`Could not read the cabinet IR: ${irResult.error ?? 'no data'}`)
    }
    const decoded = await getAudioContext().decodeAudioData(base64ToArrayBuffer(irResult.data))
    const mono = new Float32Array(decoded.length)
    decoded.copyFromChannel(mono, 0, 0)
    return { samples: mono, sampleRate: decoded.sampleRate }
  }, [irEnabled, irPath, getAudioContext])

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

      const ir = await loadLiveIr()

      const engine = new LiveEngine((message) => setLiveError(message))
      liveEngineRef.current = engine
      await engine.start({
        deviceId: inputDeviceId,
        modelJson,
        ir,
        irMix,
        inputGain: Math.pow(10, liveInputGainDb * 0.05),
        inputChannel,
        outputDeviceId,
        eq,
        delay,
        reverb,
        chorus,
        reverbIr:
          reverbPath && reverb.mode === 'convolution'
            ? await decodeImpulse(reverbPath).catch(() => null)
            : null,
        // Same loudness target the offline preview uses, so switching between the two modes is
        // not a volume jump.
        normalizeGain: computeLiveNormalizeGain(
          typeof m.loudness === 'number' ? m.loudness : null
        ),
        volume: volumeGain
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
      const inBuf = new Float32Array(4096)
      const tracker = new PitchTracker()
      tunerTrackerRef.current = tracker
      let nextTunerAt = 0
      const tick = () => {
        setLiveMeter(engine.readOutputPeak())
        if (eng.readInputPeak) setLiveInputMeter(eng.readInputPeak())
        // Meters want every frame; the tuner does not. Detection costs ~2.3ms on a 4096-sample
        // window, and running that 60 times a second would spend an eighth of the main thread on
        // a reading that is median-smoothed anyway. 20Hz is well inside how fast a peg turns.
        const now = performance.now()
        if (eng.getInputTimeDomain && now >= nextTunerAt) {
          nextTunerAt = now + TUNER_INTERVAL_MS
          eng.getInputTimeDomain(inBuf)
          setLiveTuner(tracker.update(inBuf, engine.sampleRate ?? 48000, now))
        }
        setChannelPeaks(engine.readChannelPeaks())
        liveMeterRafRef.current = requestAnimationFrame(tick)
      }
      liveMeterRafRef.current = requestAnimationFrame(tick)
    } catch (error) {
      await stopLive()
      setLiveError(formatError(error))
    } finally {
      setLiveStarting(false)
    }
  }, [file.filePath, inputDeviceId, irMix, liveInputGainDb, liveBypass, loadLiveIr, stopLive])

  // Swap the cabinet on the running engine rather than restarting it — restarting would drop the
  // mic and reload the model, so you could never hear two cabs back to back.
  useEffect(() => {
    const engine = liveEngineRef.current
    if (!engine || !liveRunning) return
    let cancelled = false
    void (async () => {
      try {
        const ir = await loadLiveIr()
        if (cancelled) return
        await engine.setIr(ir)
      } catch (error) {
        if (!cancelled) setLiveError(formatError(error))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [irEnabled, irPath, liveRunning, loadLiveIr])

  useEffect(() => {
    if (!liveMode) return
    let cancelled = false
    void (async () => {
      try {
        const [inputs, outputs] = await Promise.all([listAudioInputs(), listAudioOutputs()])
        if (cancelled) return
        setInputDevices(inputs)
        setOutputDevices(outputs)
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

  // One fader for both modes: preview goes through a GainNode in this component, live through the
  // engine's own output stage. Persisted so it survives reopening the player.
  useEffect(() => {
    if (volumeRef.current) volumeRef.current.gain.value = volumeGain
    liveEngineRef.current?.setOutputVolume(volumeGain)
    try {
      localStorage.setItem(VOLUME_PREF_KEY, String(volumeDb))
    } catch {
      // Non-fatal.
    }
  }, [volumeDb, volumeGain])

  useEffect(() => {
    liveEngineRef.current?.setGains(Math.pow(10, liveInputGainDb * 0.05), 1)
  }, [liveInputGainDb])

  useEffect(() => {
    liveEngineRef.current?.setIrMix(irMix)
  }, [irMix])

  useLayoutEffect(() => {
    const el = fxRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setFxWidth(entry.contentRect.width)
    })
    observer.observe(el)
    setFxWidth(el.getBoundingClientRect().width)
    return () => observer.disconnect()
    // Re-attached when the section mounts, which only happens in Live.
  }, [liveMode])

  useEffect(() => {
    liveEngineRef.current?.setDelay(delay)
    savePref(DELAY_PREF_KEY, delay)
  }, [delay])

  useEffect(() => {
    liveEngineRef.current?.setReverb(reverb)
    savePref(REVERB_SETTINGS_PREF_KEY, reverb)
  }, [reverb])

  useEffect(() => {
    liveEngineRef.current?.setChorus(chorus)
    savePref(CHORUS_PREF_KEY, chorus)
  }, [chorus])

  useEffect(() => {
    liveEngineRef.current?.setEq(eq)
    savePref(EQ_PREF_KEY, eq)
  }, [eq])

  useEffect(() => {
    try {
      localStorage.setItem(DEVICES_OPEN_PREF_KEY, devicesOpen ? '1' : '0')
    } catch {
      // Non-fatal.
    }
  }, [devicesOpen])

  // Loading an impulse is async and the engine may stop mid-flight, so the result is discarded
  // if this effect has been superseded.
  useEffect(() => {
    const engine = liveEngineRef.current
    if (!engine || !liveRunning) return
    let cancelled = false
    void (async () => {
      try {
        // Only decode when convolution is the selected mode — a 61s stereo file is expensive to
        // read and resample, and the plate does not need it.
        const ir = reverbPath && reverb.mode === 'convolution' ? await decodeImpulse(reverbPath) : null
        if (cancelled) return
        await engine.setReverbIr(ir)
        setReverbSeconds(engine.reverbSeconds)
      } catch (error) {
        if (!cancelled) setLiveError(formatError(error))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reverbPath, liveRunning, reverb.mode, decodeImpulse])

  // Both are rewires, not restarts — hunting for the input your guitar is in, or moving to
  // headphones, should not drop the device and reload the model on every attempt.
  useEffect(() => {
    liveEngineRef.current?.setInputChannel(inputChannel)
    try {
      localStorage.setItem(INPUT_CHANNEL_PREF_KEY, String(inputChannel))
    } catch {
      // Non-fatal.
    }
  }, [inputChannel])

  useEffect(() => {
    void liveEngineRef.current?.setOutputDevice(outputDeviceId)
    try {
      if (outputDeviceId) localStorage.setItem(OUTPUT_DEVICE_PREF_KEY, outputDeviceId)
      else localStorage.removeItem(OUTPUT_DEVICE_PREF_KEY)
    } catch {
      // Non-fatal.
    }
  }, [outputDeviceId])

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

  /** What the collapsed Devices row reports. */
  const inputDeviceLabel = inputDeviceId
    ? (inputDevices.find((d) => d.deviceId === inputDeviceId)?.label ?? 'Unknown input')
    : 'System default'

  /**
   * Previous / next through the folder in scope.
   *
   * Hidden entirely when there is nothing to step through, rather than shown disabled — a pair of
   * dead arrows on a single-capture folder is just noise.
   */
  const stepper =
    onStep && stepCount > 1 && stepIndex >= 0 ? (
      <div className="flex-shrink-0 flex items-center gap-0.5">
        <button
          onClick={() => onStep(-1)}
          disabled={stepIndex <= 0}
          title="Previous capture in this folder"
          className="w-[22px] h-[22px] flex items-center justify-center rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-[var(--hover)] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
        >
          <svg viewBox="0 0 24 24" className="w-[14px] h-[14px]" fill="none" stroke="currentColor" strokeWidth={2.2}>
            <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="font-mono text-[10px] text-gray-400 dark:text-gray-500 tabular-nums px-0.5">
          {stepIndex + 1}/{stepCount}
        </span>
        <button
          onClick={() => onStep(1)}
          disabled={stepIndex >= stepCount - 1}
          title="Next capture in this folder"
          className="w-[22px] h-[22px] flex items-center justify-center rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-[var(--hover)] disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
        >
          <svg viewBox="0 0 24 24" className="w-[14px] h-[14px]" fill="none" stroke="currentColor" strokeWidth={2.2}>
            <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    ) : null

  const needsCabIr = captureNeedsCabIr(m.gear_type)

  const coverSrc = coverImagePath ? toFileUrl(coverImagePath) : ampPlaceholder
  const onCoverError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    if (img.src !== ampPlaceholder) img.src = ampPlaceholder
  }

  /**
   * Amp picture and metadata, shown in both modes.
   *
   * Live used to open straight onto the RECORDING sign with no indication of which capture you
   * were about to play through — the same identity problem the Cab IR control had. Both modes are
   * about one capture, so both should show which.
   */
  const captureHeader = (
    <>
      {/* Constrain WIDTH, not height. `aspectRatio` plus `maxHeight` fight each other on a
          wide panel: the box wants to be taller, gets clamped, and the ratio silently
          drifts — so object-cover crops far more of the amp the wider you drag the panel.
          Capping width at (ratio x max height) keeps the crop identical at every panel
          size, and the letterbox fills with the surrounding surface.
          The ratio itself is what sets how big the amp reads: at a given panel width the
          height is width/ratio, so 2.2:1 shows it ~36% taller than the old 3:1 did. */}
      <div className="bg-gray-100 dark:bg-[var(--field)] flex justify-center">
        <div className="w-full" style={{ aspectRatio: '2.2 / 1', maxWidth: 232 * 2.2 }}>
          <img
            src={coverSrc}
            alt={coverImagePath ? 'Amp cover' : 'No amp cover'}
            className="w-full h-full object-cover block"
            loading="lazy"
            onError={onCoverError}
          />
        </div>
      </div>

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
    </>
  )

  /**
   * Cab IR controls, rendered identically in Preview and Live.
   *
   * Live originally had no IR control at all, so an amp-only capture was auditioned through a cab
   * when previewing and raw when playing into it — the two modes disagreed about what the capture
   * sounded like, which is exactly the confusion the shared IR state was meant to prevent.
   */
  /**
   * Listener volume, shown in both modes.
   *
   * Captures are normalized so they can be compared to each other, which says nothing about how
   * loud that is in your headphones — and normalized playback next to a quietly-played guitar is
   * exactly the mismatch that makes preview uncomfortable.
   */
  const volumeSection = (
    <div className="px-4 py-3.5 border-b border-gray-200 dark:border-[var(--border-soft)]">
      <div className="flex items-center justify-between mb-1.5">
        <TapeLabel>Volume</TapeLabel>
        <span className="font-mono text-[10px] text-gray-400 dark:text-gray-500">
          {volumeDb <= VOLUME_MIN_DB ? 'muted' : `${volumeDb > 0 ? '+' : ''}${volumeDb.toFixed(1)} dB`}
        </span>
      </div>
      <input
        type="range"
        min={VOLUME_MIN_DB}
        max={0}
        step={0.5}
        value={volumeDb}
        onChange={(e) => setVolumeDb(Number(e.target.value))}
        className="w-full accent-[var(--accent)]"
        aria-label="Player volume"
      />
    </div>
  )

  /**
   * Delay and reverb, Live only.
   *
   * Preview renders offline through a Worker, which would need its own implementation of both —
   * so rather than half-wire it, effects belong to the mode where you are actually playing.
   */
  const fxLayout = fxLayoutFor(fxWidth || PLAYER_MIN_WIDTH)
  const fxCardGrid = { display: 'grid', gap: 12, gridTemplateColumns: fxGridTemplate(fxLayout.cardControls) }
  const fxReverbGrid = { display: 'grid', gap: 12, gridTemplateColumns: fxGridTemplate(fxLayout.reverbControls) }
  const fxCompact = fxLayout.compact

  const fxSection = (
    <div ref={fxRef} className="px-4 py-3.5 border-b border-gray-200 dark:border-[var(--border-soft)]">
      {/* Chorus and Delay share a row once each half can still hold two controls across; below
          that they stack, because two narrow cards are taller than one wide one. */}
      <div
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: fxGridTemplate(fxLayout.cardsPerRow),
          alignItems: 'start'
        }}
      >
        <FxCard
          label="EQ"
          enabled={eq.enabled}
          onToggle={(v) => setEqState((e) => ({ ...e, enabled: v }))}
          summary={eq.enabled
            ? [eq.bassDb, eq.midDb, eq.trebleDb].map((v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}`).join('/')
            : 'off'}
        >
          <div style={fxCardGrid}>
            <FxSlider compact={fxCompact} label="Bass" hint={`${EQ_BASS_HZ}Hz`} value={eq.bassDb}
              min={-EQ_MAX_DB} max={EQ_MAX_DB} step={0.5}
              format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`}
              onChange={(v) => setEqState((e) => ({ ...e, bassDb: v }))} />
            <FxSlider compact={fxCompact} label="Middle" hint={`${EQ_MID_HZ}Hz`} value={eq.midDb}
              min={-EQ_MAX_DB} max={EQ_MAX_DB} step={0.5}
              format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`}
              onChange={(v) => setEqState((e) => ({ ...e, midDb: v }))} />
            <FxSlider compact={fxCompact} label="Treble" hint={`${EQ_TREBLE_HZ / 1000}kHz`} value={eq.trebleDb}
              min={-EQ_MAX_DB} max={EQ_MAX_DB} step={0.5}
              format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`}
              onChange={(v) => setEqState((e) => ({ ...e, trebleDb: v }))} />
          </div>
        </FxCard>

        <FxCard
          label="Chorus"
          enabled={chorus.enabled}
          onToggle={(v) => setChorusState((c) => ({ ...c, enabled: v }))}
          summary={chorus.enabled ? `${Math.round(chorus.mix * 100)}%` : 'off'}
        >
          <div style={fxCardGrid}>
            <FxSlider compact={fxCompact} label="Mix" value={chorus.mix} min={0} max={1} step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => setChorusState((c) => ({ ...c, mix: v }))} />
            <FxSlider compact={fxCompact} label="Depth" value={chorus.depthMs} min={0.2} max={12} step={0.1}
              format={(v) => `${v.toFixed(1)} ms`}
              onChange={(v) => setChorusState((c) => ({ ...c, depthMs: v }))} />
            <FxSlider compact={fxCompact} label="Rate" value={chorus.rateHz} min={0.05} max={6} step={0.05}
              format={(v) => `${v.toFixed(2)} Hz`}
              onChange={(v) => setChorusState((c) => ({ ...c, rateHz: v }))} />
          </div>
        </FxCard>

        <FxCard
          label="Delay"
          enabled={delay.enabled}
          onToggle={(v) => setDelayState((d) => ({ ...d, enabled: v }))}
          summary={delay.enabled ? `${Math.round(delay.mix * 100)}% \u00b7 ${Math.round(delay.timeMs)}ms` : 'off'}
          header={
            <button
              onClick={() => setDelayState((d) => ({ ...d, pingPong: !d.pingPong }))}
              className={`h-[22px] px-2.5 rounded text-[11px] font-medium border transition-colors ${
                delay.pingPong
                  ? 'bg-[var(--active)] border-[var(--accent)] text-gray-900 dark:text-gray-100'
                  : 'border-gray-200 dark:border-[var(--border)] text-gray-500 dark:text-gray-400'
              }`}
              title={delay.pingPong
                ? 'Ping-pong: repeats alternate left and right'
                : 'Mono: repeats sit centred'}
            >
              {delay.pingPong ? 'Ping-Pong' : 'Mono'}
            </button>
          }
        >
          <div style={fxCardGrid}>
            <FxSlider compact={fxCompact} label="Mix" value={delay.mix} min={0} max={1} step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => setDelayState((d) => ({ ...d, mix: v }))} />
            <FxSlider compact={fxCompact} label="Time" value={delay.timeMs} min={20} max={1200} step={5}
              format={(v) => `${Math.round(v)} ms`}
              onChange={(v) => setDelayState((d) => ({ ...d, timeMs: v }))} />
            {/* Ratio sets the second tap against the first, so with one tap it does nothing. */}
            {delay.pingPong && (
              <FxSlider compact={fxCompact} label="Ratio" hint="right tap vs left" value={delay.ratio} min={0.25} max={2} step={0.05}
                format={(v) => `${v.toFixed(2)}x`}
                onChange={(v) => setDelayState((d) => ({ ...d, ratio: v }))} />
            )}
            <FxSlider compact={fxCompact} label="Feedback" value={delay.feedback} min={0} max={MAX_FEEDBACK} step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => setDelayState((d) => ({ ...d, feedback: v }))} />
            <FxSlider compact={fxCompact} label="Tone" hint="darkens repeats" value={delay.toneHz} min={500} max={12000} step={100}
              format={(v) => `${(v / 1000).toFixed(1)} kHz`}
              onChange={(v) => setDelayState((d) => ({ ...d, toneHz: v }))} />
            <FxSlider compact={fxCompact} label="Mod" hint="pitch movement" value={delay.modDepthMs} min={0} max={MAX_MOD_DEPTH_MS} step={0.05}
              format={(v) => (v === 0 ? 'off' : `${v.toFixed(2)} ms`)}
              onChange={(v) => setDelayState((d) => ({ ...d, modDepthMs: v }))} />
            {delay.modDepthMs > 0 && (
              <FxSlider compact={fxCompact} label="Mod rate" value={delay.modRateHz} min={0.05} max={8} step={0.05}
                format={(v) => `${v.toFixed(2)} Hz`}
                onChange={(v) => setDelayState((d) => ({ ...d, modRateHz: v }))} />
            )}
          </div>
        </FxCard>
      </div>

      {/* Reverb takes the full width in both layouts: it has the most controls, and in
          Convolution mode it also has to house the impulse picker. */}
      <div className="mt-3">
        <FxCard
          label="Reverb"
          enabled={reverb.enabled}
          onToggle={(v) => setReverbState((r) => ({ ...r, enabled: v }))}
          summary={reverb.enabled ? `${Math.round(reverb.mix * 100)}%` : 'off'}
          header={
            <div className="flex rounded-md bg-gray-100 dark:bg-[var(--field)] border border-gray-200 dark:border-[var(--border)] p-0.5">
              {([['plate', 'Plate'], ['convolution', 'Convolution']] as const).map(([mode, modeLabel]) => (
                <button
                  key={mode}
                  onClick={() => setReverbState((r) => ({ ...r, mode }))}
                  className={`h-[22px] px-2.5 rounded text-[11px] font-medium transition-colors ${
                    reverb.mode === mode
                      ? 'bg-white dark:bg-[#232c36] text-gray-900 dark:text-gray-100 shadow-sm'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}
                >
                  {modeLabel}
                </button>
              ))}
            </div>
          }
        >
          <div style={fxReverbGrid}>
            <FxSlider compact={fxCompact} label="Mix" value={reverb.mix} min={0} max={1} step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => setReverbState((r) => ({ ...r, mix: v }))} />
            {reverb.mode === 'plate' && (
              <>
                <FxSlider compact={fxCompact} label="Size" value={reverb.roomSize} min={0} max={1} step={0.01}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => setReverbState((r) => ({ ...r, roomSize: v }))} />
                <FxSlider compact={fxCompact} label="Damping" hint="highs decay" value={reverb.damping} min={0} max={1} step={0.01}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => setReverbState((r) => ({ ...r, damping: v }))} />
                <FxSlider compact={fxCompact} label="Width" value={reverb.width} min={0} max={1} step={0.01}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => setReverbState((r) => ({ ...r, width: v }))} />
              </>
            )}
            <FxSlider compact={fxCompact} label="Low" hint={`${REVERB_LOW_SHELF_HZ}Hz \u00b7 tightens`} value={reverb.lowDb}
              min={-REVERB_EQ_MAX_DB} max={REVERB_EQ_MAX_DB} step={0.5}
              format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`}
              onChange={(v) => setReverbState((r) => ({ ...r, lowDb: v }))} />
            <FxSlider compact={fxCompact} label="High" hint={`${REVERB_HIGH_SHELF_HZ / 1000}kHz \u00b7 brightens`} value={reverb.highDb}
              min={-REVERB_EQ_MAX_DB} max={REVERB_EQ_MAX_DB} step={0.5}
              format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`}
              onChange={(v) => setReverbState((r) => ({ ...r, highDb: v }))} />
          </div>

          {reverb.mode === 'convolution' && (
            <div className="mt-2.5 flex flex-col gap-1.5">
              {reverbCount === 0 ? (
                <p className="text-[11px] text-gray-400 dark:text-gray-600 leading-relaxed">
                  Set a Convolution Reverbs folder in Settings &rarr; Player.
                </p>
              ) : (
                <>
                  <IrPicker
                    libraryPath={reverbLibraryPath ?? ''}
                    value={reverbPath}
                    allowNone
                    placeholder={`Choose from ${reverbCount.toLocaleString()} impulses\u2026`}
                    onChange={(ref) => {
                      setReverbPath(ref.path)
                      try {
                        localStorage.setItem(REVERB_PREF_KEY, ref.path)
                      } catch {
                        // Non-fatal.
                      }
                    }}
                    onClear={() => {
                      setReverbPath(null)
                      try {
                        localStorage.removeItem(REVERB_PREF_KEY)
                      } catch {
                        // Non-fatal.
                      }
                    }}
                  />
                  {reverbSeconds > 0 && (
                    <p className="text-[10px] text-gray-400 dark:text-gray-600">
                      {reverbSeconds.toFixed(1)}s tail after trimming silence
                    </p>
                  )}
                  <p className="text-[10px] text-gray-400 dark:text-gray-600 leading-relaxed">
                    Convolution reproduces real rooms exactly, and cannot reproduce anything that
                    shifts pitch or reacts to playing &mdash; shimmer, bloom and swell smear rather
                    than shimmer. Use Plate for those.
                  </p>
                </>
              )}
            </div>
          )}
        </FxCard>
      </div>
    </div>
  )

  const cabIrSection = (
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
            disabled={busy || irCount === 0}
            className="relative disabled:opacity-40"
            style={{ width: 34, height: 19, borderRadius: 10, background: irEnabled ? 'rgba(45,212,191,.3)' : 'var(--field)', border: `1px solid ${irEnabled ? 'rgba(45,212,191,.5)' : 'var(--field-border)'}`, cursor: 'pointer' }}
          >
            <span style={{ position: 'absolute', top: 1.5, left: irEnabled ? 16.5 : 1.5, width: 14, height: 14, borderRadius: '50%', background: irEnabled ? 'var(--accent)' : 'var(--text-3)', transition: 'left .15s' }} />
          </button>
        </div>
      </div>
      {irCount === 0 ? (
        <p className="text-[11px] text-gray-400 dark:text-gray-600 leading-relaxed">
          {needsCabIr
            ? `This capture has no cabinet (${GEAR_LABELS[m.gear_type as string] ?? m.gear_type}), so it will sound harsh without an IR. Set an IR Library folder in Settings → Player.`
            : 'Set an IR Library folder in Settings → Player to audition cabinets.'}
        </p>
      ) : (
        irEnabled && (
          <>
            <IrPicker
              libraryPath={irLibraryPath ?? ''}
              value={irPath}
              disabled={busy}
              onChange={(ref) => { setIrPath(ref.path); lastIrPath = ref.path; saveIrPath(ref.path) }}
            />
            {!irPath && (
              <p className="text-[10.5px] text-amber-500 mt-1.5 leading-relaxed">
                No cabinet chosen yet — search the {irCount.toLocaleString()} IRs in your library, or star the ones you use.
              </p>
            )}
          </>
        )
      )}
    </div>
  )

  const outputDb = outputMeter > 0 ? `${(20 * Math.log10(outputMeter)).toFixed(1)} dB` : '—'
  // 160% headroom was tuned for an RMS reading; with peak metering the bar is already near full
  // scale at a normalized peak, so it maps close to 1:1 with a little headroom for the top LEDs.
  const outputPct = Math.min(100, outputMeter * 105)
  const inputDb = liveInputMeter > 0 ? `${(20 * Math.log10(liveInputMeter)).toFixed(1)} dB` : '—'


  const recordingSection = (
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
    </>
  )

  const tunerSection = (
    <>
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
    </>
  )

  const metersSection = (
    <>
            {/* Meters + bypass */}
            <div className="px-4 py-3.5 flex flex-col gap-3 border-b border-gray-200 dark:border-[var(--border-soft)]">
              <Meter label="Input (dry)" hint="set gain before arming" value={liveInputMeter} db={inputDb} />
              <Meter label="Output" value={liveMeter} db={liveMeter > 0 ? `${(20 * Math.log10(liveMeter)).toFixed(1)} dB` : '—'} />
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={liveBypass} onChange={(e) => setLiveBypass(e.target.checked)} className="w-3.5 h-3.5 rounded accent-[var(--accent)]" />
                <span className="text-xs text-gray-600 dark:text-gray-300">Bypass model (hear the dry input)</span>
              </label>
            </div>
    </>
  )

  const setupSection = (
    <>
            {/* Input gain sits ABOVE the devices, and outside the collapse.
                Devices are set once and then forgotten; gain is not — it is adjusted per capture,
                because what drives a high-gain model into saturation leaves a clean one limp. It
                belongs next to the meters you set it by, not buried with the wiring. */}
            <div className="px-4 py-3.5 flex flex-col gap-3.5">
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

              <div>
                <button
                  onClick={() => setDevicesOpen((v) => !v)}
                  aria-expanded={devicesOpen}
                  className="w-full flex items-center gap-2 py-1 text-left"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="12"
                    height="12"
                    fill="none"
                    stroke="var(--text-3)"
                    strokeWidth={2.4}
                    className="flex-none transition-transform"
                    style={{ transform: devicesOpen ? 'rotate(90deg)' : 'none' }}
                  >
                    <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <TapeLabel>Devices</TapeLabel>
                  {/* Collapsed, the summary has to carry what the section would have shown —
                      otherwise "why is there no sound" needs a click to even start diagnosing. */}
                  {!devicesOpen && (
                    <span className="ml-auto text-[10px] text-gray-400 dark:text-gray-500 truncate max-w-[60%]">
                      {inputDeviceLabel}
                      {channelPeaks.length > 1 ? ` · ch ${inputChannel + 1}` : ''}
                    </span>
                  )}
                </button>

                {devicesOpen && (
                  <div className="flex flex-col gap-3.5 mt-2">
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

                    {/* Input channel.
                        Only worth showing on a multi-channel interface — on a mono input there is
                        nothing to choose. The meters are the useful half: they turn "why is there
                        no sound" into "my guitar is in the other socket". */}
                    {channelPeaks.length > 1 && (
                      <div>
                        <TapeLabel>Input Channel</TapeLabel>
                        <p className="text-[10.5px] text-gray-400 dark:text-gray-600 mt-1 mb-1.5 leading-relaxed">
                          Play, and pick the channel showing signal.
                        </p>
                        <div className="flex flex-col gap-1.5">
                          {channelPeaks.map((peak, i) => (
                            <button
                              key={i}
                              onClick={() => setInputChannel(i)}
                              className={`flex items-center gap-2.5 h-[26px] px-2 rounded-md transition-colors ${
                                inputChannel === i ? 'bg-[var(--active)]' : 'hover:bg-gray-100 dark:hover:bg-[var(--hover)]'
                              }`}
                            >
                              <span
                                className="flex-none w-3 h-3 rounded-full border flex items-center justify-center"
                                style={{ borderColor: inputChannel === i ? 'var(--accent)' : 'var(--field-border)' }}
                              >
                                {inputChannel === i && (
                                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent)' }} />
                                )}
                              </span>
                              <span className="flex-none text-[11px] font-mono text-gray-500 dark:text-gray-400">{i + 1}</span>
                              <span
                                className="flex-1 h-[7px] rounded-sm overflow-hidden"
                                style={{ background: 'var(--field)', border: '1px solid var(--border)' }}
                              >
                                <span
                                  className="block h-full"
                                  style={{
                                    width: `${Math.min(100, peak * 140)}%`,
                                    background: 'linear-gradient(90deg,var(--accent) 0%,var(--accent) 62%,#fbbf24 82%,#f87171 100%)',
                                    transition: 'width .06s linear'
                                  }}
                                />
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <TapeLabel>Output Device</TapeLabel>
                      <select
                        value={outputDeviceId ?? ''}
                        onChange={(e) => setOutputDeviceId(e.target.value || null)}
                        className="mt-1.5 w-full h-[34px] px-3 rounded-[9px] text-xs bg-gray-50 dark:bg-[var(--field)] border border-gray-200 dark:border-[var(--field-border)] text-gray-700 dark:text-gray-200 focus:outline-none focus:border-[var(--accent)]"
                      >
                        <option value="">System default</option>
                        {outputDevices.map((d) => (
                          <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
                        ))}
                      </select>
                    </div>

                    {liveLatencyMs !== null && (
                      <p className="text-[10.5px] text-gray-400 dark:text-gray-600 leading-relaxed">
                        Round-trip latency ≈ {liveLatencyMs.toFixed(0)}ms
                        {liveEngineRef.current?.sampleRate ? ` · ${liveEngineRef.current.sampleRate} Hz` : ''}. Use headphones to avoid feedback.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
    </>
  )

  if (poppedOut) {
    return (
      <>
        {/* The panel keeps rendering behind the modal. Unmounting it would tear down the live
            engine and the meter loop, so popping out would silence what you are listening to. */}
        <div ref={panelRef} className="flex flex-col h-full bg-white dark:bg-[var(--panel)] text-gray-900 dark:text-gray-100 select-none opacity-40 pointer-events-none">
          <div className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">Expanded &mdash; see the rig view.</div>
        </div>
        <PlayerPopout
          captureLabel={captureLabel}
          gearLine={[m.gear_make, m.gear_model].filter(Boolean).join(' ')}
          coverSrc={coverSrc}
          onCoverError={onCoverError}
          summaryRows={summaryRows}
          onClose={() => setPoppedOut(false)}
          stepper={stepper}
          recording={recordingSection}
          fx={fxSection}
          tuner={tunerSection}
          meters={metersSection}
          cabIr={cabIrSection}
          volume={volumeSection}
          setup={setupSection}
        />
      </>
    )
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
        {stepper}
        <div className="flex-shrink-0 flex rounded-[9px] bg-gray-100 dark:bg-[var(--field)] border border-gray-200 dark:border-[var(--border)] p-0.5">
          {PLAYER_MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              title={m.hint}
              className={`h-6 px-2.5 rounded-md text-[11px] font-medium transition-colors ${
                mode === m.id
                  ? 'bg-white dark:bg-[#232c36] text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {/* Only offered in Live: Preview has no FX, so a wide view would show the same panel
            bigger for no reason. */}
        {liveMode && (
          <button
            onClick={() => setPoppedOut(true)}
            className="flex-shrink-0 w-[26px] h-[26px] flex items-center justify-center rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-[var(--hover)] transition-colors"
            title="Expand the rig to a full-width view"
          >
            <svg viewBox="0 0 24 24" className="w-[15px] h-[15px]" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M4 14v6h6M20 10V4h-6M20 4l-7 7M4 20l7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
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
          /* ══════════ LIVE MODE — capture → recording lightbox + tuner + meters ══════════ */
          <>
            {captureHeader}

            {recordingSection}

            {liveError && (
              <div className="mx-4 my-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3">
                <p className="text-xs font-medium text-red-700 dark:text-red-400 mb-0.5">Live input failed</p>
                <p className="text-[11px] text-red-600 dark:text-red-500 font-mono break-all">{liveError}</p>
              </div>
            )}

            {tunerSection}

            {/* Cab IR — the same control Preview has, so both modes agree on the cabinet. */}
            {cabIrSection}

            {fxSection}

            {volumeSection}

            {metersSection}

            {setupSection}
          </>
        ) : (
          /* ══════════ PREVIEW MODE — picture → metadata → transport → Cab IR → DI ══════════ */
          <>
            {captureHeader}

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
                style={{
                  backgroundImage: `url(${transportPanelBg})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  border: '1px solid #3a3a3d',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.08), inset 0 -8px 18px rgba(0,0,0,.45)'
                }}
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
                <div className="flex gap-2 justify-center">
                  <TapeCap
                    label="RESTART"
                    variant="neutral"
                    momentary
                    onClick={restart}
                    disabled={status !== 'ready'}
                    title="Restart from the top"
                  />
                  <TapeCap
                    label="PLAY"
                    variant="play"
                    active={isPlaying}
                    onClick={handlePlay}
                    disabled={status !== 'ready' || isPlaying}
                    title={isPlaying ? 'Playing — press Stop to end' : 'Play'}
                  />
                  <TapeCap
                    label="STOP"
                    variant="stop"
                    momentary
                    onClick={stopPlayback}
                    // Enabled whenever a clip is loaded, not only mid-play. Gating on isPlaying
                    // left Stop looking greyed-out for most of the panel's life; pressing it
                    // while already stopped is a harmless no-op.
                    disabled={status !== 'ready'}
                    title="Stop"
                  />
                  <TapeCap
                    label="LOOP"
                    variant="loop"
                    active={loopEnabled}
                    onClick={toggleLoop}
                    title={loopEnabled ? 'Looping — click for once' : 'Play once — click to loop'}
                  />
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
            {cabIrSection}

            {volumeSection}

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
                          className={`flex-none h-9 px-4 rounded-full text-[13px] whitespace-nowrap transition-colors disabled:opacity-50 ${
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
                          className={`w-full flex items-center gap-2.5 h-[42px] px-3 text-left transition-colors disabled:opacity-50 ${i > 0 ? 'border-t border-gray-200 dark:border-[#1a2027]' : ''} ${
                            selected ? 'bg-[var(--active)]' : 'hover:bg-gray-100 dark:hover:bg-[#151b22]'
                          }`}
                          style={selected ? { boxShadow: 'inset 3px 0 0 var(--accent)' } : undefined}
                        >
                          <svg viewBox="0 0 24 24" width="14" height="14" fill={selected ? 'var(--accent)' : 'currentColor'} className={selected ? '' : 'text-gray-400 dark:text-gray-500'}><path d="M8 5.14v14l11-7-11-7z" /></svg>
                          <span className={`flex-1 text-[13px] truncate ${selected ? 'text-gray-900 dark:text-gray-100' : 'text-gray-600 dark:text-gray-300'}`}>{clip.name.replace(/\.wav$/i, '')}</span>
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
/**
 * Full-width rig view.
 *
 * The player panel is a side panel with a 420px floor, which is why the FX controls have to
 * compress so hard. This is the same controls with room to breathe: cover and metadata across the
 * top, then the arm control, then the effects laid side by side rather than stacked.
 *
 * It takes the panel's own sections as props rather than rebuilding them. Two copies of sixteen
 * controls would drift apart the first time one was edited, and every one of these is already
 * bound to the same state and the same engine.
 */
function PlayerPopout({
  captureLabel,
  gearLine,
  coverSrc,
  onCoverError,
  summaryRows,
  onClose,
  stepper,
  recording,
  tuner,
  meters,
  fx,
  cabIr,
  volume,
  setup
}: {
  captureLabel: string
  gearLine: string
  coverSrc: string
  onCoverError: (e: React.SyntheticEvent<HTMLImageElement>) => void
  summaryRows: Array<{ label: string; value: string; tone?: string }>
  onClose: () => void
  stepper: React.ReactNode
  recording: React.ReactNode
  tuner: React.ReactNode
  meters: React.ReactNode
  fx: React.ReactNode
  cabIr: React.ReactNode
  volume: React.ReactNode
  setup: React.ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[300] flex flex-col bg-white dark:bg-[var(--panel)] text-gray-900 dark:text-gray-100 select-none">
      <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-200 dark:border-[var(--border-soft)] flex-shrink-0">
        <div className="uppercase text-amber-500 dark:text-amber-400" style={{ font: "700 10.5px 'IBM Plex Sans', sans-serif", letterSpacing: '.1em' }}>
          Live Rig
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold truncate">{captureLabel}</span>
          {gearLine && <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">{gearLine}</span>}
        </div>
        {stepper}
        <button
          onClick={onClose}
          className="flex-shrink-0 h-7 px-3 rounded-md text-[11px] font-medium border border-gray-200 dark:border-[var(--border)] text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-[var(--hover)] transition-colors"
          title="Back to the panel (Esc)"
        >
          Collapse
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-full" style={{ maxWidth: 1400 }}>
          {/* Cover and metadata share the top row — the capture you are playing through, stated
              once, with the room to state it properly. */}
          <div className="flex flex-wrap gap-5 px-5 py-5 border-b border-gray-200 dark:border-[var(--border-soft)]">
            <div className="flex-none rounded-lg overflow-hidden bg-gray-100 dark:bg-[var(--field)]" style={{ width: 300, aspectRatio: '2.2 / 1' }}>
              <img src={coverSrc} alt="Amp cover" className="w-full h-full object-cover block" onError={onCoverError} />
            </div>
            {summaryRows.length > 0 && (
              <div className="flex-1 min-w-[280px] grid gap-x-6 gap-y-3 content-start"
                   style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
                {summaryRows.map((row) => (
                  <MetaCell key={row.label} label={row.label} value={row.value} tone={row.tone} />
                ))}
              </div>
            )}
            <div className="flex-none w-[260px]">{recording}</div>
          </div>

          {/* Effects side by side. Each card already re-grids itself to the width it is given, so
              a third of a wide screen is plenty for any of them. */}
          <div className="px-1">{fx}</div>

          <div className="grid gap-x-5 border-t border-gray-200 dark:border-[var(--border-soft)]"
               style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
            <div>{tuner}</div>
            <div>{meters}</div>
            <div>{cabIr}</div>
            <div>{volume}</div>
            <div>{setup}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * \u2500\u2500 One effect: a bordered card with its name, on/off switch and controls.
 *
 * Collapsing the body when the effect is off is deliberate. Three effects fully expanded is
 * sixteen controls, and the ones that are off are exactly the ones you are not adjusting \u2014 so
 * their sliders are pure noise between the ones you are.
 */
function FxCard({
  label,
  enabled,
  summary,
  onToggle,
  header,
  children
}: {
  label: string
  enabled: boolean
  summary: string
  onToggle: (enabled: boolean) => void
  /** Extra control rendered beside the title, e.g. the reverb's mode selector. */
  header?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="rounded-[10px] border border-gray-200 dark:border-[var(--border)] bg-gray-50 dark:bg-[var(--field)] p-3">
      <div className="flex items-center gap-2">
        <TapeLabel>{label}</TapeLabel>
        {enabled && header}
        <span className={`ml-auto font-mono text-[10px] ${enabled ? 'text-[var(--accent)]' : 'text-gray-400 dark:text-gray-500'}`}>
          {summary}
        </span>
        <button
          role="switch"
          aria-checked={enabled}
          aria-label={`${label} on/off`}
          onClick={() => onToggle(!enabled)}
          className="relative flex-none"
          style={{
            width: 32,
            height: 18,
            borderRadius: 9,
            background: enabled ? 'rgba(45,212,191,.3)' : 'var(--panel)',
            border: `1px solid ${enabled ? 'rgba(45,212,191,.5)' : 'var(--field-border)'}`,
            cursor: 'pointer'
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 1.5,
              left: enabled ? 15.5 : 1.5,
              width: 13,
              height: 13,
              borderRadius: '50%',
              background: enabled ? 'var(--accent)' : 'var(--text-3)',
              transition: 'left .15s'
            }}
          />
        </button>
      </div>
      {enabled && <div className="mt-2.5">{children}</div>}
    </div>
  )
}

/** \u2500\u2500 One labelled FX parameter slider. */
function FxSlider({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange,
  compact
}: {
  label: string
  hint?: string
  value: number
  min: number
  max: number
  step: number
  format: (value: number) => string
  onChange: (value: number) => void
  /** Label, track and value on one line — half the height, shorter track. */
  compact?: boolean
}) {
  const input = (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full accent-[var(--accent)]"
      aria-label={label}
      title={hint}
    />
  )

  // Compact drops the hint text rather than the value: the hint explains a control you already
  // understand once you have moved it, the number is what you are aiming at.
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <span className="flex-none w-[70px] text-[10.5px] text-gray-500 dark:text-gray-400 truncate" title={hint ? `${label} \u00b7 ${hint}` : label}>
          {label}
        </span>
        <span className="flex-1 min-w-0 flex items-center">{input}</span>
        <span className="flex-none w-[52px] text-right font-mono text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">
          {format(value)}
        </span>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1 gap-2">
        <span className="text-[10.5px] text-gray-500 dark:text-gray-400 truncate">
          {label}
          {hint && <span className="text-gray-400 dark:text-gray-600"> &middot; {hint}</span>}
        </span>
        <span className="flex-none font-mono text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">
          {format(value)}
        </span>
      </div>
      {input}
    </div>
  )
}

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
