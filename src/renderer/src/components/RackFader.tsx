import { useCallback, useRef, useState } from 'react'
import { RackValueTip } from './RackValueTip'
import rackFaderCap from '../assets/fx/rack-fader-cap.png'

/**
 * A fader cap riding in a channel cut into a rack panel.
 *
 * Unlike RackKnob this only ever translates, never rotates — so unlike the knob art, the cap is
 * allowed to keep its own directional highlight: its orientation to the camera never changes as
 * it moves, only its Y position.
 *
 * Geometry is percentages of the panel image, same as everything else on these units.
 */
export function RackFader({
  value,
  min,
  max,
  onChange,
  centerXPct,
  trackTopPct,
  trackBottomPct,
  capWidthPct,
  capAspect = 1.35,
  label,
  format,
  inert = false
}: {
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  centerXPct: number
  /** Top and bottom of the cut channel, as a percentage of panel height. */
  trackTopPct: number
  trackBottomPct: number
  /** Cap width as a percentage of panel width. */
  capWidthPct: number
  /** Cap height as a multiple of its width. The source art is ~1.9; squashing it a little keeps
   *  the throw usable on a short channel without reading as a different part. */
  capAspect?: number
  label?: string
  /** Renders the value for the hover/drag readout. */
  format?: (value: number) => string
  /** Dim and ignore input — the parameter exists but does nothing in the current mode. */
  inert?: boolean
}) {
  const dragRef = useRef<{ startY: number; startValue: number; trackPx: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [hover, setHover] = useState(false)

  // An inert fader parks at the bottom rather than sitting wherever its stored value happens to
  // be. A dimmed cap halfway up still reads as a setting; parked at zero it reads as "not in
  // play". The stored value is untouched — this is display only, so re-engaging the parameter
  // brings the cap straight back to where it was.
  const frac = inert ? 0 : max > min ? (value - min) / (max - min) : 0
  // Fader convention is min at the BOTTOM, so the fraction runs up from trackBottom.
  const centerYPct = trackBottomPct - frac * (trackBottomPct - trackTopPct)

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      const panelH = wrapRef.current?.offsetHeight ?? 0
      dragRef.current = {
        startY: e.clientY,
        startValue: value,
        trackPx: (panelH * (trackBottomPct - trackTopPct)) / 100
      }
      setDragging(true)
    },
    [value, trackTopPct, trackBottomPct]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current
      if (!drag || drag.trackPx <= 0) return
      // 1:1 with the channel — a fader should follow your finger exactly, unlike a knob where
      // drag distance is arbitrary.
      const deltaY = drag.startY - e.clientY
      const next = Math.max(min, Math.min(max, drag.startValue + (deltaY / drag.trackPx) * (max - min)))
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
    <div ref={wrapRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <button
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerEnter={() => setHover(true)}
        onPointerLeave={() => setHover(false)}
        aria-label={label}
        style={{
          position: 'absolute',
          left: `${centerXPct}%`,
          top: `${centerYPct}%`,
          width: `${capWidthPct}%`,
          transform: 'translate(-50%, -50%)',
          aspectRatio: `1 / ${capAspect}`,
          cursor: 'ns-resize',
          touchAction: 'none',
          background: 'none',
          border: 'none',
          padding: 0,
          pointerEvents: inert ? 'none' : 'auto'
        }}
      >
        <img
          src={rackFaderCap}
          alt=""
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            // Solid but desaturated/darkened, not faded — matches RackKnob's locked treatment.
            filter: inert
              ? 'grayscale(1) brightness(0.6) drop-shadow(0 2px 3px rgba(0,0,0,0.55))'
              : 'drop-shadow(0 2px 3px rgba(0,0,0,0.55))',
            transition: 'filter 0.15s',
            pointerEvents: 'none',
            userSelect: 'none'
          }}
        />
        {label && format && (
          <RackValueTip label={label} value={format(value)} visible={hover || dragging} />
        )}
      </button>
    </div>
  )
}
