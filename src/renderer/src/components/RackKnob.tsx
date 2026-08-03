import { useCallback, useRef, useState } from 'react'
import rackKnobBlack from '../assets/fx/rack-knob-black.png'
import { RackValueTip } from './RackValueTip'

/**
 * A rack-style knob: a flat, non-directionally-lit image (see rack-knob-black.png prep notes)
 * that rotates as a single rigid unit — texture and pointer together — which is the only
 * physically correct way to animate a fluted/knurled cap. A knob with a baked directional
 * highlight could not be spun this way; its light source would swing with it.
 *
 * Positioned as a percentage of its own panel image, not absolute pixels, so the panel can be
 * resized without re-measuring anything.
 */
export function RackKnob({
  value,
  min,
  max,
  onChange,
  centerXPct,
  centerYPct,
  diameterPct,
  label,
  format,
  image = rackKnobBlack,
  resetTo
}: {
  /** Current value, in the knob's own units (caller's min..max). */
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  /** Knob centre as a percentage of the panel image's width/height. */
  centerXPct: number
  centerYPct: number
  /** Knob diameter as a percentage of the panel image's width. */
  diameterPct: number
  label?: string
  /** Renders the value for the hover/drag readout. */
  format?: (value: number) => string
  /** Knob face art. Must be flat and non-directionally lit so it survives rotation. */
  image?: string
  /**
   * Value a double-click snaps to. Only meaningful for controls with a neutral position — a
   * cut/boost EQ band is flat at 0, so getting back there should not mean nudging by hand.
   * Omit on knobs where no value is more "correct" than another, like Mix or Rate.
   */
  resetTo?: number
}) {
  const dragRef = useRef<{ startY: number; startValue: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [hover, setHover] = useState(false)

  const frac = max > min ? (value - min) / (max - min) : 0
  // Standard knob sweep: -135deg (fully counter-clockwise) to +135deg, 270deg of travel.
  const angle = -135 + frac * 270

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      dragRef.current = { startY: e.clientY, startValue: value }
      setDragging(true)
    },
    [value]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current
      if (!drag) return
      // Vertical drag, not rotational — dragging in a circle around a small knob feels wrong
      // and is imprecise. 200px of drag covers the full range, as most DAW knobs do.
      const deltaY = drag.startY - e.clientY
      const next = Math.max(min, Math.min(max, drag.startValue + (deltaY / 200) * (max - min)))
      onChange(next)
    },
    [min, max, onChange]
  )

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    dragRef.current = null
    setDragging(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // Already released.
    }
  }, [])

  return (
    <button
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onDoubleClick={resetTo === undefined ? undefined : () => onChange(resetTo)}
      title={resetTo === undefined ? undefined : 'Double-click to reset'}
      aria-label={label}
      style={{
        position: 'absolute',
        left: `${centerXPct}%`,
        top: `${centerYPct}%`,
        width: `${diameterPct}%`,
        aspectRatio: '1 / 1',
        transform: 'translate(-50%, -50%)',
        cursor: 'ns-resize',
        touchAction: 'none',
        background: 'none',
        border: 'none',
        padding: 0
      }}
    >
      <img
        src={image}
        alt=""
        draggable={false}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          transform: `rotate(${angle}deg)`,
          pointerEvents: 'none',
          userSelect: 'none'
        }}
      />
      {label && format && (
        <RackValueTip label={label} value={format(value)} visible={hover || dragging} />
      )}
    </button>
  )
}
