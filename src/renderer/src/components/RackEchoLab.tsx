import echoLabPanel from '../assets/fx/echo-lab-panel.png'
import { RackKnob } from './RackKnob'
import { RackFader } from './RackFader'
import { RackButton, RackDisplay, RackLed } from './RackParts'
import { rackDimStyle } from './RackPower'
import {
  MAX_FEEDBACK,
  MAX_MOD_DEPTH_MS,
  MAX_PAN_RATE_HZ,
  MIN_PAN_RATE_HZ,
  type EchoLabCharacter,
  type EchoLabSettings,
  type EchoLabTopology
} from '../utils/liveEngine'

/**
 * Echo Lab as a photoreal rack panel, sharing the orange Delay's slot (see PlayerPanel's
 * delaySlotView — this is a view toggle, both units keep processing audio regardless of which
 * panel is drawn). Geometry measured once against echo-lab-panel.png at 1754x428.
 *
 * Unlike Delay/Reverb, Bands 1-2's knobs have NO printed label in the art — they relabel by
 * Mode (Single/Dual) and Character (Digital/Tape/Memory Man), and a baked label would be wrong
 * most of the time. Those labels are drawn in CSS instead (see KnobLabel below), colour-matched
 * to the real engraved text sampled from Band 3/the switch labels. Band 3 (EQ Low/High, Duck
 * Depth/Release) and every switch label ARE printed into the art, since their meaning never
 * changes — see docs/echo-lab-plan.md's "Generation prompt" section for the reasoning.
 */

const P = { w: 1748, h: 430 }
const px = (v: number): number => (v / P.w) * 100
const py = (v: number): number => (v / P.h) * 100

/**
 * All coordinates below were re-measured with a centroid/bounding-box scan against the actual
 * committed asset (not eyeballed off a grid overlay, which is what produced the first pass and
 * left the switch LEDs and Duck/Pan buttons visibly off — up to 19px on the LED row, 13px on Duck
 * and Pan specifically). Same lesson as the Delay/Reverb LED-alignment work in
 * rack-ui-lessons.md §4: verify against the real pixels, don't trust a hand-drawn grid by eye.
 *
 * Panel art swapped 2026-08-05 for a variant with a genuinely wider LCD (measured ~640px vs the
 * original ~480px — confirmed by direct measurement, not assumed from the filename, since an
 * earlier "longer LCD" candidate turned out on inspection to be pixel-identical to the original).
 * Every other control's position re-verified against the new asset at the same time — small
 * global registration drift (2-4px) from the independent regeneration, but no layout changes.
 * The requested alternate (down/up) rocker positions did NOT materialize in this render either —
 * checked with a pixel diff between the lit/unlit halves' switch bodies, identical shape, only
 * the LED differs. RackButton's CSS-only `pressed` treatment remains the real mechanism for that.
 */

// Row 1 (Topology-relabeled): six columns, all six knobs live here.
const ROW1_XS = [127, 265, 404, 545, 686, 834].map(px)
const ROW1_Y = py(187)
// Rows 2-3 reuse columns 2-5 of Row 1 (indices 1..4) — columns 1 and 6 stay empty beneath them,
// matching the generation prompt's explicit column-alignment instruction.
const MID_XS = ROW1_XS.slice(1, 5)
const ROW2_Y = py(282)
const ROW3_Y = py(362)
// Measured mounting-plate diameter is ~78px. 74 (radius 37) left almost no room for a CSS label
// between two knob edges 95px apart (Row1->Row2) or 80px apart (Row2->Row3) — the label text was
// visibly clipped by the knob above and/or below it. 68 buys back clearance on both sides while
// staying well above the original undersized 50.
const KNOB_D = px(68)
// Each row's own label sits centred in the GAP to the row below it, not at a fixed offset from
// its own knob — the two gaps aren't equal (95px vs 80px), so a single shared constant left Row
// 1's labels too close to both the knob above them and the knob below. Half of each gap centres
// the label with equal clearance on both sides.
const LABEL_OFFSET_Y_ROW1 = py((282 - 187) / 2)
const LABEL_OFFSET_Y_ROW2 = py((362 - 282) / 2)

const FADER_XS = [1103, 1263].map(px)
const FADER_TRACK_TOP = py(35)
const FADER_TRACK_BOTTOM = py(205)
// The channel groove itself is ~16px, but the printed tick marks flanking it spread to ~65-70px
// — a 25px cap sat inside the groove but read as a small pill floating in a much wider printed
// mechanism, which is the "hole in the middle" gap. 46px bridges most of that spread.
const FADER_CAP_W = px(46)

