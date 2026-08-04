import { useCallback, useRef, useState } from 'react'
import jogKnob from '../assets/fx/jog-knob.png'

/**
 * Input / output gain control: a metal wheel ringed by an LED arc.
 *
 * The wheel has no printed indicator, so the ring carries the value. It DOES rotate, but only so
 * the brushed-metal shine sweeps as you turn — it is not an indicator and nothing has to line up
 * with it. That distinction matters: because nothing reads position off the face, being a degree
 * or two out is invisible, unlike the rack knobs where a mis-centred pivot was glaring.
 *
 * The ring shows two things at once, which is why it earns its space:
 *  - the SET value, as a bright arc from the minimum up to where the control is dialled
 *  - the LIVE signal level, as a brighter overlay arc, so the ring doubles as a meter
 *
 * Placeholder styling by design — see design_handoff_player_redesign README, change #4; the user
 * intends to redo the wheel art. Geometry and behaviour here are the part meant to survive.
 */

const SWEEP = 270
const START = 135 // degrees clockwise from 12 o'clock to the minimum position

export function JogWheel({
  label,
  value,
  min,
  max,
  onChange,
  level = 0,
  format,
  size = 132,
  resetTo
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  /** Live meter level 0..1, drawn as a brighter overlay on the same ring. */
  level?: number
  format: (v: number) => string
  size?: number
  /** Value a double-click snaps to — both jog wheels use this for 0 dB (unity), the "no change"
   *  position, matching RackKnob's own double-click-to-flat convention. */
  resetTo?: number
}) {
  const drag = useRef<{ y: number; v: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  const frac = max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0

  const onDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = { y: e.clientY, v: value }
      setDragging(true)
    },
    [value]
  )
  const onMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const d = drag.current
      if (!d) return
      const next = Math.max(min, Math.min(max, d.v + ((d.y - e.clientY) / 180) * (max - min)))
      onChange(next)
    },
    [min, max, onChange]
  )
  const onUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null
    setDragging(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // already released
    }
  }, [])

  // conic-gradient is measured clockwise from 12 o'clock, which is exactly how the sweep is
  // defined, so the arc needs no rotation wrapper.
  const ring = (f: number, on: string, off: string): string =>
    `conic-gradient(from ${START}deg, ${on} 0deg ${f * SWEEP}deg, ${off} ${f * SWEEP}deg ${SWEEP}deg, transparent ${SWEEP}deg 360deg)`

  return (
    <div className="flex flex-col items-center gap-1.5" style={{ width: size }}>
      <div
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onDoubleClick={resetTo === undefined ? undefined : () => onChange(resetTo)}
        title={resetTo === undefined ? undefined : 'Double-click to reset'}
        role="slider"
        aria-label={label}
        aria-valuenow={Math.round(value * 10) / 10}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        style={{
          position: 'relative',
          width: size,
          height: size,
          cursor: 'ns-resize',
          touchAction: 'none',
          borderRadius: '50%'
        }}
      >
        {/* set value */}
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: ring(frac, '#ffae2e', 'rgba(255,255,255,0.10)') }} />
        {/* live level, brighter, on top */}
        {level > 0.001 && (
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: ring(Math.min(1, level), '#fff0c9', 'transparent'), opacity: 0.85, mixBlendMode: 'screen' }} />
        )}
        {/* mask the ring into a thin band */}
        <div style={{ position: 'absolute', inset: '11%', borderRadius: '50%', background: 'var(--panel)' }} />
        <img
          src={jogKnob}
          alt=""
          draggable={false}
          style={{
            position: 'absolute',
            inset: '14%',
            width: '72%',
            height: '72%',
            display: 'block',
            transform: `rotate(${frac * 300}deg)`,
            filter: dragging ? 'brightness(1.08)' : 'none',
            transition: 'filter .12s, transform .06s linear',
            pointerEvents: 'none',
            userSelect: 'none'
          }}
        />
      </div>
      <div className="text-center leading-tight">
        <div style={{ font: "500 10px 'IBM Plex Mono', monospace", letterSpacing: '.12em', color: 'var(--text-2)' }}>
          {label}
        </div>
        <div style={{ font: "500 12.5px 'IBM Plex Mono', monospace", color: 'var(--text)' }}>{format(value)}</div>
      </div>
    </div>
  )
}
