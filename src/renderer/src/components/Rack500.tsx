import rack500Panel from '../assets/fx/v3e-rack-panel.png'
import knobEq from '../assets/fx/v3f-knob-eq.png'
import knobGate from '../assets/fx/v3f-knob-gate.png'
import knobMod from '../assets/fx/v3f-knob-mod.png'
import powerOn from '../assets/fx/v3-power-on.png'
import { RackKnob } from './RackKnob'
import { RackButton, RackDisplay, RackLed } from './RackParts'
import {
  EQ_MAX_DB,
  type ChorusSettings,
  type EqSettings,
  type GateSettings,
  type ModulationType
} from '../utils/liveEngine'

/**
 * The 500-series strip: EQ, Gate and Modulation in one chassis.
 *
 * Geometry measured once against rack500-panel.png at 1693x929; everything below is a
 * percentage of that box.
 *
 * LED handling is inverted relative to the Reverb and Delay units, because the source art came
 * as two whole-panel renders (all-lit and all-unlit) that are NOT pixel-aligned — so they cannot
 * be swapped or cross-cut wholesale. Instead the LIT render is the base, and an unlit lens is
 * overlaid to switch one OFF. Three unlit sprites exist rather than one, cut from each module's
 * own faceplate colour, so the sprite's few background pixels always match what is behind them.
 */

const P = { w: 1774, h: 887 }
const pctX = (v: number): number => (v / P.w) * 100
const pctY = (v: number): number => (v / P.h) * 100

const EQ_X = pctX(316)
const GATE_X = pctX(581)
const EQ_KNOB_YS = [356, 494, 633].map(pctY)
const GATE_KNOB_YS = [461, 571, 683].map(pctY)
const MOD_KNOB_XS = [800, 957, 1114, 1269].map(pctX)
const MOD_KNOB_Y = pctY(592)
const EQ_KNOB_D = pctX(100)
const GATE_KNOB_D = pctX(88)
const MOD_KNOB_D = pctX(116)

const EQ_LED_X = pctX(312)
const EQ_LED_Y = pctY(210)
const GATE_LED_X = pctX(583)
const GATE_LED_Y = pctY(207)
const MOD_LED_Y = pctY(215)
const EQ_BYPASS_BTN_Y = pctY(253)
const MOD_BYPASS_X = pctX(1042)
const MOD_BYPASS_BTN_Y = pctY(258)
const MOD_ROW_XS = [861, 1041, 1222].map(pctX)
const MOD_ROW_LED_XS = [862, 1042, 1223].map(pctX)
const MOD_ROW_LED_Y = pctY(355)
const MOD_ROW_BTN_Y = pctY(400)
const BTN_W = pctX(70)
const BTN_H = pctY(55)
const LED_W = pctX(19)

const GATE_LCD = { x: GATE_X, y: pctY(350), w: pctX(200), h: pctY(80) }
const POWER = { x: pctX(1493), y: pctY(254), w: pctX(144) }

