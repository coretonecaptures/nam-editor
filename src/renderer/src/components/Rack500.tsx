import rack500Panel from '../assets/fx/rack500-panel.png'
import ledOffNavy from '../assets/fx/rack500-led-off-navy.png'
import ledOffPurple from '../assets/fx/rack500-led-off-purple.png'
import ledOffSilver from '../assets/fx/rack500-led-off-silver.png'
import knobConsoleEq from '../assets/fx/knob-console-eq.png'
import knobStrymonCream from '../assets/fx/knob-strymon-cream.png'
import knobNeveRed from '../assets/fx/knob-neve-red.png'
import knobNeveGrey from '../assets/fx/knob-neve-grey.png'
import { RackKnob } from './RackKnob'
import { RackButton, RackDisplay } from './RackParts'
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

const P = { w: 1693, h: 929 }
const pctX = (px: number): number => (px / P.w) * 100
const pctY = (px: number): number => (px / P.h) * 100

const KNOB_D = pctX(92)
const BTN_W = pctX(46)
const BTN_H = pctY(28)
const LED_W = pctX(26)

const EQ_X = pctX(347)
const GATE_X = pctX(639)
const MOD_X = pctX(996)

const EQ_KNOB_YS = [pctY(358), pctY(497), pctY(642)]
const GATE_KNOB_YS = [pctY(429), pctY(556), pctY(686)]
const MOD_KNOB_YS = [pctY(378), pctY(489), pctY(598), pctY(707)]

const BYPASS_LED_Y = pctY(216)
const BYPASS_BTN_Y = pctY(253)
const MOD_LED_Y = pctY(247)
const MOD_BTN_Y = pctY(278)
const MOD_BTN_XS = [pctX(857), pctX(947), pctX(1037), pctX(1146)]

