import rackDelayPanel from '../assets/fx/rack-delay-panel.png'
import ledOn from '../assets/fx/rack-led-amber-on.png'
import ledOff from '../assets/fx/rack-led-amber-off.png'
import { RackKnob } from './RackKnob'
import { RackFader } from './RackFader'
import { RackButton, RackDisplay, RackLed } from './RackParts'
import { RackPower, rackDimStyle } from './RackPower'
import {
  MAX_FEEDBACK,
  MAX_MOD_DEPTH_MS,
  MAX_PAN_RATE_HZ,
  MIN_PAN_RATE_HZ,
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

const KNOB_XS = [13.08, 27.40, 41.83, 56.31, 70.80, 85.74]
const KNOB_Y = 46.56
const KNOB_D = 8.45

const ENGINE_Y_LED = 11.16
const ENGINE_Y_BTN = 15.39
const STEREO_Y_LED = 26.83
const STEREO_Y_BTN = 31.00
const ENGINE_XS = [76.78, 85.23]
const STEREO_XS = [72.21, 80.95, 89.68]
const BTN_W = 4.45
const BTN_H = 4.74
const LED_W = 2.25

/** The two cut channels: Mod Rate on the left, Pan Speed on the right. */
const FADER_XS = [32.50, 39.91]
const TRACK_TOP = 66.5
const TRACK_BOTTOM = 85.5
const FADER_CAP_W = 2.6

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
  presetBar,
  irPicker
}: {
  delay: DelaySettings
  onChange: (patch: Partial<DelaySettings>) => void
  delayPresets: DelayPreset[]
  irName: string | null
  presetBar: React.ReactNode
  irPicker: React.ReactNode
}) {
  // A loaded preset names itself and nothing else — the mode is already shown by the lit LED,
  // so prefixing it would spend glass on something the panel already says. With no preset
  // loaded the display falls back to whatever identifies the sound: the impulse in convolution,
  // and the one number you actually dial by ear in algorithmic.
  const activePreset = delayPresets.find((p) => JSON.stringify(p.settings) === JSON.stringify(delay))
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
        <RackKnob label="Time" value={delay.timeMs} min={20} max={1200} format={(v) => `${Math.round(v)} ms`}
          onChange={(v) => onChange({ timeMs: v })}
          centerXPct={KNOB_XS[1]} centerYPct={KNOB_Y} diameterPct={KNOB_D} />
        <RackKnob label="Ratio" value={delay.ratio} min={0.25} max={2} format={(v) => `${v.toFixed(2)}x`}
          onChange={(v) => onChange({ ratio: v })}
          centerXPct={KNOB_XS[2]} centerYPct={KNOB_Y} diameterPct={KNOB_D} />
        <RackKnob label="Feedback" value={delay.feedback} min={0} max={MAX_FEEDBACK} format={pct}
          onChange={(v) => onChange({ feedback: v })}
          centerXPct={KNOB_XS[3]} centerYPct={KNOB_Y} diameterPct={KNOB_D} />
        <RackKnob label="Tone" value={delay.toneHz} min={500} max={12000} format={(v) => `${(v / 1000).toFixed(1)} kHz`}
          onChange={(v) => onChange({ toneHz: v })}
          centerXPct={KNOB_XS[4]} centerYPct={KNOB_Y} diameterPct={KNOB_D} />
        <RackKnob label="Mod" value={delay.modDepthMs} min={0} max={MAX_MOD_DEPTH_MS} format={(v) => (v === 0 ? "off" : `${v.toFixed(2)} ms`)}
          onChange={(v) => onChange({ modDepthMs: v })}
          centerXPct={KNOB_XS[5]} centerYPct={KNOB_Y} diameterPct={KNOB_D} />

        {/* Both caps stay fitted whatever the settings — an empty channel just looks broken, and
            gives no clue what the slot is for. They dim instead when the parameter is inert:
            Mod Rate until Mod depth is up, Pan Speed until Pan is engaged. */}
        <RackFader label="Mod rate" value={delay.modRateHz} min={0.05} max={8} format={hz}
          inert={delay.modDepthMs === 0}
          onChange={(v) => onChange({ modRateHz: v })}
          centerXPct={FADER_XS[0]} trackTopPct={TRACK_TOP} trackBottomPct={TRACK_BOTTOM} capWidthPct={FADER_CAP_W} />
        <RackFader label="Pan speed" value={delay.panRateHz} min={MIN_PAN_RATE_HZ} max={MAX_PAN_RATE_HZ} format={hz}
          inert={!delay.panEnabled}
          onChange={(v) => onChange({ panRateHz: v })}
          centerXPct={FADER_XS[1]} trackTopPct={TRACK_TOP} trackBottomPct={TRACK_BOTTOM} capWidthPct={FADER_CAP_W} />

        <RackButton label="Algorithmic" centerXPct={ENGINE_XS[0]} centerYPct={ENGINE_Y_BTN} widthPct={BTN_W} heightPct={BTN_H} onClick={() => setEngine('algorithmic')} />
        <RackButton label="Convolution" centerXPct={ENGINE_XS[1]} centerYPct={ENGINE_Y_BTN} widthPct={BTN_W} heightPct={BTN_H} onClick={() => setEngine('convolution')} />
        <RackLed on={ledOn} off={ledOff} active={delay.mode === 'algorithmic'} centerXPct={ENGINE_XS[0]} centerYPct={ENGINE_Y_LED} widthPct={LED_W} />
        <RackLed on={ledOn} off={ledOff} active={delay.mode === 'convolution'} centerXPct={ENGINE_XS[1]} centerYPct={ENGINE_Y_LED} widthPct={LED_W} />

        <RackButton label="Center" centerXPct={STEREO_XS[0]} centerYPct={STEREO_Y_BTN} widthPct={BTN_W} heightPct={BTN_H} onClick={() => onChange({ pingPong: false })} />
        <RackButton label="Ping-Pong" centerXPct={STEREO_XS[1]} centerYPct={STEREO_Y_BTN} widthPct={BTN_W} heightPct={BTN_H} onClick={() => onChange({ pingPong: true })} />
        <RackButton label="Pan" centerXPct={STEREO_XS[2]} centerYPct={STEREO_Y_BTN} widthPct={BTN_W} heightPct={BTN_H} onClick={() => onChange({ panEnabled: !delay.panEnabled })} />
        <RackLed on={ledOn} off={ledOff} active={!delay.pingPong} centerXPct={STEREO_XS[0]} centerYPct={STEREO_Y_LED} widthPct={LED_W} />
        <RackLed on={ledOn} off={ledOff} active={delay.pingPong} centerXPct={STEREO_XS[1]} centerYPct={STEREO_Y_LED} widthPct={LED_W} />
        <RackLed on={ledOn} off={ledOff} active={delay.panEnabled} centerXPct={STEREO_XS[2]} centerYPct={STEREO_Y_LED} widthPct={LED_W} />

        <RackDisplay text={lcd} centerXPct={70.07} centerYPct={75.71} widthPct={35.85} heightPct={23.34} />
      </div>

      <div className="w-full flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <RackPower label="Delay" on={delay.enabled} onToggle={() => onChange({ enabled: !delay.enabled })} />
          <div className="flex-1 min-w-0">{presetBar}</div>
        </div>
        {delay.mode === 'convolution' && irPicker}
      </div>
    </div>
  )
}