const pct = (v: number): string => `${Math.round(v * 100)}%`
const db = (v: number): string => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`
const ms = (v: number): string => `${Math.round(v * 1000)} ms`

export function Rack500({
  gate,
  eq,
  chorus,
  onGate,
  onEq,
  onChorus,
  modPresetBar,
  power,
  onTogglePower
}: {
  gate: GateSettings
  eq: EqSettings
  chorus: ChorusSettings
  onGate: (patch: Partial<GateSettings>) => void
  onEq: (patch: Partial<EqSettings>) => void
  onChorus: (patch: Partial<ChorusSettings>) => void
  /** Modulation's preset controls. EQ and Gate have no preset lists — only Chorus/Modulation,
   *  Delay and Reverb do — so this strip carries one bar rather than three. */
  modPresetBar?: React.ReactNode
  /** Master power for the whole FX rig — the blue bay's illuminated button. */
  power: boolean
  onTogglePower: () => void
}) {
  const trem = chorus.type === 'tremolo'
  const setType = (type: ModulationType) => onChorus({ type })

  return (
    <div className="flex flex-col gap-3 w-full">
    <div style={{ position: 'relative', width: '100%', containerType: 'inline-size' }}>
      <img src={rack500Panel} alt="EQ, Gate and Modulation" draggable={false} style={{ width: '100%', display: 'block', userSelect: 'none' }} />

      {/* ── EQ */}
      <RackKnob image={knobEq} label="Bass" value={eq.bassDb} min={-EQ_MAX_DB} max={EQ_MAX_DB} format={db}
        onChange={(v) => onEq({ bassDb: v })} centerXPct={EQ_X} centerYPct={EQ_KNOB_YS[0]} diameterPct={EQ_KNOB_D} />
      <RackKnob image={knobEq} label="Middle" value={eq.midDb} min={-EQ_MAX_DB} max={EQ_MAX_DB} format={db}
        onChange={(v) => onEq({ midDb: v })} centerXPct={EQ_X} centerYPct={EQ_KNOB_YS[1]} diameterPct={EQ_KNOB_D} />
      <RackKnob image={knobEq} label="Treble" value={eq.trebleDb} min={-EQ_MAX_DB} max={EQ_MAX_DB} format={db}
        onChange={(v) => onEq({ trebleDb: v })} centerXPct={EQ_X} centerYPct={EQ_KNOB_YS[2]} diameterPct={EQ_KNOB_D} />
      <RackButton label="EQ on/off" centerXPct={EQ_X} centerYPct={EQ_BYPASS_BTN_Y} widthPct={BTN_W} heightPct={BTN_H} onClick={() => onEq({ enabled: !eq.enabled })} />
      <RackLed active={eq.enabled} centerXPct={EQ_LED_X} centerYPct={EQ_LED_Y} widthPct={LED_W} />

      {/* ── Gate. Hold and Release are seconds internally; the panel speaks milliseconds. */}
      <RackKnob image={knobGate} label="Threshold" value={gate.threshold} min={-100} max={0} format={(v) => `${v.toFixed(0)} dB`}
        onChange={(v) => onGate({ threshold: v })} centerXPct={GATE_X} centerYPct={GATE_KNOB_YS[0]} diameterPct={GATE_KNOB_D} />
      <RackKnob image={knobGate} label="Hold" value={gate.holdTime} min={0} max={0.5} format={ms}
        onChange={(v) => onGate({ holdTime: v })} centerXPct={GATE_X} centerYPct={GATE_KNOB_YS[1]} diameterPct={GATE_KNOB_D} />
      <RackKnob image={knobGate} label="Release" value={gate.closeTime} min={0.001} max={0.5} format={ms}
        onChange={(v) => onGate({ closeTime: v })} centerXPct={GATE_X} centerYPct={GATE_KNOB_YS[2]} diameterPct={GATE_KNOB_D} />
      <RackButton label="Gate on/off" centerXPct={GATE_X} centerYPct={EQ_BYPASS_BTN_Y} widthPct={BTN_W} heightPct={BTN_H} onClick={() => onGate({ enabled: !gate.enabled })} />
      <RackLed active={gate.enabled} centerXPct={GATE_LED_X} centerYPct={GATE_LED_Y} widthPct={LED_W} />
      {/* The Gate's display shows a live value, not a preset name — it has no preset system, and
          the threshold is the one number worth reading while you set it. */}
      <RackDisplay text={`${gate.threshold.toFixed(0)}dB`} centerXPct={GATE_LCD.x} centerYPct={GATE_LCD.y} widthPct={GATE_LCD.w} heightPct={GATE_LCD.h} />

      {/* ── Modulation. Mix and Width are chorus-only; a Fender tremolo has neither, so those
          two knobs are simply inert in Tremolo mode, as they would be on real hardware. */}
      <RackKnob image={knobMod} label="Mix" value={chorus.mix} min={0} max={1} format={pct}
        onChange={(v) => onChorus({ mix: v })} centerXPct={MOD_KNOB_XS[0]} centerYPct={MOD_KNOB_Y} diameterPct={MOD_KNOB_D} />
      <RackKnob image={knobMod} label="Depth"
        value={trem ? chorus.tremoloDepth : chorus.depthMs}
        min={0} max={trem ? 1 : 12}
        format={trem ? pct : (v) => `${v.toFixed(1)} ms`}
        onChange={(v) => onChorus(trem ? { tremoloDepth: v } : { depthMs: v })}
        centerXPct={MOD_KNOB_XS[1]} centerYPct={MOD_KNOB_Y} diameterPct={MOD_KNOB_D} />
      <RackKnob image={knobMod} label="Rate" value={chorus.rateHz} min={0.05} max={6} format={(v) => `${v.toFixed(2)} Hz`}
        onChange={(v) => onChorus({ rateHz: v })} centerXPct={MOD_KNOB_XS[2]} centerYPct={MOD_KNOB_Y} diameterPct={MOD_KNOB_D} />
      <RackKnob image={knobMod} label="Width" value={chorus.width} min={0} max={1} format={pct}
        onChange={(v) => onChorus({ width: v })} centerXPct={MOD_KNOB_XS[3]} centerYPct={MOD_KNOB_Y} diameterPct={MOD_KNOB_D} />

      <RackButton label="Modulation on/off" centerXPct={MOD_BYPASS_X} centerYPct={MOD_BYPASS_BTN_Y} widthPct={BTN_W} heightPct={BTN_H} onClick={() => onChorus({ enabled: !chorus.enabled })} />
      <RackLed active={chorus.enabled} centerXPct={MOD_BYPASS_X} centerYPct={MOD_LED_Y} widthPct={LED_W} />

      <RackButton label="Chorus" centerXPct={MOD_ROW_XS[0]} centerYPct={MOD_ROW_BTN_Y} widthPct={BTN_W} heightPct={BTN_H} onClick={() => setType('chorus')} />
      <RackButton label="Tremolo" centerXPct={MOD_ROW_XS[1]} centerYPct={MOD_ROW_BTN_Y} widthPct={BTN_W} heightPct={BTN_H} onClick={() => setType('tremolo')} />
      <RackButton label="Harmonic" centerXPct={MOD_ROW_XS[2]} centerYPct={MOD_ROW_BTN_Y} widthPct={BTN_W} heightPct={BTN_H} onClick={() => onChorus({ harmonic: !chorus.harmonic })} />
      <RackLed active={!trem} centerXPct={MOD_ROW_LED_XS[0]} centerYPct={MOD_ROW_LED_Y} widthPct={LED_W} />
      <RackLed active={trem} centerXPct={MOD_ROW_LED_XS[1]} centerYPct={MOD_ROW_LED_Y} widthPct={LED_W} />
      {/* Harmonic only means anything in Tremolo, so it reads unlit in Chorus regardless. */}
      <RackLed active={trem && chorus.harmonic} centerXPct={MOD_ROW_LED_XS[2]} centerYPct={MOD_ROW_LED_Y} widthPct={LED_W} />

      {/* Master power for the whole FX rig. The panel's own grey ring IS the off state, so the
          lit sprite (cut from the earlier render, where the ring glows orange) is overlaid only
          when on — no filter trickery, both states are real photographed hardware. */}
      <button
        onClick={onTogglePower}
        title="FX rig power"
        aria-label="FX rig power"
        style={{
          position: 'absolute', left: `${POWER.x}%`, top: `${POWER.y}%`, width: `${POWER.w}%`,
          aspectRatio: '1 / 1', transform: 'translate(-50%, -50%)',
          background: 'none', border: 'none', padding: 0, cursor: 'pointer'
        }}
      >
        <img src={powerOn} alt="" draggable={false}
          style={{
            width: '100%', height: '100%', display: 'block',
            opacity: power ? 1 : 0, transition: 'opacity 0.18s',
            pointerEvents: 'none', userSelect: 'none'
          }} />
      </button>
    </div>
    {modPresetBar && (
      <div className="w-full flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500 flex-shrink-0">Modulation</span>
        <div className="flex-1 min-w-0">{modPresetBar}</div>
      </div>
    )}
    </div>
  )
}
