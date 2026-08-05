import rackDelayPanel from '../assets/fx/v2c-delay-panel.png'
import { RackKnob } from './RackKnob'
import { RackFader } from './RackFader'
import { RackButton, RackDisplay, RackLed } from './RackParts'
import { rackDimStyle } from './RackPower'
import {
  MAX_FEEDBACK,
  MAX_MOD_DEPTH_MS,
  type DelayMode,
  type DelaySettings
} from '../utils/liveEngine'
import type { DelayPreset } from '../types/settings'

/**
 * The Delay unit as a photoreal rack panel. Geometry measured once against
 * rack-delay-panel.png at 1774x887; everything below is a percentage of that box.
 *
 * The panel art was prepped the same way Reverb's was — LCD glass emptied, pointer notches
 * removed from the knob plates, shaft-hole rim highlights evened out, and both LED states cut
 * as lens-only sprites with the panel's own LEDs erased.
 */

const P = { w: 2172, h: 724 }
const px = (v: number): number => (v / P.w) * 100
const py = (v: number): number => (v / P.h) * 100

const KNOB_XS = [173, 362, 554, 738, 922, 1096].map(px)
const KNOB_Y = py(462)
const KNOB_D = px(142)

const SW_Y = py(515)
const LED_Y = py(426)
const ENGINE_XS = [1554, 1678].map(px)
const STEREO_XS = [1818, 1919, 2021].map(px)
const BTN_W = px(75)
const BTN_H = py(79)
const LED_W = px(30)

const BYPASS_X = px(1940)
const BYPASS_Y = py(240)
const BYPASS_LED_X = px(2023)
const BYPASS_LED_Y = py(212)

/** The two cut channels: Mod Rate on the left, Pan Speed on the right. */
const FADER_XS = [1258, 1388].map(px)
const TRACK_TOP = py(402)
const TRACK_BOTTOM = py(539)
const FADER_CAP_W = px(52)

const LCD = { x: px(937), y: py(220), w: px(1160), h: py(152) }

const pct = (v: number): string => `${Math.round(v * 100)}%`
const hz = (v: number): string => `${v.toFixed(2)} Hz`

/**
 * The STEREO row is three buttons but NOT a three-way choice.
 *
 * Center/Ping-Pong pick the tap topology; Pan is an independent sweep layered on top, exactly as
 * the flat slider UI has always had it. An earlier version here collapsed all three into one
 * exclusive group, which silently changed the delay's topology when you enabled Pan — turning
 * ping-pong off behind your back and audibly changing the sound. Panels do not get to redefine
 * what the engine does.
 */

