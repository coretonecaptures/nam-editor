import { impulseSeconds, trimImpulse, type ImpulseResponse } from './impulseTrim'

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

/**
 * Noise gate settings, at the front of the live chain.
 *
 * Ported from NAM's own gate (see public/gate-worklet.js), so a capture gates the way it does in
 * the plugin. `threshold` is where expansion starts; below it the reduction grows quadratically.
 */
export interface GateSettings {
  enabled: boolean
  /** dB. Below this the gate starts closing. */
  threshold: number
  /** Seconds to open. */
  openTime: number
  /** Seconds held open after the signal drops below threshold. */
  holdTime: number
  /** Seconds to close. */
  closeTime: number
}

export const DEFAULT_GATE: GateSettings = {
  enabled: false,
  threshold: -60,
  openTime: 0.005,
  holdTime: 0.05,
  closeTime: 0.05
}

/** Which delay is in the chain. */
export type DelayMode = 'algorithmic' | 'convolution'

/**
 * Pre-effects tone stack, mimicking a plugin's amp EQ.
 *
 * Sits at the very front of the chain, before the chorus, so it shapes the amp's own voice going
 * INTO the effects rather than colouring their output. Frequencies are the conventional guitar
 * tone-stack centres, not measured from any particular plugin.
 */
export interface EqSettings {
  enabled: boolean
  bassDb: number
  midDb: number
  trebleDb: number
}

export const DEFAULT_EQ: EqSettings = { enabled: false, bassDb: 0, midDb: 0, trebleDb: 0 }

/** Tone-stack centres. Bass shelf, mid bell, treble shelf. */
export const EQ_BASS_HZ = 100
export const EQ_MID_HZ = 650
export const EQ_TREBLE_HZ = 3200
/** Mid bell width. Broad enough to move a voice rather than notch it. */
export const EQ_MID_Q = 0.7
export const EQ_MAX_DB = 12

/** Ping-pong stereo delay. All of it maps onto native nodes; none of it needs the worklet. */
export interface DelaySettings {
  /** Wet level, 0..1. At 0 the delay nodes stay wired but silent. */
  mix: number
  /** Left tap in milliseconds; the right tap follows it. */
  timeMs: number
  /** Right tap as a multiple of the left. 1 is symmetrical; 0.5 gives dotted-eighth patterns. */
  ratio: number
  /** Regeneration, 0..0.9. Clamped below 1 or the loop runs away. */
  feedback: number
  /** Lowpass in the feedback loop — each repeat darker than the last, as tape and BBD both do. */
  toneHz: number
  /**
   * Modulation depth in milliseconds, 0 for none.
   *
   * Moving the delay time moves the read head, which shifts the pitch of what is already in the
   * line — the same mechanism as tape wow or a BBD chorus. A fraction of a millisecond is all it
   * takes; past a few the repeats audibly warble.
   */
  modDepthMs: number
  /** Modulation rate in Hz. */
  modRateHz: number
  /** Master on/off. Off bypasses the wet path entirely rather than just muting it. */
  enabled: boolean
  /**
   * Algorithmic delay line, or convolution against a captured delay.
   *
   * Convolution buys the character of a real rack unit, and costs every control except mix: a
   * delay impulse bakes in its own time AND its feedback, so it is a preset rather than a delay
   * you dial. The two modes complement each other rather than one replacing the other.
   */
  mode: DelayMode
  /**
   * Ping-pong, or plain mono repeats.
   *
   * On, the taps are chained so repeats alternate across the stereo field. Off, one tap feeds
   * both channels equally and the delay sits centred — which is what you want under a dense mix,
   * or when the repeats are meant to thicken rather than move.
   */
  pingPong: boolean
  /**
   * How much of the ping-pong separation actually comes through, 0..1 — only meaningful while
   * pingPong is on; Center always sits at 0 regardless of this. 0 sounds essentially like Center
   * (repeats centred), 1 is full hard-alternating stereo. Lets the effect sit anywhere between
   * "basically mono, slightly wider" and full ping-pong instead of only ever being either.
   */
  pingPongWidth: number
  /**
   * Auto-pan the repeats across the stereo field, independent of ping-pong.
   *
   * Ping-pong alternates taps discretely, left-right-left; this sweeps continuously, so it reads
   * as movement rather than alternation. It runs on the wet signal only — the dry input stays
   * centred — so it works in either delay mode, algorithmic or convolution.
   */
  panEnabled: boolean
  /** Sweep rate in Hz. One knob: how fast it moves left to right and back. */
  panRateHz: number
}

/** Which reverb is in the chain. */
export type ReverbMode = 'plate' | 'convolution'

/**
 * Corner frequencies for the reverb's tone controls.
 *
 * These are the standard places engineers reach for when a reverb sits badly in a mix, so they are
 * fixed rather than exposed as two more sliders:
 *
 *  - LOW, 250 Hz. Reverb turns to mud from roughly 200-400 Hz down, because the tail's low end
 *    piles up under everything and blurs the attack. Cutting here is the single most common move
 *    on any send reverb, and the reason hardware units ship with a low-cut in the tail.
 *
 *  - HIGH, 4 kHz. Air and sizzle live above ~4 kHz. Real rooms absorb high frequencies as sound
 *    travels, so cutting here reads as "further away" and "darker room", while a lift reads as
 *    "brighter plate". Cut ranges of 5-8 kHz are typical; 4 kHz sits low enough that a boost adds
 *    audible sheen rather than just hiss.
 */
export const REVERB_LOW_SHELF_HZ = 250
export const REVERB_HIGH_SHELF_HZ = 4000
/** Shelf range. Wide enough to remove boom entirely or add obvious air, without being a synth. */
export const REVERB_EQ_MAX_DB = 15

export interface ReverbSettings {
  enabled: boolean
  mode: ReverbMode
  mix: number
  /** Low shelf gain in dB at REVERB_LOW_SHELF_HZ. Negative tightens the tail. */
  lowDb: number
  /** High shelf gain in dB at REVERB_HIGH_SHELF_HZ. Positive brightens it. */
  highDb: number
  /** Plate only: tail length, 0..1. */
  roomSize: number
  /** Plate only: how fast highs decay out of the tail, 0..1. */
  damping: number
  /** Plate only: stereo spread, 0..1. */
  width: number
}

export const DEFAULT_REVERB: ReverbSettings = {
  enabled: false,
  mode: 'plate',
  mix: 0.25,
  // A gentle low cut by default: it is almost always wanted, and a tail with no low-end trim is
  // the first thing that makes a reverb sound like it is fighting the amp.
  lowDb: -3,
  highDb: 0,
  roomSize: 0.72,
  damping: 0.5,
  width: 1
}

/**
 * The "Modulation" block is one FX slot with two unrelated circuits in it, Chorus and Tremolo,
 * rather than a separate Tremolo block — both are "vary something about the note over time"
 * effects sharing the same rate/depth territory. `ChorusSettings` keeps its name internally
 * (touches the FX preset system and a localStorage key; renaming it is a display-only change,
 * not a functional one) even though the UI label is "Modulation".
 */
export type ModulationType = 'chorus' | 'tremolo'

export interface ChorusSettings {
  enabled: boolean
  /** Which circuit: Chorus (existing) or Tremolo (amplitude modulation). */
  type: ModulationType
  /** Chorus-only: wet/dry mix. Tremolo has no separate mix — `enabled` fully engages it, the
   * same way a real Fender tremolo has no wet/dry knob, just Speed and Intensity. */
  mix: number
  /**
   * Stereo spread of the two chorus voices, 0..1.
   *
   * At 1 each swept voice stays on its own side; at 0 they are averaged into both, which is a
   * mono chorus. This is the chain's mono-to-stereo conversion point, so it is also what decides
   * how wide everything downstream starts out. Chorus-only.
   */
  width: number
  /** Sweep depth in milliseconds. Chorus-only. */
  depthMs: number
  /** LFO rate in Hz — shared between Chorus and Tremolo, both are just an LFO frequency. */
  rateHz: number
  /** Tremolo-only: how deep the volume dips, 0..1 (0 = no effect, 1 = full mute at the trough). */
  tremoloDepth: number
  /**
   * Tremolo-only: harmonic (silverface Fender "vibrato channel") vs standard tremolo.
   *
   * Standard modulates the whole signal's level together. Harmonic splits the signal into low
   * and high bands through a crossover and modulates them 180° out of phase — as the low band
   * swells the high band dips — which is what gives it the subtle shimmer/coloring plain
   * tremolo doesn't have. Fender's own panels historically mislabeled this circuit "Vibrato";
   * it is not pitch vibrato.
   */
  harmonic: boolean
}

export const DEFAULT_CHORUS: ChorusSettings = {
  enabled: false,
  type: 'chorus',
  mix: 0.35,
  width: 1,
  depthMs: 1.5,
  rateHz: 0.5,
  tremoloDepth: 0.6,
  harmonic: false
}

/** Centre delay a chorus sweeps around. Short enough to fuse with the dry signal. */
const CHORUS_CENTRE_MS = 18

/**
 * Harmonic tremolo's low/high crossover point. Documented brownface Fender component values put
 * the real circuit's corner in the 300-600Hz range, not up at 800Hz — pulled down to sit in that
 * range: 800Hz was lumping midrange content into the (louder, more prominent) low band, which
 * likely read as darkness independent of the crossover-summing fix above.
 */
const TREMOLO_CROSSOVER_HZ = 450
/** Below Butterworth on purpose: a wide, sloppy overlap is what makes harmonic tremolo phase.
 *  Only affects HOW GRADUALLY energy hands off between bands now — see buildFxChain for why the
 *  static (unmodulated) response no longer depends on this the way two separate filters would. */
const TREMOLO_CROSSOVER_Q = 0.5

export const DEFAULT_DELAY: DelaySettings = {
  mix: 0,
  timeMs: 380,
  ratio: 1,
  feedback: 0.35,
  toneHz: 4200,
  modDepthMs: 0,
  modRateHz: 0.6,
  enabled: false,
  pingPong: true,
  pingPongWidth: 1,
  panEnabled: false,
  panRateHz: 0.5,
  mode: 'algorithmic'
}

/** Auto-pan sweep range. Below this it reads as drift rather than pan; above, a warble. */
export const MIN_PAN_RATE_HZ = 0.05
export const MAX_PAN_RATE_HZ = 5

/**
 * Echo Lab — a second, swappable delay unit sharing the orange Delay's rack slot (a view toggle,
 * not a mode switch; see EchoLabViewState below — both units keep processing audio regardless of
 * which panel is currently drawn). Research/design doc: docs/echo-lab-plan.md.
 *
 * DSP for this unit is NOT YET BUILT — this type only exists so the settings/UI/persistence layer
 * has something concrete to wire against ahead of the actual audio graph. `enabled` defaults to
 * false and nothing in buildFxChain reads these fields yet.
 *
 * Single is the only topology with real fields modeled so far. `leftTimeMs`/`rightTimeMs`/
 * `leftFeedback`/`rightFeedback`/`spread` are placeholders for Dual, which needs genuinely
 * independent delay lines (not just a ratio off one line, the way the orange Delay's Ratio knob
 * works) — real scope, not yet designed at the DSP level.
 */
export type EchoLabTopology = 'single' | 'dual'
export type EchoLabCharacter = 'digital' | 'tape' | 'memoryman'

export interface EchoLabSettings {
  enabled: boolean
  mix: number
  topology: EchoLabTopology
  character: EchoLabCharacter

  // Single-topology fields (Row 1, knobs 2-3 when Mode=Single).
  timeMs: number
  feedback: number
  /**
   * Row 1, knob 6 when Mode=Single — how much of Echo Lab's Right line crosses in to alternate
   * repeats across the stereo field, 0..1. 0 is indistinguishable from mono (R silent, matching
   * this unit's behaviour before Ping-Pong existed); 1 is full hard alternation. Continuous, same
   * "one knob, not a toggle" idea as the orange Delay's own ping-pong-width fader. Only meaningful
   * in Single — Dual already gets real stereo from its two independent lines, so this slot
   * relabels to Spread there instead; see RackEchoLab.
   */
  pingPongWidth: number

  // Dual-topology fields (Row 1, knobs 2-6 when Mode=Dual).
  leftTimeMs: number
  rightTimeMs: number
  leftFeedback: number
  rightFeedback: number
  spread: number

  /**
   * Row 2, knob 1 — meaning depends on `character`: Tape = Wow/Flutter depth (ms, reuses the same
   * modDepthMs-style LFO-on-delay-time trick the orange Delay's Mod knob already uses), Memory Man
   * = Tone/bandwidth (Hz, a lowpass in the feedback loop). Unused for Digital.
   */
  char1: number
  /**
   * Row 2, knob 2 — Tape = Tape Age (0..1, simulated wear: more darkening/noise at higher values),
   * Memory Man = Chorus depth (reuses the same LFO mechanism as char1, slower/subtler than Tape's
   * wow/flutter — the real Deluxe Memory Man's built-in chorus circuit). Unused for Digital.
   */
  char2: number
  /** Row 2, knob 3 — saturation amount, all characters. */
  colorDrive: number
  /** Row 2, knob 4 — stereo widening on the wet output, all characters. */
  width: number

  /** Row 3 — always active regardless of topology/character. */
  eqLowDb: number
  eqHighDb: number
  duckEnabled: boolean
  duckDepth: number
  duckReleaseMs: number

  /** Button row — Pan on/off (fixed rate, no dedicated knob, matching the orange Delay's own Pan). */
  panEnabled: boolean
  /** Fader — Pan sweep rate. Inert (dimmed) while panEnabled is off. */
  panRateHz: number
  /** Fader — modulation rate for whichever char1/char2 LFO is active. Inert while Character is
   *  Digital, since Digital has no modulation-flavored character knob. */
  modRateHz: number

  /**
   * Where the orange Delay sits relative to Echo Lab when BOTH are enabled — series routing:
   * dry hits one, its wet output feeds the other. 'before' (the default): Delay -> Echo Lab, the
   * confirmed default order. 'after': Echo Lab -> Delay instead.
   */
  secondaryDelayPosition: 'before' | 'after'
}

