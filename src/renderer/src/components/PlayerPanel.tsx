import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { namToneChipClass } from '../assets/gear'
import type { ChorusPreset, DelayPreset, EchoLabPreset, PlayGroup, ReverbPreset, RigPreset, RigSnapshot } from '../types/settings'
import { RackReverbTest } from './RackReverbTest'
import { RackDelay } from './RackDelay'
import { RackEchoLab, CHAR1_RANGE, CHAR2_RANGE, DEFAULT_CHAR1, DEFAULT_CHAR2, pingPongFormat } from './RackEchoLab'
import { EchoLabFloatingWindow } from './EchoLabFloatingWindow'
import { RackCrop, RACK_CROP } from './RackCrop'
import { RackColumn } from './RackColumn'
import { PresetMenu } from './PresetMenu'
import { CapturePicker } from './CapturePicker'
import { JogWheel } from './JogWheel'
import { Rack500 } from './Rack500'
import { detectPreset } from '../utils/detectPreset'
import { getCaptureBestEsr, getEsrTone } from '../utils/esr'
import {
  DEFAULT_CHORUS,
  DEFAULT_DELAY,
  DEFAULT_ECHO_LAB,
  DEFAULT_EQ,
  DEFAULT_GATE,
  DEFAULT_REVERB,
  EQ_BASS_HZ,
  EQ_MAX_DB,
  EQ_MID_HZ,
  EQ_TREBLE_HZ,
  LiveEngine,
  MAX_FEEDBACK,
  MAX_MOD_DEPTH_MS,
  MAX_PAN_RATE_HZ,
  MIN_PAN_RATE_HZ,
  REVERB_EQ_MAX_DB,
  REVERB_HIGH_SHELF_HZ,
  REVERB_LOW_SHELF_HZ,
  listAudioInputs,
  listAudioOutputs,
  type ChorusSettings,
  type DelaySettings,
  type DelaySlotView,
  type EchoLabSettings,
  type EqSettings,
  type GateSettings,
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

/** Fixed brand/hardware colours — deliberately NOT theme tokens. These are physical objects
 *  (a painted sign, an LED, a meter lamp), so they must not recolour with the UI theme. */
const RIG_GOLD = '#e8b04a'
const TUNER_GREEN = '#2dd48a'
/** Same convention App.tsx uses for the main capture's cover — kept local rather than exported,
 *  since the pedal-capture cover lookup below deliberately does NOT replicate App's folder
 *  walk-up-to-library-root search, just the picked file's own folder. */
const AMPCOVER_PATTERN = /^ampcover\.(png|jpe?g|webp|gif|avif)$/i

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
const DELAY_IR_PREF_KEY = 'nam-player-delay-ir'
const REVERB_SETTINGS_PREF_KEY = 'nam-player-reverb-settings'
const ECHO_LAB_PREF_KEY = 'nam-player-echo-lab'
const DELAY_SLOT_VIEW_PREF_KEY = 'nam-player-delay-slot-view'
const CHORUS_PREF_KEY = 'nam-player-chorus'
const EQ_PREF_KEY = 'nam-player-eq'
const GATE_PREF_KEY = 'nam-player-gate'
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
  // Object-spread merging only makes sense for object fallbacks (DEFAULT_DELAY etc.) — it's what
  // lets a settings blob saved before a field existed still load with that field defaulted.
  // Spreading a PRIMITIVE fallback (a plain string like delaySlotView's 'echo-lab') does not
  // preserve it: `{...'echo-lab'}` silently produces a character-indexed object
  // ({0:'e',1:'c',...}), not the string — which is never === 'echo-lab' or 'delay' again, and
  // self-perpetuates once that corrupted shape gets saved back to localStorage. Real bug found
  // via a user report that Echo Lab's preset menu "just doesn't exist": traced to exactly this.
  const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v)
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw) as T
      return isPlainObject(fallback) ? { ...fallback, ...(parsed as Partial<T>) } : parsed
    }
  } catch {
    // Non-fatal.
  }
  return isPlainObject(fallback) ? { ...fallback } : fallback
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
  delayLibraryPath?: string | null
  irMix?: number
  coverImagePath?: string | null
  /** Move to the previous (-1) or next (+1) capture in the folder currently in scope. */
  onStep?: (delta: number) => void
  /** Position of this capture in that scope, and its size, for the "3 / 42" readout. */
  stepIndex?: number
  stepCount?: number
  /** Named FX presets, persisted in AppSettings so they survive across captures and restarts. */
  chorusPresets?: ChorusPreset[]
  delayPresets?: DelayPreset[]
  reverbPresets?: ReverbPreset[]
  echoLabPresets?: EchoLabPreset[]
  rigPresets?: RigPreset[]
  onChorusPresetsChange?: (presets: ChorusPreset[]) => void
  onDelayPresetsChange?: (presets: DelayPreset[]) => void
  onReverbPresetsChange?: (presets: ReverbPreset[]) => void
  onEchoLabPresetsChange?: (presets: EchoLabPreset[]) => void
  onRigPresetsChange?: (presets: RigPreset[]) => void
  /** Play groups — a hand-picked scope the stepper can drive from instead of the current folder. */
  playGroups?: PlayGroup[]
  activeGroupName?: string | null
  onLoadGroup?: (groupId: string) => void
  onExitGroup?: () => void
  /** Skip the manual click on the record sign — start monitoring as soon as the Live rig opens. */
  autoStartLiveOnPopout?: boolean
  onAutoStartLiveOnPopoutChange?: (value: boolean) => void
  /** Set (to any non-null value) by the list view's "Play Live" action to jump straight past
   *  Preview to the popped-out rig, instead of the three-click Live tab → tiny expand-arrow path.
   *  Self-clearing: PlayerPanel calls onLiveJumpHandled once it has acted on it. */
  liveJumpRequest?: number | null
  onLiveJumpHandled?: () => void
  /** The in-memory library, for picking a pedal capture by searching what's already loaded
   *  instead of dropping into a bare OS file dialog with no context. */
  libraryFiles?: NamFile[]
  /** A rig preset can carry its own amp capture — recalling one switches to it if it isn't
   *  already open. PlayerPanel doesn't own file-loading itself, so this delegates up. */
  onOpenAmpCapture?: (filePath: string) => void
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
  delayLibraryPath,
  irMix = 1,
  onStep,
  stepIndex = -1,
  stepCount = 0,
  coverImagePath,
  chorusPresets = [],
  delayPresets = [],
  reverbPresets = [],
  echoLabPresets = [],
  rigPresets = [],
  onChorusPresetsChange,
  onDelayPresetsChange,
  onReverbPresetsChange,
  onEchoLabPresetsChange,
  onRigPresetsChange,
  playGroups = [],
  activeGroupName = null,
  onLoadGroup,
  onExitGroup,
  autoStartLiveOnPopout = false,
  onAutoStartLiveOnPopoutChange,
  liveJumpRequest = null,
  onLiveJumpHandled,
  libraryFiles = [],
  onOpenAmpCapture
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
  // Chain a second capture ahead of this one — e.g. a pedal capture feeding the amp capture, the
  // way people cascade two NAM/Gateway plugin instances. Session-only, not persisted: this is a
  // first simple build to find out whether it sounds like anything, per the TODO note on it.
  const [preCapturePath, setPreCapturePath] = useState<string | null>(null)
  // Clicking the loaded chip toggles this without forgetting which capture is chosen — matches
  // Gate/EQ/Mod/Delay/Reverb's own on/off convention, so you can A/B the pedal stage without
  // losing your pick and having to re-browse for it.
  const [preEnabled, setPreEnabled] = useState(true)
  const [preCaptureName, setPreCaptureName] = useState<string | null>(null)
  const [preCaptureCoverSrc, setPreCaptureCoverSrc] = useState<string | null>(null)
  const [preGainDb, setPreGainDb] = useState(0)
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
  // Echo Lab shares Delay's rack slot — settings persist and both units keep running regardless
  // of which panel is currently drawn; delaySlotView controls ONLY which panel is shown.
  const [echoLab, setEchoLabState] = useState<EchoLabSettings>(() => {
    const loaded = loadPref(ECHO_LAB_PREF_KEY, DEFAULT_ECHO_LAB)
    // One-time self-heal: DEFAULT_ECHO_LAB.width was 0.5 (25% cross-bleed in the width matrix,
    // diluting Ping Pong's hard pan) until that default was corrected to 1. Anyone who used Echo
    // Lab before that fix has 0.5 persisted, which silently overrides the corrected default on
    // every load (loadPref merges saved values OVER the default) — so the code fix alone never
    // reaches an existing session. Echo Lab is new enough this session that a saved value of
    // EXACTLY the old broken default is overwhelmingly more likely to be inherited than a
    // deliberate choice, so it's corrected here rather than left to require a manual re-set.
    return loaded.width === 0.5 ? { ...loaded, width: 1 } : loaded
  })
  const [delaySlotView, setDelaySlotView] = useState<DelaySlotView>(() => {
    // Validated, not just loaded: a session that ran before the loadPref fix above may already
    // have a corrupted character-indexed object saved under this key, which the fix alone can't
    // retroactively repair — reading it back would just return that same corrupted shape as-is.
    // This self-heals it the next time the app starts, rather than requiring a manual localStorage clear.
    const loaded = loadPref(DELAY_SLOT_VIEW_PREF_KEY, 'echo-lab' as DelaySlotView)
    return loaded === 'delay' || loaded === 'echo-lab' ? loaded : 'echo-lab'
  })
  // Not persisted — a pop-out is a this-session convenience, not a saved layout preference.
  // Always starts closed/back-in-slot on a fresh player.
  const [echoLabFloating, setEchoLabFloating] = useState(false)
  const [reverb, setReverbState] = useState<ReverbSettings>(() => loadPref(REVERB_SETTINGS_PREF_KEY, DEFAULT_REVERB))
  const [chorus, setChorusState] = useState<ChorusSettings>(() => loadPref(CHORUS_PREF_KEY, DEFAULT_CHORUS))
  const [eq, setEqState] = useState<EqSettings>(() => loadPref(EQ_PREF_KEY, DEFAULT_EQ))
  const [gate, setGateState] = useState<GateSettings>(() => loadPref(GATE_PREF_KEY, DEFAULT_GATE))
  const [reverbPath, setReverbPath] = useState<string | null>(null)
  const [reverbCount, setReverbCount] = useState(0)
  const [reverbSeconds, setReverbSeconds] = useState(0)
  const [delayIrPath, setDelayIrPath] = useState<string | null>(null)
  const [delayIrCount, setDelayIrCount] = useState(0)
  const [delayIrSeconds, setDelayIrSeconds] = useState(0)
  const [delayIrChannels, setDelayIrChannels] = useState(0)
  const [reverbIrChannels, setReverbIrChannels] = useState(0)

  // The FX grid is chosen from the measured panel width. Same reasoning as the scan list: this
  // panel is dragged, so a viewport breakpoint says nothing about the room it actually has.
  const fxRef = useRef<HTMLDivElement | null>(null)
  const [fxWidth, setFxWidth] = useState(0)
  const [devicesOpen, setDevicesOpen] = useState<boolean>(() => loadDevicesOpen())
  const [poppedOut, setPoppedOut] = useState(false)
  // The list view's "Play Live" button jumps straight here instead of Preview + the mode tab +
  // the tiny expand arrow.
  //
  // This is a self-clearing one-shot request (liveJumpRequest / onLiveJumpHandled), not a
  // monotonic counter compared against a ref snapshot — that was the first version and it had a
  // real bug: App.tsx mounts PlayerPanel and bumps the counter in the same click when the player
  // wasn't already open, so the ref's very first read already saw the incremented value and the
  // "did it change" comparison silently no-opped — the first click landed in Preview, only a
  // second click (now genuinely already-mounted, ref genuinely stale) worked. A persistent
  // counter can't tell "this mount was caused by that click" apart from "this mount just happens
  // to occur while the counter is nonzero" (e.g. closing the player, then later clicking a plain
  // Play on a different file). Clearing the request immediately after acting on it removes the
  // ambiguity entirely: a fresh mount only jumps to Live if the request is still non-null, and
  // it's null again by the time any unrelated later mount happens.
  useEffect(() => {
    if (liveJumpRequest != null) {
      setMode('live')
      setPoppedOut(true)
      onLiveJumpHandled?.()
    }
  }, [liveJumpRequest, onLiveJumpHandled])
  // Master power for the 500-strip rack (Gate/EQ/Mod) — the rack's illuminated blue button.
  const [fxPower, setFxPower] = useState(true)
  // Power off silences all three stages without touching their own on/off state or settings, so
  // flipping it back on restores exactly what was dialed in. Delay/Reverb are separate physical
  // units with their own bypass switches and are deliberately not affected by this button.
  const effectiveGate: GateSettings = fxPower ? gate : { ...gate, enabled: false }
  const effectiveEq: EqSettings = fxPower ? eq : { ...eq, enabled: false }
  const effectiveChorus: ChorusSettings = fxPower ? chorus : { ...chorus, enabled: false }
  const [drawerOpen, setDrawerOpen] = useState(false)
  // Electron does not implement window.prompt() — alert/confirm show a native dialog, but prompt
  // silently returns null with no UI at all. That is why every "Save as" looked like it did
  // nothing: the four onSaveAs handlers below were calling into a browser API that never fires
  // here. This is the themed replacement.
  const [saveAsPrompt, setSaveAsPrompt] = useState<{ title: string; onSave: (name: string) => void } | null>(null)
  const [saveAsValue, setSaveAsValue] = useState('')
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
    if (!delayLibraryPath) {
      setDelayIrCount(0)
      return
    }
    void (async () => {
      const result = await window.api.indexIrLibrary(delayLibraryPath)
      if (cancelled) return
      setDelayIrCount(result.count)
      try {
        const remembered = localStorage.getItem(DELAY_IR_PREF_KEY)
        if (remembered) setDelayIrPath(remembered)
      } catch {
        // Non-fatal.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [delayLibraryPath])

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
      setIrPath(lastIrPath ?? resolveRememberedIr(loadIrFavorites('cab')))
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
    setDelayIrSeconds(0)
    setDelayIrChannels(0)
    setReverbIrChannels(0)
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

  /**
   * Step to the next or previous impulse in the SAME FOLDER as the one currently loaded — the
   * arrows next to Delay IR / Reverb IR. A live directory read of the current file's own folder,
   * not the cached library index — works regardless of whether the file was picked from inside
   * the configured library or via the native "Browse…" file dialog (which can pick anything on
   * disk, outside the index entirely), and always sees files added since the app opened.
   * Deliberately does nothing if nothing is loaded yet: there is no folder to cycle within until
   * you have picked a first impulse the normal way.
   */
  const cycleIr = useCallback(
    async (currentPath: string | null, direction: 1 | -1, onPick: (path: string) => void) => {
      if (!currentPath) return
      const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
      const file = norm(currentPath)
      const { files } = await window.api.listWavSiblings(currentPath)
      if (files.length === 0) return
      const sorted = [...files.map(norm)].sort((a, b) => a.localeCompare(b))
      const currentIndex = sorted.findIndex((f) => f === file)
      if (currentIndex === -1) return
      const next = sorted[(currentIndex + direction + sorted.length) % sorted.length]
      onPick(next)
    },
    []
  )

  const pickPedalCaptureFromLibrary = useCallback(
    (filePath: string) => {
      const found = libraryFiles.find((f) => f.filePath === filePath)
      setPreCapturePath(filePath)
      setPreCaptureName(found?.metadata.name || (filePath.split(/[\\/]/).pop() ?? filePath).replace(/\.nam$/i, ''))
      // A freshly-picked capture should be audible, not silently inherit an earlier off toggle.
      setPreEnabled(true)
    },
    [libraryFiles]
  )

  const browsePedalCapture = useCallback(async () => {
    const paths = await window.api.openFiles()
    const path = paths[0]
    if (!path) return
    setPreCapturePath(path)
    // Not in the library, so there is no metadata to pull a name from — the filename is all there is.
    setPreCaptureName((path.split(/[\\/]/).pop() ?? path).replace(/\.nam$/i, ''))
    setPreEnabled(true)
  }, [])

  const clearPedalCapture = useCallback(() => {
    setPreCapturePath(null)
    setPreCaptureName(null)
    setPreCaptureCoverSrc(null)
    setPreEnabled(true)
  }, [])

  // Cover art for the pedal capture, shown next to the amp's own cover once one is picked.
  // Deliberately simpler than App.tsx's main-cover resolution: just the picked file's own folder,
  // not a walk up to the library root — a pedal capture's cover, if it has one, lives right next
  // to the .nam file itself.
  useEffect(() => {
    if (!preCapturePath) {
      setPreCaptureCoverSrc(null)
      return
    }
    let cancelled = false
    const folder = preCapturePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
    void window.api.scanImages(folder).then((result) => {
      if (cancelled || !result.success) return
      const match = result.images.find((imagePath) => {
        const name = imagePath.replace(/\\/g, '/').split('/').pop() ?? ''
        return AMPCOVER_PATTERN.test(name)
      })
      setPreCaptureCoverSrc(match ? toFileUrl(match) : null)
    })
    return () => {
      cancelled = true
    }
  }, [preCapturePath])

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

      let preModelJson: string | null = null
      if (preCapturePath && preEnabled) {
        const preResult = await window.api.readFileBinary(preCapturePath)
        if (preResult.data) {
          preModelJson = new TextDecoder().decode(base64ToArrayBuffer(preResult.data))
        } else {
          // Don't fail the whole rig over the pedal stage — fall back to the amp alone and say why.
          setLiveError(`Could not read the pedal capture, continuing without it: ${preResult.error ?? 'no data'}`)
        }
      }

      const ir = await loadLiveIr()

      const engine = new LiveEngine((message) => setLiveError(message))
      liveEngineRef.current = engine
      await engine.start({
        deviceId: inputDeviceId,
        modelJson,
        preModelJson,
        preGain: Math.pow(10, preGainDb * 0.05),
        ir,
        irMix,
        inputGain: Math.pow(10, liveInputGainDb * 0.05),
        inputChannel,
        outputDeviceId,
        gate: effectiveGate,
        eq: effectiveEq,
        delay,
        echoLab,
        reverb,
        chorus: effectiveChorus,
        reverbIr:
          reverbPath && reverb.mode === 'convolution'
            ? await decodeImpulse(reverbPath).catch(() => null)
            : null,
        delayIr:
          delayIrPath && delay.mode === 'convolution'
            ? await decodeImpulse(delayIrPath).catch(() => null)
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
  }, [file.filePath, inputDeviceId, irMix, liveInputGainDb, liveBypass, loadLiveIr, stopLive, preCapturePath, preEnabled, preGainDb, fxPower])

  // Auto-start monitoring the moment the popped-out Live rig is entered, if the user has opted
  // in — skips the manual click on the record sign every single time. Fires once per arrival
  // (poppedOut+live going from false to true), not on every render while already there, so it
  // doesn't fight someone who deliberately stopped monitoring while still on this page.
  const wasLiveVisible = useRef(false)
  useEffect(() => {
    const liveVisible = poppedOut && mode === 'live'
    if (liveVisible && !wasLiveVisible.current && autoStartLiveOnPopout && !liveRunning && !liveStarting) {
      void startLive()
    }
    wasLiveVisible.current = liveVisible
  }, [poppedOut, mode, autoStartLiveOnPopout, liveRunning, liveStarting, startLive])

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
    liveEngineRef.current?.setEchoLab(echoLab)
    savePref(ECHO_LAB_PREF_KEY, echoLab)
  }, [echoLab])

  useEffect(() => {
    savePref(DELAY_SLOT_VIEW_PREF_KEY, delaySlotView)
  }, [delaySlotView])

  useEffect(() => {
    liveEngineRef.current?.setReverb(reverb)
    savePref(REVERB_SETTINGS_PREF_KEY, reverb)
  }, [reverb])

  useEffect(() => {
    liveEngineRef.current?.setChorus(effectiveChorus)
    savePref(CHORUS_PREF_KEY, chorus)
  }, [chorus, fxPower])

  useEffect(() => {
    liveEngineRef.current?.setEq(effectiveEq)
    savePref(EQ_PREF_KEY, eq)
  }, [eq, fxPower])

  useEffect(() => {
    liveEngineRef.current?.setGate(effectiveGate)
    savePref(GATE_PREF_KEY, gate)
  }, [gate, fxPower])

  /**
   * FX presets — save/apply/delete for Chorus, Delay, Reverb (independent per block) and Rig
   * (all five blocks at once). Applying one is just calling the same state setters the sliders
   * already use, so it rides the effects above for free: no separate "push to engine" path.
   *
   * Save is an upsert by case-insensitive name, so re-saving under an existing name overwrites it
   * rather than piling up duplicates.
   */
  function upsertPreset<P extends { id: string; name: string }>(
    list: P[],
    name: string,
    build: (id: string) => P
  ): P[] {
    const existingId = list.find((p) => p.name.toLowerCase() === name.toLowerCase())?.id
    const preset = build(existingId ?? crypto.randomUUID())
    return existingId ? list.map((p) => (p.id === existingId ? preset : p)) : [...list, preset]
  }

  // Merged over the default rather than applied bare: a preset saved before Tremolo existed has
  // no type/tremoloDepth/harmonic fields, and applying it directly would leave those undefined.
  const sameSettings = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
  // Must mirror saveRigPreset's snapshot shape exactly, field-for-field — sameSettings is a
  // JSON.stringify comparison, so a rig preset with a shape that doesn't match this object's keys
  // can never match, which is exactly what "loads fine but the picker still says No rig loaded"
  // turned out to be: cabIrPath/cabIrEnabled/ampCapturePath/pedalCapturePath/pedalGainDb/
  // pedalEnabled were added to what gets SAVED without being added here too.
  const activeRigPresetId = rigPresets.find((p) =>
    sameSettings(p.settings, {
      gate,
      eq,
      chorus,
      delay,
      delayIrPath,
      reverb,
      reverbIrPath: reverbPath,
      cabIrPath: irPath,
      cabIrEnabled: irEnabled,
      ampCapturePath: file.filePath,
      pedalCapturePath: preCapturePath,
      pedalGainDb: preGainDb,
      pedalEnabled: preEnabled
    }))?.id ?? null
  const activeChorusPresetId = chorusPresets.find((p) => sameSettings(p.settings, chorus))?.id ?? null
  const activeEchoLabPresetId = echoLabPresets.find((p) => sameSettings(p.settings, echoLab))?.id ?? null
  const activeDelayPresetId = delayPresets.find((p) => sameSettings(p.settings, delay) && p.irPath === delayIrPath)?.id ?? null
  const activeReverbPresetId = reverbPresets.find((p) => sameSettings(p.settings, reverb) && p.irPath === reverbPath)?.id ?? null

  const applyChorusPreset = useCallback(
    (settings: ChorusSettings) => setChorusState({ ...DEFAULT_CHORUS, ...settings }),
    []
  )
  const saveChorusPreset = useCallback(
    (name: string) => {
      onChorusPresetsChange?.(
        upsertPreset(chorusPresets, name, (id) => ({ id, name, settings: { ...chorus } }))
      )
    },
    [chorusPresets, chorus, onChorusPresetsChange]
  )
  const deleteChorusPreset = useCallback(
    (id: string) => onChorusPresetsChange?.(chorusPresets.filter((p) => p.id !== id)),
    [chorusPresets, onChorusPresetsChange]
  )

  const applyEchoLabPreset = useCallback(
    // Merged over the default, same reasoning as every other applyXPreset here — protects a
    // preset saved before some future field existed from leaking undefined into the engine.
    (settings: EchoLabSettings) => setEchoLabState({ ...DEFAULT_ECHO_LAB, ...settings }),
    []
  )
  const saveEchoLabPreset = useCallback(
    (name: string) => {
      onEchoLabPresetsChange?.(
        upsertPreset(echoLabPresets, name, (id) => ({ id, name, settings: { ...echoLab } }))
      )
    },
    [echoLabPresets, echoLab, onEchoLabPresetsChange]
  )
  const deleteEchoLabPreset = useCallback(
    (id: string) => onEchoLabPresetsChange?.(echoLabPresets.filter((p) => p.id !== id)),
    [echoLabPresets, onEchoLabPresetsChange]
  )

  const applyDelayPreset = useCallback((settings: DelaySettings, irPath?: string | null) => {
    // Merged over the default rather than applied bare — same reasoning as applyChorusPreset: a
    // delay preset saved before pingPongWidth existed has no such field, and applying it directly
    // left that field undefined, which Math.min(1, undefined) turns into NaN a few lines into
    // setDelay's clamp — silently breaking the ping-pong crossfade gains rather than throwing.
    setDelayState({ ...DEFAULT_DELAY, ...settings })
    setDelayIrPath(irPath ?? null)
    try {
      if (irPath) localStorage.setItem(DELAY_IR_PREF_KEY, irPath)
      else localStorage.removeItem(DELAY_IR_PREF_KEY)
    } catch {
      // Non-fatal.
    }
  }, [])
  const saveDelayPreset = useCallback(
    (name: string) => {
      onDelayPresetsChange?.(
        upsertPreset(delayPresets, name, (id) => ({ id, name, settings: { ...delay }, irPath: delayIrPath }))
      )
    },
    [delayPresets, delay, delayIrPath, onDelayPresetsChange]
  )
  const deleteDelayPreset = useCallback(
    (id: string) => onDelayPresetsChange?.(delayPresets.filter((p) => p.id !== id)),
    [delayPresets, onDelayPresetsChange]
  )

  const applyReverbPreset = useCallback((settings: ReverbSettings, irPath?: string | null) => {
    // Merged over the default for the same reason applyDelayPreset now is — protects any future
    // reverb field addition from the same "old preset, missing field, undefined leaks into the
    // engine" class of bug, not just a fix for one field that happens to exist today.
    setReverbState({ ...DEFAULT_REVERB, ...settings })
    setReverbPath(irPath ?? null)
    try {
      if (irPath) localStorage.setItem(REVERB_PREF_KEY, irPath)
      else localStorage.removeItem(REVERB_PREF_KEY)
    } catch {
      // Non-fatal.
    }
  }, [])
  const saveReverbPreset = useCallback(
    (name: string) => {
      onReverbPresetsChange?.(
        upsertPreset(reverbPresets, name, (id) => ({ id, name, settings: { ...reverb }, irPath: reverbPath }))
      )
    },
    [reverbPresets, reverb, reverbPath, onReverbPresetsChange]
  )
  const deleteReverbPreset = useCallback(
    (id: string) => onReverbPresetsChange?.(reverbPresets.filter((p) => p.id !== id)),
    [reverbPresets, onReverbPresetsChange]
  )

  const applyRigPreset = useCallback((snap: RigSnapshot) => {
    setGateState({ ...snap.gate })
    setEqState({ ...snap.eq })
    applyChorusPreset(snap.chorus)
    applyDelayPreset(snap.delay, snap.delayIrPath)
    applyReverbPreset(snap.reverb, snap.reverbIrPath)
    // Optional fields: a rig saved before these existed just leaves that aspect alone.
    if (snap.cabIrPath !== undefined) {
      irManuallySetRef.current = true
      setIrPath(snap.cabIrPath)
      if (snap.cabIrPath) saveIrPath(snap.cabIrPath)
    }
    if (snap.cabIrEnabled !== undefined) setIrEnabled(snap.cabIrEnabled)
    if (snap.pedalCapturePath !== undefined) {
      setPreCapturePath(snap.pedalCapturePath)
      setPreCaptureName(
        snap.pedalCapturePath
          ? libraryFiles.find((f) => f.filePath === snap.pedalCapturePath)?.metadata.name ||
            (snap.pedalCapturePath.split(/[\\/]/).pop() ?? snap.pedalCapturePath).replace(/\.nam$/i, '')
          : null
      )
    }
    if (snap.pedalGainDb !== undefined) setPreGainDb(snap.pedalGainDb)
    if (snap.pedalEnabled !== undefined) setPreEnabled(snap.pedalEnabled)
    // Switch the amp capture itself only if the rig actually names one AND it differs from what's
    // already open — recalling a rig on the same amp you're already on should not reload anything.
    if (snap.ampCapturePath && snap.ampCapturePath !== file.filePath) {
      onOpenAmpCapture?.(snap.ampCapturePath)
    }
  }, [applyChorusPreset, applyDelayPreset, applyReverbPreset, libraryFiles, file.filePath, onOpenAmpCapture])
  const saveRigPreset = useCallback(
    (name: string) => {
      const snapshot: RigSnapshot = {
        gate,
        eq,
        chorus,
        delay,
        delayIrPath,
        reverb,
        reverbIrPath: reverbPath,
        cabIrPath: irPath,
        cabIrEnabled: irEnabled,
        ampCapturePath: file.filePath,
        pedalCapturePath: preCapturePath,
        pedalGainDb: preGainDb,
        pedalEnabled: preEnabled
      }
      onRigPresetsChange?.(upsertPreset(rigPresets, name, (id) => ({ id, name, settings: snapshot })))
    },
    [rigPresets, gate, eq, chorus, delay, delayIrPath, reverb, reverbPath, irPath, irEnabled, file.filePath, preCapturePath, preGainDb, preEnabled, onRigPresetsChange]
  )
  const deleteRigPreset = useCallback(
    (id: string) => onRigPresetsChange?.(rigPresets.filter((p) => p.id !== id)),
    [rigPresets, onRigPresetsChange]
  )

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
        setReverbIrChannels(engine.reverbIrChannelCount)
      } catch (error) {
        if (!cancelled) setLiveError(formatError(error))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [reverbPath, liveRunning, reverb.mode, decodeImpulse])

  useEffect(() => {
    const engine = liveEngineRef.current
    if (!engine || !liveRunning) return
    let cancelled = false
    void (async () => {
      try {
        const ir = delayIrPath && delay.mode === 'convolution' ? await decodeImpulse(delayIrPath) : null
        if (cancelled) return
        await engine.setDelayIr(ir)
        setDelayIrSeconds(engine.delayIrSecondsLoaded)
        setDelayIrChannels(engine.delayIrChannelCount)
      } catch (error) {
        if (!cancelled) setLiveError(formatError(error))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [delayIrPath, liveRunning, delay.mode, decodeImpulse])

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

  // Picking/clearing the pedal capture, or toggling it on/off, changes what the second worklet is
  // loaded with, which needs a fresh engine.start() rather than a live message — a restart, same
  // cost as switching the main capture. Drive (preGainDb) is deliberately NOT a dependency here:
  // it ramps live via setPreGain below instead of restarting on every knob tick.
  useEffect(() => {
    if (liveRunning) void startLive()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preCapturePath, preEnabled])

  useEffect(() => {
    liveEngineRef.current?.setPreGain(Math.pow(10, preGainDb * 0.05))
  }, [preGainDb])

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

  /**
   * Switch which play group is driving prev/next without leaving the player — the whole point of
   * "pick 4 favorites and step through them back to back" without a trip to Group Administration
   * first. Native <select> reset to "" on every pick for the same reason FxPresetBar does: picking
   * the group that's already active would not otherwise fire onChange at all.
   */
  const groupControl = activeGroupName ? (
    <div className="flex-shrink-0 flex items-center gap-1 h-[22px] pl-2 pr-1 rounded-full bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900">
      <span className="text-[10px] font-medium text-indigo-600 dark:text-indigo-300 truncate max-w-[110px]" title={activeGroupName}>
        {activeGroupName}
      </span>
      {onExitGroup && (
        <button
          onClick={onExitGroup}
          title="Exit group — back to the full folder view"
          className="w-4 h-4 flex items-center justify-center rounded-full text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-200 hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-colors"
        >
          <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={3}>
            <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  ) : onLoadGroup && playGroups.length > 0 ? (
    <select
      value=""
      onChange={(e) => { if (e.target.value) onLoadGroup(e.target.value) }}
      title="Load a play group — drives prev/next until you exit it"
      className="flex-shrink-0 h-[22px] max-w-[110px] rounded border border-gray-200 dark:border-[var(--border)] bg-white dark:bg-[var(--field)] text-[10px] px-1 text-gray-500 dark:text-gray-400"
    >
      <option value="">Load group…</option>
      {playGroups.map((g) => (
        <option key={g.id} value={g.id}>{g.name}</option>
      ))}
    </select>
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
      {/* Rig presets snapshot all five blocks at once (including which are on) — sits above the
          grid because it isn't any one card's business. */}
      <div className="flex items-center gap-2 mb-3">
        <TapeLabel>Rig</TapeLabel>
        <div className="flex-1">
          <FxPresetBar
            presets={rigPresets.map((p) => ({ id: p.id, name: p.name, settings: p.settings }))}
            onApply={applyRigPreset}
            onSave={saveRigPreset}
            onDelete={deleteRigPreset}
          />
        </div>
      </div>

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
          label="Gate"
          enabled={gate.enabled}
          onToggle={(v) => setGateState((g) => ({ ...g, enabled: v }))}
          summary={gate.enabled ? `${gate.threshold.toFixed(0)}dB` : 'off'}
        >
          <div style={fxCardGrid}>
            <FxSlider compact={fxCompact} label="Threshold" value={gate.threshold} min={-100} max={0} step={1}
              format={(v) => `${v.toFixed(0)} dB`}
              onChange={(v) => setGateState((g) => ({ ...g, threshold: v }))} />
            <FxSlider compact={fxCompact} label="Hold" hint="ms" value={gate.holdTime * 1000} min={0} max={500} step={5}
              format={(v) => `${v.toFixed(0)} ms`}
              onChange={(v) => setGateState((g) => ({ ...g, holdTime: v / 1000 }))} />
            <FxSlider compact={fxCompact} label="Release" hint="ms" value={gate.closeTime * 1000} min={1} max={500} step={5}
              format={(v) => `${v.toFixed(0)} ms`}
              onChange={(v) => setGateState((g) => ({ ...g, closeTime: v / 1000 }))} />
          </div>
        </FxCard>

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
          label="Modulation"
          enabled={chorus.enabled}
          onToggle={(v) => setChorusState((c) => ({ ...c, enabled: v }))}
          summary={
            chorus.enabled
              ? chorus.type === 'chorus'
                ? `${Math.round(chorus.mix * 100)}%`
                : `${Math.round(chorus.tremoloDepth * 100)}%`
              : 'off'
          }
          header={
            <div className="flex items-center gap-1.5">
              <div className="flex rounded-md bg-gray-100 dark:bg-[var(--field)] border border-gray-200 dark:border-[var(--border)] p-0.5">
                {([['chorus', 'Chorus'], ['tremolo', 'Tremolo']] as const).map(([type, typeLabel]) => (
                  <button
                    key={type}
                    onClick={() => setChorusState((c) => ({ ...c, type }))}
                    className={`h-[22px] px-2 rounded text-[11px] font-medium transition-colors ${
                      chorus.type === type
                        ? 'bg-white dark:bg-[#232c36] text-gray-900 dark:text-gray-100 shadow-sm'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                    }`}
                  >
                    {typeLabel}
                  </button>
                ))}
              </div>
              {chorus.type === 'tremolo' && (
                <button
                  onClick={() => setChorusState((c) => ({ ...c, harmonic: !c.harmonic }))}
                  className={`h-[22px] px-2.5 rounded text-[11px] font-medium border transition-colors ${
                    chorus.harmonic
                      ? 'bg-[var(--active)] border-[var(--accent)] text-gray-900 dark:text-gray-100'
                      : 'border-gray-200 dark:border-[var(--border)] text-gray-500 dark:text-gray-400'
                  }`}
                  title={chorus.harmonic
                    ? 'Harmonic: low and high bands swell and dip in opposition (silverface Fender vibrato channel)'
                    : 'Standard: the whole signal’s level moves together'}
                >
                  Harmonic
                </button>
              )}
            </div>
          }
        >
          <FxPresetBar
            presets={chorusPresets}
            onApply={applyChorusPreset}
            onSave={saveChorusPreset}
            onDelete={deleteChorusPreset}
          />
          {chorus.type === 'chorus' ? (
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
              {/* Chorus-only, and the chain's mono-to-stereo conversion point — at 0 the two
                  swept voices average into both sides, at 1 each keeps its own. Tremolo has no
                  equivalent, so it does not appear in that mode. */}
              <FxSlider compact={fxCompact} label="Width" hint="stereo spread" value={chorus.width} min={0} max={1} step={0.01}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => setChorusState((c) => ({ ...c, width: v }))} />
            </div>
          ) : (
            <div style={fxCardGrid}>
              {/* No Mix here on purpose — a real Fender tremolo has no wet/dry knob either,
                  just Speed and Intensity; `enabled` fully engages the circuit. */}
              <FxSlider compact={fxCompact} label="Depth" value={chorus.tremoloDepth} min={0} max={1} step={0.01}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => setChorusState((c) => ({ ...c, tremoloDepth: v }))} />
              <FxSlider compact={fxCompact} label="Rate" value={chorus.rateHz} min={0.05} max={6} step={0.05}
                format={(v) => `${v.toFixed(2)} Hz`}
                onChange={(v) => setChorusState((c) => ({ ...c, rateHz: v }))} />
            </div>
          )}
        </FxCard>

        <FxCard
          label="Delay"
          enabled={delay.enabled}
          onToggle={(v) => setDelayState((d) => ({ ...d, enabled: v }))}
          summary={delay.enabled ? `${Math.round(delay.mix * 100)}% \u00b7 ${Math.round(delay.timeMs)}ms` : 'off'}
          header={
            <div className="flex items-center gap-1.5">
              <div className="flex rounded-md bg-gray-100 dark:bg-[var(--field)] border border-gray-200 dark:border-[var(--border)] p-0.5">
                {([['algorithmic', 'Algorithmic'], ['convolution', 'Convolution']] as const).map(([mode, modeLabel]) => (
                  <button
                    key={mode}
                    onClick={() => setDelayState((d) => ({ ...d, mode }))}
                    className={`h-[22px] px-2 rounded text-[11px] font-medium transition-colors ${
                      delay.mode === mode
                        ? 'bg-white dark:bg-[#232c36] text-gray-900 dark:text-gray-100 shadow-sm'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                    }`}
                  >
                    {modeLabel}
                  </button>
                ))}
              </div>
              {delay.mode === 'algorithmic' && (
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
              )}
              {/* Independent of ping-pong: a continuous sweep instead of a discrete alternation,
                  and it works on either delay mode since it sits after both wet paths merge. */}
              <button
                onClick={() => setDelayState((d) => ({ ...d, panEnabled: !d.panEnabled }))}
                className={`h-[22px] px-2.5 rounded text-[11px] font-medium border transition-colors ${
                  delay.panEnabled
                    ? 'bg-[var(--active)] border-[var(--accent)] text-gray-900 dark:text-gray-100'
                    : 'border-gray-200 dark:border-[var(--border)] text-gray-500 dark:text-gray-400'
                }`}
                title={delay.panEnabled
                  ? 'Auto-pan: repeats sweep continuously left to right'
                  : 'Auto-pan off: repeats stay where the delay mode puts them'}
              >
                Pan
              </button>
            </div>
          }
        >
          <FxPresetBar
            presets={delayPresets}
            onApply={applyDelayPreset}
            onSave={saveDelayPreset}
            onDelete={deleteDelayPreset}
          />
          {delay.mode === 'algorithmic' ? (
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
              {delay.panEnabled && (
                <FxSlider compact={fxCompact} label="Pan speed" value={delay.panRateHz} min={MIN_PAN_RATE_HZ} max={MAX_PAN_RATE_HZ} step={0.05}
                  format={(v) => `${v.toFixed(2)} Hz`}
                  onChange={(v) => setDelayState((d) => ({ ...d, panRateHz: v }))} />
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              <div style={fxCardGrid}>
                {/* Mix is the ONLY control here, and that is the nature of the thing: a delay
                    impulse has its time and its feedback baked in. */}
                <FxSlider compact={fxCompact} label="Mix" value={delay.mix} min={0} max={1} step={0.01}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => setDelayState((d) => ({ ...d, mix: v }))} />
                {delay.panEnabled && (
                  <FxSlider compact={fxCompact} label="Pan speed" value={delay.panRateHz} min={MIN_PAN_RATE_HZ} max={MAX_PAN_RATE_HZ} step={0.05}
                    format={(v) => `${v.toFixed(2)} Hz`}
                    onChange={(v) => setDelayState((d) => ({ ...d, panRateHz: v }))} />
                )}
              </div>
                <>
                  <IrPicker
                    libraryPath={delayLibraryPath ?? ''}
                    value={delayIrPath}
                    allowNone
                    favoritesKind="delay"
                    placeholder={`Choose from ${delayIrCount.toLocaleString()} delay impulses\u2026`}
                    onChange={(ref) => {
                      setDelayIrPath(ref.path)
                      try {
                        localStorage.setItem(DELAY_IR_PREF_KEY, ref.path)
                      } catch {
                        // Non-fatal.
                      }
                    }}
                    onClear={() => {
                      setDelayIrPath(null)
                      try {
                        localStorage.removeItem(DELAY_IR_PREF_KEY)
                      } catch {
                        // Non-fatal.
                      }
                    }}
                  />
                  {delayIrSeconds > 0 && (
                    <p className="text-[10px] text-gray-400 dark:text-gray-600">
                      {delayIrSeconds.toFixed(2)}s of repeats &middot; {describeIrChannels(delayIrChannels)}
                    </p>
                  )}
                  <p className="text-[10px] text-gray-400 dark:text-gray-600 leading-relaxed">
                    Time and feedback are part of the impulse, so each one is a preset. Patches that
                    shift pitch or modulate cannot be convolved &mdash; use Algorithmic for those.
                  </p>
                </>
            </div>
          )}
        </FxCard>
      </div>

      {/* Echo Lab — full width, same footing as Reverb below it: this has the most controls of
          any block here (Single/Dual topology, three Characters, Ducking), so it needs the room.
          Shares no state with the orange Delay above other than the series-routing order the rack
          view's toggle also controls; both are independent FX blocks in this simple view, not a
          view-swap like the rack panel. */}
      <div className="mt-3">
        <FxCard
          label="Echo Lab"
          enabled={echoLab.enabled}
          onToggle={(v) => setEchoLabState((e) => ({ ...e, enabled: v }))}
          summary={echoLab.enabled ? `${Math.round(echoLab.mix * 100)}% · ${echoLab.character}` : 'off'}
          header={
            <div className="flex items-center gap-1.5 flex-wrap">
              <div className="flex rounded-md bg-gray-100 dark:bg-[var(--field)] border border-gray-200 dark:border-[var(--border)] p-0.5">
                {(['single', 'dual'] as const).map((topology) => (
                  <button
                    key={topology}
                    onClick={() => setEchoLabState((e) => ({ ...e, topology }))}
                    className={`h-[22px] px-2 rounded text-[11px] font-medium capitalize transition-colors ${
                      echoLab.topology === topology
                        ? 'bg-white dark:bg-[#232c36] text-gray-900 dark:text-gray-100 shadow-sm'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                    }`}
                  >
                    {topology}
                  </button>
                ))}
              </div>
              <div className="flex rounded-md bg-gray-100 dark:bg-[var(--field)] border border-gray-200 dark:border-[var(--border)] p-0.5">
                {([['digital', 'Digital'], ['tape', 'Tape'], ['memoryman', 'Memory Man']] as const).map(([character, characterLabel]) => (
                  <button
                    key={character}
                    onClick={() => setEchoLabState((e) => ({ ...e, character, char1: DEFAULT_CHAR1[character], char2: DEFAULT_CHAR2[character] }))}
                    className={`h-[22px] px-2 rounded text-[11px] font-medium transition-colors ${
                      echoLab.character === character
                        ? 'bg-white dark:bg-[#232c36] text-gray-900 dark:text-gray-100 shadow-sm'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                    }`}
                  >
                    {characterLabel}
                  </button>
                ))}
              </div>
            </div>
          }
        >
          <FxPresetBar
            presets={echoLabPresets}
            onApply={applyEchoLabPreset}
            onSave={saveEchoLabPreset}
            onDelete={deleteEchoLabPreset}
          />
          <div style={fxCardGrid}>
            <FxSlider compact={fxCompact} label="Mix" value={echoLab.mix} min={0} max={1} step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => setEchoLabState((e) => ({ ...e, mix: v }))} />
            <FxSlider compact={fxCompact} label={echoLab.topology === 'single' ? 'Time' : 'L Delay'}
              value={echoLab.topology === 'single' ? echoLab.timeMs : echoLab.leftTimeMs} min={20} max={1200} step={5}
              format={(v) => `${Math.round(v)} ms`}
              onChange={(v) => setEchoLabState((e) => (e.topology === 'single' ? { ...e, timeMs: v } : { ...e, leftTimeMs: v }))} />
            <FxSlider compact={fxCompact} label={echoLab.topology === 'single' ? 'Feedback' : 'L Feedback'}
              value={echoLab.topology === 'single' ? echoLab.feedback : echoLab.leftFeedback} min={0} max={MAX_FEEDBACK} step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => setEchoLabState((e) => (e.topology === 'single' ? { ...e, feedback: v } : { ...e, leftFeedback: v }))} />
            {echoLab.topology === 'dual' && (
              <>
                <FxSlider compact={fxCompact} label="R Delay" value={echoLab.rightTimeMs} min={20} max={1200} step={5}
                  format={(v) => `${Math.round(v)} ms`}
                  onChange={(v) => setEchoLabState((e) => ({ ...e, rightTimeMs: v }))} />
                <FxSlider compact={fxCompact} label="R Feedback" value={echoLab.rightFeedback} min={0} max={MAX_FEEDBACK} step={0.01}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(v) => setEchoLabState((e) => ({ ...e, rightFeedback: v }))} />
              </>
            )}
            {/* Ping Pong (Single) and Spread (Dual) share the same physical role Echo Lab's Row 1
                slot 6 knob plays on the rack panel — only one is ever relevant at a time. Plain
                linear, matching the rack knob (a squared taper was tried and reverted). */}
            {echoLab.topology === 'single' ? (
              <FxSlider compact={fxCompact} label="Ping Pong" hint="0 mono, 1 full alternation" value={echoLab.pingPongWidth} min={0} max={1} step={0.01}
                format={pingPongFormat}
                onChange={(v) => setEchoLabState((e) => ({ ...e, pingPongWidth: v }))} />
            ) : (
              <FxSlider compact={fxCompact} label="Spread" value={echoLab.spread} min={0} max={1} step={0.01}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => setEchoLabState((e) => ({ ...e, spread: v }))} />
            )}
            <FxSlider compact={fxCompact} label={CHAR1_RANGE[echoLab.character].label} value={echoLab.char1}
              min={CHAR1_RANGE[echoLab.character].min} max={CHAR1_RANGE[echoLab.character].max} step={(CHAR1_RANGE[echoLab.character].max - CHAR1_RANGE[echoLab.character].min) / 200}
              format={CHAR1_RANGE[echoLab.character].format}
              onChange={(v) => setEchoLabState((e) => ({ ...e, char1: v }))} />
            {echoLab.character !== 'digital' && (
              <FxSlider compact={fxCompact} label={CHAR2_RANGE[echoLab.character].label} value={echoLab.char2}
                min={CHAR2_RANGE[echoLab.character].min} max={CHAR2_RANGE[echoLab.character].max} step={(CHAR2_RANGE[echoLab.character].max - CHAR2_RANGE[echoLab.character].min) / 200}
                format={CHAR2_RANGE[echoLab.character].format}
                onChange={(v) => setEchoLabState((e) => ({ ...e, char2: v }))} />
            )}
            <FxSlider compact={fxCompact} label="Color/Drive" value={echoLab.colorDrive} min={0} max={1} step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => setEchoLabState((e) => ({ ...e, colorDrive: v }))} />
            <FxSlider compact={fxCompact} label="Width" value={echoLab.width} min={0} max={1} step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => setEchoLabState((e) => ({ ...e, width: v }))} />
            <FxSlider compact={fxCompact} label="EQ Low" value={echoLab.eqLowDb} min={-REVERB_EQ_MAX_DB} max={REVERB_EQ_MAX_DB} step={0.5}
              format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`}
              onChange={(v) => setEchoLabState((e) => ({ ...e, eqLowDb: v }))} />
            <FxSlider compact={fxCompact} label="EQ High" value={echoLab.eqHighDb} min={-REVERB_EQ_MAX_DB} max={REVERB_EQ_MAX_DB} step={0.5}
              format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`}
              onChange={(v) => setEchoLabState((e) => ({ ...e, eqHighDb: v }))} />
            {echoLab.character !== 'digital' && (
              <FxSlider compact={fxCompact} label="Mod Rate" value={echoLab.modRateHz} min={MIN_PAN_RATE_HZ} max={MAX_PAN_RATE_HZ} step={0.05}
                format={(v) => `${v.toFixed(2)} Hz`}
                onChange={(v) => setEchoLabState((e) => ({ ...e, modRateHz: v }))} />
            )}
          </div>

          <div className="mt-2.5 flex items-center gap-1.5">
            <button
              onClick={() => setEchoLabState((e) => ({ ...e, panEnabled: !e.panEnabled }))}
              className={`h-[22px] px-2.5 rounded text-[11px] font-medium border transition-colors ${
                echoLab.panEnabled
                  ? 'bg-[var(--active)] border-[var(--accent)] text-gray-900 dark:text-gray-100'
                  : 'border-gray-200 dark:border-[var(--border)] text-gray-500 dark:text-gray-400'
              }`}
              title={echoLab.panEnabled ? 'Auto-pan: repeats sweep continuously left to right' : 'Auto-pan off'}
            >
              Pan
            </button>
            <button
              onClick={() => setEchoLabState((e) => ({ ...e, duckEnabled: !e.duckEnabled }))}
              className={`h-[22px] px-2.5 rounded text-[11px] font-medium border transition-colors ${
                echoLab.duckEnabled
                  ? 'bg-[var(--active)] border-[var(--accent)] text-gray-900 dark:text-gray-100'
                  : 'border-gray-200 dark:border-[var(--border)] text-gray-500 dark:text-gray-400'
              }`}
              title={echoLab.duckEnabled ? 'Ducking: repeats duck under playing, swell back in the gaps' : 'Ducking off'}
            >
              Duck
            </button>
            {delay.enabled && (
              <button
                onClick={() => setEchoLabState((e) => ({ ...e, secondaryDelayPosition: e.secondaryDelayPosition === 'before' ? 'after' : 'before' }))}
                className="h-[22px] px-2.5 rounded text-[11px] font-medium border border-gray-200 dark:border-[var(--border)] text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-[var(--hover)] transition-colors"
                title="Toggle whether the orange Delay's signal feeds into Echo Lab, or Echo Lab feeds into Delay"
              >
                {echoLab.secondaryDelayPosition === 'before' ? 'Delay → Echo Lab' : 'Echo Lab → Delay'}
              </button>
            )}
          </div>
          {(echoLab.panEnabled || echoLab.duckEnabled) && (
            <div style={fxCardGrid} className="mt-2">
              {echoLab.panEnabled && (
                <FxSlider compact={fxCompact} label="Pan Speed" value={echoLab.panRateHz} min={MIN_PAN_RATE_HZ} max={MAX_PAN_RATE_HZ} step={0.05}
                  format={(v) => `${v.toFixed(2)} Hz`}
                  onChange={(v) => setEchoLabState((e) => ({ ...e, panRateHz: v }))} />
              )}
              {echoLab.duckEnabled && (
                <>
                  <FxSlider compact={fxCompact} label="Duck Depth" value={echoLab.duckDepth} min={0} max={1} step={0.01}
                    format={(v) => `${Math.round(v * 100)}%`}
                    onChange={(v) => setEchoLabState((e) => ({ ...e, duckDepth: v }))} />
                  <FxSlider compact={fxCompact} label="Duck Release" value={echoLab.duckReleaseMs} min={50} max={1000} step={10}
                    format={(v) => `${Math.round(v)} ms`}
                    onChange={(v) => setEchoLabState((e) => ({ ...e, duckReleaseMs: v }))} />
                </>
              )}
            </div>
          )}
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
          <FxPresetBar
            presets={reverbPresets}
            onApply={applyReverbPreset}
            onSave={saveReverbPreset}
            onDelete={deleteReverbPreset}
          />
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
                <>
                  <IrPicker
                    libraryPath={reverbLibraryPath ?? ''}
                    value={reverbPath}
                    allowNone
                    favoritesKind="reverb"
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
                      {reverbSeconds.toFixed(1)}s tail &middot; {describeIrChannels(reverbIrChannels)}
                    </p>
                  )}
                  <p className="text-[10px] text-gray-400 dark:text-gray-600 leading-relaxed">
                    Convolution reproduces real rooms exactly, and cannot reproduce anything that
                    shifts pitch or reacts to playing &mdash; shimmer, bloom and swell smear rather
                    than shimmer. Use Plate for those.
                  </p>
                </>
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
      {/* The picker renders whether or not a library is configured: Browse lives inside it, and
          "no library set" is exactly when reaching for a single file matters most. */}
      {irEnabled && (
        <>
          <IrPicker
            libraryPath={irLibraryPath ?? ''}
            value={irPath}
            disabled={busy}
            favoritesKind="cab"
            onChange={(ref) => { setIrPath(ref.path); lastIrPath = ref.path; saveIrPath(ref.path) }}
          />
          {!irPath && (
            <p className="text-[10.5px] text-amber-500 mt-1.5 leading-relaxed">
              {irCount === 0
                ? (needsCabIr
                    ? `This capture has no cabinet (${GEAR_LABELS[m.gear_type as string] ?? m.gear_type}), so it will sound harsh without one. Set an IR Library folder in Settings, or Browse for a single file.`
                    : 'Set an IR Library folder in Settings, or Browse for a single file.')
                : `No cabinet chosen yet \u2014 search the ${irCount.toLocaleString()} IRs in your library, or star the ones you use.`}
            </p>
          )}
        </>
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

  /**
   * ── Redesigned full-screen Live rig (design_handoff_player_redesign).
   *
   * Three stacked wells: identity band, rack wall, master dock. Every surface, border and text
   * colour is a theme token so it recolours across dark / midnight / blue / charcoal / light.
   * The only intentionally theme-independent things are the physical hardware — panel art,
   * knobs, LEDs, LCD, record sign, meter gradient — which are photographs of objects and should
   * not follow a UI theme.
   *
   * Readability rule from the handoff: no label below 10px, and nothing dimmer than --text-2.
   */
  const wellStyle: React.CSSProperties = {
    background: 'var(--panel)',
    border: '1px solid var(--border-soft)',
    borderRadius: 14,
    padding: 16
  }
  const monoLabel: React.CSSProperties = {
    font: "600 10px 'IBM Plex Mono', monospace",
    letterSpacing: '.13em',
    color: 'var(--text-2)',
    textTransform: 'uppercase'
  }

  // Outline-tinted rather than solid-filled: a colored border+text on the existing neutral chip
  // background reads clearly in both light and dark theme without needing a separate contrast
  // check per color (a silver chip with white text would vanish in light mode; an orange one
  // would need dark text — outline sidesteps all of that). Sampled from each unit's own panel
  // art where one exists; EQ/Gate/Mod share one physical strip with no distinct per-module
  // chassis color, so those three are assigned rather than sampled.
  const CHAIN_UNIT_COLORS: Record<string, string> = {
    'EQ': '#4a90c4',
    'GATE': '#9163d1',
    'MOD': '#9a9a92',
    'DELAY': '#d97b3f',
    'ECHO LAB': '#7a7a4f',
    'REVERB': '#3b7ec9'
  }

  const chainChip = (text: string, kind: 'normal' | 'active' | 'optional' = 'normal'): React.ReactNode => {
    const unitColor = kind === 'normal' ? CHAIN_UNIT_COLORS[text] : undefined
    return (
    <span
      key={text}
      style={{
        height: 40,
        display: 'inline-flex',
        alignItems: 'center',
        padding: '0 12px',
        borderRadius: 8,
        whiteSpace: 'nowrap',
        font: "600 10.5px 'IBM Plex Mono', monospace",
        letterSpacing: '.08em',
        background: kind === 'active' ? RIG_GOLD : 'var(--field)',
        border: kind === 'optional' ? '1px dashed #2e7d54' : `1px solid ${kind === 'active' ? RIG_GOLD : unitColor ?? 'var(--field-border)'}`,
        color: kind === 'active' ? '#2a1e08' : kind === 'optional' ? '#4fbf87' : unitColor ?? 'var(--text-2)'
      }}
    >
      {text}
    </span>
    )
  }

  // The reserved "+ PEDAL CAPTURE" slot, now a real control: search the library (or fall back to
  // an OS file dialog for a capture not yet loaded) to chain a second capture ahead of this one —
  // pedal into amp, the way people cascade two NAM/Gateway plugin instances. Untested territory
  // sonically, see the TODO note on this feature, so it starts completely out of the way and only
  // grows a Drive knob in the master dock once something is actually loaded.
  const pedalOptions = useMemo(
    () =>
      libraryFiles.map((f) => ({
        filePath: f.filePath,
        label: f.metadata.name || f.fileName,
        sublabel: [f.metadata.gear_make, f.metadata.gear_model].filter(Boolean).join(' ') || undefined
      })),
    [libraryFiles]
  )
  const pedalChip = (
    <CapturePicker
      key="pedal-chip"
      options={pedalOptions}
      activePath={preCapturePath}
      placeholder="+ PEDAL CAPTURE"
      onPick={pickPedalCaptureFromLibrary}
      onBrowse={browsePedalCapture}
      favoritesKind="pedal-capture"
      renderTrigger={({ onClick: openPicker }) =>
        preCapturePath ? (
          // The pill itself toggles on/off — matches Gate/EQ/Mod/Delay/Reverb's own convention,
          // and is what lets you A/B the pedal stage without losing the pick. Changing WHICH
          // capture is loaded, or removing it, are deliberately smaller side actions so a stray
          // click doesn't accidentally lose your choice while you're just trying to bypass it.
          <button
            onClick={() => setPreEnabled((v) => !v)}
            title={preEnabled ? `${preCaptureName} — click to bypass` : `${preCaptureName} — bypassed, click to re-engage`}
            style={{
              height: 40, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 6px 0 12px',
              borderRadius: 8, whiteSpace: 'nowrap', cursor: 'pointer', transition: 'background .12s, border-color .12s, color .12s',
              border: `1px solid ${preEnabled ? RIG_GOLD : 'var(--field-border)'}`,
              background: preEnabled ? RIG_GOLD : 'var(--field)',
              color: preEnabled ? '#2a1e08' : 'var(--text-2)',
              font: "600 10.5px 'IBM Plex Mono', monospace", letterSpacing: '.08em'
            }}
          >
            <span style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: preEnabled ? 'none' : 'line-through', opacity: preEnabled ? 1 : 0.7 }}>
              {preCaptureName}
            </span>
            <span
              role="button"
              onClick={(e) => { e.stopPropagation(); openPicker() }}
              title="Change the pedal capture"
              style={{ width: 18, height: 18, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, background: preEnabled ? 'rgba(0,0,0,.15)' : 'var(--raised)' }}
            >
              ✎
            </span>
            <span
              role="button"
              onClick={(e) => { e.stopPropagation(); clearPedalCapture() }}
              title="Remove the pedal capture"
              style={{ width: 18, height: 18, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: preEnabled ? 'rgba(0,0,0,.15)' : 'var(--raised)' }}
            >
              ×
            </span>
          </button>
        ) : (
          <button
            onClick={openPicker}
            title="Chain a pedal capture ahead of this amp capture"
            style={{
              height: 40, display: 'inline-flex', alignItems: 'center', padding: '0 12px', borderRadius: 8,
              whiteSpace: 'nowrap', cursor: 'pointer', font: "600 10.5px 'IBM Plex Mono', monospace", letterSpacing: '.08em',
              background: 'var(--field)', border: '1px dashed #2e7d54', color: '#4fbf87'
            }}
          >
            + PEDAL CAPTURE
          </button>
        )
      }
    />
  )

  const rigView = (
    <div className="flex flex-col gap-3.5" style={{ padding: '0 9px 12px' }}>
      {/* ── A. Identity band */}
      <div style={{ ...wellStyle, flex: 'none', display: 'flex', gap: 14, alignItems: 'stretch', flexWrap: 'wrap' }}>
        {/* Pedal cover, LEFT of the amp — only once a pedal capture is both picked AND has a
            resolvable ampcover.* next to it (a raw-browsed file with no library metadata often
            won't). No placeholder shown for "picked but no cover": an empty box here would read
            as a loading/broken state rather than "this one just has no picture." Smaller than the
            amp box on purpose — the amp stays the visual lead, this is a secondary identity. */}
        {preCapturePath && preCaptureCoverSrc && (
          <div style={{ width: 160, flex: 'none', borderRadius: 11, border: `1px solid ${RIG_GOLD}`, background: 'var(--field)', overflow: 'hidden', minHeight: 150, maxHeight: 210, display: 'flex' }}>
            <img src={preCaptureCoverSrc} alt="Pedal capture" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
          </div>
        )}
        {/* Amp image, hard left. object-fit:contain so the whole amp is visible — cover was
            silently cropping the top and bottom off every photo. */}
        <div style={{ width: 372, flex: 'none', borderRadius: 11, border: '1px solid var(--border)', background: 'var(--field)', overflow: 'hidden', minHeight: 150, maxHeight: 210, display: 'flex' }}>
          <img src={coverSrc} alt="Amp" onError={onCoverError} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
        </div>

        {/* Centre: title, metadata grid, signal chain */}
        <div style={{ flex: 1, minWidth: 360, display: 'flex', flexDirection: 'column', gap: 13 }}>
          <div className="flex items-center gap-2.5 flex-wrap">
            <span style={{ font: "600 22px 'IBM Plex Sans', sans-serif", color: 'var(--text)' }}>{captureLabel}</span>
            {m.tone_type && (
              <span className={`nam-chip ${namToneChipClass(m.tone_type)}`}><span className="nam-dot" />{TONE_LABELS[m.tone_type] ?? m.tone_type}</span>
            )}
            {stepper}
          </div>
          {summaryRows.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '14px 18px' }}>
              {summaryRows.map((row) => (
                <div key={row.label} style={{ minWidth: 0 }}>
                  <div style={monoLabel}>{row.label}</div>
                  <div
                    className={row.tone}
                    style={{ font: "500 12.5px 'IBM Plex Sans', sans-serif", color: row.tone ? undefined : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={row.value}
                  >
                    {row.value}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Reflects what is actually in the signal path, not a fixed diagram — each FX block
                and Cab IR appear only while their own bypass is off, so the rail always shows
                what you'd actually hear right now, not what could theoretically be turned on. */}
            {[
              chainChip('DI IN'),
              pedalChip,
              chainChip('AMP CAPTURE', 'active'),
              irEnabled && chainChip('CAB IR'),
              effectiveEq.enabled && chainChip('EQ'),
              effectiveGate.enabled && chainChip('GATE'),
              effectiveChorus.enabled && chainChip('MOD'),
              // Order in the rail follows actual signal flow: Echo Lab's own secondaryDelayPosition
              // decides whether the orange Delay's wet feeds INTO Echo Lab or comes AFTER it. Shows
              // regardless of which panel (delaySlotView) is currently drawn below — the rail
              // reflects what's in the signal path, not what's on screen.
              echoLab.enabled && delay.enabled && echoLab.secondaryDelayPosition === 'before' && chainChip('DELAY'),
              echoLab.enabled && chainChip('ECHO LAB'),
              echoLab.enabled && delay.enabled && echoLab.secondaryDelayPosition === 'after' && chainChip('DELAY'),
              !echoLab.enabled && delay.enabled && chainChip('DELAY'),
              reverb.enabled && chainChip('REVERB'),
              chainChip('OUT')
            ]
              .filter((chip): chip is React.ReactNode => Boolean(chip))
              .map((chip, i) => (
                <Fragment key={i}>
                  {i > 0 && <span style={{ color: 'var(--text-3)' }}>→</span>}
                  {chip}
                </Fragment>
              ))}
          </div>
        </div>

        {/* Record light, hard right. Fixed aspect so the sign can never distort as the box resizes — that
            distortion was the complaint, and it came from re-rendering TEXT into a flexible box.
            Swapping in a real sign image later is a one-line change to the inner element. */}
        <div style={{ width: 244, flex: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            onClick={() => (liveRunning ? void stopLive() : void startLive())}
            disabled={liveStarting}
            title={liveRunning ? 'Stop live input' : 'Start live input'}
            className="transition-transform active:scale-[.99] disabled:opacity-70"
            style={{
              padding: 9,
              borderRadius: 10,
              border: 'none',
              cursor: 'pointer',
              background: 'linear-gradient(180deg,#4a3320,#2c1d10)',
              boxShadow: liveRunning ? '0 0 40px 6px rgba(255,72,48,.42)' : '0 10px 26px rgba(0,0,0,.45)',
              transition: 'box-shadow .25s'
            }}
          >
            <div
              style={{
                aspectRatio: '2.05 / 1',
                borderRadius: 5,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                background: liveRunning ? 'linear-gradient(180deg,#fbefc7,#f2db9a)' : 'linear-gradient(180deg,#4a4436,#3a3428)',
                boxShadow: liveRunning ? 'inset 0 0 34px rgba(255,185,125,.45)' : 'inset 0 0 20px rgba(0,0,0,.4)',
                transition: 'background .25s, box-shadow .25s'
              }}
            >
              <div style={{ font: "700 30px/0.92 'Barlow Semi Condensed', sans-serif", textTransform: 'uppercase', color: liveRunning ? '#d8352a' : '#6b5a3e' }}>
                Recording
              </div>
              <div style={{ height: 2, width: '58%', background: liveRunning ? '#d8352a' : '#6b5a3e' }} />
              <div style={{ font: "700 12px 'Barlow Semi Condensed', sans-serif", letterSpacing: '.12em', textTransform: 'uppercase', color: liveRunning ? '#4a3a1e' : '#5a4f3a' }}>
                {liveStarting ? 'Starting…' : liveRunning ? 'On Air' : 'Studio in Use'}
              </div>
            </div>
          </button>
          <div style={{ textAlign: 'center', font: "500 10.5px 'IBM Plex Sans', sans-serif", color: 'var(--text-2)' }}>
            {liveRunning ? 'Monitoring live — tap to stop' : 'Tap the sign to play through this capture'}
          </div>
        </div>
      </div>

      {/* ── C. Rig preset bar */}
      <div style={{ ...wellStyle, flex: 'none', padding: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ ...monoLabel, color: RIG_GOLD, letterSpacing: '.14em' }}>Rig Preset</span>
        <PresetMenu
          options={rigPresets.map((r) => ({ id: r.id, name: r.name }))}
          activeId={activeRigPresetId}
          placeholder="No rig loaded"
          searchable
          width={420}
          onRecall={(id) => {
            const found = rigPresets.find((r) => r.id === id)
            if (found) applyRigPreset(found.settings)
          }}
          onSaveAs={() => setSaveAsPrompt({ title: 'Save current rig as…', onSave: saveRigPreset })}
          onUpdate={(id) => { const found = rigPresets.find((p) => p.id === id); if (found) saveRigPreset(found.name) }}
          onDelete={deleteRigPreset}
          favoritesKind="rig-preset"
        />
        <span style={{ font: "500 10.5px 'IBM Plex Sans', sans-serif", color: 'var(--text-2)' }}>
          Recalls every panel at once — EQ · gate · mod · delay · reverb
        </span>
      </div>

      {/* ── D. Rack wall
           Column widths are 1.5 : 1 (500-strip : delay/reverb), matching the original design
           handoff, not an even 50/50 split. The 500 unit's aspect ratio (~2.3) is much less wide
           relative to its height than Delay/Reverb's (~4), so an even split would leave it
           visibly shorter than its neighbour; the wider share is what makes the two sides land at
           roughly the same height once each fills its column via width:100% (see RackCrop). This
           well is NOT flex:1 — it takes its natural, content-driven height like every other well
           in the rig, exactly like the design handoff. If that runs taller than the window, the
           rig scrolls a little, which is the correct fallback, not something to engineer around. */}
      <div style={{ ...wellStyle, display: 'flex', gap: 14, alignItems: 'stretch' }}>
        <div style={{ flex: '1.5 1 0', minWidth: 0, display: 'flex' }}>
          <RackColumn
            header={
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span style={{ ...monoLabel, color: 'var(--text-2)' }}>EQ · Gate · Modulation</span>
            <PresetMenu
              label="Mod Preset"
              options={chorusPresets.map((c) => ({ id: c.id, name: c.name }))}
              activeId={activeChorusPresetId}
              placeholder="No preset"
              width={220}
              onRecall={(id) => {
                const found = chorusPresets.find((c) => c.id === id)
                if (found) applyChorusPreset(found.settings)
              }}
              onSaveAs={() => setSaveAsPrompt({ title: 'Save modulation preset as…', onSave: saveChorusPreset })}
              onUpdate={(id) => { const found = chorusPresets.find((p) => p.id === id); if (found) saveChorusPreset(found.name) }}
              onDelete={deleteChorusPreset}
              favoritesKind="chorus-preset"
            />
          </div>
            }
            panel={
            <RackCrop metal={RACK_CROP.rack500}>
              <Rack500
                gate={gate}
                eq={eq}
                chorus={chorus}
                onGate={(patch) => setGateState((g) => ({ ...g, ...patch }))}
                onEq={(patch) => setEqState((e) => ({ ...e, ...patch }))}
                onChorus={(patch) => setChorusState((c) => ({ ...c, ...patch }))}
                power={fxPower}
                onTogglePower={() => setFxPower((v) => !v)}
              />
            </RackCrop>
            }
          />
        </div>

        <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Delay / Echo Lab — share one rack slot. Both keep processing audio regardless of
              which panel delaySlotView picks; this is a view toggle, not a mode switch. */}
          <RackColumn
            header={
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span style={{ ...monoLabel }}>{delaySlotView === 'echo-lab' ? 'Echo Lab' : 'Delay'}</span>
                <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
                  {(['echo-lab', 'delay'] as const).map((v) => {
                    // Both units keep processing audio regardless of which panel is showing, so
                    // whichever one you're NOT looking at needs its on/off state visible some
                    // other way — otherwise a unit can sit enabled-but-hidden (or disabled-but-
                    // hidden) with no indication at all. A small dot on each toggle, independent
                    // of which one is currently selected/displayed.
                    const on = v === 'echo-lab' ? echoLab.enabled : delay.enabled
                    // Echo Lab isn't available in the shared slot while it's floating — its own
                    // toggle option is disabled rather than clickable-but-does-nothing.
                    const disabled = v === 'echo-lab' && echoLabFloating
                    return (
                    <button
                      key={v}
                      onClick={() => !disabled && setDelaySlotView(v)}
                      disabled={disabled}
                      title={disabled ? 'Echo Lab is currently floating — close its window to bring it back here' : `${v === 'echo-lab' ? 'Echo Lab' : 'Delay'} is currently ${on ? 'ON' : 'bypassed'}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        font: "600 10.5px 'IBM Plex Mono', monospace",
                        letterSpacing: '0.04em',
                        padding: '4px 9px',
                        border: 'none',
                        cursor: disabled ? 'default' : 'pointer',
                        opacity: disabled ? 0.4 : 1,
                        background: delaySlotView === v && !disabled ? 'var(--accent)' : 'var(--field)',
                        color: delaySlotView === v && !disabled ? '#fff' : 'var(--text-2)'
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          flexShrink: 0,
                          background: on ? '#ffae2e' : 'currentColor',
                          opacity: on ? 1 : 0.35,
                          boxShadow: on ? '0 0 4px 1px #ffae2e99' : 'none'
                        }}
                      />
                      {v === 'echo-lab' ? 'ECHO LAB' : 'DELAY'}
                    </button>
                    )
                  })}
                </div>
                {/* Float: a movable, non-blocking floating panel (see EchoLabFloatingWindow) —
                    not a modal, so Delay stays fully editable underneath/beside it at the same
                    time. Only offered from Echo Lab's own slot view; floating immediately frees
                    the shared slot for Delay, closing the floating window returns Echo Lab there. */}
                {delaySlotView === 'echo-lab' && !echoLabFloating && (
                  <button
                    onClick={() => {
                      setEchoLabFloating(true)
                      setDelaySlotView('delay')
                    }}
                    aria-label="Pop out Echo Lab into its own movable window"
                    title="Pop out into its own movable window"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 26,
                      height: 26,
                      font: "600 14px 'IBM Plex Mono', monospace",
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--field)',
                      color: 'var(--text-2)',
                      cursor: 'pointer'
                    }}
                  >
                    ⤢
                  </button>
                )}
                {/* Series order between Delay and Echo Lab when both are enabled — the chain rail
                    up top already reflects this, but until now nothing let you actually change
                    it. Belongs to neither unit's own panel art, so it lives here instead. */}
                {delay.enabled && echoLab.enabled && (
                  <button
                    onClick={() => setEchoLabState((e) => ({ ...e, secondaryDelayPosition: e.secondaryDelayPosition === 'before' ? 'after' : 'before' }))}
                    title="Toggle whether the orange Delay's signal feeds into Echo Lab, or Echo Lab feeds into Delay"
                    style={{
                      font: "600 10px 'IBM Plex Mono', monospace",
                      letterSpacing: '0.03em',
                      padding: '4px 8px',
                      borderRadius: 6,
                      border: '1px solid var(--border)',
                      background: 'var(--field)',
                      color: 'var(--text-2)',
                      cursor: 'pointer'
                    }}
                  >
                    {echoLab.secondaryDelayPosition === 'before' ? 'DELAY → ECHO LAB' : 'ECHO LAB → DELAY'}
                  </button>
                )}
              </div>
              {delaySlotView === 'delay' && (
              <PresetMenu
                label="Preset"
                options={delayPresets.map((d) => ({ id: d.id, name: d.name }))}
                activeId={activeDelayPresetId}
                placeholder="No preset"
                width={210}
                onRecall={(id) => {
                  const found = delayPresets.find((d) => d.id === id)
                  if (found) applyDelayPreset(found.settings, found.irPath)
                }}
                onSaveAs={() => setSaveAsPrompt({ title: 'Save delay preset as…', onSave: saveDelayPreset })}
                onUpdate={(id) => { const found = delayPresets.find((p) => p.id === id); if (found) saveDelayPreset(found.name) }}
                onDelete={deleteDelayPreset}
                favoritesKind="delay-preset"
              />
              )}
              {delaySlotView === 'echo-lab' && (
              <PresetMenu
                label="Preset"
                options={echoLabPresets.map((d) => ({ id: d.id, name: d.name }))}
                activeId={activeEchoLabPresetId}
                placeholder="No preset"
                width={210}
                onRecall={(id) => {
                  const found = echoLabPresets.find((d) => d.id === id)
                  if (found) applyEchoLabPreset(found.settings)
                }}
                onSaveAs={() => setSaveAsPrompt({ title: 'Save Echo Lab preset as…', onSave: saveEchoLabPreset })}
                onUpdate={(id) => { const found = echoLabPresets.find((p) => p.id === id); if (found) saveEchoLabPreset(found.name) }}
                onDelete={deleteEchoLabPreset}
                favoritesKind="echo-lab-preset"
              />
              )}
            </div>
            }
            panel={
              delaySlotView === 'delay' ? (
              <RackCrop metal={RACK_CROP.delay}>
                <RackDelay delay={delay} onChange={(patch) => setDelayState((d) => ({ ...d, ...patch }))} delayPresets={delayPresets}
                  irName={delayIrPath ? (delayIrPath.split(/[\\/]/).pop() ?? '').replace(/\.wav$/i, '') : null} irPath={delayIrPath} />
              </RackCrop>
              ) : (
                <RackEchoLab echoLab={echoLab} onChange={(patch) => setEchoLabState((e) => ({ ...e, ...patch }))} />
              )
            }
            footer={
            /* Dimmed unless the unit is in convolution — the IR is loaded either way, but it
               only affects what you hear in that mode, and the mode lives on the panel face. */
            <div className="flex items-center gap-2" style={{ opacity: delay.mode === 'convolution' ? 1 : 0.45, transition: 'opacity .15s' }}>
              <span style={{ ...monoLabel, flexShrink: 0 }}>Delay IR</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <IrPicker libraryPath={delayLibraryPath ?? ''} value={delayIrPath} allowNone favoritesKind="delay"
                  placeholder={`Choose from ${delayIrCount.toLocaleString()} delay impulses…`}
                  onChange={(ref) => { setDelayIrPath(ref.path); try { localStorage.setItem(DELAY_IR_PREF_KEY, ref.path) } catch { /* non-fatal */ } }}
                  onClear={() => { setDelayIrPath(null); try { localStorage.removeItem(DELAY_IR_PREF_KEY) } catch { /* non-fatal */ } }} />
              </div>
              {/* Steps within the folder the current impulse lives in — not the whole library —
                  same idea as flipping through one drawer of a cabinet rather than the whole rack. */}
              <button onClick={() => void cycleIr(delayIrPath, -1, (p) => { setDelayIrPath(p); try { localStorage.setItem(DELAY_IR_PREF_KEY, p) } catch { /* non-fatal */ } })}
                disabled={!delayIrPath} title="Previous impulse in this folder"
                style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 6, cursor: delayIrPath ? 'pointer' : 'default', background: 'var(--field)', border: '1px solid var(--field-border)', color: 'var(--text-2)', opacity: delayIrPath ? 1 : 0.4 }}>‹</button>
              <button onClick={() => void cycleIr(delayIrPath, 1, (p) => { setDelayIrPath(p); try { localStorage.setItem(DELAY_IR_PREF_KEY, p) } catch { /* non-fatal */ } })}
                disabled={!delayIrPath} title="Next impulse in this folder"
                style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 6, cursor: delayIrPath ? 'pointer' : 'default', background: 'var(--field)', border: '1px solid var(--field-border)', color: 'var(--text-2)', opacity: delayIrPath ? 1 : 0.4 }}>›</button>
            </div>
            }
          />

          {/* Reverb */}
          <RackColumn
            header={
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span style={{ ...monoLabel }}>Reverb</span>
              <PresetMenu
                label="Preset"
                options={reverbPresets.map((r) => ({ id: r.id, name: r.name }))}
                activeId={activeReverbPresetId}
                placeholder="No preset"
                width={210}
                onRecall={(id) => {
                  const found = reverbPresets.find((r) => r.id === id)
                  if (found) applyReverbPreset(found.settings, found.irPath)
                }}
                onSaveAs={() => setSaveAsPrompt({ title: 'Save reverb preset as…', onSave: saveReverbPreset })}
                onUpdate={(id) => { const found = reverbPresets.find((p) => p.id === id); if (found) saveReverbPreset(found.name) }}
                onDelete={deleteReverbPreset}
                favoritesKind="reverb-preset"
              />
            </div>
            }
            panel={
              <RackCrop metal={RACK_CROP.reverb}>
                <RackReverbTest reverb={reverb} onChange={(patch) => setReverbState((r) => ({ ...r, ...patch }))} reverbPresets={reverbPresets}
                  irName={reverbPath ? (reverbPath.split(/[\\/]/).pop() ?? '').replace(/\.wav$/i, '') : null} irPath={reverbPath} />
              </RackCrop>
            }
            footer={
            <div className="flex items-center gap-2" style={{ opacity: reverb.mode === 'convolution' ? 1 : 0.45, transition: 'opacity .15s' }}>
              <span style={{ ...monoLabel, flexShrink: 0 }}>Reverb IR</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <IrPicker libraryPath={reverbLibraryPath ?? ''} value={reverbPath} allowNone favoritesKind="reverb"
                  placeholder={`Choose from ${reverbCount.toLocaleString()} impulses…`}
                  onChange={(ref) => { setReverbPath(ref.path); try { localStorage.setItem(REVERB_PREF_KEY, ref.path) } catch { /* non-fatal */ } }}
                  onClear={() => { setReverbPath(null); try { localStorage.removeItem(REVERB_PREF_KEY) } catch { /* non-fatal */ } }} />
              </div>
              <button onClick={() => void cycleIr(reverbPath, -1, (p) => { setReverbPath(p); try { localStorage.setItem(REVERB_PREF_KEY, p) } catch { /* non-fatal */ } })}
                disabled={!reverbPath} title="Previous impulse in this folder"
                style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 6, cursor: reverbPath ? 'pointer' : 'default', background: 'var(--field)', border: '1px solid var(--field-border)', color: 'var(--text-2)', opacity: reverbPath ? 1 : 0.4 }}>‹</button>
              <button onClick={() => void cycleIr(reverbPath, 1, (p) => { setReverbPath(p); try { localStorage.setItem(REVERB_PREF_KEY, p) } catch { /* non-fatal */ } })}
                disabled={!reverbPath} title="Next impulse in this folder"
                style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 6, cursor: reverbPath ? 'pointer' : 'default', background: 'var(--field)', border: '1px solid var(--field-border)', color: 'var(--text-2)', opacity: reverbPath ? 1 : 0.4 }}>›</button>
            </div>
            }
          />
        </div>
      </div>

      {/* ── E. Master dock */}
      <div style={{ ...wellStyle, flex: 'none', display: 'flex', gap: 16, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <JogWheel label="Input Gain" value={liveInputGainDb} min={-24} max={24} onChange={setLiveInputGainDb}
          level={liveInputMeter} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`} resetTo={0} />

        {/* Only shown once a pedal capture is actually chained — no point cluttering the dock
            with a knob for a stage that isn't loaded. */}
        {preCapturePath && (
          <JogWheel label="Drive" value={preGainDb} min={-24} max={24} onChange={setPreGainDb}
            format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`} resetTo={0} />
        )}

        <div style={{ width: 300, minWidth: 240, flex: '1 1 260px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="flex items-center gap-2.5">
            {/* concentric cone so it reads as a cabinet, not a generic circle */}
            <div style={{ width: 46, height: 46, borderRadius: '50%', flexShrink: 0,
              background: 'radial-gradient(circle at 50% 50%, #2b3038 0 18%, #171b21 18% 30%, #262c34 30% 62%, #12161b 62% 78%, #2a313a 78% 100%)',
              border: '1px solid var(--border)' }} />
            <div style={{ minWidth: 0 }}>
              <div style={monoLabel}>Cab IR</div>
              <button onClick={() => { irManuallySetRef.current = true; setIrEnabled((v) => !v) }}
                disabled={irCount === 0}
                style={{ marginTop: 3, height: 22, padding: '0 10px', borderRadius: 6, cursor: 'pointer',
                  background: irEnabled ? 'var(--active)' : 'var(--field)',
                  border: `1px solid ${irEnabled ? 'var(--accent)' : 'var(--field-border)'}`,
                  color: irEnabled ? 'var(--accent-text)' : 'var(--text-2)',
                  font: "600 10px 'IBM Plex Mono', monospace", letterSpacing: '.1em' }}>
                {irEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>
          <IrPicker libraryPath={irLibraryPath ?? ''} value={irPath} allowNone favoritesKind="cab"
            placeholder={`Choose from ${irCount.toLocaleString()} cab impulses…`}
            onChange={(ref) => { irManuallySetRef.current = true; setIrPath(ref.path); saveIrPath(ref.path) }}
            onClear={() => setIrPath(null)} />
        </div>

        {/* Tuner — deliberately large; this is the one control you read from across a room. */}
        <div style={{ flex: '1 1 260px', minWidth: 240, display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'center' }}>
          <div className="flex items-center justify-between">
            <span style={monoLabel}>Tuner</span>
            <span style={{ font: "600 11px 'IBM Plex Mono', monospace",
              color: liveTuner?.inTune ? TUNER_GREEN : 'var(--text-2)' }}>
              {liveTuner?.note ? (liveTuner.inTune ? 'in tune' : liveTuner.cents > 0 ? 'sharp' : 'flat') : '—'}
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div style={{ font: "600 46px/1 'IBM Plex Sans', sans-serif", color: 'var(--text)', minWidth: 62 }}>
              {liveTuner?.note ?? '—'}
              {liveTuner?.octave != null && <span style={{ fontSize: 18, color: 'var(--text-2)', verticalAlign: 'super' }}>{liveTuner.octave}</span>}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ position: 'relative', height: 30 }}>
                <div style={{ position: 'absolute', left: 0, right: 0, top: '50%', height: 2, background: 'var(--border)' }} />
                <div style={{ position: 'absolute', left: '50%', top: 2, bottom: 2, width: 2, marginLeft: -1, background: TUNER_GREEN }} />
                <div style={{ position: 'absolute', top: '50%', width: 16, height: 16, marginTop: -8, marginLeft: -8, borderRadius: '50%',
                  left: `${50 + Math.max(-50, Math.min(50, liveTuner?.cents ?? 0))}%`,
                  background: liveTuner?.inTune ? TUNER_GREEN : '#f0b84a',
                  boxShadow: `0 0 12px ${liveTuner?.inTune ? 'rgba(45,212,138,.6)' : 'rgba(240,184,74,.5)'}`,
                  transition: 'left .09s linear' }} />
              </div>
              <div className="flex justify-between" style={{ font: "500 10px 'IBM Plex Mono', monospace", color: 'var(--text-2)', marginTop: 3 }}>
                <span>♭ flat</span>
                <span>{liveTuner?.note ? `${liveTuner.cents > 0 ? '+' : ''}${liveTuner.cents}¢` : 'play a note'}</span>
                <span>sharp ♯</span>
              </div>
            </div>
          </div>
        </div>

        {/* Stereo out meters — bottom-up */}
        <div style={{ width: 78, flex: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={monoLabel}>Out L·R</span>
          <div className="flex gap-2" style={{ flex: 1, minHeight: 84 }}>
            {[liveMeter, liveMeter].map((lv, i) => (
              <div key={i} style={{ flex: 1, position: 'relative', background: 'var(--field)', border: '1px solid var(--field-border)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${Math.min(100, lv * 100)}%`,
                  background: 'linear-gradient(180deg,#e2483a 0%,#f0b84a 22%,#3ddc9a 55%,#17a86f 100%)',
                  transition: 'height .07s linear' }} />
              </div>
            ))}
          </div>
          <span style={{ font: "500 10px 'IBM Plex Mono', monospace", color: 'var(--text-2)', textAlign: 'center' }}>
            {liveMeter > 0 ? `${(20 * Math.log10(liveMeter)).toFixed(0)} dB` : '—'}
          </span>
        </div>

        <JogWheel label="Output" value={volumeDb} min={-40} max={12} onChange={setVolumeDb}
          level={liveMeter} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`} resetTo={0} />

        <div style={{ width: 52, flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', borderLeft: '1px solid var(--border-soft)' }}>
          <button onClick={() => setDrawerOpen(true)} title="Setup"
            style={{ width: 38, height: 38, borderRadius: 9, cursor: 'pointer',
              background: 'var(--raised)', border: '1px solid var(--border)', color: 'var(--text-2)', fontSize: 17 }}>
            ⚙
          </button>
        </div>
      </div>
    </div>
  )

  /**
   * ── F. Setup drawer. Everything that should not stay pinned to the main surface.
   *
   * The DI-source picker the design originally placed here has been cut: in Live you are playing
   * a guitar, so the DI clip is Preview-mode machinery and only added clutter. If "play a DI clip
   * through the live rack" is ever built (see TODO.md) the picker becomes a primary control and
   * belongs on the main surface, not in here.
   */
  const setupDrawer = drawerOpen ? (
    <div style={{ position: 'fixed', inset: 0, zIndex: 400 }}>
      <div onClick={() => setDrawerOpen(false)} style={{ position: 'absolute', inset: 0, background: 'rgba(6,8,11,.6)' }} />
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 340, overflowY: 'auto',
        background: 'var(--panel)', borderLeft: '1px solid var(--border)', boxShadow: '-18px 0 40px rgba(0,0,0,.45)' }}>
        <div className="flex items-center justify-between" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-soft)' }}>
          <span style={{ font: "600 11px 'IBM Plex Mono', monospace", letterSpacing: '.14em', color: 'var(--text-2)', textTransform: 'uppercase' }}>Setup</span>
          <button onClick={() => setDrawerOpen(false)} style={{ width: 28, height: 28, borderRadius: 7, cursor: 'pointer',
            background: 'var(--raised)', border: '1px solid var(--border)', color: 'var(--text-2)' }}>✕</button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <div style={{ font: "600 10px 'IBM Plex Mono', monospace", letterSpacing: '.12em', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 6 }}>Input device</div>
            <select value={inputDeviceId ?? ''} onChange={(e) => setInputDeviceId(e.target.value || null)}
              style={{ width: '100%', height: 32, borderRadius: 8, padding: '0 10px', background: 'var(--field)',
                border: '1px solid var(--field-border)', color: 'var(--text)', font: "500 11.5px 'IBM Plex Sans', sans-serif" }}>
              <option value="">System default</option>
              {inputDevices.map((d) => (<option key={d.deviceId} value={d.deviceId}>{d.label}</option>))}
            </select>
          </div>
          {/* Only worth showing on a multi-channel interface — a mono input has nothing to pick. */}
          {channelPeaks.length > 1 && (
          <div>
            <div style={{ font: "600 10px 'IBM Plex Mono', monospace", letterSpacing: '.12em', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 6 }}>Input channel</div>
            <div className="flex gap-2">
              {channelPeaks.map((lv, i) => (
                <button key={i} onClick={() => setInputChannel(i)}
                  style={{ flex: 1, height: 34, borderRadius: 7, cursor: 'pointer', position: 'relative', overflow: 'hidden',
                    background: inputChannel === i ? 'var(--active)' : 'var(--field)',
                    border: `1px solid ${inputChannel === i ? 'var(--accent)' : 'var(--field-border)'}`,
                    color: inputChannel === i ? 'var(--accent-text)' : 'var(--text-2)',
                    font: "600 10px 'IBM Plex Mono', monospace", opacity: inputChannel === i ? 1 : 0.75 }}>
                  <span style={{ position: 'relative', zIndex: 1 }}>CH {i + 1}</span>
                  <span style={{ position: 'absolute', left: 0, bottom: 0, height: 3, width: `${Math.min(100, lv * 100)}%`, background: TUNER_GREEN }} />
                </button>
              ))}
            </div>
          </div>
          )}
          <div>
            <div style={{ font: "600 10px 'IBM Plex Mono', monospace", letterSpacing: '.12em', color: 'var(--text-2)', textTransform: 'uppercase', marginBottom: 6 }}>Output device</div>
            <select value={outputDeviceId ?? ''} onChange={(e) => setOutputDeviceId(e.target.value || null)}
              style={{ width: '100%', height: 32, borderRadius: 8, padding: '0 10px', background: 'var(--field)',
                border: '1px solid var(--field-border)', color: 'var(--text)', font: "500 11.5px 'IBM Plex Sans', sans-serif" }}>
              <option value="">System default</option>
              {outputDevices.map((d) => (<option key={d.deviceId} value={d.deviceId}>{d.label}</option>))}
            </select>
          </div>
          <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={liveBypass} onChange={(e) => setLiveBypass(e.target.checked)} className="w-3.5 h-3.5 rounded accent-[var(--accent)]" />
              <span style={{ font: "500 11.5px 'IBM Plex Sans', sans-serif", color: 'var(--text)' }}>Bypass model (hear the dry input)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={autoStartLiveOnPopout}
                onChange={(e) => onAutoStartLiveOnPopoutChange?.(e.target.checked)}
                className="w-3.5 h-3.5 rounded accent-[var(--accent)]" />
              <span style={{ font: "500 11.5px 'IBM Plex Sans', sans-serif", color: 'var(--text)' }}>Start recording automatically when this page opens</span>
            </label>
          </div>
          {liveLatencyMs !== null && (
            <div style={{ font: "500 10.5px 'IBM Plex Sans', sans-serif", color: 'var(--text-2)' }}>
              Round-trip latency ≈ {liveLatencyMs.toFixed(0)} ms
            </div>
          )}
        </div>
      </div>
    </div>
  ) : null

  const saveAsModal = saveAsPrompt ? (
    <div style={{ position: 'fixed', inset: 0, zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={() => setSaveAsPrompt(null)} style={{ position: 'absolute', inset: 0, background: 'rgba(6,8,11,.6)' }} />
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const name = saveAsValue.trim()
          if (name) saveAsPrompt.onSave(name)
          setSaveAsPrompt(null)
          setSaveAsValue('')
        }}
        style={{
          position: 'relative', width: 340, background: 'var(--panel)', border: '1px solid var(--border)',
          borderRadius: 12, boxShadow: '0 20px 50px rgba(0,0,0,.5)', padding: 18, display: 'flex', flexDirection: 'column', gap: 12
        }}
      >
        <span style={{ font: "600 12px 'IBM Plex Sans', sans-serif", color: 'var(--text)' }}>{saveAsPrompt.title}</span>
        <input
          autoFocus
          value={saveAsValue}
          onChange={(e) => setSaveAsValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setSaveAsPrompt(null); setSaveAsValue('') } }}
          placeholder="Preset name…"
          style={{
            height: 36, borderRadius: 8, padding: '0 12px', background: 'var(--field)',
            border: '1px solid var(--field-border)', color: 'var(--text)', font: "500 12.5px 'IBM Plex Sans', sans-serif", outline: 'none'
          }}
        />
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => { setSaveAsPrompt(null); setSaveAsValue('') }}
            style={{ height: 32, padding: '0 14px', borderRadius: 8, cursor: 'pointer', background: 'var(--raised)', border: '1px solid var(--border)', color: 'var(--text-2)', font: "600 11px 'IBM Plex Sans', sans-serif" }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!saveAsValue.trim()}
            style={{ height: 32, padding: '0 14px', borderRadius: 8, cursor: 'pointer', background: 'var(--accent)', border: '1px solid var(--accent)', color: 'var(--accent-fg, #fff)', font: "600 11px 'IBM Plex Sans', sans-serif", opacity: saveAsValue.trim() ? 1 : 0.5 }}
          >
            Save
          </button>
        </div>
      </form>
    </div>
  ) : null

  if (poppedOut) {
    return (
      <>
        {/* The panel keeps rendering behind the modal. Unmounting it would tear down the live
            engine and the meter loop, so popping out would silence what you are listening to. */}
        <div ref={panelRef} className="flex flex-col h-full bg-white dark:bg-[var(--panel)] text-gray-900 dark:text-gray-100 select-none opacity-40 pointer-events-none">
          <div className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">Expanded &mdash; see the rig view.</div>
        </div>
        <div
          className="fixed inset-0 z-[300] flex flex-col select-none"
          style={{ background: 'var(--app-bg)', color: 'var(--text)' }}
        >
          {/* ── A. Title bar */}
          <div
            className="flex items-center gap-3 flex-shrink-0"
            style={{
              height: 40,
              // Clears the macOS window buttons, exactly as Toolbar.tsx does.
              paddingLeft: window.api.platform === 'darwin' ? 88 : 16,
              paddingRight: 16,
              borderBottom: '1px solid var(--border-soft)'
            }}
          >
            <span style={{ font: "600 10px 'IBM Plex Mono', monospace", letterSpacing: '.18em', color: RIG_GOLD }}>LIVE RIG</span>
            <span style={{ font: "600 13px 'IBM Plex Sans', sans-serif", color: 'var(--text)' }}>{captureLabel}</span>
            {(m.gear_make || m.gear_model) && (
              <span style={{ font: "500 12px 'IBM Plex Sans', sans-serif", color: 'var(--text-2)' }}>
                {[m.gear_make, m.gear_model].filter(Boolean).join(' ')}
              </span>
            )}
            <div className="flex-1" />
            {groupControl}
            <button
              onClick={() => setPoppedOut(false)}
              title="Back to the panel (Esc)"
              style={{
                height: 26, padding: '0 12px', borderRadius: 8, cursor: 'pointer',
                background: 'var(--raised)', border: '1px solid var(--border)', color: 'var(--text-2)',
                font: "600 10px 'IBM Plex Mono', monospace", letterSpacing: '.08em', textTransform: 'uppercase'
              }}
            >
              Collapse
            </button>
          </div>

          {/* Minimal side margins on purpose — the panels are the content, and every pixel of
              margin comes off how large and readable they are.
              The rig takes its natural, content-driven height (see the Rack wall comment below);
              on a window shorter than that, this scrolls. That is the correct, boring fallback —
              not something to design around by starving every control to fit. */}
          <div className="flex-1 min-h-0 overflow-auto" style={{ paddingTop: 12 }}>
            {rigView}
          </div>
        </div>
        {setupDrawer}
        {saveAsModal}
        {echoLabFloating && (
          <EchoLabFloatingWindow
            echoLab={echoLab}
            onChange={(patch) => setEchoLabState((e) => ({ ...e, ...patch }))}
            onClose={() => {
              setEchoLabFloating(false)
              setDelaySlotView('echo-lab')
            }}
          />
        )}
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
        {groupControl}
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

const fxPresetControlClass =
  'h-[22px] px-2 rounded text-[11px] font-medium border border-gray-200 dark:border-[var(--border)] text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-[var(--hover)] transition-colors disabled:opacity-40 disabled:pointer-events-none'

/**
 * Save/load/delete bar for one named preset list.
 *
 * Deliberately dumb: it holds only which row is selected and whether the save-name field is
 * open. The parent owns the actual list and persistence, and re-uses the SAME state setters the
 * sliders already call — so applying a preset needs no separate "push to engine" path.
 */
function FxPresetBar<T>({
  presets,
  onApply,
  onSave,
  onDelete
}: {
  presets: { id: string; name: string; settings: T; irPath?: string | null }[]
  onApply: (settings: T, irPath?: string | null) => void
  onSave: (name: string) => void
  onDelete: (id: string) => void
}) {
  // Which preset is currently "loaded" — kept separate from the <select> element's own value
  // (always reset to "" below) so re-picking the same option still fires a change event. A native
  // <select> does not fire onChange when the chosen option is already the one selected, which is
  // why picking the preset you just saved appeared to do nothing until the component remounted.
  const [selectedId, setSelectedId] = useState('')
  const [savingName, setSavingName] = useState<string | null>(null)

  const applied = presets.find((p) => p.id === selectedId) ?? null

  function confirmSave(): void {
    const trimmed = (savingName ?? '').trim()
    if (!trimmed) return
    onSave(trimmed)
    setSavingName(null)
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 mb-2">
      <select
        value=""
        onChange={(e) => {
          const id = e.target.value
          if (!id) return
          setSelectedId(id)
          const preset = presets.find((p) => p.id === id)
          if (preset) onApply(preset.settings, preset.irPath ?? null)
        }}
        className="h-[22px] flex-1 min-w-0 rounded border border-gray-200 dark:border-[var(--border)] bg-white dark:bg-[var(--panel)] text-[11px] px-1.5 text-gray-700 dark:text-gray-300"
      >
        <option value="">{applied ? applied.name : presets.length ? 'Presets…' : 'No presets saved'}</option>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      {savingName === null ? (
        <>
          {applied && (
            <button
              className={fxPresetControlClass}
              onClick={() => onSave(applied.name)}
              title={`Overwrite "${applied.name}" with the current settings`}
            >
              Update
            </button>
          )}
          <button
            className={fxPresetControlClass}
            onClick={() => setSavingName('')}
            title="Save the current settings as a new preset"
          >
            Save new
          </button>
          <button
            className={fxPresetControlClass}
            disabled={!applied}
            onClick={() => {
              if (applied && window.confirm(`Delete preset "${applied.name}"?`)) {
                onDelete(applied.id)
                setSelectedId('')
              }
            }}
          >
            Delete
          </button>
        </>
      ) : (
        <>
          <input
            autoFocus
            value={savingName}
            onChange={(e) => setSavingName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmSave()
              if (e.key === 'Escape') setSavingName(null)
            }}
            placeholder="Preset name"
            className="h-[22px] flex-1 min-w-0 rounded border border-gray-200 dark:border-[var(--border)] bg-white dark:bg-[var(--panel)] text-[11px] px-1.5 text-gray-700 dark:text-gray-300"
          />
          <button className={fxPresetControlClass} disabled={!savingName.trim()} onClick={confirmSave}>
            ✓
          </button>
          <button className={fxPresetControlClass} onClick={() => setSavingName(null)}>
            ✕
          </button>
        </>
      )}
    </div>
  )
}

/**
 * How an impulse's channel count will actually behave.
 *
 * The amp model is mono, so any width has to come from the impulse. Per the Web Audio spec a mono
 * input convolved with a stereo impulse yields two channels (the input against each side), which
 * is real stereo; a 4-channel impulse is true-stereo; a mono one stays mono however it is mixed.
 */
function describeIrChannels(channels: number): string {
  if (channels >= 4) return `${channels}ch true-stereo`
  if (channels === 2) return 'stereo'
  if (channels === 1) return 'mono impulse \u2014 no width'
  return 'loading\u2026'
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