export function RackDelay({
  delay,
  onChange,
  delayPresets,
  irName,
  irPath,
}: {
  delay: DelaySettings
  onChange: (patch: Partial<DelaySettings>) => void
  delayPresets: DelayPreset[]
  irName: string | null
  /** Currently loaded impulse, for matching against a preset's OWN irPath below — see the matching
   *  comment in RackReverbTest for why this is needed (settings alone don't capture which IR is
   *  loaded, so swapping the IR without touching a knob left the LCD stuck on the old preset). */
  irPath: string | null
}) {
  // A loaded preset names itself and nothing else — the mode is already shown by the lit LED,
  // so prefixing it would spend glass on something the panel already says. With no preset
  // loaded the display falls back to whatever identifies the sound: the impulse in convolution,
  // and the one number you actually dial by ear in algorithmic.
  const activePreset = delayPresets.find(
    (p) => JSON.stringify(p.settings) === JSON.stringify(delay) && p.irPath === irPath
  )
  const lcd = activePreset
    ? activePreset.name.toUpperCase()
    : delay.mode === 'convolution'
      ? (irName ?? 'NO IR').toUpperCase()
      : `DELAY TIME - ${Math.round(delay.timeMs)}MS`

  const setEngine = (mode: DelayMode) => onChange({ mode })

  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <div style={{ position: 'relative', width: '100%', containerType: 'inline-size', ...rackDimStyle(delay.enabled) }}>
        <img src={rackDelayPanel} alt="Delay" draggable={false} style={{ width: '100%', display: 'block', userSelect: 'none' }} />

        <RackKnob label="Mix" value={delay.mix} min={0} max={1} format={pct}
          onChange={(v) => onChange({ mix: v })}
          centerXPct={KNOB_XS[0]} centerYPct={KNOB_Y} diameterPct={KNOB_D} />
        {/* Time/Ratio/Feedback/Tone/Mod all drive the algorithmic delay line — convolution
            replaces that line with a captured impulse, so these do nothing while it's selected.
            Pan speed and the Pan switch are NOT in this set: the convolution wet signal still
            runs through the auto-pan stage (see liveEngine's delayConvWet -> delayPanIn), so pan
            keeps working in either mode. */}
        <RackKnob label="Time" value={delay.timeMs} min={20} max={1200} format={(v) => `${Math.round(v)} ms`}
          locked={delay.mode === 'convolution'}
          onChange={(v) => onChange({ timeMs: v })}
          centerXPct={KNOB_XS[1]} centerYPct={KNOB_Y} diameterPct={KNOB_D} />
        <RackKnob label="Ratio" value={delay.ratio} min={0.25} max={2} format={(v) => `${v.toFixed(2)}x`}
          locked={delay.mode === 'convolution'}
          onChange={(v) => onChange({ ratio: v })}
          centerXPct={KNOB_XS[2]} centerYPct={KNOB_Y} diameterPct={KNOB_D} />
        <RackKnob label="Feedback" value={delay.feedback} min={0} max={MAX_FEEDBACK} format={pct}
          locked={delay.mode === 'convolution'}
          onChange={(v) => onChange({ feedback: v })}
          centerXPct={KNOB_XS[3]} centerYPct={KNOB_Y} diameterPct={KNOB_D} />
        <RackKnob label="Tone" value={delay.toneHz} min={500} max={12000} format={(v) => `${(v / 1000).toFixed(1)} kHz`}
          locked={delay.mode === 'convolution'}
          onChange={(v) => onChange({ toneHz: v })}
          centerXPct={KNOB_XS[4]} centerYPct={KNOB_Y} diameterPct={KNOB_D} />
        <RackKnob label="Mod" value={delay.modDepthMs} min={0} max={MAX_MOD_DEPTH_MS} format={(v) => (v === 0 ? "off" : `${v.toFixed(2)} ms`)}
          locked={delay.mode === 'convolution'}
          onChange={(v) => onChange({ modDepthMs: v })}
          centerXPct={KNOB_XS[5]} centerYPct={KNOB_Y} diameterPct={KNOB_D} />

        {/* Both caps stay fitted whatever the settings — an empty channel just looks broken, and
            gives no clue what the slot is for. Left dims when the parameter is inert: Mod Rate
            until Mod depth is up (or convolution makes it moot entirely). The right fader used to
            be Pan Speed; it's now Ping-Pong Width, a continuous 0..1 instead of the Center/
            Ping-Pong buttons' old hard on/off — 0 sounds like Center even with Ping-Pong selected,
            1 is full hard-alternating stereo. Pan Speed lost its dedicated control in the swap;
            Pan (the auto-sweep toggle) still works, just at a fixed rate now. */}
        <RackFader label="Mod rate" value={delay.modRateHz} min={0.05} max={8} format={hz}
          inert={delay.modDepthMs === 0 || delay.mode === 'convolution'}
          onChange={(v) => onChange({ modRateHz: v })}
          centerXPct={FADER_XS[0]} trackTopPct={TRACK_TOP} trackBottomPct={TRACK_BOTTOM} capWidthPct={FADER_CAP_W} />
        <RackFader label="PP width" value={delay.pingPongWidth} min={0} max={1} format={pct}
          inert={!delay.pingPong || delay.mode === 'convolution'}
          onChange={(v) => onChange({ pingPongWidth: v })}
          centerXPct={FADER_XS[1]} trackTopPct={TRACK_TOP} trackBottomPct={TRACK_BOTTOM} capWidthPct={FADER_CAP_W} />

        <RackButton label="Algorithmic" centerXPct={ENGINE_XS[0]} centerYPct={SW_Y} widthPct={BTN_W} heightPct={BTN_H} onClick={() => setEngine('algorithmic')} />
        <RackButton label="Convolution" centerXPct={ENGINE_XS[1]} centerYPct={SW_Y} widthPct={BTN_W} heightPct={BTN_H} onClick={() => setEngine('convolution')} />
        <RackLed active={delay.mode === 'algorithmic'} centerXPct={ENGINE_XS[0]} centerYPct={LED_Y} widthPct={LED_W} />
        <RackLed active={delay.mode === 'convolution'} centerXPct={ENGINE_XS[1]} centerYPct={LED_Y} widthPct={LED_W} />

        {/* Center/Ping-Pong pick the ALGORITHMIC tap topology specifically — convolution's wet
            signal never touches delayL/delayR, so choosing between them is moot in that mode. */}
        <RackButton label="Center" locked={delay.mode === 'convolution'} centerXPct={STEREO_XS[0]} centerYPct={SW_Y} widthPct={BTN_W} heightPct={BTN_H} onClick={() => onChange({ pingPong: false })} />
        <RackButton label="Ping-Pong" locked={delay.mode === 'convolution'} centerXPct={STEREO_XS[1]} centerYPct={SW_Y} widthPct={BTN_W} heightPct={BTN_H} onClick={() => onChange({ pingPong: true })} />
        <RackButton label="Pan" centerXPct={STEREO_XS[2]} centerYPct={SW_Y} widthPct={BTN_W} heightPct={BTN_H} onClick={() => onChange({ panEnabled: !delay.panEnabled })} />
        <RackLed active={!delay.pingPong} centerXPct={STEREO_XS[0]} centerYPct={LED_Y} widthPct={LED_W} />
        <RackLed active={delay.pingPong} centerXPct={STEREO_XS[1]} centerYPct={LED_Y} widthPct={LED_W} />
        <RackLed active={delay.panEnabled} centerXPct={STEREO_XS[2]} centerYPct={LED_Y} widthPct={LED_W} />

        <RackButton label="Delay on/off" centerXPct={BYPASS_X} centerYPct={BYPASS_Y} widthPct={px(80)} heightPct={py(64)} onClick={() => onChange({ enabled: !delay.enabled })} />
        <RackLed active={delay.enabled} centerXPct={BYPASS_LED_X} centerYPct={BYPASS_LED_Y} widthPct={LED_W} />

        <RackDisplay text={lcd} centerXPct={LCD.x} centerYPct={LCD.y} widthPct={LCD.w} heightPct={LCD.h} />
      </div>

    </div>
  )
}