const pct = (v: number): string => `${Math.round(v * 100)}%`
const db = (v: number): string => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`
const ms = (v: number): string => `${Math.round(v * 1000)} ms`

/** Overlaid only to turn a lit LED OFF — see the note above on why this is inverted. */
function OffLed({ hidden, src, centerXPct, centerYPct }: { hidden: boolean; src: string; centerXPct: number; centerYPct: number }) {
  if (hidden) return null
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      style={{
        position: 'absolute',
        left: `${centerXPct}%`,
        top: `${centerYPct}%`,
        width: `${LED_W}%`,
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
        userSelect: 'none'
      }}
    />
  )
}

export function Rack500({
  gate,
  eq,
  chorus,
  onGate,
  onEq,
  onChorus,
  modPresetBar
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
}) {
  const trem = chorus.type === 'tremolo'
  const setType = (type: ModulationType) => onChorus({ type })

  return (
    <div className="flex flex-col gap-3 w-full">
    <div style={{ position: 'relative', width: '100%', containerType: 'inline-size' }}>
      <img src={rack500Panel} alt="EQ, Gate and Modulation" draggable={false} style={{ width: '100%', display: 'block', userSelect: 'none' }} />

      {/* ── EQ */}
      <RackKnob image={knobConsoleEq} label="Bass" value={eq.bassDb} min={-EQ_MAX_DB} max={EQ_MAX_DB} format={db}
        onChange={(v) => onEq({ bassDb: v })} centerXPct={EQ_X} centerYPct={EQ_KNOB_YS[0]} diameterPct={KNOB_D} />
      <RackKnob image={knobConsoleEq} label="Middle" value={eq.midDb} min={-EQ_MAX_DB} max={EQ_MAX_DB} format={db}
        onChange={(v) => onEq({ midDb: v })} centerXPct={EQ_X} centerYPct={EQ_KNOB_YS[1]} diameterPct={KNOB_D} />
      <RackKnob image={knobConsoleEq} label="Treble" value={eq.trebleDb} min={-EQ_MAX_DB} max={EQ_MAX_DB} format={db}
        onChange={(v) => onEq({ trebleDb: v })} centerXPct={EQ_X} centerYPct={EQ_KNOB_YS[2]} diameterPct={KNOB_D} />
      <RackButton label="EQ on/off" centerXPct={EQ_X} centerYPct={BYPASS_BTN_Y} widthPct={BTN_W} heightPct={BTN_H} onClick={() => onEq({ enabled: !eq.enabled })} />
      <OffLed hidden={eq.enabled} src={ledOffNavy} centerXPct={EQ_X} centerYPct={BYPASS_LED_Y} />

      {/* ── Gate. Hold and Release are seconds internally; the panel speaks milliseconds. */}
      <RackKnob image={knobStrymonCream} label="Threshold" value={gate.threshold} min={-100} max={0} format={(v) => `${v.toFixed(0)} dB`}
        onChange={(v) => onGate({ threshold: v })} centerXPct={GATE_X} centerYPct={GATE_KNOB_YS[0]} diameterPct={KNOB_D} />
      <RackKnob image={knobStrymonCream} label="Hold" value={gate.holdTime} min={0} max={0.5} format={ms}
        onChange={(v) => onGate({ holdTime: v })} centerXPct={GATE_X} centerYPct={GATE_KNOB_YS[1]} diameterPct={KNOB_D} />
      <RackKnob image={knobStrymonCream} label="Release" value={gate.closeTime} min={0.001} max={0.5} format={ms}
        onChange={(v) => onGate({ closeTime: v })} centerXPct={GATE_X} centerYPct={GATE_KNOB_YS[2]} diameterPct={KNOB_D} />
      <RackButton label="Gate on/off" centerXPct={GATE_X} centerYPct={BYPASS_BTN_Y} widthPct={BTN_W} heightPct={BTN_H} onClick={() => onGate({ enabled: !gate.enabled })} />
      <OffLed hidden={gate.enabled} src={ledOffPurple} centerXPct={GATE_X} centerYPct={BYPASS_LED_Y} />
      {/* The Gate's display shows a live value rather than a preset name — it has no preset
          system, and the threshold is the one number worth reading while you set it. */}
      <RackDisplay text={`${gate.threshold.toFixed(0)}dB`} centerXPct={GATE_X} centerYPct={pctY(318)} widthPct={pctX(165)} heightPct={pctY(58)} />

      {/* ── Modulation. Mix and Width are chorus-only; a Fender tremolo has neither, so those
          two knobs are simply inert in Tremolo mode, as they would be on real hardware. */}
      <RackKnob image={knobNeveRed} label="Mix" value={chorus.mix} min={0} max={1} format={pct}
        onChange={(v) => onChorus({ mix: v })} centerXPct={MOD_X} centerYPct={MOD_KNOB_YS[0]} diameterPct={KNOB_D} />
      <RackKnob image={knobNeveGrey} label="Depth"
        value={trem ? chorus.tremoloDepth : chorus.depthMs}
        min={0} max={trem ? 1 : 12}
        format={trem ? pct : (v) => `${v.toFixed(1)} ms`}
        onChange={(v) => onChorus(trem ? { tremoloDepth: v } : { depthMs: v })}
        centerXPct={MOD_X} centerYPct={MOD_KNOB_YS[1]} diameterPct={KNOB_D} />
      <RackKnob image={knobNeveGrey} label="Rate" value={chorus.rateHz} min={0.05} max={6} format={(v) => `${v.toFixed(2)} Hz`}
        onChange={(v) => onChorus({ rateHz: v })} centerXPct={MOD_X} centerYPct={MOD_KNOB_YS[2]} diameterPct={KNOB_D} />
      <RackKnob image={knobNeveGrey} label="Width" value={chorus.width} min={0} max={1} format={pct}
        onChange={(v) => onChorus({ width: v })} centerXPct={MOD_X} centerYPct={MOD_KNOB_YS[3]} diameterPct={KNOB_D} />

      <RackButton label="Chorus" centerXPct={MOD_BTN_XS[0]} centerYPct={MOD_BTN_Y} widthPct={BTN_W} heightPct={BTN_H} onClick={() => setType('chorus')} />
      <RackButton label="Tremolo" centerXPct={MOD_BTN_XS[1]} centerYPct={MOD_BTN_Y} widthPct={BTN_W} heightPct={BTN_H} onClick={() => setType('tremolo')} />
      <RackButton label="Harmonic" centerXPct={MOD_BTN_XS[2]} centerYPct={MOD_BTN_Y} widthPct={BTN_W} heightPct={BTN_H} onClick={() => onChorus({ harmonic: !chorus.harmonic })} />
      <RackButton label="Modulation on/off" centerXPct={MOD_BTN_XS[3]} centerYPct={MOD_BTN_Y} widthPct={BTN_W} heightPct={BTN_H} onClick={() => onChorus({ enabled: !chorus.enabled })} />
      <OffLed hidden={!trem} src={ledOffSilver} centerXPct={MOD_BTN_XS[0]} centerYPct={MOD_LED_Y} />
      <OffLed hidden={trem} src={ledOffSilver} centerXPct={MOD_BTN_XS[1]} centerYPct={MOD_LED_Y} />
      {/* Harmonic only means anything in Tremolo, so it reads unlit in Chorus regardless. */}
      <OffLed hidden={trem && chorus.harmonic} src={ledOffSilver} centerXPct={MOD_BTN_XS[2]} centerYPct={MOD_LED_Y} />
      <OffLed hidden={chorus.enabled} src={ledOffSilver} centerXPct={MOD_BTN_XS[3]} centerYPct={MOD_LED_Y} />
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
