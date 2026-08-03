import rackReverbPanel from '../assets/fx/rack-reverb-panel.png'
import ledOn from '../assets/fx/rack-led-on.png'
import ledOff from '../assets/fx/rack-led-off.png'
import { RackKnob } from './RackKnob'
import { RackButton, RackDisplay, RackLed } from './RackParts'
import { RackPower, rackDimStyle } from './RackPower'
import { REVERB_EQ_MAX_DB, type ReverbMode, type ReverbSettings } from '../utils/liveEngine'
import type { ReverbPreset } from '../types/settings'

/**
 * The Reverb unit as a photoreal rack panel. Geometry measured once against
 * rack-reverb-panel.png at 2076x758; everything below is a percentage of that box.
 */

const KNOB_XS = [10.62, 20.55, 30.47, 40.34, 50.17, 60.02]
const KNOB_Y = 54.7
const KNOB_D = 7.5

const pct = (v: number): string => `${Math.round(v * 100)}%`
const db = (v: number): string => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`

export function RackReverbTest({
  reverb,
  onChange,
  reverbPresets,
  irName,
  presetBar,
  irPicker
}: {
  reverb: ReverbSettings
  onChange: (patch: Partial<ReverbSettings>) => void
  reverbPresets: ReverbPreset[]
  irName: string | null
  presetBar: React.ReactNode
  irPicker: React.ReactNode
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
          onChange={(v) => onChange({ lowDb: v })}
          centerXPct={KNOB_XS[4]} centerYPct={KNOB_Y} diameterPct={KNOB_D} />
        <RackKnob label="High" value={reverb.highDb} min={-REVERB_EQ_MAX_DB} max={REVERB_EQ_MAX_DB} format={db}
          onChange={(v) => onChange({ highDb: v })}
          centerXPct={KNOB_XS[5]} centerYPct={KNOB_Y} diameterPct={KNOB_D} />

        <RackButton label="Plate" centerXPct={76.68} centerYPct={31.53} widthPct={6.45} heightPct={10.03} onClick={() => setMode('plate')} />
        <RackButton label="Convolution" centerXPct={86.95} centerYPct={31.53} widthPct={6.45} heightPct={10.03} onClick={() => setMode('convolution')} />
        <RackLed on={ledOn} off={ledOff} active={reverb.mode === 'plate'} centerXPct={76.64} centerYPct={19.13} widthPct={1.93} />
        <RackLed on={ledOn} off={ledOff} active={reverb.mode === 'convolution'} centerXPct={86.90} centerYPct={19.13} widthPct={1.93} />

        <RackDisplay text={lcd} centerXPct={80.32} centerYPct={56.53} widthPct={26.73} heightPct={22.56} />
      </div>

      {/* Librarian strip — deliberately BELOW the unit and deliberately not skeuomorphic. The
          panel's own upper-right is already busy, and presets are app state rather than
          something the hardware would carry. */}
      <div className="w-full flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <RackPower label="Reverb" on={reverb.enabled} onToggle={() => onChange({ enabled: !reverb.enabled })} />
          <div className="flex-1 min-w-0">{presetBar}</div>
        </div>
        {reverb.mode === 'convolution' && irPicker}
      </div>
    </div>
  )
}