const SW_LED_Y = py(277)
const SW_Y = py(327)
const SW_XS = [947, 1036, 1156, 1242, 1333, 1451, 1560].map(px)
const BTN_W = px(57)
const BTN_H = py(65)
const LED_W = px(22)

const BYPASS_X = px(1608)
const BYPASS_LED_Y = py(67)
const BYPASS_Y = py(145)
const BYPASS_W = px(89)
const BYPASS_H = py(99)

// Genuinely wider than before — see the geometry comment above.
const LCD = { x: px(638), y: py(75), w: px(640), h: py(106) }

const pct = (v: number): string => `${Math.round(v * 100)}%`
const ms = (v: number): string => `${Math.round(v)} ms`
const hz = (v: number): string => `${v.toFixed(2)} Hz`
const db = (v: number): string => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`
const hzWhole = (v: number): string => `${Math.round(v)} Hz`

/** Colour sampled directly from the panel's own engraved text (Band 3 / switch labels) so the
 *  code-drawn Row 1/2 labels read as the same ink, not a mismatched web font pasted on top. */
const ENGRAVED_LABEL_COLOR = '#f6f4e8'

function KnobLabel({ xPct, yPct, text, dim = false }: { xPct: number; yPct: number; text: string; dim?: boolean }): React.ReactNode {
  return (
    <div
      style={{
        position: 'absolute',
        left: `${xPct}%`,
        top: `${yPct}%`,
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        textAlign: 'center'
      }}
    >
      <span
        style={{
          // DIN Alternate ships on macOS, Bahnschrift on Windows — both close matches to the
          // panel's own engraved industrial sans (per the ChatGPT font ID this was checked
          // against); IBM Plex Sans as the cross-platform fallback where neither exists.
          fontFamily: "'DIN Alternate', 'Bahnschrift', 'IBM Plex Sans', sans-serif",
          fontWeight: 600,
          // Shaved down from 0.85cqw alongside the knob-size/offset fix above — a bit more
          // headroom against the two knob edges it now sits centred between.
          fontSize: '0.76cqw',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          // Dimmed text pairs with the knob's own lock scrim — the whole control (art + label)
          // recedes together, rather than a grayscale knob under a still-bright caption.
          color: dim ? '#8a8778' : ENGRAVED_LABEL_COLOR,
          textShadow: dim ? 'none' : '0 1px 0 rgba(0,0,0,0.55), 0 0 1px rgba(0,0,0,0.35)',
          transition: 'color .15s'
        }}
      >
        {text}
      </span>
    </div>
  )
}

export const CHAR1_RANGE: Record<EchoLabCharacter, { min: number; max: number; format: (v: number) => string; label: string }> = {
  digital: { min: -12, max: 12, format: db, label: 'EQ Tilt' },
  tape: { min: 0, max: MAX_MOD_DEPTH_MS, format: ms, label: 'Wow/Flutter' },
  memoryman: { min: 500, max: 8000, format: hzWhole, label: 'Tone' }
}
export const CHAR2_RANGE: Record<EchoLabCharacter, { min: number; max: number; format: (v: number) => string; label: string }> = {
  digital: { min: 0, max: 1, format: pct, label: 'Tape Age' },
  tape: { min: 0, max: 1, format: pct, label: 'Tape Age' },
  memoryman: { min: 0, max: MAX_MOD_DEPTH_MS, format: ms, label: 'Chorus' }
}

/**
 * char1/char2 are shared fields reused across Characters with different meanings (see the
 * EchoLabSettings doc comments) — switching Character alone does NOT reset them, so a value
 * dialed in as one Character's parameter silently carries over as raw milliseconds/Hz for the
 * next. Both Tape and Memory Man's own defining trait is modulation depth (char1 or char2
 * depending on which), and both start life at 0 from Digital — Mod Rate then has nothing to
 * modulate and reads as broken. Applying these on every Character switch is what actually fixes
 * that, not just picking better global defaults.
 */
export const DEFAULT_CHAR1: Record<EchoLabCharacter, number> = { digital: 0, tape: 1.2, memoryman: 3200 }
export const DEFAULT_CHAR2: Record<EchoLabCharacter, number> = { digital: 0, tape: 0.25, memoryman: 1 }

export const pingPongFormat = (v: number): string => (v <= 0.01 ? 'Off' : v >= 0.99 ? 'Full' : pct(v))

export function RackEchoLab({
  echoLab,
  onChange
}: {
  echoLab: EchoLabSettings
  onChange: (patch: Partial<EchoLabSettings>) => void
}) {
  const single = echoLab.topology === 'single'
  const char1 = CHAR1_RANGE[echoLab.character]
  const char2 = CHAR2_RANGE[echoLab.character]
  const setTopology = (topology: EchoLabTopology): void => onChange({ topology })
  const setCharacter = (character: EchoLabCharacter): void =>
    onChange({ character, char1: DEFAULT_CHAR1[character], char2: DEFAULT_CHAR2[character] })

  // Dual shows BOTH taps (L/R) rather than just leftTimeMs — showing only one number in Dual mode
  // silently hid that Right runs its own, usually-different time. Tightened separators (no spaces
  // around the middle dot, a single space instead of an em-dash) to make room for the extra digits.
  const lcdTime = single
    ? `${Math.round(echoLab.timeMs)}MS`
    : `${Math.round(echoLab.leftTimeMs)}/${Math.round(echoLab.rightTimeMs)}MS`
  const lcd = !echoLab.enabled
    ? 'BYPASSED'
    : `${echoLab.topology.toUpperCase()}·${echoLab.character.toUpperCase()} ${lcdTime}`

  return (
    <div className="flex flex-col items-center gap-3 w-full">
      <div style={{ position: 'relative', width: '100%', containerType: 'inline-size', ...rackDimStyle(echoLab.enabled) }}>
        <img src={echoLabPanel} alt="Echo Lab" draggable={false} style={{ width: '100%', display: 'block', userSelect: 'none' }} />

        {/* Row 1 — Topology relabel. Mix is always live. Slots 4-5 (R Delay/R Feedback) only mean
            something in Dual. Slot 6 is meaningful in BOTH: Ping Pong in Single (0 off/mono, 1
            full alternation, continuous — the "single open knob" this repurposes), Spread in
            Dual (already real stereo from two independent lines, so Ping Pong doesn't apply). */}
        <RackKnob label="Mix" value={echoLab.mix} min={0} max={1} format={pct} raised
          onChange={(v) => onChange({ mix: v })}
          centerXPct={ROW1_XS[0]} centerYPct={ROW1_Y} diameterPct={KNOB_D} />
        <KnobLabel xPct={ROW1_XS[0]} yPct={ROW1_Y + LABEL_OFFSET_Y_ROW1} text="Mix" />

        <RackKnob label={single ? 'Time' : 'L Delay'} value={single ? echoLab.timeMs : echoLab.leftTimeMs}
          min={20} max={1200} format={ms} raised
          onChange={(v) => onChange(single ? { timeMs: v } : { leftTimeMs: v })}
          centerXPct={ROW1_XS[1]} centerYPct={ROW1_Y} diameterPct={KNOB_D} />
        <KnobLabel xPct={ROW1_XS[1]} yPct={ROW1_Y + LABEL_OFFSET_Y_ROW1} text={single ? 'Time' : 'L Delay'} />

        <RackKnob label={single ? 'Feedback' : 'L Feedback'} value={single ? echoLab.feedback : echoLab.leftFeedback}
          min={0} max={MAX_FEEDBACK} format={pct} raised
          onChange={(v) => onChange(single ? { feedback: v } : { leftFeedback: v })}
          centerXPct={ROW1_XS[2]} centerYPct={ROW1_Y} diameterPct={KNOB_D} />
        <KnobLabel xPct={ROW1_XS[2]} yPct={ROW1_Y + LABEL_OFFSET_Y_ROW1} text={single ? 'Feedback' : 'L Feedback'} />

        <RackKnob label="R Delay" value={echoLab.rightTimeMs} min={20} max={1200} format={ms} raised
          locked={single} lockScrim
          onChange={(v) => onChange({ rightTimeMs: v })}
          centerXPct={ROW1_XS[3]} centerYPct={ROW1_Y} diameterPct={KNOB_D} />
        <KnobLabel xPct={ROW1_XS[3]} yPct={ROW1_Y + LABEL_OFFSET_Y_ROW1} text="R Delay" dim={single} />

        <RackKnob label="R Feedback" value={echoLab.rightFeedback} min={0} max={MAX_FEEDBACK} format={pct} raised
          locked={single} lockScrim
          onChange={(v) => onChange({ rightFeedback: v })}
          centerXPct={ROW1_XS[4]} centerYPct={ROW1_Y} diameterPct={KNOB_D} />
        <KnobLabel xPct={ROW1_XS[4]} yPct={ROW1_Y + LABEL_OFFSET_Y_ROW1} text="R Feedback" dim={single} />

        {/* Ping Pong uses the same squared-taper trick as the Chorus Depth knob: the knob's own
            position is sqrt(pingPongWidth), and onChange squares it back. Low knob travel then
            barely moves the real value (near-off stays near-off for longer), and the back half
            of the travel is where it actually opens up toward full hard alternation — matching
            "1% should be basically nothing, 50% shouldn't be super wide yet" directly, as a
            presentation-layer curve rather than a DSP change. */}
        <RackKnob label={single ? 'Ping Pong' : 'Spread'}
          value={single ? Math.sqrt(echoLab.pingPongWidth) : echoLab.spread}
          min={0} max={1} format={single ? (v) => pingPongFormat(v * v) : pct} raised
          onChange={(v) => onChange(single ? { pingPongWidth: v * v } : { spread: v })}
          centerXPct={ROW1_XS[5]} centerYPct={ROW1_Y} diameterPct={KNOB_D} />
        <KnobLabel xPct={ROW1_XS[5]} yPct={ROW1_Y + LABEL_OFFSET_Y_ROW1} text={single ? 'Ping Pong' : 'Spread'} />

        {/* Row 2 — Character relabel. Digital's second slot is unused: it has no character
            knob the way Tape's Age or Memory Man's Chorus do. */}
        <RackKnob label={char1.label} value={echoLab.char1} min={char1.min} max={char1.max} format={char1.format} raised
          onChange={(v) => onChange({ char1: v })}
          centerXPct={MID_XS[0]} centerYPct={ROW2_Y} diameterPct={KNOB_D} />
        <KnobLabel xPct={MID_XS[0]} yPct={ROW2_Y + LABEL_OFFSET_Y_ROW2} text={char1.label} />

        <RackKnob label={char2.label} value={echoLab.char2} min={char2.min} max={char2.max} format={char2.format} raised
          locked={echoLab.character === 'digital'} lockScrim
          onChange={(v) => onChange({ char2: v })}
          centerXPct={MID_XS[1]} centerYPct={ROW2_Y} diameterPct={KNOB_D} />
        <KnobLabel xPct={MID_XS[1]} yPct={ROW2_Y + LABEL_OFFSET_Y_ROW2} text={char2.label} dim={echoLab.character === 'digital'} />

        <RackKnob label="Color/Drive" value={echoLab.colorDrive} min={0} max={1} format={pct} raised
          onChange={(v) => onChange({ colorDrive: v })}
          centerXPct={MID_XS[2]} centerYPct={ROW2_Y} diameterPct={KNOB_D} />
        <KnobLabel xPct={MID_XS[2]} yPct={ROW2_Y + LABEL_OFFSET_Y_ROW2} text="Color/Drive" />

        <RackKnob label="Width" value={echoLab.width} min={0} max={1} format={pct} raised
          onChange={(v) => onChange({ width: v })}
          centerXPct={MID_XS[3]} centerYPct={ROW2_Y} diameterPct={KNOB_D} />
        <KnobLabel xPct={MID_XS[3]} yPct={ROW2_Y + LABEL_OFFSET_Y_ROW2} text="Width" />

        {/* Row 3 — always active, printed labels already in the art (EQ LOW/EQ HIGH/DUCK
            DEPTH/DUCK RELEASE), no CSS label needed. */}
        <RackKnob label="EQ Low" value={echoLab.eqLowDb} min={-15} max={15} format={db} raised
          resetTo={0}
          onChange={(v) => onChange({ eqLowDb: v })}
          centerXPct={MID_XS[0]} centerYPct={ROW3_Y} diameterPct={KNOB_D} />
        <RackKnob label="EQ High" value={echoLab.eqHighDb} min={-15} max={15} format={db} raised
          resetTo={0}
          onChange={(v) => onChange({ eqHighDb: v })}
          centerXPct={MID_XS[1]} centerYPct={ROW3_Y} diameterPct={KNOB_D} />
        <RackKnob label="Duck Depth" value={echoLab.duckDepth} min={0} max={1} format={pct} raised
          locked={!echoLab.duckEnabled} lockScrim
          onChange={(v) => onChange({ duckDepth: v })}
          centerXPct={MID_XS[2]} centerYPct={ROW3_Y} diameterPct={KNOB_D} />
        <RackKnob label="Duck Release" value={echoLab.duckReleaseMs} min={50} max={1000} format={ms} raised
          locked={!echoLab.duckEnabled} lockScrim
          onChange={(v) => onChange({ duckReleaseMs: v })}
          centerXPct={MID_XS[3]} centerYPct={ROW3_Y} diameterPct={KNOB_D} />

        {/* Faders. Mod Rate drives whichever char1/char2 LFO the current Character actually
            uses — inert under Digital, which has no modulation-flavored knob at all. */}
        <RackFader label="Pan Speed" value={echoLab.panRateHz} min={MIN_PAN_RATE_HZ} max={MAX_PAN_RATE_HZ} format={hz}
          inert={!echoLab.panEnabled}
          onChange={(v) => onChange({ panRateHz: v })}
          centerXPct={FADER_XS[0]} trackTopPct={FADER_TRACK_TOP} trackBottomPct={FADER_TRACK_BOTTOM} capWidthPct={FADER_CAP_W} />
        <RackFader label="Mod Rate" value={echoLab.modRateHz} min={MIN_PAN_RATE_HZ} max={MAX_PAN_RATE_HZ} format={hz}
          inert={echoLab.character === 'digital'}
          onChange={(v) => onChange({ modRateHz: v })}
          centerXPct={FADER_XS[1]} trackTopPct={FADER_TRACK_TOP} trackBottomPct={FADER_TRACK_BOTTOM} capWidthPct={FADER_CAP_W} />

        {/* Switch groups — labels are printed into the art since none of these ever relabel.
            `pressed` is a CSS-only up/down stand-in (see RackButton's doc comment) until a real
            second rocker-position photo exists to composite in — LED is still the primary,
            reliable state indicator, this is a secondary reinforcement on the switch itself. */}
        <RackButton label="Single" pressed={single} centerXPct={SW_XS[0]} centerYPct={SW_Y} widthPct={BTN_W} heightPct={BTN_H} onClick={() => setTopology('single')} />
        <RackButton label="Dual" pressed={!single} centerXPct={SW_XS[1]} centerYPct={SW_Y} widthPct={BTN_W} heightPct={BTN_H} onClick={() => setTopology('dual')} />
        <RackLed active={single} centerXPct={SW_XS[0]} centerYPct={SW_LED_Y} widthPct={LED_W} />
        <RackLed active={!single} centerXPct={SW_XS[1]} centerYPct={SW_LED_Y} widthPct={LED_W} />

        <RackButton label="Digital" pressed={echoLab.character === 'digital'} centerXPct={SW_XS[2]} centerYPct={SW_Y} widthPct={BTN_W} heightPct={BTN_H} onClick={() => setCharacter('digital')} />
        <RackButton label="Tape" pressed={echoLab.character === 'tape'} centerXPct={SW_XS[3]} centerYPct={SW_Y} widthPct={BTN_W} heightPct={BTN_H} onClick={() => setCharacter('tape')} />
        <RackButton label="Memory Man" pressed={echoLab.character === 'memoryman'} centerXPct={SW_XS[4]} centerYPct={SW_Y} widthPct={BTN_W} heightPct={BTN_H} onClick={() => setCharacter('memoryman')} />
        <RackLed active={echoLab.character === 'digital'} centerXPct={SW_XS[2]} centerYPct={SW_LED_Y} widthPct={LED_W} />
        <RackLed active={echoLab.character === 'tape'} centerXPct={SW_XS[3]} centerYPct={SW_LED_Y} widthPct={LED_W} />
        <RackLed active={echoLab.character === 'memoryman'} centerXPct={SW_XS[4]} centerYPct={SW_LED_Y} widthPct={LED_W} />

        <RackButton label="Duck" pressed={echoLab.duckEnabled} centerXPct={SW_XS[5]} centerYPct={SW_Y} widthPct={BTN_W} heightPct={BTN_H} onClick={() => onChange({ duckEnabled: !echoLab.duckEnabled })} />
        <RackLed active={echoLab.duckEnabled} centerXPct={SW_XS[5]} centerYPct={SW_LED_Y} widthPct={LED_W} />

        <RackButton label="Pan" pressed={echoLab.panEnabled} centerXPct={SW_XS[6]} centerYPct={SW_Y} widthPct={BTN_W} heightPct={BTN_H} onClick={() => onChange({ panEnabled: !echoLab.panEnabled })} />
        <RackLed active={echoLab.panEnabled} centerXPct={SW_XS[6]} centerYPct={SW_LED_Y} widthPct={LED_W} />

        <RackButton label="Echo Lab on/off" pressed={echoLab.enabled} centerXPct={BYPASS_X} centerYPct={BYPASS_Y} widthPct={BYPASS_W} heightPct={BYPASS_H} onClick={() => onChange({ enabled: !echoLab.enabled })} />
        <RackLed active={echoLab.enabled} centerXPct={BYPASS_X} centerYPct={BYPASS_LED_Y} widthPct={LED_W} />

        <RackDisplay text={lcd} centerXPct={LCD.x} centerYPct={LCD.y} widthPct={LCD.w} heightPct={LCD.h} />
      </div>
    </div>
  )
}
