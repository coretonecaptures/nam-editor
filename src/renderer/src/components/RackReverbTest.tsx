import rackReverbPanel from '../assets/fx/v2c-reverb-panel.png'
import { RackKnob } from './RackKnob'
import { RackButton, RackDisplay, RackLed } from './RackParts'
import { rackDimStyle } from './RackPower'
import { REVERB_EQ_MAX_DB, type ReverbMode, type ReverbSettings } from '../utils/liveEngine'
import type { ReverbPreset } from '../types/settings'

/**
 * The Reverb unit as a photoreal rack panel. Geometry measured once against
 * rack-reverb-panel.png at 2076x758; everything below is a percentage of that box.
 */

const P = { w: 2172, h: 724 }
const px = (v: number): number => (v / P.w) * 100
const py = (v: number): number => (v / P.h) * 100

const KNOB_XS = [175, 375, 575, 774, 976, 1176].map(px)
const KNOB_Y = py(457)
const KNOB_D = px(149)

const MODE_XS = [1785, 1928].map(px)
const MODE_SW_Y = py(515)
const MODE_LED_Y = py(422)
const BTN_W = px(85)
const BTN_H = py(85)
const LED_W = px(30)

const BYPASS_X = px(1941)
const BYPASS_Y = py(232)
const BYPASS_LED_X = px(2023)
const BYPASS_LED_Y = py(212)

const LCD = { x: px(948), y: py(218), w: px(1130), h: py(152) }

const pct = (v: number): string => `${Math.round(v * 100)}%`
const db = (v: number): string => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`

export function RackReverbTest({
  reverb,
  onChange,
  reverbPresets,
  irName,
}: {
  reverb: ReverbSettings
  onChange: (patch: Partial<ReverbSettings>) => void
  reverbPresets: ReverbPreset[]
  irName: string | null
}) {
  // A loaded preset names itself and nothing else — the mode is already shown by the lit LED,
  // so prefixing it would spend glass on something the panel already says. With no preset
  // loaded the display falls back to whatever identifies the sound: the impulse in convolution,
  // and the headline parameter in plate.
  const activePreset = reverbPresets.find((p) => JSON.stringify(p.settings) === JSON.stringify(reverb))
  const lcd = activePreset
    ? activePreset.name.toUpperCase()
    : reverb.mode === 'convolution'
      ? (irName ?? 'NO IR').toUpperCase()
      : `REVERB MIX - ${Math.round(reverb.mix * 100)}%`

  const setMode = (mode: ReverbMode) => onChange({ mode })

  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <div style={{ position: 'relative', width: '100%', containerType: 'inline-size', ...rackDimStyle(reverb.enabled) }}>
        <img src={rackReverbPanel} alt="Reverb" draggable={false} style={{ width: '100%', display: 'block', userSelect: 'none' }} />

        <RackKnob label="Mix" value={reverb.mix} min={0} max={1} format={pct}
          onChange={(v) => onChange({ mix: v })}
          centerXPct={KNOB_XS[0]} centerYPct={KNOB_Y} diameterPct={KNOB_D} />
        <RackKnob label="Size" value={reverb.roomSize} min={0} max={1} format={pct}
          onChange={(v) => onChange({ roomSize: v })}
          centerXPct={KNOB_XS[1]} centerYPct={KNOB_Y} diameterPct={KNOB_D} />
        <RackKnob label="Damping" value={reverb.damping} min={0} max={1} format={pct}
          onChange={(v) => onChange({ damping: v })}
          centerXPct={KNOB_XS[2]} centerYPct={KNOB_Y} diameterPct={KNOB_D} />
        <RackKnob label="Width" value={reverb.width} min={0} max={1} format={pct}
          onChange={(v) => onChange({ width: v })}
          centerXPct={KNOB_XS[3]} centerYPct={KNOB_Y} diameterPct={KNOB_D} />
        <RackKnob label="Low" value={reverb.lowDb} min={-REVERB_EQ_MAX_DB} max={REVERB_EQ_MAX_DB} format={db}
          resetTo={0} onChange={(v) => onChange({ lowDb: v })}
          centerXPct={KNOB_XS[4]} centerYPct={KNOB_Y} diameterPct={KNOB_D} />
        <RackKnob label="High" value={reverb.highDb} min={-REVERB_EQ_MAX_DB} max={REVERB_EQ_MAX_DB} format={db}
          resetTo={0} onChange={(v) => onChange({ highDb: v })}
          centerXPct={KNOB_XS[5]} centerYPct={KNOB_Y} diameterPct={KNOB_D} />

        <RackButton label="Plate" centerXPct={MODE_XS[0]} centerYPct={MODE_SW_Y} widthPct={BTN_W} heightPct={BTN_H} onClick={() => setMode('plate')} />
        <RackButton label="Convolution" centerXPct={MODE_XS[1]} centerYPct={MODE_SW_Y} widthPct={BTN_W} heightPct={BTN_H} onClick={() => setMode('convolution')} />
        <RackLed active={reverb.mode === 'plate'} centerXPct={MODE_XS[0]} centerYPct={MODE_LED_Y} widthPct={LED_W} />
        <RackLed active={reverb.mode === 'convolution'} centerXPct={MODE_XS[1]} centerYPct={MODE_LED_Y} widthPct={LED_W} />

        <RackButton label="Reverb on/off" centerXPct={BYPASS_X} centerYPct={BYPASS_Y} widthPct={px(94)} heightPct={py(64)} onClick={() => onChange({ enabled: !reverb.enabled })} />
        <RackLed active={reverb.enabled} centerXPct={BYPASS_LED_X} centerYPct={BYPASS_LED_Y} widthPct={LED_W} />

        <RackDisplay text={lcd} centerXPct={LCD.x} centerYPct={LCD.y} widthPct={LCD.w} heightPct={LCD.h} />
      </div>

      {/* Librarian strip — deliberately BELOW the unit and deliberately not skeuomorphic. The
          panel's own upper-right is already busy, and presets are app state rather than
          something the hardware would carry. */}
    </div>
  )
}