export const DEFAULT_ECHO_LAB: EchoLabSettings = {
  enabled: false,
  mix: 0,
  topology: 'single',
  character: 'digital',
  timeMs: 380,
  feedback: 0.35,
  pingPongWidth: 0,
  leftTimeMs: 380,
  rightTimeMs: 500,
  leftFeedback: 0.35,
  rightFeedback: 0.35,
  spread: 0,
  char1: 0,
  char2: 0,
  colorDrive: 0,
  width: 0.5,
  eqLowDb: 0,
  eqHighDb: 0,
  duckEnabled: false,
  duckDepth: 0.5,
  duckReleaseMs: 300,
  panEnabled: false,
  panRateHz: 0.5,
  modRateHz: 0.6,
  secondaryDelayPosition: 'before'
}

/** Which panel is currently drawn in the shared Delay/Echo Lab rack slot — display only, both
 *  units keep processing audio regardless of which one is showing. */
export type DelaySlotView = 'delay' | 'echo-lab'

/** Highest feedback allowed. Above this the loop gains more than it loses and never decays. */
export const MAX_FEEDBACK = 0.9
/** Longest tap the delay lines are allocated for. */
export const MAX_DELAY_SECONDS = 2
/** Deepest modulation offered. Beyond this the repeats warble rather than shimmer. */
export const MAX_MOD_DEPTH_MS = 8

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
  /**
   * Which input channel carries the guitar, 0-based.
   *
   * Nearly every interface is stereo, and a guitar is plugged into ONE of its inputs. Asking for
   * a mono stream does not pick that input, it downmixes both — so a guitar on input 2 arrived at
   * roughly half level with whatever was on input 1 summed into it, and nothing in the UI
   * explained why.
   */
  inputChannel?: number
  /** Output device to play through; omit for the system default. */
  outputDeviceId?: string | null
  gate?: GateSettings
  eq?: EqSettings
  delay?: DelaySettings
  /** Decoded delay impulse for convolution mode. Stereo and 4-channel true-stereo both work. */
  delayIr?: ImpulseResponse | null
  echoLab?: EchoLabSettings
  reverb?: ReverbSettings
  chorus?: ChorusSettings
  /** Decoded reverb impulse, or null for none. Stereo is preserved. */
  reverbIr?: ImpulseResponse | null
  /**
   * Gain that brings this model to the same playback loudness the offline preview targets.
   * Compute it with computeLiveNormalizeGain from playerAudio.
   */
  normalizeGain?: number
  /** Listener volume trim, 0..1. */
  volume?: number
  /**
   * Second NAM model chained BEFORE the main one — e.g. an overdrive/fuzz pedal capture feeding
   * an amp capture, the way people cascade two NAM/Gateway plugin instances. A capture is trained
   * on clean guitar in, not on another model's output, so this is genuinely untested territory
   * sonically; the drive trim below exists because of that, not as a nice-to-have.
   */
  preModelJson?: string | null
  /** Linear drive into the second stage, applied on a plain GainNode so it can be ramped live
   *  without reloading either model. 1 = unity. */
  preGain?: number
}

/**
 * Enumerate audio input devices.
 *
 * Labels are empty until permission has been granted at least once, so this asks for a stream
 * first and immediately discards it — the standard workaround, and harmless because the live
 * player is about to want that permission anyway.
 */
/**
 * A tanh soft-clip curve for Echo Lab's Color/Drive knob, normalized so 0 drive is the identity
 * line (transparent) and higher drive compresses peaks progressively harder without ever hard
 * clipping — the standard, cheap way to get "grit that builds" out of a WaveShaperNode.
 */
function makeSoftClipCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 256
  const curve = new Float32Array(new ArrayBuffer(n * Float32Array.BYTES_PER_ELEMENT))
  const k = amount * 18
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = k === 0 ? x : Math.tanh(k * x) / Math.tanh(k)
  }
  return curve
}

export async function listAudioOutputs(): Promise<LiveDeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((d) => d.kind === 'audiooutput')
    .map((d, index) => ({
      deviceId: d.deviceId,
      label: d.label || `Output ${index + 1}`
    }))
}

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
  private splitter: ChannelSplitterNode | null = null
  private worklet: AudioWorkletNode | null = null
  /** Optional pedal-capture stage chained ahead of `worklet`. See LiveStartOptions.preModelJson. */
  private preWorklet: AudioWorkletNode | null = null
  private preGainNode: GainNode | null = null
  /** One analyser per input channel, so the UI can show which one has signal. */
  private channelAnalysers: AnalyserNode[] = []
  private channelBuffer: Float32Array<ArrayBuffer> = new Float32Array(1024)
  private inputChannel = 0
  private gate: AudioWorkletNode | null = null
  private gateSettings: GateSettings = { ...DEFAULT_GATE }
  private gateAvailable = false
  private convolver: ConvolverNode | null = null
  private wetGain: GainNode | null = null
  private dryGain: GainNode | null = null
  private outputGain: GainNode | null = null
  private analyser: AnalyserNode | null = null

  /**
   * Effects chain, sitting between the cabinet and the output stage.
   *
   *   [cab] -> fxInput -+-> delayDry ------------------+-> fxMid -+-> reverbDry -+-> outputGain
   *                     |                              |          |              |
   *                     +-> delayL -> delayR -> delayWet          +-> convolver -+
   *                            ^         |                           -> reverbWet
   *                            +- damp <-+  (feedback)
   *
   * fxInput and fxMid exist so the cabinet can be swapped, and a reverb impulse loaded or
   * cleared, without rebuilding the parts on either side of them.
   */
  private fxInput: GainNode | null = null
  private fxMid: GainNode | null = null
  private eqBass: BiquadFilterNode | null = null
  private eqMid: BiquadFilterNode | null = null
  private eqTreble: BiquadFilterNode | null = null
  private eqSettings: EqSettings = { ...DEFAULT_EQ }
  /** Ping-pong routing gains — see buildFxChain for why this is gains and not rewiring. */
  private ppSend: GainNode | null = null
  private ppTap: GainNode | null = null
  private ppOut: GainNode | null = null
  private monoTap: GainNode | null = null
  private monoOut: GainNode | null = null
  private delayConvolver: ConvolverNode | null = null
  private delayConvWet: GainNode | null = null
  private delayIrSeconds = 0
  private delayIrChannels = 0
  private delayL: DelayNode | null = null
  private delayR: DelayNode | null = null
  private delayFeedback: GainNode | null = null
  private delayDamp: BiquadFilterNode | null = null
  private delayWet: GainNode | null = null
  private delayDry: GainNode | null = null
  private delayMerger: ChannelMergerNode | null = null
  private delayPanIn: GainNode | null = null
  private delayPanner: StereoPannerNode | null = null
  private delayPanOsc: OscillatorNode | null = null
  private delayPanDepth: GainNode | null = null
  private modOsc: OscillatorNode | null = null
  private modDepthL: GainNode | null = null
  private modDepthR: GainNode | null = null
  private delaySettings: DelaySettings = { ...DEFAULT_DELAY }
  /** Junction nodes so Delay's position relative to Echo Lab can be swapped without rebuilding
   *  the graph — see reconcileChainOrder. Everything else about Delay is unchanged. */
  private delayIn: GainNode | null = null
  private delayOut: GainNode | null = null

  /**
   * Echo Lab — second delay unit sharing the orange Delay's rack slot. See docs/echo-lab-plan.md.
   *
   *   echoLabIn -+-> echoLabDry ------------------------------------+-> echoLabMerger
   *              +-> echoLabDelayL -> [tone -> sat] -+-> (ch0) ------+
   *              |         ^                          +-> monoTap --+ (ch1, Single only)
   *              |         +--------- feedbackL <------+
   *              +-> echoLabDelayR -> [tone -> sat] -+-> rGain ------+ (ch1, Dual only)
   *                        ^                          |
   *                        +--------- feedbackR <------+
   *
   *   echoLabMerger -> widen(direct/cross, reused chorus technique) -> eqLow -> eqHigh -> wet
   *     -> panIn -> panner -> echoLabOut  (echoLabDry also sums into echoLabOut)
   *
   * L is always live (both Single and Dual); R only contributes once rGain is up (Dual only).
   * Tone/saturation sit INSIDE each line's own feedback loop so darkening/grit compounds on
   * repeats, same reasoning as the orange Delay's toneHz — but each line gets its own filter
   * since a shared post-merge filter would not be a real feedback loop for either line.
   */
  private echoLabIn: GainNode | null = null
  private echoLabDry: GainNode | null = null
  private echoLabDelayL: DelayNode | null = null
  private echoLabDelayR: DelayNode | null = null
  /** Gates echoLabIn -> echoLabDelayR: 1 in Dual (R is independently fed), 0 in Single (R's input
   *  instead comes from echoLabPpSend, or nothing at all when Ping-Pong is off). Needed because a
   *  DelayNode input SUMS whatever is connected to it — without this gate, Single mode would leak
   *  the dry input into R at the same time as L's ping-pong signal, muddying both. */
  private echoLabDualRGain: GainNode | null = null
  /** Gates echoLabSatL -> echoLabDelayR: Single-mode Ping-Pong's own "L feeds R" tap, 0..pingPongWidth. */
  private echoLabPpSend: GainNode | null = null
  private echoLabFeedbackL: GainNode | null = null
  private echoLabFeedbackR: GainNode | null = null
  /** Feedback-source crossfade: each line's feedback is a blend of its OWN processed output
   *  (Self) and the OTHER line's (Cross). Dual keeps Self=1/Cross=0 on both — fully independent
   *  lines, unchanged from before Ping-Pong existed. Single crossfades by pingPongWidth: 0 is
   *  each line feeding only itself (R has no input anyway, so this is silent/unchanged), 1 is
   *  each line's repeats built entirely from the OTHER line's output — genuine alternation. */
  private echoLabFbLSelf: GainNode | null = null
  private echoLabFbLCross: GainNode | null = null
  private echoLabFbRSelf: GainNode | null = null
  private echoLabFbRCross: GainNode | null = null
  private echoLabToneL: BiquadFilterNode | null = null
  private echoLabToneR: BiquadFilterNode | null = null
  private echoLabSatL: WaveShaperNode | null = null
  private echoLabSatR: WaveShaperNode | null = null
  private echoLabModOsc: OscillatorNode | null = null
  private echoLabModDepthL: GainNode | null = null
  private echoLabModDepthR: GainNode | null = null
  /** 0 in Single (R line's own contribution muted), 1 in Dual. */
  private echoLabRGain: GainNode | null = null
  /** L duplicated onto channel 1 in Single mode — same convention as Delay's monoTap/monoOut. */
  private echoLabMonoTap: GainNode | null = null
  private echoLabMerger: ChannelMergerNode | null = null
  /** Width matrix — identical direct/cross-gain technique already proven on Chorus's width knob. */
  private echoLabSplitter: ChannelSplitterNode | null = null
  private echoLabWidenDirectL: GainNode | null = null
  private echoLabWidenDirectR: GainNode | null = null
  private echoLabWidenCrossL: GainNode | null = null
  private echoLabWidenCrossR: GainNode | null = null
  private echoLabWidenMerger: ChannelMergerNode | null = null
  private echoLabEqLow: BiquadFilterNode | null = null
  private echoLabEqHigh: BiquadFilterNode | null = null
  private echoLabWet: GainNode | null = null
  private echoLabPanIn: GainNode | null = null
  private echoLabPanner: StereoPannerNode | null = null
  private echoLabPanOsc: OscillatorNode | null = null
  private echoLabPanDepth: GainNode | null = null
  private echoLabOut: GainNode | null = null
  /** Ducking envelope follower — see the buildFxChain comment by echoLabDuckAnalyser. */
  private echoLabDuckAnalyser: AnalyserNode | null = null
  private echoLabDuckGain: GainNode | null = null
  private echoLabDuckBuffer: Float32Array<ArrayBuffer> = new Float32Array(new ArrayBuffer(512 * Float32Array.BYTES_PER_ELEMENT))
  /** Smoothed 0..~0.3 "how loud is the dry signal right now", NOT the gain itself — the gain is
   *  a separate setTargetAtTime ramp computed off this each poll. */
  private echoLabDuckEnvelope = 0
  private echoLabDuckTimerId: ReturnType<typeof setInterval> | null = null
  private echoLabSettings: EchoLabSettings = { ...DEFAULT_ECHO_LAB }
  /** Last colorDrive a WaveShaper curve was actually built for — regenerating a 256-sample curve
   *  on every unrelated knob tweak would be wasteful, so setEchoLab only rebuilds it on change. */
  private echoLabColorDriveApplied = -1
  /** The dynamic pair of connections reconcileChainOrder last made, so they can be torn down
   *  cleanly before making a new pair rather than guessing what is currently wired. */
  private chainOrderConnected: { from: AudioNode; to: AudioNode }[] = []
  private reverbConvolver: ConvolverNode | null = null
  private reverbWet: GainNode | null = null
  private reverbDry: GainNode | null = null
  private plate: AudioWorkletNode | null = null
  private plateWet: GainNode | null = null
  private reverbEqLow: BiquadFilterNode | null = null
  private reverbEqHigh: BiquadFilterNode | null = null
  private reverbSettings: ReverbSettings = { ...DEFAULT_REVERB }
  private chorusSettings: ChorusSettings = { ...DEFAULT_CHORUS }
  private chorusIn: GainNode | null = null
  private chorusOut: GainNode | null = null
  private chorusDelayL: DelayNode | null = null
  private chorusDelayR: DelayNode | null = null
  private chorusOscL: OscillatorNode | null = null
  private chorusOscR: OscillatorNode | null = null
  private chorusDepthL: GainNode | null = null
  private chorusDepthR: GainNode | null = null
  private chorusWet: GainNode | null = null
  private chorusMerger: ChannelMergerNode | null = null
  /** Width matrix: each voice's own side, and its bleed into the other. */
  private chorusDirectL: GainNode | null = null
  private chorusDirectR: GainNode | null = null
  private chorusCrossL: GainNode | null = null
  private chorusCrossR: GainNode | null = null
  /** Tremolo — the Modulation block's other circuit. See buildFxChain for the shared-crossover design. */
  private tremOsc: OscillatorNode | null = null
  private tremLowFilter: BiquadFilterNode | null = null
  /** High band = dry − lowpassed, not a separate highpass filter — see buildFxChain. */
  private tremHighSum: GainNode | null = null
  private tremLowInvert: GainNode | null = null
  private tremLowGain: GainNode | null = null
  private tremHighGain: GainNode | null = null
  private tremLowDepthGain: GainNode | null = null
  private tremHighDepthGain: GainNode | null = null
  private tremFullGain: GainNode | null = null
  private tremFullDepthGain: GainNode | null = null
  private tremStdSel: GainNode | null = null
  private tremHarmSel: GainNode | null = null
  private tremWetGain: GainNode | null = null
  private tremBypassGain: GainNode | null = null
  private tremOut: GainNode | null = null
  /** Length of the loaded impulse after trimming, for the UI to report. */
  private reverbLoadedSeconds = 0
  private reverbIrChannels = 0
  private plateAvailable = false
  private reverbMix = 0.25
  private meterBuffer: Float32Array<ArrayBuffer> = new Float32Array(1024)

  /**
   * Tap on the RAW input, before the model.
   *
   * The output analyser can't serve the tuner or a dry-input meter: by then the signal has been
   * through a high-gain amp model that adds harmonics and compresses, so pitch detection would be
   * reading the distortion rather than the string, and the meter would show model output rather
   * than how hard you're driving it — which is the thing you actually set input gain by.
   *
   * This is a pure observer: connecting a node to an analyser does not alter the signal path.
   */
  private inputAnalyser: AnalyserNode | null = null
  private inputBuffer: Float32Array<ArrayBuffer> = new Float32Array(4096)
  /** Gain compensating the active IR's own level; see where it is computed in wireIr(). */
  private irMakeup = 1
  /** Wet/dry blend, kept so a cabinet swap rebuilds at the mix already set. */
  private irMix = 1
  /**
   * Loudness-normalization gain for this capture, and the listener's volume trim.
   *
   * Kept apart so they can be set independently, and multiplied into outputGain. Live used to run
   * at unity with no normalization at all, while the offline preview normalized to
   * TARGET_LOUDNESS_DB — which is why the two modes were nowhere near the same loudness.
   */
  private normalizeGain = 1
  private volume = 1

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
      //
      // channelCount is deliberately NOT constrained. Asking for 1 makes Chromium downmix the
      // interface's inputs together rather than give you the one your guitar is in; the channel
      // is chosen further down the graph instead, where it can be changed without reopening the
      // device.
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(options.deviceId ? { deviceId: { exact: options.deviceId } } : {}),
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        },
        video: false
      })

      await ctx.audioWorklet.addModule('/nam-worklet.js')
      // Loaded unconditionally so switching to the plate reverb mid-session is instant. It is a
      // small text module; the cost is a parse, not a WASM compile.
      try {
        await ctx.audioWorklet.addModule('/reverb-worklet.js')
        this.plateAvailable = true
      } catch (error) {
        this.plateAvailable = false
        this.onError(`Plate reverb unavailable: ${error instanceof Error ? error.message : String(error)}`)
      }
      try {
        await ctx.audioWorklet.addModule('/gate-worklet.js')
        this.gateAvailable = true
      } catch (error) {
        this.gateAvailable = false
        this.onError(`Noise gate unavailable: ${error instanceof Error ? error.message : String(error)}`)
      }

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

      this.normalizeGain = options.normalizeGain ?? 1
      this.volume = options.volume ?? 1
      this.outputGain = ctx.createGain()
      this.outputGain.gain.value = this.normalizeGain * this.volume

      this.source = ctx.createMediaStreamSource(this.stream)

      // Split the input so ONE channel feeds the model, and every channel can be metered. The
      // meters are the point: without them "no sound" and "guitar is in the other input" look
      // identical, and the only way to tell was to unplug and try the other socket.
      const channels = Math.max(1, this.source.channelCount)
      this.splitter = ctx.createChannelSplitter(channels)
      this.source.connect(this.splitter)

      this.channelAnalysers = []
      for (let i = 0; i < channels; i++) {
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 1024
        this.splitter.connect(analyser, i, 0)
        this.channelAnalysers.push(analyser)
      }

      this.inputChannel = Math.min(Math.max(0, options.inputChannel ?? 0), channels - 1)

      // Pre-model tap for the tuner and the dry-input meter, taken from the SELECTED channel so
      // the tuner reads the guitar rather than a sum of both inputs. 4096 rather than 2048
      // because the tuner's accuracy on the low E depends directly on how many periods of it fit
      // in a window: at 82Hz and 48kHz, 2048 samples is barely three.
      this.inputAnalyser = ctx.createAnalyser()
      this.inputAnalyser.fftSize = 4096
      this.splitter.connect(this.inputAnalyser, this.inputChannel, 0)

      // Optional pedal-capture stage, chained ahead of the main model — built before the gate
      // wiring below so the gate can point at whichever node is actually first in the chain.
      // Reuses the same compiled WASM module: a second AudioWorkletNode is a fully separate
      // instance with its own memory, the normal way to run two of one processor.
      let namInput: AudioNode = this.worklet
      if (options.preModelJson) {
        this.preWorklet = new AudioWorkletNode(ctx, 'nam-processor', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          processorOptions: { wasmModule: module, manifest }
        })
        this.preWorklet.port.onmessage = (event: MessageEvent) => {
          const data = event.data as { type?: string; error?: string; stage?: string }
          if (data.type === 'error') {
            this.onError(`pedal stage ${data.stage ?? 'worklet'}: ${data.error ?? 'unknown error'}`)
          }
        }
        const preModelBytes = new TextEncoder().encode(options.preModelJson)
        this.preWorklet.port.postMessage({ type: 'loadModel', modelBytes: preModelBytes }, [preModelBytes.buffer])
        this.preWorklet.port.postMessage({ type: 'setGain', inputGain: 1, outputGain: 1 })
        // The drive into stage two lives on a plain GainNode, not inside either worklet, so it
        // can be ramped from a knob without touching either model.
        this.preGainNode = ctx.createGain()
        this.preGainNode.gain.value = Math.max(0, options.preGain ?? 1)
        this.preWorklet.connect(this.preGainNode)
        this.preGainNode.connect(this.worklet)
        namInput = this.preWorklet
      }

      // Gate on the RAW input, ahead of the model(s) — gating a high-gain model's output means
      // gating noise it has already amplified, which chatters. The tuner tap is deliberately
      // BEFORE the gate, so a gated-out note does not make the tuner go blank mid-adjustment.
      if (this.gateAvailable) {
        try {
          this.gate = new AudioWorkletNode(ctx, 'nam-gate', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1]
          })
          this.splitter.connect(this.gate, this.inputChannel, 0)
          this.gate.connect(namInput)
        } catch (error) {
          this.gate = null
          this.onError(`Noise gate failed to start: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      if (!this.gate) this.splitter.connect(namInput, this.inputChannel, 0)

      this.buildFxChain(ctx)
      this.buildPlate(ctx)
      this.setGate(options.gate ?? DEFAULT_GATE)
      this.setEq(options.eq ?? DEFAULT_EQ)
      this.setDelay(options.delay ?? DEFAULT_DELAY)
      if (options.delayIr) await this.setDelayIr(options.delayIr)
      this.setEchoLab(options.echoLab ?? DEFAULT_ECHO_LAB)
      this.setChorus(options.chorus ?? DEFAULT_CHORUS)
      this.setReverb(options.reverb ?? DEFAULT_REVERB)
      if (options.reverbIr) await this.setReverbIr(options.reverbIr)

      this.irMix = Math.max(0, Math.min(1, options.irMix ?? 1))
      await this.wireIr(options.ir ?? null)

      // Post-everything, so the meter shows what actually reaches the speakers.
      this.analyser = ctx.createAnalyser()
      this.analyser.fftSize = 2048
      this.outputGain.connect(this.analyser)
      this.outputGain.connect(ctx.destination)

      if (options.outputDeviceId) await this.setOutputDevice(options.outputDeviceId)

      // ~33Hz poll for Echo Lab's ducking envelope follower — see the buildFxChain comment by
      // echoLabDuckAnalyser for why this is a plain timer rather than a worklet.
      this.echoLabDuckTimerId = setInterval(() => this.updateEchoLabDuck(), 30)

      await ctx.resume()
    } catch (error) {
      await this.stop()
      throw error instanceof Error ? error : new Error(String(error))
    }
  }

  /**
   * Wire the effects once, at start.
   *
   * Signal order is CHORUS -> DELAY -> REVERB, which is how the same three would be patched on a
   * board. Chorus first because it is a pitch/width treatment of the note itself: put it after the
   * delay and it smears the repeats instead of the note, and after the reverb it would wobble the
   * tail rather than the playing.
   *
   *   fxInput -+-> (dry) ------------------+-> chorusOut -+-> (dry) ---------------+-> fxMid
   *            +-> chorusDelayL/R -> wet --+              +-> delayL <-> delayR ---+
   *
   *   fxMid -+-> reverbDry ------------------------------------------> outputGain
   *          +-> plate ----------> plateWet ---+
   *          +-> convolver -> reverbWet -------+-> eqLow -> eqHigh --> outputGain
   *
   * Everything is built even when fully dry, and silenced with gains instead. Rebuilding a graph
   * mid-stream clicks, and these are reached for while playing — so a couple of idle delay lines
   * buys controls that can be swept without any of that. The convolver is the exception: it only
   * exists once an impulse is loaded, because unlike a delay line it costs real CPU per block.
   */
  private buildFxChain(ctx: AudioContext): void {
    if (!this.outputGain) return

    this.fxInput = ctx.createGain()
    this.fxMid = ctx.createGain()

    // The buses are pinned to two channels EXPLICITLY rather than inheriting a count from
    // whatever happens to be connected. Left to infer, a bus is only as wide as its widest live
    // input, so the convolution delay was stereo when the chorus was on and mono when it was off
    // — width appearing and disappearing with an unrelated effect. Pinning them makes the chain
    // stereo from the chorus onwards regardless of what is switched on.
    for (const bus of [this.fxMid]) {
      bus.channelCount = 2
      bus.channelCountMode = 'explicit'
      bus.channelInterpretation = 'speakers'
    }

    // ── Tone stack (first of all).
    // Always in circuit, and flat when disabled — a shelf or bell at 0 dB is mathematically
    // transparent, so bypassing costs nothing and avoids rewiring the head of the chain.
    this.eqBass = ctx.createBiquadFilter()
    this.eqBass.type = 'lowshelf'
    this.eqBass.frequency.value = EQ_BASS_HZ
    this.eqMid = ctx.createBiquadFilter()
    this.eqMid.type = 'peaking'
    this.eqMid.frequency.value = EQ_MID_HZ
    this.eqMid.Q.value = EQ_MID_Q
    this.eqTreble = ctx.createBiquadFilter()
    this.eqTreble.type = 'highshelf'
    this.eqTreble.frequency.value = EQ_TREBLE_HZ
    for (const f of [this.eqBass, this.eqMid, this.eqTreble]) f.gain.value = 0
    this.fxInput.connect(this.eqBass)
    this.eqBass.connect(this.eqMid)
    this.eqMid.connect(this.eqTreble)

    // ── Chorus (first).
    // A short delay swept by an LFO. Two lines with their oscillators in quadrature so the sides
    // sweep at different points in the cycle — that difference is the chorus, rather than a
    // single detune applied to both.
    this.chorusIn = ctx.createGain()
    this.chorusOut = ctx.createGain()
    this.chorusOut.channelCount = 2
    this.chorusOut.channelCountMode = 'explicit'
    this.chorusOut.channelInterpretation = 'speakers'
    this.chorusWet = ctx.createGain()
    this.chorusWet.gain.value = 0
    this.chorusMerger = ctx.createChannelMerger(2)
    this.chorusDelayL = ctx.createDelay(0.1)
    this.chorusDelayR = ctx.createDelay(0.1)
    this.chorusDelayL.delayTime.value = CHORUS_CENTRE_MS / 1000
    this.chorusDelayR.delayTime.value = CHORUS_CENTRE_MS / 1000
    this.chorusOscL = ctx.createOscillator()
    this.chorusOscR = ctx.createOscillator()
    this.chorusOscL.type = 'sine'
    this.chorusOscR.type = 'sine'
    this.chorusDepthL = ctx.createGain()
    this.chorusDepthR = ctx.createGain()
    this.chorusDepthL.gain.value = 0
    this.chorusDepthR.gain.value = 0
    this.chorusOscL.connect(this.chorusDepthL)
    this.chorusOscR.connect(this.chorusDepthR)
    this.chorusDepthL.connect(this.chorusDelayL.delayTime)
    this.chorusDepthR.connect(this.chorusDelayR.delayTime)

    // Width matrix. Each voice goes to its own side at `direct` and to the other at `cross`,
    // with direct + cross held at 1 so width changes the image without changing the level.
    this.chorusDirectL = ctx.createGain()
    this.chorusDirectR = ctx.createGain()
    this.chorusCrossL = ctx.createGain()
    this.chorusCrossR = ctx.createGain()

    this.eqTreble.connect(this.chorusIn)
    this.chorusIn.connect(this.chorusDelayL)
    this.chorusIn.connect(this.chorusDelayR)
    this.chorusDelayL.connect(this.chorusDirectL)
    this.chorusDelayL.connect(this.chorusCrossL)
    this.chorusDelayR.connect(this.chorusDirectR)
    this.chorusDelayR.connect(this.chorusCrossR)
    this.chorusDirectL.connect(this.chorusMerger, 0, 0)
    this.chorusCrossR.connect(this.chorusMerger, 0, 0)
    this.chorusDirectR.connect(this.chorusMerger, 0, 1)
    this.chorusCrossL.connect(this.chorusMerger, 0, 1)
    this.chorusMerger.connect(this.chorusWet)
    this.chorusWet.connect(this.chorusOut)
    this.eqTreble.connect(this.chorusOut)

    this.chorusOscL.start()
    // A quarter period late, which is the quadrature that gives the two sides independent motion.
    this.chorusOscR.start(ctx.currentTime + 0.25 / Math.max(0.05, this.chorusSettings.rateHz))

    // ── Tremolo, the Modulation block's other circuit (sits after chorusOut, before the delay).
    //
    // Standard and harmonic tremolo share ONE crossover instead of being two separate signal
    // paths: split into low/high bands always, then modulate both bands with the SAME sign for
    // standard (equivalent to modulating the whole signal, since a matched lowpass/highpass pair
    // sums back to ~flat) or OPPOSITE signs for harmonic (low swells as high dips — the
    // silverface Fender "vibrato channel" trick). Flipping harmonic on/off is just flipping the
    // sign of one depth-gain, not a topology change — same "both paths always wired, selected by
    // gain" convention as ping-pong/mono and plate/convolution reverb.
    this.tremOsc = ctx.createOscillator()
    this.tremOsc.type = 'sine'

    // STANDARD tremolo modulates the WHOLE signal on its own path, deliberately NOT through the
    // crossover. A 2nd-order lowpass and highpass at the same corner do not sum back to flat —
    // their phase relationship digs a notch at the crossover — so routing plain tremolo through
    // the band split coloured the tone even with both bands moving together.
    this.tremFullGain = ctx.createGain()
    this.tremFullDepthGain = ctx.createGain()

    // HARMONIC's crossover is deliberately NOT a matched lowpass/highpass pair. Two independent
    // 2nd-order (biquad) filters at the same corner do not sum back to a flat response — there is
    // an inherent dip/coloration in the crossover region, and it gets WIDER at the low Q used
    // here for the wide "sloppy overlap" that makes this phase at all. That non-flat region was
    // very likely why this sounded dark even at rest: real brownface Fender harmonic vibrato uses
    // a gentle passive RC network, not sharp filters, and a first-order complementary pair (one
    // simple lowpass, its complement) reconstructs the original signal exactly when not being
    // modulated — there is no "crossover coloration" to begin with in the real circuit.
    //
    // Reproduced here as a SUBTRACTIVE split instead of two filters: the high band is computed as
    // dry − lowpassed (tremLowInvert is a gain of -1, summed with the dry signal at tremHighSum).
    // That is exact by construction, regardless of the lowpass's order or Q — low + high always
    // reconstructs the dry signal bit-for-bit at rest, so any coloration heard is only ever from
    // the deliberate antiphase modulation, never from the split itself.
    this.tremLowFilter = ctx.createBiquadFilter()
    this.tremLowFilter.type = 'lowpass'
    this.tremLowFilter.frequency.value = TREMOLO_CROSSOVER_HZ
    this.tremLowFilter.Q.value = TREMOLO_CROSSOVER_Q
    this.tremHighSum = ctx.createGain()
    this.tremLowInvert = ctx.createGain()
    this.tremLowInvert.gain.value = -1
    this.tremLowGain = ctx.createGain()
    this.tremHighGain = ctx.createGain()
    this.tremLowDepthGain = ctx.createGain()
    this.tremHighDepthGain = ctx.createGain()

    // Which circuit is heard is a gain choice, not a rewire — same convention as everywhere else.
    this.tremStdSel = ctx.createGain()
    this.tremStdSel.gain.value = 0
    this.tremHarmSel = ctx.createGain()
    this.tremHarmSel.gain.value = 0
    this.tremWetGain = ctx.createGain()
    this.tremWetGain.gain.value = 1
    this.tremBypassGain = ctx.createGain()
    this.tremBypassGain.gain.value = 1
    this.tremOut = ctx.createGain()

    this.chorusOut.connect(this.tremFullGain)
    this.chorusOut.connect(this.tremLowFilter)
    this.chorusOut.connect(this.tremHighSum)
    this.tremLowFilter.connect(this.tremLowInvert)
    this.tremLowInvert.connect(this.tremHighSum)
    this.chorusOut.connect(this.tremBypassGain)
    this.tremFullGain.connect(this.tremStdSel)
    this.tremLowFilter.connect(this.tremLowGain)
    this.tremHighSum.connect(this.tremHighGain)
    this.tremLowGain.connect(this.tremHarmSel)
    this.tremHighGain.connect(this.tremHarmSel)
    this.tremStdSel.connect(this.tremWetGain)
    this.tremHarmSel.connect(this.tremWetGain)
    this.tremWetGain.connect(this.tremOut)
    this.tremBypassGain.connect(this.tremOut)

    this.tremOsc.connect(this.tremFullDepthGain)
    this.tremOsc.connect(this.tremLowDepthGain)
    this.tremOsc.connect(this.tremHighDepthGain)
    this.tremFullDepthGain.connect(this.tremFullGain.gain)
    this.tremLowDepthGain.connect(this.tremLowGain.gain)
    this.tremHighDepthGain.connect(this.tremHighGain.gain)
    this.tremOsc.start()

    // ── Ping-pong delay (second).
    // Input hits the left tap; left feeds right; right feeds back into left through the damping
    // filter. That single crossing is what makes repeats alternate across the stereo field rather
    // than sit in the middle, and it is why the taps are chained instead of parallel.
    this.delayL = ctx.createDelay(MAX_DELAY_SECONDS)
    this.delayR = ctx.createDelay(MAX_DELAY_SECONDS)
    this.delayFeedback = ctx.createGain()
    this.delayDamp = ctx.createBiquadFilter()
    this.delayDamp.type = 'lowpass'
    this.delayWet = ctx.createGain()
    this.delayDry = ctx.createGain()
    this.delayMerger = ctx.createChannelMerger(2)

    // Both topologies are wired at once and selected with gains, rather than reconnected on the
    // fly. Rewiring a live graph clicks, and ping-pong is a switch you flip while playing to hear
    // the difference — so the two paths coexist and only their levels change.
    //
    //   ping-pong: L -> R, both taps heard, feedback from R
    //   mono:      L only, heard on both channels, feedback from L
    this.ppSend = ctx.createGain()
    this.ppTap = ctx.createGain()
    this.ppOut = ctx.createGain()
    this.monoTap = ctx.createGain()
    this.monoOut = ctx.createGain()

    // Junction, not a direct tremOut connection — see reconcileChainOrder. Whatever feeds Delay
    // (tremOut, or Echo Lab's output when Echo Lab comes first) connects to delayIn instead.
    this.delayIn = ctx.createGain()
    this.delayIn.connect(this.delayL)
    this.delayL.connect(this.ppSend)
    this.ppSend.connect(this.delayR)

    this.delayR.connect(this.ppTap)
    this.ppTap.connect(this.delayDamp)
    this.delayL.connect(this.monoTap)
    this.monoTap.connect(this.delayDamp)
    this.delayDamp.connect(this.delayFeedback)
    this.delayFeedback.connect(this.delayL)

    this.delayL.connect(this.delayMerger, 0, 0)
    this.delayR.connect(this.ppOut)
    this.ppOut.connect(this.delayMerger, 0, 1)
    this.delayL.connect(this.monoOut)
    this.monoOut.connect(this.delayMerger, 0, 1)

    // Auto-pan sits after BOTH delay modes and before fxMid, so one sweep serves whichever mode is
    // active. It is pinned to 2 channels for the same reason fxMid and chorusOut are: left to
    // infer, a bus this narrow only widens when something wide happens to already be connected.
    this.delayPanIn = ctx.createGain()
    this.delayPanIn.channelCount = 2
    this.delayPanIn.channelCountMode = 'explicit'
    this.delayPanIn.channelInterpretation = 'speakers'
    this.delayPanner = ctx.createStereoPanner()
    this.delayPanOsc = ctx.createOscillator()
    this.delayPanOsc.type = 'sine'
    this.delayPanOsc.frequency.value = this.delaySettings.panRateHz
    this.delayPanDepth = ctx.createGain()
    // Zero until setDelay turns it on — the oscillator runs continuously, so on/off is depth, not
    // start/stop, which is what lets it fade in click-free instead of jumping to hard left or right.
    this.delayPanDepth.gain.value = 0
    this.delayPanOsc.connect(this.delayPanDepth)
    this.delayPanDepth.connect(this.delayPanner.pan)
    this.delayPanOsc.start()

    this.delayMerger.connect(this.delayWet)
    this.delayWet.connect(this.delayPanIn)
    this.delayPanIn.connect(this.delayPanner)

    this.delayIn.connect(this.delayDry)

    // Combined dry+wet tap — the reroutable "output" of the whole Delay unit. What it connects TO
    // (fxMid directly, or into Echo Lab) is decided by reconcileChainOrder, not fixed here.
    this.delayOut = ctx.createGain()
    this.delayPanner.connect(this.delayOut)
    this.delayDry.connect(this.delayOut)

    // Convolution branch. Built empty; setDelayIr adds the convolver once an impulse is chosen,
    // because unlike a delay line a convolver costs real CPU per block even with nothing to do.
    this.delayConvWet = ctx.createGain()
    this.delayConvWet.gain.value = 0
    this.delayConvWet.connect(this.delayPanIn)

    this.modOsc = ctx.createOscillator()
    this.modOsc.type = 'sine'
    this.modDepthL = ctx.createGain()
    this.modDepthR = ctx.createGain()
    this.modDepthL.gain.value = 0
    this.modDepthR.gain.value = 0
    this.modOsc.connect(this.modDepthL)
    this.modOsc.connect(this.modDepthR)
    this.modDepthL.connect(this.delayL.delayTime)
    this.modDepthR.connect(this.delayR.delayTime)
    this.modOsc.start()

    // ── Echo Lab (shares Delay's rack slot; see the class-field comment above for the topology
    // diagram). Junction in (echoLabIn) and out (echoLabOut) so reconcileChainOrder can splice
    // this in before or after Delay without rebuilding anything.
    this.echoLabIn = ctx.createGain()
    this.echoLabDry = ctx.createGain()
    this.echoLabDelayL = ctx.createDelay(MAX_DELAY_SECONDS)
    this.echoLabDelayR = ctx.createDelay(MAX_DELAY_SECONDS)
    this.echoLabFeedbackL = ctx.createGain()
    this.echoLabFeedbackR = ctx.createGain()
    this.echoLabToneL = ctx.createBiquadFilter()
    this.echoLabToneL.type = 'lowpass'
    this.echoLabToneR = ctx.createBiquadFilter()
    this.echoLabToneR.type = 'lowpass'
    this.echoLabSatL = ctx.createWaveShaper()
    this.echoLabSatR = ctx.createWaveShaper()

    this.echoLabIn.connect(this.echoLabDry)
    this.echoLabIn.connect(this.echoLabDelayL)

    // R's input is gated, not direct — see the field comments on echoLabDualRGain/echoLabPpSend
    // for why a DelayNode input can't just have two unconditional sources connected to it.
    this.echoLabDualRGain = ctx.createGain()
    this.echoLabDualRGain.gain.value = 0
    this.echoLabIn.connect(this.echoLabDualRGain)
    this.echoLabDualRGain.connect(this.echoLabDelayR)
    this.echoLabPpSend = ctx.createGain()
    this.echoLabPpSend.gain.value = 0

    this.echoLabDelayL.connect(this.echoLabToneL)
    this.echoLabToneL.connect(this.echoLabSatL)
    this.echoLabSatL.connect(this.echoLabPpSend)
    this.echoLabPpSend.connect(this.echoLabDelayR)

    this.echoLabDelayR.connect(this.echoLabToneR)
    this.echoLabToneR.connect(this.echoLabSatR)

    // Feedback source crossfade — see the field comment on echoLabFbLSelf for the reasoning.
    this.echoLabFbLSelf = ctx.createGain()
    this.echoLabFbLSelf.gain.value = 1
    this.echoLabFbLCross = ctx.createGain()
    this.echoLabFbLCross.gain.value = 0
    this.echoLabFbRSelf = ctx.createGain()
    this.echoLabFbRSelf.gain.value = 1
    this.echoLabFbRCross = ctx.createGain()
    this.echoLabFbRCross.gain.value = 0

    this.echoLabSatL.connect(this.echoLabFbLSelf)
    this.echoLabSatR.connect(this.echoLabFbLCross)
    this.echoLabFbLSelf.connect(this.echoLabFeedbackL)
    this.echoLabFbLCross.connect(this.echoLabFeedbackL)
    this.echoLabFeedbackL.connect(this.echoLabDelayL)

    this.echoLabSatR.connect(this.echoLabFbRSelf)
    this.echoLabSatL.connect(this.echoLabFbRCross)
    this.echoLabFbRSelf.connect(this.echoLabFeedbackR)
    this.echoLabFbRCross.connect(this.echoLabFeedbackR)
    this.echoLabFeedbackR.connect(this.echoLabDelayR)

    // Merge: L always on ch0. Ch1 crossfades between a mono duplicate of L (Single) and R's own
    // output (Dual) — same "both paths always wired, selected by gain" convention as Delay's own
    // ping-pong/mono crossfade, so switching Mode live doesn't click or rebuild anything.
    this.echoLabRGain = ctx.createGain()
    this.echoLabRGain.gain.value = 0
    this.echoLabMonoTap = ctx.createGain()
    this.echoLabMonoTap.gain.value = 1
    this.echoLabMerger = ctx.createChannelMerger(2)
    this.echoLabSatL.connect(this.echoLabMerger, 0, 0)
    this.echoLabSatL.connect(this.echoLabMonoTap)
    this.echoLabMonoTap.connect(this.echoLabMerger, 0, 1)
    this.echoLabSatR.connect(this.echoLabRGain)
    this.echoLabRGain.connect(this.echoLabMerger, 0, 1)

    // Width — the exact direct/cross gain matrix already proven on Chorus's Width knob, just
    // applied to Echo Lab's own L/R instead of the two chorus voices.
    this.echoLabSplitter = ctx.createChannelSplitter(2)
    this.echoLabMerger.connect(this.echoLabSplitter)
    this.echoLabWidenDirectL = ctx.createGain()
    this.echoLabWidenDirectR = ctx.createGain()
    this.echoLabWidenCrossL = ctx.createGain()
    this.echoLabWidenCrossR = ctx.createGain()
    this.echoLabWidenMerger = ctx.createChannelMerger(2)
    this.echoLabSplitter.connect(this.echoLabWidenDirectL, 0)
    this.echoLabSplitter.connect(this.echoLabWidenCrossL, 0)
    this.echoLabSplitter.connect(this.echoLabWidenDirectR, 1)
    this.echoLabSplitter.connect(this.echoLabWidenCrossR, 1)
    this.echoLabWidenDirectL.connect(this.echoLabWidenMerger, 0, 0)
    this.echoLabWidenCrossR.connect(this.echoLabWidenMerger, 0, 0)
    this.echoLabWidenDirectR.connect(this.echoLabWidenMerger, 0, 1)
    this.echoLabWidenCrossL.connect(this.echoLabWidenMerger, 0, 1)

    // EQ Low/High — wet-only, mirroring Reverb's own lowDb/highDb shelving exactly (same corner
    // frequencies): it shapes the OVERALL effect, separate from the Character-driven tone filter
    // living inside each feedback loop above, which shapes the repeats themselves.
    this.echoLabEqLow = ctx.createBiquadFilter()
    this.echoLabEqLow.type = 'lowshelf'
    this.echoLabEqLow.frequency.value = REVERB_LOW_SHELF_HZ
    this.echoLabEqHigh = ctx.createBiquadFilter()
    this.echoLabEqHigh.type = 'highshelf'
    this.echoLabEqHigh.frequency.value = REVERB_HIGH_SHELF_HZ
    this.echoLabWidenMerger.connect(this.echoLabEqLow)
    this.echoLabEqLow.connect(this.echoLabEqHigh)

    this.echoLabWet = ctx.createGain()
    this.echoLabWet.gain.value = 0
    this.echoLabEqHigh.connect(this.echoLabWet)

    // Ducking — an envelope follower reading the DRY signal feeding this unit (echoLabIn, tapped
    // passively via an AnalyserNode so it does not affect the audio) drives echoLabDuckGain down
    // while you play and lets it back up in the gaps. No AudioWorklet: a plain setInterval poll
    // (see updateEchoLabDuck) is simple, doesn't need a new processor module, and 30ms resolution
    // is plenty for something that is meant to breathe with playing dynamics, not track sample-
    // accurately — this is the first envelope follower anywhere in this engine.
    this.echoLabDuckAnalyser = ctx.createAnalyser()
    this.echoLabDuckAnalyser.fftSize = 512
    this.echoLabIn.connect(this.echoLabDuckAnalyser)
    this.echoLabDuckGain = ctx.createGain()
    this.echoLabDuckGain.gain.value = 1
    this.echoLabWet.connect(this.echoLabDuckGain)

    // Auto-pan — Echo Lab's own sweep, independent of Delay's, same mechanism.
    this.echoLabPanIn = ctx.createGain()
    this.echoLabPanIn.channelCount = 2
    this.echoLabPanIn.channelCountMode = 'explicit'
    this.echoLabPanIn.channelInterpretation = 'speakers'
    this.echoLabPanner = ctx.createStereoPanner()
    this.echoLabPanOsc = ctx.createOscillator()
    this.echoLabPanOsc.type = 'sine'
    this.echoLabPanOsc.frequency.value = this.echoLabSettings.panRateHz
    this.echoLabPanDepth = ctx.createGain()
    this.echoLabPanDepth.gain.value = 0
    this.echoLabPanOsc.connect(this.echoLabPanDepth)
    this.echoLabPanDepth.connect(this.echoLabPanner.pan)
    this.echoLabPanOsc.start()
    this.echoLabDuckGain.connect(this.echoLabPanIn)
    this.echoLabPanIn.connect(this.echoLabPanner)

    this.echoLabOut = ctx.createGain()
    this.echoLabPanner.connect(this.echoLabOut)
    this.echoLabDry.connect(this.echoLabOut)

    // Modulation LFO — wow/flutter (Tape) or the Deluxe Memory Man's own built-in chorus
    // (Memory Man), same delayTime-modulation trick as Delay's Mod knob. Silent under Digital,
    // which has no modulation-flavored Character knob at all; see setEchoLab.
    this.echoLabModOsc = ctx.createOscillator()
    this.echoLabModOsc.type = 'sine'
    this.echoLabModDepthL = ctx.createGain()
    this.echoLabModDepthR = ctx.createGain()
    this.echoLabModDepthL.gain.value = 0
    this.echoLabModDepthR.gain.value = 0
    this.echoLabModOsc.connect(this.echoLabModDepthL)
    this.echoLabModOsc.connect(this.echoLabModDepthR)
    this.echoLabModDepthL.connect(this.echoLabDelayL.delayTime)
    this.echoLabModDepthR.connect(this.echoLabDelayR.delayTime)
    this.echoLabModOsc.start()

    // ── Reverb tone (third), on the WET path only.
    //
    // Both reverb modes share one pair of shelves, sitting between their wet gains and the output.
    // Wet-only is the whole point: it is what lets a tail be darkened or lifted without touching
    // the amp tone in front of it, and it is where every hardware reverb puts its own tone
    // controls. See REVERB_LOW_SHELF_HZ / REVERB_HIGH_SHELF_HZ for the corner frequencies.
    this.reverbEqLow = ctx.createBiquadFilter()
    this.reverbEqLow.type = 'lowshelf'
    this.reverbEqLow.frequency.value = REVERB_LOW_SHELF_HZ
    this.reverbEqLow.gain.value = 0
    this.reverbEqHigh = ctx.createBiquadFilter()
    this.reverbEqHigh.type = 'highshelf'
    this.reverbEqHigh.frequency.value = REVERB_HIGH_SHELF_HZ
    this.reverbEqHigh.gain.value = 0
    this.reverbEqLow.connect(this.reverbEqHigh)
    this.reverbEqHigh.connect(this.outputGain)

    // Dry path bypasses the reverb EQ entirely — it is not reverb.
    this.reverbDry = ctx.createGain()
    this.reverbDry.gain.value = 1
    this.fxMid.connect(this.reverbDry)
    this.reverbDry.connect(this.outputGain)

    // tremOut -> {Delay, Echo Lab in some order} -> fxMid — see reconcileChainOrder.
    this.reconcileChainOrder()
  }

  /**
   * Splices Delay and Echo Lab into series in whichever order Echo Lab's own
   * secondaryDelayPosition asks for, by connecting/disconnecting exactly the two dynamic hops
   * (tremOut -> first unit's *In, last unit's *Out -> fxMid) rather than rebuilding either unit's
   * internal graph. Called once at startup and again only when that setting actually changes —
   * this is a deliberate, infrequent settings change, not a per-note hot path, so a couple of
   * disconnect/reconnect calls are fine even though they are not click-free the way a gain ramp is.
   */
  private reconcileChainOrder(): void {
    if (!this.tremOut || !this.delayIn || !this.delayOut || !this.echoLabIn || !this.echoLabOut || !this.fxMid) return

    for (const { from, to } of this.chainOrderConnected) {
      try {
        from.disconnect(to)
      } catch {
        // Already disconnected.
      }
    }
    this.chainOrderConnected = []

    const connect = (from: AudioNode, to: AudioNode): void => {
      from.connect(to)
      this.chainOrderConnected.push({ from, to })
    }

    if (this.echoLabSettings.secondaryDelayPosition === 'before') {
      // Delay -> Echo Lab -> fxMid (the confirmed default order).
      connect(this.tremOut, this.delayIn)
      connect(this.delayOut, this.echoLabIn)
      connect(this.echoLabOut, this.fxMid)
    } else {
      // Echo Lab -> Delay -> fxMid.
      connect(this.tremOut, this.echoLabIn)
      connect(this.echoLabOut, this.delayIn)
      connect(this.delayOut, this.fxMid)
    }
  }

  get gateConfig(): GateSettings {
    return { ...this.gateSettings }
  }

  /** Whether the gate worklet loaded. False means the input runs ungated. */
  get hasGate(): boolean {
    return this.gate !== null
  }

  setGate(settings: Partial<GateSettings>): void {
    const next: GateSettings = { ...this.gateSettings, ...settings }
    next.threshold = Math.max(-100, Math.min(0, next.threshold))
    next.openTime = Math.max(0.0005, Math.min(0.5, next.openTime))
    next.holdTime = Math.max(0, Math.min(2, next.holdTime))
    next.closeTime = Math.max(0.001, Math.min(2, next.closeTime))
    this.gateSettings = next
    this.gate?.port.postMessage({ type: 'params', ...next })
  }

  get eq(): EqSettings {
    return { ...this.eqSettings }
  }

  /** Update the tone stack. Disabled means flat, not bypassed — the result is identical. */
  setEq(settings: Partial<EqSettings>): void {
    const next: EqSettings = { ...this.eqSettings, ...settings }
    const clamp = (v: number): number => Math.max(-EQ_MAX_DB, Math.min(EQ_MAX_DB, v))
    next.bassDb = clamp(next.bassDb)
    next.midDb = clamp(next.midDb)
    next.trebleDb = clamp(next.trebleDb)
    this.eqSettings = next

    const ctx = this.ctx
    if (!ctx) return
    const now = ctx.currentTime
    const on = next.enabled
    this.eqBass?.gain.linearRampToValueAtTime(on ? next.bassDb : 0, now + 0.05)
    this.eqMid?.gain.linearRampToValueAtTime(on ? next.midDb : 0, now + 0.05)
    this.eqTreble?.gain.linearRampToValueAtTime(on ? next.trebleDb : 0, now + 0.05)
  }

  get chorus(): ChorusSettings {
    return { ...this.chorusSettings }
  }

  setChorus(settings: Partial<ChorusSettings>): void {
    const next: ChorusSettings = { ...this.chorusSettings, ...settings }
    next.mix = Math.max(0, Math.min(1, next.mix))
    next.depthMs = Math.max(0, Math.min(20, next.depthMs))
    next.rateHz = Math.max(0.05, Math.min(8, next.rateHz))
    next.width = Math.max(0, Math.min(1, next.width))
    next.tremoloDepth = Math.max(0, Math.min(1, next.tremoloDepth))
    this.chorusSettings = next

    const ctx = this.ctx
    if (!ctx) return
    const now = ctx.currentTime
    const RAMP = 0.05
    const chorusActive = next.enabled && next.type === 'chorus'
    const wet = chorusActive ? next.mix : 0
    // Depth is halved because the LFO swings both ways: a 2ms "depth" should sweep 2ms in total,
    // not 2ms either side of centre.
    const depthSec = chorusActive ? next.depthMs / 2000 : 0

    this.chorusWet?.gain.linearRampToValueAtTime(wet, now + RAMP)
    this.chorusOscL?.frequency.linearRampToValueAtTime(next.rateHz, now + RAMP)
    this.chorusOscR?.frequency.linearRampToValueAtTime(next.rateHz, now + RAMP)
    this.chorusDepthL?.gain.linearRampToValueAtTime(depthSec, now + RAMP)
    this.chorusDepthR?.gain.linearRampToValueAtTime(-depthSec, now + RAMP)

    const direct = 0.5 + next.width / 2
    const cross = 0.5 - next.width / 2
    this.chorusDirectL?.gain.linearRampToValueAtTime(direct, now + RAMP)
    this.chorusDirectR?.gain.linearRampToValueAtTime(direct, now + RAMP)
    this.chorusCrossL?.gain.linearRampToValueAtTime(cross, now + RAMP)
    this.chorusCrossR?.gain.linearRampToValueAtTime(cross, now + RAMP)

    // Tremolo — shares the chorus rate knob (both are just an LFO frequency) but its own depth.
    const tremActive = next.enabled && next.type === 'tremolo'
    const harmonic = tremActive && next.harmonic
    this.tremOsc?.frequency.linearRampToValueAtTime(next.rateHz, now + RAMP)
    // Width doubles as the voicing switch in Tremolo mode (it does nothing else there — a real
    // tremolo has no stereo-width control). Below centre: '63 tube-bias, a harder-edged triangle
    // ramp closer to how a biased tube's on/off swing actually moves. At or above centre: '65
    // photocell, sine — the physical lag of a lamp/photoresistor pair rounds the same swing off
    // smoother than any electronic LFO would left alone. A frequency type change, not a new node.
    if (this.tremOsc) this.tremOsc.type = next.width < 0.5 ? 'triangle' : 'sine'
    this.tremBypassGain?.gain.linearRampToValueAtTime(tremActive ? 0 : 1, now + RAMP)
    this.tremStdSel?.gain.linearRampToValueAtTime(tremActive && !harmonic ? 1 : 0, now + RAMP)
    this.tremHarmSel?.gain.linearRampToValueAtTime(harmonic ? 1 : 0, now + RAMP)

    // A modulated gain rides on a centre value with the oscillator swinging around it, so level
    // travels from 1 at the peak down to (1 - depth) at the trough.
    const swing = next.tremoloDepth / 2
    const centre = 1 - swing
    this.tremFullGain?.gain.linearRampToValueAtTime(centre, now + RAMP)
    this.tremFullDepthGain?.gain.linearRampToValueAtTime(swing, now + RAMP)
    this.tremLowGain?.gain.linearRampToValueAtTime(centre, now + RAMP)
    this.tremHighGain?.gain.linearRampToValueAtTime(centre, now + RAMP)
    this.tremLowDepthGain?.gain.linearRampToValueAtTime(swing, now + RAMP)
    // The high band runs in ANTIPHASE — it dips as the low band swells. That opposition, across
    // an overlapping crossover, is what separates harmonic tremolo from plain amplitude tremolo.
    this.tremHighDepthGain?.gain.linearRampToValueAtTime(-swing, now + RAMP)
  }

  /** Seconds of delay impulse being convolved, after trimming. 0 when none. */
  get delayIrSecondsLoaded(): number {
    return this.delayIrSeconds
  }

  /**
   * Channels in the loaded delay impulse.
   *
   * Surfaced because "is this actually stereo" is otherwise unanswerable from outside: the model
   * is mono, so a stereo image can only come from the impulse, and a file that silently arrived
   * as 1 channel looks identical to one that worked.
   */
  get delayIrChannelCount(): number {
    return this.delayIrChannels
  }

  /** Channels in the loaded reverb impulse. Same reasoning as delayIrChannelCount. */
  get reverbIrChannelCount(): number {
    return this.reverbIrChannels
  }

  /**
   * Load or clear the delay impulse.
   *
   * Same treatment as the reverb: stereo preserved, silence trimmed, the browser's calibrated
   * normalization. These impulses are far shorter than reverb ones — a measured rack pack runs to
   * a 1.36s median against a reverb pack's 11s — so the convolution cost is comparatively light.
   */
  async setDelayIr(ir: ImpulseResponse | null): Promise<void> {
    const ctx = this.ctx
    if (!ctx || !this.tremOut || !this.delayConvWet) return

    try {
      this.delayConvolver?.disconnect()
    } catch {
      // Already disconnected.
    }
    this.delayConvolver = null
    this.delayIrSeconds = 0
    this.delayIrChannels = 0

    if (!ir || ir.channels.length === 0 || ir.channels[0].length === 0) return

    const trimmed = trimImpulse(ir)
    const channels = await Promise.all(
      trimmed.channels.map((c) => resampleForContext(c, trimmed.sampleRate, ctx.sampleRate))
    )
    const length = channels[0].length
    if (length === 0) return

    const buffer = ctx.createBuffer(channels.length, length, ctx.sampleRate)
    for (let c = 0; c < channels.length; c++) buffer.copyToChannel(channels[c], c)

    this.delayConvolver = ctx.createConvolver()
    this.delayConvolver.normalize = true
    this.delayConvolver.buffer = buffer
    this.delayIrSeconds = impulseSeconds({ channels: [channels[0]], sampleRate: ctx.sampleRate })
    this.delayIrChannels = channels.length

    this.tremOut.connect(this.delayConvolver)
    this.delayConvolver.connect(this.delayConvWet)
    this.setDelay({})
  }

  get reverb(): ReverbSettings {
    return { ...this.reverbSettings }
  }

  /**
   * Apply reverb settings, switching between the plate and convolution wet paths.
   *
   * Only one wet path is audible at a time, but both stay wired — a convolver with a loaded
   * impulse is expensive to rebuild, and switching modes to compare them is exactly the thing
   * you want to be instant.
   */
  setReverb(settings: Partial<ReverbSettings>): void {
    const next: ReverbSettings = { ...this.reverbSettings, ...settings }
    next.mix = Math.max(0, Math.min(1, next.mix))
    next.roomSize = Math.max(0, Math.min(1, next.roomSize))
    next.damping = Math.max(0, Math.min(1, next.damping))
    next.width = Math.max(0, Math.min(1, next.width))
    next.lowDb = Math.max(-REVERB_EQ_MAX_DB, Math.min(REVERB_EQ_MAX_DB, next.lowDb))
    next.highDb = Math.max(-REVERB_EQ_MAX_DB, Math.min(REVERB_EQ_MAX_DB, next.highDb))
    this.reverbSettings = next
    this.reverbMix = next.mix

    const ctx = this.ctx
    if (!ctx) return
    const now = ctx.currentTime
    const RAMP = 0.05

    const wet = next.enabled ? next.mix : 0
    const plateWet = next.mode === 'plate' ? wet : 0
    const convWet = next.mode === 'convolution' ? wet : 0

    // Anchored before ramping — see the matching comment in setDelay for why.
    if (this.plateWet) {
      this.plateWet.gain.setValueAtTime(this.plateWet.gain.value, now)
      this.plateWet.gain.linearRampToValueAtTime(plateWet, now + RAMP)
    }
    if (this.reverbWet) {
      this.reverbWet.gain.setValueAtTime(this.reverbWet.gain.value, now)
      this.reverbWet.gain.linearRampToValueAtTime(convWet, now + RAMP)
    }
    this.reverbDry?.gain.linearRampToValueAtTime(1, now + RAMP)

    this.reverbEqLow?.gain.linearRampToValueAtTime(next.lowDb, now + RAMP)
    this.reverbEqHigh?.gain.linearRampToValueAtTime(next.highDb, now + RAMP)

    this.plate?.port.postMessage({
      type: 'params',
      roomSize: next.roomSize,
      damping: next.damping,
      width: next.width
    })
  }

  /** Whether the plate worklet loaded. False means only convolution is available. */
  get hasPlateReverb(): boolean {
    return this.plateAvailable
  }

  /** Build the plate reverb node. Separate from buildFxChain because it needs the module loaded. */
  private buildPlate(ctx: AudioContext): void {
    if (!this.plateAvailable || !this.fxMid || !this.outputGain) return
    try {
      this.plate = new AudioWorkletNode(ctx, 'freeverb', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2]
      })
      this.plateWet = ctx.createGain()
      this.plateWet.gain.value = 0
      this.fxMid.connect(this.plate)
      this.plate.connect(this.plateWet)
      this.plateWet.connect(this.reverbEqLow ?? this.outputGain)
    } catch (error) {
      this.plateAvailable = false
      this.onError(`Plate reverb failed to start: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Current delay settings, so the UI can render what the engine actually holds. */
  get delay(): DelaySettings {
    return { ...this.delaySettings }
  }

  /**
   * Update the delay.
   *
   * Times are ramped rather than assigned: writing DelayNode.delayTime directly while audio is
   * flowing jumps the read head and clicks, where a short ramp pitch-bends the tails the way a
   * real delay does when you turn the knob.
   */
  setDelay(settings: Partial<DelaySettings>): void {
    const next: DelaySettings = { ...this.delaySettings, ...settings }
    next.mix = Math.max(0, Math.min(1, next.mix))
    next.feedback = Math.max(0, Math.min(MAX_FEEDBACK, next.feedback))
    next.ratio = Math.max(0.05, Math.min(2, next.ratio))
    next.timeMs = Math.max(1, Math.min(MAX_DELAY_SECONDS * 1000, next.timeMs))
    next.toneHz = Math.max(200, Math.min(20000, next.toneHz))
    next.modDepthMs = Math.max(0, Math.min(MAX_MOD_DEPTH_MS, next.modDepthMs))
    next.modRateHz = Math.max(0.05, Math.min(12, next.modRateHz))
    next.panRateHz = Math.max(MIN_PAN_RATE_HZ, Math.min(MAX_PAN_RATE_HZ, next.panRateHz))
    // Number.isFinite guard, not just clamping: a settings object missing this field entirely
    // (an old preset predating it) has it as undefined, and Math.min(1, undefined) is NaN — which
    // would then propagate into the ping-pong crossfade gains below and make them behave
    // unpredictably instead of throwing anywhere obvious. Falls back to 1 (full ping-pong),
    // matching what the boolean-only pingPong field meant before this existed.
    next.pingPongWidth = Number.isFinite(next.pingPongWidth) ? Math.max(0, Math.min(1, next.pingPongWidth)) : 1
    this.delaySettings = next

    const ctx = this.ctx
    if (!ctx) return
    const now = ctx.currentTime
    const RAMP = 0.05

    // The right tap is the SECOND half of the ping-pong, so the pair must sum to the full time or
    // the ratio control would also change the tempo of the repeats.
    const leftSec = (next.timeMs / 1000) * (next.ratio >= 1 ? 1 : next.ratio)
    const rightSec = (next.timeMs / 1000) * (next.ratio >= 1 ? next.ratio : 1)

    this.delayL?.delayTime.linearRampToValueAtTime(Math.min(leftSec, MAX_DELAY_SECONDS), now + RAMP)
    this.delayR?.delayTime.linearRampToValueAtTime(Math.min(rightSec, MAX_DELAY_SECONDS), now + RAMP)
    if (this.delayFeedback) this.delayFeedback.gain.linearRampToValueAtTime(next.feedback, now + RAMP)
    if (this.delayDamp) this.delayDamp.frequency.linearRampToValueAtTime(next.toneHz, now + RAMP)
    const wet = next.enabled ? next.mix : 0
    // Anchored with setValueAtTime before ramping: without it, a linearRampToValueAtTime can
    // start its ramp from whatever value a PREVIOUS ramp was scheduled to end at, rather than
    // the param's actual current value — usually invisible, but on the very first enable after
    // sitting at 0 it could mean the new ramp starts from a stale target instead of 0, which
    // reads as "turned it on, heard nothing" until the next toggle schedules a correct one.
    if (this.delayWet) {
      this.delayWet.gain.setValueAtTime(this.delayWet.gain.value, now)
      this.delayWet.gain.linearRampToValueAtTime(next.mode === 'algorithmic' ? wet : 0, now + RAMP)
    }
    if (this.delayConvWet) {
      this.delayConvWet.gain.setValueAtTime(this.delayConvWet.gain.value, now)
      this.delayConvWet.gain.linearRampToValueAtTime(next.mode === 'convolution' ? wet : 0, now + RAMP)
    }
    // Equal-gain rather than equal-power: the dry signal is the capture itself, and dipping it as
    // you add ambience makes the amp sound like it is losing level rather than gaining space.
    if (this.delayDry) this.delayDry.gain.linearRampToValueAtTime(1, now + RAMP)

    // The crossfade between the two topologies (see buildFxChain) now takes a continuous amount
    // instead of a hard 0/1 — that IS the whole feature: 0 sounds like Center even with
    // Ping-Pong selected, 1 is full hard-alternating stereo, everywhere between is in between.
    const pp = next.pingPong ? next.pingPongWidth : 0
    this.ppSend?.gain.linearRampToValueAtTime(pp, now + RAMP)
    this.ppTap?.gain.linearRampToValueAtTime(pp, now + RAMP)
    this.ppOut?.gain.linearRampToValueAtTime(pp, now + RAMP)
    this.monoTap?.gain.linearRampToValueAtTime(1 - pp, now + RAMP)
    this.monoOut?.gain.linearRampToValueAtTime(1 - pp, now + RAMP)

    const depthSec = next.modDepthMs / 1000
    if (this.modOsc) this.modOsc.frequency.linearRampToValueAtTime(next.modRateHz, now + RAMP)
    if (this.modDepthL) this.modDepthL.gain.linearRampToValueAtTime(depthSec, now + RAMP)
    if (this.modDepthR) this.modDepthR.gain.linearRampToValueAtTime(-depthSec, now + RAMP)

    if (this.delayPanOsc) this.delayPanOsc.frequency.linearRampToValueAtTime(next.panRateHz, now + RAMP)
    if (this.delayPanDepth) {
      this.delayPanDepth.gain.linearRampToValueAtTime(next.panEnabled ? 1 : 0, now + RAMP)
    }
  }

  get echoLab(): EchoLabSettings {
    return { ...this.echoLabSettings }
  }

  /**
   * Apply Echo Lab settings. Ducking's own knobs (duckEnabled/duckDepth/duckReleaseMs) are
   * accepted and clamped here but not yet READ by any node — no envelope follower exists in this
   * engine yet. Everything else is fully live: Single/Dual topology, all three Characters, EQ,
   * Color/Drive, Width, Pan, and the series position relative to the orange Delay.
   */
  setEchoLab(settings: Partial<EchoLabSettings>): void {
    const prevOrder = this.echoLabSettings.secondaryDelayPosition
    const next: EchoLabSettings = { ...this.echoLabSettings, ...settings }
    next.mix = Math.max(0, Math.min(1, next.mix))
    next.timeMs = Math.max(1, Math.min(MAX_DELAY_SECONDS * 1000, next.timeMs))
    next.feedback = Math.max(0, Math.min(MAX_FEEDBACK, next.feedback))
    // Number.isFinite guard, not just clamping — same defensive reasoning as the orange Delay's
    // own pingPongWidth: a settings object missing this field (an old preset) would otherwise
    // propagate NaN into the crossfade gains below.
    next.pingPongWidth = Number.isFinite(next.pingPongWidth) ? Math.max(0, Math.min(1, next.pingPongWidth)) : 0
    next.leftTimeMs = Math.max(1, Math.min(MAX_DELAY_SECONDS * 1000, next.leftTimeMs))
    next.rightTimeMs = Math.max(1, Math.min(MAX_DELAY_SECONDS * 1000, next.rightTimeMs))
    next.leftFeedback = Math.max(0, Math.min(MAX_FEEDBACK, next.leftFeedback))
    next.rightFeedback = Math.max(0, Math.min(MAX_FEEDBACK, next.rightFeedback))
    next.spread = Math.max(0, Math.min(1, next.spread))
    next.colorDrive = Math.max(0, Math.min(1, next.colorDrive))
    next.width = Math.max(0, Math.min(1, next.width))
    next.eqLowDb = Math.max(-REVERB_EQ_MAX_DB, Math.min(REVERB_EQ_MAX_DB, next.eqLowDb))
    next.eqHighDb = Math.max(-REVERB_EQ_MAX_DB, Math.min(REVERB_EQ_MAX_DB, next.eqHighDb))
    next.duckDepth = Math.max(0, Math.min(1, next.duckDepth))
    next.duckReleaseMs = Math.max(20, Math.min(2000, next.duckReleaseMs))
    next.panRateHz = Math.max(MIN_PAN_RATE_HZ, Math.min(MAX_PAN_RATE_HZ, next.panRateHz))
    next.modRateHz = Math.max(MIN_PAN_RATE_HZ, Math.min(MAX_PAN_RATE_HZ, next.modRateHz))
    // char1/char2's valid range depends on which Character is selected — same knob, different
    // meaning, so the clamp has to be looked up rather than fixed. Mirrors RackEchoLab's own
    // CHAR1_RANGE/CHAR2_RANGE tables; keep the two in sync if either changes.
    const char1Range: [number, number] =
      next.character === 'tape' ? [0, MAX_MOD_DEPTH_MS] : next.character === 'memoryman' ? [500, 8000] : [-12, 12]
    const char2Range: [number, number] = next.character === 'memoryman' ? [0, MAX_MOD_DEPTH_MS] : [0, 1]
    next.char1 = Math.max(char1Range[0], Math.min(char1Range[1], next.char1))
    next.char2 = Math.max(char2Range[0], Math.min(char2Range[1], next.char2))
    this.echoLabSettings = next

    const ctx = this.ctx
    if (!ctx) return
    const now = ctx.currentTime
    const RAMP = 0.05
    const single = next.topology === 'single'

    const leftSec = (single ? next.timeMs : next.leftTimeMs) / 1000
    // Spread pulls Right away from Left's own time, symmetrically — the same "one knob instead of
    // two independent numbers" idea as the orange Delay's ping-pong-width fader.
    const rightSec = single
      ? leftSec
      : Math.max(0.001, Math.min(MAX_DELAY_SECONDS, (next.rightTimeMs / 1000) * (1 + next.spread)))

    this.echoLabDelayL?.delayTime.linearRampToValueAtTime(Math.min(leftSec, MAX_DELAY_SECONDS), now + RAMP)
    this.echoLabDelayR?.delayTime.linearRampToValueAtTime(rightSec, now + RAMP)
    this.echoLabFeedbackL?.gain.linearRampToValueAtTime(single ? next.feedback : next.leftFeedback, now + RAMP)
    this.echoLabFeedbackR?.gain.linearRampToValueAtTime(single ? next.feedback : next.rightFeedback, now + RAMP)

    // Ping-Pong (Single) vs independent Dual — both topologies stay wired, selected entirely by
    // gain, same convention as everywhere else in this file. pp is 0 in Dual (meaningless there,
    // Spread already provides real stereo) and next.pingPongWidth in Single.
    const pp = single ? next.pingPongWidth : 0
    this.echoLabDualRGain?.gain.linearRampToValueAtTime(single ? 0 : 1, now + RAMP)
    this.echoLabPpSend?.gain.linearRampToValueAtTime(pp, now + RAMP)
    this.echoLabFbLSelf?.gain.linearRampToValueAtTime(single ? 1 - pp : 1, now + RAMP)
    this.echoLabFbLCross?.gain.linearRampToValueAtTime(single ? pp : 0, now + RAMP)
    this.echoLabFbRSelf?.gain.linearRampToValueAtTime(single ? 1 - pp : 1, now + RAMP)
    this.echoLabFbRCross?.gain.linearRampToValueAtTime(single ? pp : 0, now + RAMP)
    // R's contribution to the stereo merge now reflects Ping-Pong being engaged, not just Dual.
    this.echoLabRGain?.gain.linearRampToValueAtTime(single ? pp : 1, now + RAMP)
    this.echoLabMonoTap?.gain.linearRampToValueAtTime(single ? 1 - pp : 0, now + RAMP)

    // Character drives the feedback-loop tone filter, and which char1/char2 knob (if either)
    // feeds the modulation LFO. Digital stays effectively transparent regardless of char1's Tilt
    // value living in a wide, near-inaudible range rather than a separate filter node.
    let toneHz: number
    let modDepthMsL: number
    if (next.character === 'tape') {
      toneHz = 8000 - next.char2 * 6000
      modDepthMsL = next.char1
    } else if (next.character === 'memoryman') {
      toneHz = next.char1
      modDepthMsL = next.char2
    } else {
      toneHz = 6000 + ((next.char1 + 12) / 24) * 12000
      modDepthMsL = 0
    }
    const toneClamped = Math.max(200, Math.min(18000, toneHz))
    this.echoLabToneL?.frequency.linearRampToValueAtTime(toneClamped, now + RAMP)
    this.echoLabToneR?.frequency.linearRampToValueAtTime(toneClamped, now + RAMP)

    const modDepthSec = (next.character === 'digital' ? 0 : modDepthMsL) / 1000
    if (this.echoLabModOsc) this.echoLabModOsc.frequency.linearRampToValueAtTime(next.modRateHz, now + RAMP)
    this.echoLabModDepthL?.gain.linearRampToValueAtTime(modDepthSec, now + RAMP)
    this.echoLabModDepthR?.gain.linearRampToValueAtTime(-modDepthSec, now + RAMP)

    // A WaveShaper curve isn't an AudioParam — only rebuild it when Color/Drive actually changed.
    if (next.colorDrive !== this.echoLabColorDriveApplied) {
      const curve = makeSoftClipCurve(next.colorDrive)
      if (this.echoLabSatL) this.echoLabSatL.curve = curve
      if (this.echoLabSatR) this.echoLabSatR.curve = curve
      this.echoLabColorDriveApplied = next.colorDrive
    }

    const wet = next.enabled ? next.mix : 0
    if (this.echoLabWet) {
      this.echoLabWet.gain.setValueAtTime(this.echoLabWet.gain.value, now)
      this.echoLabWet.gain.linearRampToValueAtTime(wet, now + RAMP)
    }
    if (this.echoLabDry) this.echoLabDry.gain.linearRampToValueAtTime(1, now + RAMP)

    const direct = 0.5 + next.width / 2
    const cross = 0.5 - next.width / 2
    this.echoLabWidenDirectL?.gain.linearRampToValueAtTime(direct, now + RAMP)
    this.echoLabWidenDirectR?.gain.linearRampToValueAtTime(direct, now + RAMP)
    this.echoLabWidenCrossL?.gain.linearRampToValueAtTime(cross, now + RAMP)
    this.echoLabWidenCrossR?.gain.linearRampToValueAtTime(cross, now + RAMP)

    this.echoLabEqLow?.gain.linearRampToValueAtTime(next.eqLowDb, now + RAMP)
    this.echoLabEqHigh?.gain.linearRampToValueAtTime(next.eqHighDb, now + RAMP)

    if (this.echoLabPanOsc) this.echoLabPanOsc.frequency.linearRampToValueAtTime(next.panRateHz, now + RAMP)
    this.echoLabPanDepth?.gain.linearRampToValueAtTime(next.panEnabled ? 1 : 0, now + RAMP)

    if (next.secondaryDelayPosition !== prevOrder) this.reconcileChainOrder()
  }

  /**
   * Ducking's envelope follower, polled from a setInterval (see start()) rather than driven by
   * onaudioprocess/AudioWorklet — this only needs to breathe with playing dynamics, not track
   * sample-accurately, so a ~33Hz JS poll is the simplest thing that is actually correct.
   *
   * Two time constants smoothed separately: the ENVELOPE itself (how "loud right now" is tracked
   * off the raw RMS, fast attack / user's Release on the way down) and the GAIN ramp applied to
   * the wet signal (a short fixed setTargetAtTime, just enough to avoid zipper noise) — conflating
   * these into one smoothing stage would make Release also control how fast ducking ENGAGES, which
   * is backwards from how a real ducker's attack/release knobs behave.
   */
  private updateEchoLabDuck(): void {
    const ctx = this.ctx
    if (!ctx || !this.echoLabDuckAnalyser || !this.echoLabDuckGain) return
    const settings = this.echoLabSettings
    const now = ctx.currentTime

    if (!settings.duckEnabled) {
      this.echoLabDuckGain.gain.setTargetAtTime(1, now, 0.05)
      this.echoLabDuckEnvelope = 0
      return
    }

    this.echoLabDuckAnalyser.getFloatTimeDomainData(this.echoLabDuckBuffer)
    let sumSq = 0
    for (let i = 0; i < this.echoLabDuckBuffer.length; i++) {
      const v = this.echoLabDuckBuffer[i]
      sumSq += v * v
    }
    const rms = Math.sqrt(sumSq / this.echoLabDuckBuffer.length)

    const POLL_SEC = 0.03
    const ATTACK_TC = 0.01
    const releaseTc = Math.max(0.02, settings.duckReleaseMs / 1000)
    const tc = rms > this.echoLabDuckEnvelope ? ATTACK_TC : releaseTc
    const alpha = 1 - Math.exp(-POLL_SEC / tc)
    this.echoLabDuckEnvelope += (rms - this.echoLabDuckEnvelope) * alpha

    // Linear map off RMS rather than a hard threshold/gate, so the duck breathes with playing
    // dynamics instead of snapping — 0.15 is comfortably inside normal playing level, chosen so
    // full duckDepth is reached on ordinary playing rather than only on a hard-picked peak.
    const drive = Math.min(1, this.echoLabDuckEnvelope / 0.15)
    const targetGain = 1 - drive * settings.duckDepth
    this.echoLabDuckGain.gain.setTargetAtTime(targetGain, now, 0.02)
  }

  get reverbMixValue(): number {
    return this.reverbMix
  }

  /** Reverb wet/dry, without touching the impulse. */
  setReverbMix(mix: number): void {
    this.reverbMix = Math.max(0, Math.min(1, mix))
    const ctx = this.ctx
    if (!ctx) return
    const now = ctx.currentTime
    if (this.reverbWet) {
      this.reverbWet.gain.linearRampToValueAtTime(this.reverbMix, now + 0.05)
    }
    if (this.reverbDry) this.reverbDry.gain.linearRampToValueAtTime(1, now + 0.05)
  }

  /** Seconds of reverb impulse actually being convolved, after trimming. 0 when none. */
  get reverbSeconds(): number {
    return this.reverbLoadedSeconds
  }

  /**
   * Load or clear the reverb impulse.
   *
   * Three things differ from the cabinet path, all because a reverb impulse is a different animal
   * — a measured Strymon BigSky set is 61 s, stereo, 44.1 kHz, against a cabinet's ~20-200 ms mono:
   *
   *  1. STEREO IS KEPT. The cabinet path takes channel 0 and discards the rest, which is fine for
   *     a mono cabinet capture and destroys a reverb: the width between the two channels is most
   *     of what you are buying.
   *
   *  2. NORMALIZATION IS THE BROWSER'S. ConvolverNode.normalize implements the spec's calibrated
   *     scale (a fixed gain calibration and a sample-rate correction over the impulse's total
   *     energy), which exists precisely for reverb impulses. The cabinet's hand-rolled 1/L2 makeup
   *     is calibrated for something a thousand times shorter, and applied to a 61 s tail it lands
   *     nowhere near a usable wet level.
   *
   *  3. THE TAIL IS TRIMMED. ~82% of each of those files is silent padding, and convolving
   *     against silence costs CPU every block for nothing.
   */
  async setReverbIr(ir: ImpulseResponse | null): Promise<void> {
    const ctx = this.ctx
    if (!ctx || !this.fxMid || !this.outputGain) return

    if (this.reverbConvolver || this.reverbWet) {
      try {
        this.reverbConvolver?.disconnect()
        this.reverbWet?.disconnect()
      } catch {
        // Already disconnected.
      }
      this.reverbConvolver = null
      this.reverbWet = null
      this.reverbLoadedSeconds = 0
      this.reverbIrChannels = 0
    }

    if (!ir || ir.channels.length === 0 || ir.channels[0].length === 0) {
      this.setReverbMix(this.reverbMix)
      return
    }

    const trimmed = trimImpulse(ir)
    const channels = await Promise.all(
      trimmed.channels.map((channel) =>
        resampleForContext(channel, trimmed.sampleRate, ctx.sampleRate)
      )
    )
    const length = channels[0].length
    if (length === 0) return

    const buffer = ctx.createBuffer(channels.length, length, ctx.sampleRate)
    for (let c = 0; c < channels.length; c++) buffer.copyToChannel(channels[c], c)

    this.reverbConvolver = ctx.createConvolver()
    this.reverbConvolver.normalize = true
    this.reverbConvolver.buffer = buffer
    this.reverbLoadedSeconds = impulseSeconds({ channels: [channels[0]], sampleRate: ctx.sampleRate })
    this.reverbIrChannels = channels.length

    this.reverbWet = ctx.createGain()
    this.reverbWet.gain.value = this.reverbMix

    this.fxMid.connect(this.reverbConvolver)
    this.reverbConvolver.connect(this.reverbWet)
    this.reverbWet.connect(this.reverbEqLow ?? this.outputGain)
    // Re-apply so a freshly built wet node picks up the current mode and mix.
    this.setReverb({})
  }

  /**
   * Build (or rebuild) the cabinet stage between the model and the output.
   *
   * Split out of start() because the IR has to be changeable while playing: rebuilding the whole
   * engine to try another cab would drop the mic, reload the model and silence you for about a
   * second, which makes comparing two cabs by ear impossible.
   *
   * Assumes the caller has already disconnected the worklet's outputs.
   */
  private async wireIr(ir: { samples: Float32Array; sampleRate: number } | null): Promise<void> {
    const ctx = this.ctx
    if (!ctx || !this.worklet || !this.fxInput) return

    // Drop any previous cabinet stage.
    for (const node of [this.convolver, this.wetGain, this.dryGain]) {
      try {
        node?.disconnect()
      } catch {
        // Already disconnected.
      }
    }
    this.convolver = null
    this.wetGain = null
    this.dryGain = null
    this.irMakeup = 1

    if (!ir || ir.samples.length === 0 || this.irMix <= 0) {
      this.worklet.connect(this.fxInput)
      return
    }

    // Parallel wet/dry so cab amount stays blendable, matching the offline path.
    this.convolver = ctx.createConvolver()
    this.convolver.normalize = false

    // Always route through resampleForContext: it short-circuits when the rates match, and
    // returns a fresh ArrayBuffer-backed array, which copyToChannel's typing requires.
    const irSamples = await resampleForContext(ir.samples, ir.sampleRate, ctx.sampleRate)
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
    this.irMakeup = irEnergy > 0 ? 1 / Math.sqrt(irEnergy) : 1

    this.wetGain = ctx.createGain()
    this.wetGain.gain.value = this.irMix * this.irMakeup
    this.dryGain = ctx.createGain()
    this.dryGain.gain.value = 1 - this.irMix

    this.worklet.connect(this.convolver)
    this.convolver.connect(this.wetGain)
    this.wetGain.connect(this.fxInput)

    this.worklet.connect(this.dryGain)
    this.dryGain.connect(this.fxInput)
  }

  /**
   * Swap the cabinet while playing.
   *
   * Rewiring an audio graph mid-stream steps the signal discontinuously, which is an audible
   * click through headphones, so the output is faded down first and back up after. The fade is
   * short enough to read as a crossfade between cabs rather than a gap.
   */
  async setIr(ir: { samples: Float32Array; sampleRate: number } | null): Promise<void> {
    const ctx = this.ctx
    if (!ctx || !this.worklet || !this.fxInput || !this.outputGain) return

    const FADE = 0.02
    const now = ctx.currentTime
    const gain = this.outputGain.gain
    gain.cancelScheduledValues(now)
    gain.setValueAtTime(gain.value, now)
    gain.linearRampToValueAtTime(0.0001, now + FADE)

    // Let the fade actually reach silence before the graph changes under it.
    await new Promise((resolve) => setTimeout(resolve, FADE * 1000 + 5))
    if (this.ctx !== ctx) return // Stopped while we waited.

    try {
      this.worklet.disconnect()
    } catch {
      // Already disconnected.
    }
    // The tap is on the source, not the worklet, so it survives this rewiring untouched.
    await this.wireIr(ir)
    if (this.ctx !== ctx) return

    const resumeAt = ctx.currentTime
    gain.cancelScheduledValues(resumeAt)
    gain.setValueAtTime(gain.value, resumeAt)
    gain.linearRampToValueAtTime(this.normalizeGain * this.volume, resumeAt + FADE)
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

  /** Peak of the raw input, 0..1 — what to set input gain by, before the model colours it. */
  readInputPeak(): number {
    if (!this.inputAnalyser) return 0
    if (this.inputBuffer.length !== this.inputAnalyser.fftSize) {
      this.inputBuffer = new Float32Array(this.inputAnalyser.fftSize)
    }
    this.inputAnalyser.getFloatTimeDomainData(this.inputBuffer)
    let peak = 0
    for (let i = 0; i < this.inputBuffer.length; i++) {
      const v = Math.abs(this.inputBuffer[i])
      if (v > peak) peak = v
    }
    return peak
  }

  /**
   * Fill `out` with raw input samples for pitch detection.
   *
   * Caller owns the buffer so the tuner can reuse one array per frame rather than allocating in a
   * requestAnimationFrame loop.
   */
  getInputTimeDomain(out: Float32Array): void {
    this.inputAnalyser?.getFloatTimeDomainData(out as Float32Array<ArrayBuffer>)
  }

  /** True once the input tap exists, so callers can tell "no signal" from "not connected". */
  get hasInputTap(): boolean {
    return this.inputAnalyser !== null
  }

  /** How many input channels the open device actually has. 0 when not running. */
  get inputChannelCount(): number {
    return this.channelAnalysers.length
  }

  /** Which channel currently feeds the model. */
  get selectedInputChannel(): number {
    return this.inputChannel
  }

  /**
   * Route a different input channel into the model.
   *
   * Rewires rather than restarting, so switching inputs to find your guitar does not drop the
   * device and reload the model each time you try one.
   */
  setInputChannel(channel: number): void {
    if (!this.splitter || !this.worklet || !this.inputAnalyser) return
    const next = Math.min(Math.max(0, channel), this.channelAnalysers.length - 1)
    if (next === this.inputChannel) return
    try {
      if (this.gate) this.splitter.disconnect(this.gate)
      else this.splitter.disconnect(this.worklet)
      this.splitter.disconnect(this.inputAnalyser)
    } catch {
      // Not connected yet.
    }
    this.inputChannel = next
    if (this.gate) this.splitter.connect(this.gate, next, 0)
    else this.splitter.connect(this.worklet, next, 0)
    this.splitter.connect(this.inputAnalyser, next, 0)
  }

  /** Peak level of every input channel, 0..1 — what the channel picker's meters show. */
  readChannelPeaks(): number[] {
    return this.channelAnalysers.map((analyser) => {
      if (this.channelBuffer.length !== analyser.fftSize) {
        this.channelBuffer = new Float32Array(analyser.fftSize)
      }
      analyser.getFloatTimeDomainData(this.channelBuffer)
      let peak = 0
      for (let i = 0; i < this.channelBuffer.length; i++) {
        const v = Math.abs(this.channelBuffer[i])
        if (v > peak) peak = v
      }
      return peak
    })
  }

  /**
   * Send output to a specific device.
   *
   * setSinkId on an AudioContext is comparatively recent, and is absent from the DOM typings we
   * build against, hence the cast. Guarded so an older runtime falls back to the default device
   * rather than throwing and taking live playback down with it.
   */
  async setOutputDevice(deviceId: string | null): Promise<void> {
    const ctx = this.ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null
    if (!ctx || typeof ctx.setSinkId !== 'function') return
    try {
      await ctx.setSinkId(deviceId ?? '')
    } catch (error) {
      this.onError(`Could not switch output device: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  setBypass(bypass: boolean): void {
    this.worklet?.port.postMessage({ type: 'setBypass', bypass })
  }

  setGains(inputGain: number, outputGain: number): void {
    this.worklet?.port.postMessage({ type: 'setGain', inputGain, outputGain })
  }

  /** Drive trim feeding the pedal stage into the amp stage. No-op if no pre-stage is loaded. */
  setPreGain(gain: number): void {
    if (!this.preGainNode || !this.ctx) return
    const now = this.ctx.currentTime
    this.preGainNode.gain.cancelScheduledValues(now)
    this.preGainNode.gain.setValueAtTime(this.preGainNode.gain.value, now)
    this.preGainNode.gain.linearRampToValueAtTime(Math.max(0, gain), now + 0.015)
  }

  hasPreStage(): boolean {
    return this.preWorklet !== null
  }

  /**
   * Player volume, applied at the very end of the chain.
   *
   * Separate from the normalization gain passed to start(): that one decides how loud this
   * capture is relative to other captures, this one is the listener's own trim. Ramped rather
   * than set, because stepping a gain while audio is flowing clicks.
   */
  setOutputVolume(volume: number): void {
    if (!this.outputGain || !this.ctx) return
    this.volume = Math.max(0, volume)
    const target = this.volume * this.normalizeGain
    const now = this.ctx.currentTime
    this.outputGain.gain.cancelScheduledValues(now)
    this.outputGain.gain.setValueAtTime(this.outputGain.gain.value, now)
    this.outputGain.gain.linearRampToValueAtTime(target, now + 0.015)
  }

  /** Change cabinet blend without rebuilding the graph. */
  setIrMix(mix: number): void {
    const wet = Math.max(0, Math.min(1, mix))
    this.irMix = wet
    // Keep the IR makeup applied, or sliding the mix would reintroduce the level jump.
    if (this.wetGain) this.wetGain.gain.value = wet * this.irMakeup
    if (this.dryGain) this.dryGain.gain.value = 1 - wet
  }

  async stop(): Promise<void> {
    if (this.echoLabDuckTimerId) {
      clearInterval(this.echoLabDuckTimerId)
      this.echoLabDuckTimerId = null
    }

    // Release the mic promptly — an open input device is user-visible (OS indicators) and can
    // block other apps from grabbing the interface.
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null

    try {
      this.worklet?.port.postMessage({ type: 'unloadModel' })
    } catch {
      // Port already closed.
    }
    try {
      this.preWorklet?.port.postMessage({ type: 'unloadModel' })
    } catch {
      // Port already closed.
    }

    for (const node of [
      this.source,
      this.splitter,
      ...this.channelAnalysers,
      this.worklet,
      this.preWorklet,
      this.preGainNode,
      this.gate,
      this.fxInput,
      this.fxMid,
      this.eqBass,
      this.eqMid,
      this.eqTreble,
      this.ppSend,
      this.ppTap,
      this.ppOut,
      this.monoTap,
      this.monoOut,
      this.delayConvolver,
      this.delayConvWet,
      this.delayL,
      this.delayR,
      this.delayFeedback,
      this.delayDamp,
      this.delayWet,
      this.delayDry,
      this.delayMerger,
      this.delayPanIn,
      this.delayPanner,
      this.delayPanDepth,
      this.modDepthL,
      this.modDepthR,
      this.reverbConvolver,
      this.reverbWet,
      this.reverbDry,
      this.plate,
      this.plateWet,
      this.reverbEqLow,
      this.reverbEqHigh,
      this.chorusIn,
      this.chorusOut,
      this.chorusWet,
      this.chorusMerger,
      this.chorusDelayL,
      this.chorusDelayR,
      this.chorusDepthL,
      this.chorusDepthR,
      this.chorusDirectL,
      this.chorusDirectR,
      this.chorusCrossL,
      this.chorusCrossR,
      this.tremLowFilter,
      this.tremHighSum,
      this.tremLowInvert,
      this.tremLowGain,
      this.tremHighGain,
      this.tremLowDepthGain,
      this.tremHighDepthGain,
      this.tremWetGain,
      this.tremBypassGain,
      this.tremFullGain,
      this.tremFullDepthGain,
      this.tremStdSel,
      this.tremHarmSel,
      this.tremOut,
      this.convolver,
      this.wetGain,
      this.dryGain,
      this.outputGain,
      this.analyser,
      this.inputAnalyser
    ]) {
      try {
        node?.disconnect()
      } catch {
        // Already disconnected.
      }
    }
    this.source = null
    this.splitter = null
    this.channelAnalysers = []
    this.inputChannel = 0
    this.gate = null
    this.gateSettings = { ...DEFAULT_GATE }
    this.worklet = null
    this.preWorklet = null
    this.preGainNode = null
    this.convolver = null
    this.wetGain = null
    this.dryGain = null
    this.outputGain = null
    this.analyser = null
    this.inputAnalyser = null
    this.irMakeup = 1
    this.irMix = 1
    this.normalizeGain = 1
    this.volume = 1
    this.fxInput = null
    this.fxMid = null
    this.eqBass = null
    this.eqMid = null
    this.eqTreble = null
    this.eqSettings = { ...DEFAULT_EQ }
    this.ppSend = null
    this.ppTap = null
    this.ppOut = null
    this.monoTap = null
    this.monoOut = null
    this.delayConvolver = null
    this.delayConvWet = null
    this.delayIrSeconds = 0
    this.delayIrChannels = 0
    this.delayL = null
    this.delayR = null
    this.delayFeedback = null
    this.delayDamp = null
    this.delayWet = null
    this.delayDry = null
    this.delayMerger = null
    this.delayPanIn = null
    this.delayPanner = null
    try {
      this.delayPanOsc?.stop()
      this.delayPanOsc?.disconnect()
    } catch {
      // Never started, or already stopped.
    }
    this.delayPanOsc = null
    this.delayPanDepth = null
    try {
      this.modOsc?.stop()
      this.modOsc?.disconnect()
    } catch {
      // Never started, or already stopped.
    }
    this.modOsc = null
    this.modDepthL = null
    this.modDepthR = null
    this.delaySettings = { ...DEFAULT_DELAY }
    this.delayIn = null
    this.delayOut = null
    this.echoLabIn = null
    this.echoLabDry = null
    this.echoLabDelayL = null
    this.echoLabDelayR = null
    this.echoLabDualRGain = null
    this.echoLabPpSend = null
    this.echoLabFeedbackL = null
    this.echoLabFeedbackR = null
    this.echoLabFbLSelf = null
    this.echoLabFbLCross = null
    this.echoLabFbRSelf = null
    this.echoLabFbRCross = null
    this.echoLabToneL = null
    this.echoLabToneR = null
    this.echoLabSatL = null
    this.echoLabSatR = null
    try {
      this.echoLabModOsc?.stop()
      this.echoLabModOsc?.disconnect()
    } catch {
      // Never started, or already stopped.
    }
    this.echoLabModOsc = null
    this.echoLabModDepthL = null
    this.echoLabModDepthR = null
    this.echoLabRGain = null
    this.echoLabMonoTap = null
    this.echoLabMerger = null
    this.echoLabSplitter = null
    this.echoLabWidenDirectL = null
    this.echoLabWidenDirectR = null
    this.echoLabWidenCrossL = null
    this.echoLabWidenCrossR = null
    this.echoLabWidenMerger = null
    this.echoLabEqLow = null
    this.echoLabEqHigh = null
    this.echoLabWet = null
    this.echoLabPanIn = null
    this.echoLabPanner = null
    try {
      this.echoLabPanOsc?.stop()
      this.echoLabPanOsc?.disconnect()
    } catch {
      // Never started, or already stopped.
    }
    this.echoLabPanOsc = null
    this.echoLabPanDepth = null
    this.echoLabOut = null
    this.echoLabDuckAnalyser = null
    this.echoLabDuckGain = null
    this.echoLabDuckEnvelope = 0
    this.echoLabSettings = { ...DEFAULT_ECHO_LAB }
    this.echoLabColorDriveApplied = -1
    this.chainOrderConnected = []
    this.reverbConvolver = null
    this.reverbWet = null
    this.reverbDry = null
    this.plate = null
    this.plateWet = null
    this.reverbEqLow = null
    this.reverbEqHigh = null
    this.reverbLoadedSeconds = 0
    this.reverbIrChannels = 0
    this.reverbSettings = { ...DEFAULT_REVERB }
    this.chorusSettings = { ...DEFAULT_CHORUS }
    for (const osc of [this.chorusOscL, this.chorusOscR]) {
      try {
        osc?.stop()
        osc?.disconnect()
      } catch {
        // Never started, or already stopped.
      }
    }
    this.chorusOscL = null
    this.chorusOscR = null
    this.chorusIn = null
    this.chorusOut = null
    this.chorusWet = null
    this.chorusMerger = null
    this.chorusDelayL = null
    this.chorusDelayR = null
    this.chorusDepthL = null
    this.chorusDepthR = null
    this.chorusDirectL = null
    this.chorusDirectR = null
    this.chorusCrossL = null
    this.chorusCrossR = null
    try {
      this.tremOsc?.stop()
      this.tremOsc?.disconnect()
    } catch {
      // Never started, or already stopped.
    }
    this.tremOsc = null
    this.tremLowFilter = null
    this.tremHighSum = null
    this.tremLowInvert = null
    this.tremLowGain = null
    this.tremHighGain = null
    this.tremLowDepthGain = null
    this.tremHighDepthGain = null
    this.tremWetGain = null
    this.tremBypassGain = null
    this.tremFullGain = null
    this.tremFullDepthGain = null
    this.tremStdSel = null
    this.tremHarmSel = null
    this.tremOut = null

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
