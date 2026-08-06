import { useCallback, useEffect, useRef, useState } from 'react'
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
  resetTo,
  locked = false,
  raised = false,
  lockScrim = false,
  typeable = false,
  tapTempo = false,
  presets
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
  /** Dims and disables the knob without moving it — for a control that is wired up but does
   *  nothing in the unit's current mode (e.g. an algorithmic-only knob while Convolution is
   *  selected), so it stops inviting a turn that has no audible effect. */
  locked?: boolean
  /** Adds a drop-shadow so the knob reads as sitting proud of the plate rather than flush/sunk
   *  into it. Off by default — Delay/Reverb's existing knob art already reads correctly without
   *  it, and adding it there would be an unrequested visual change. */
  raised?: boolean
  /**
   * Layers a dark scrim over the whole knob (not just a filter on the image) when locked — a
   * filter alone reads as "slightly different color," an added shape reads as "this is off" at
   * a glance. Trying this on Echo Lab first rather than everywhere at once; off by default so
   * Delay/Reverb's existing locked-knob look is unchanged until/unless it's rolled out there too.
   */
  lockScrim?: boolean
  /**
   * Right-click opens an inline numeric field instead of the usual context menu — for a control
   * where dragging to an exact value is fiddly (a delay time in ms is the first case). Off by
   * default so this is opt-in per knob rather than a blanket behaviour change; trying it on the
   * orange Delay's Time knob first before rolling it out further.
   */
  typeable?: boolean
  /**
   * Adds a TAP button to the same right-click popover — tapping it a few times averages the
   * interval between taps into a millisecond value and applies it live, the way a hardware delay
   * pedal's footswitch does. Only meaningful alongside `typeable`, and only on a knob whose value
   * is itself a time in ms (the orange Delay's Time, Echo Lab's Time/L Delay/R Delay).
   */
  tapTempo?: boolean
  /**
   * Quick-pick buttons shown in the same popover — for a knob like Ratio where a handful of exact
   * values (dotted-eighth, triplet, ...) are what people actually want rather than an arbitrary
   * drag position. Only meaningful alongside `typeable`.
   */
  presets?: { label: string; value: number }[]
}) {
  const dragRef = useRef<{
    startX: number
    startY: number
    lastY: number
    currentValue: number
    armed: boolean
  } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [hover, setHover] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const editInputRef = useRef<HTMLInputElement | null>(null)

  const frac = max > min ? (value - min) / (max - min) : 0
  // Standard knob sweep: -135deg (fully counter-clockwise) to +135deg, 270deg of travel.
  const angle = -135 + frac * 270

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        lastY: e.clientY,
        currentValue: value,
        armed: false
      }
      setDragging(true)
    },
    [value]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current
      if (!drag) return
      // Vertical drag, not rotational — dragging in a circle around a small knob feels wrong and
      // is imprecise. 200px of drag covers the full range at the knob itself, as most DAW knobs
      // do — but a knob spanning a wide range (an Echo Lab delay time over several seconds) packs
      // many ms into each of those pixels, which read as "huge gaps" and sudden jumps for exact
      // values. Real plugin knobs fix this by rewarding a drag that strays sideways away from the
      // knob with finer resolution — same idea here: the further right/left of where the drag
      // started, the more pixels it takes to cover the same range, so pulling the mouse out to the
      // side is how you dial in something precise. Applied to the INCREMENT each move, using the
      // value already reached rather than the value the drag started at, so moving purely
      // sideways (no new vertical motion) never changes the value on its own.
      // Dead zone before the first move: a trackpad's tap-to-click / pressure sensitivity can
      // occasionally register a light graze as a real pointerdown+move, which reads as "the knob
      // grabbed itself" since no deliberate click was involved. Gates only the FIRST response —
      // once a real drag is underway, every subsequent pixel should count, or precise moves would
      // keep eating their own first few pixels.
      if (!drag.armed) {
        if (Math.abs(e.clientY - drag.startY) < 8) return
        drag.armed = true
        drag.lastY = e.clientY
      }
      const deltaYStep = drag.lastY - e.clientY
      if (deltaYStep === 0) return
      const sidewaysPx = Math.abs(e.clientX - drag.startX)
      const pixelsForFullRange = Math.min(1400, 200 + sidewaysPx * 4)
      const next = Math.max(
        min,
        Math.min(max, drag.currentValue + (deltaYStep / pixelsForFullRange) * (max - min))
      )
      drag.lastY = e.clientY
      drag.currentValue = next
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

  // Safety net, not the normal path: a captured pointer keeps routing to this element regardless
  // of where the cursor physically is, so a legitimate drag never fires Leave mid-drag. If capture
  // ever silently failed to take, though, a stale dragRef could persist and make a LATER hover
  // (no click at all) look like it's still dragging — clearing here guarantees that can't happen.
  const handlePointerLeave = useCallback(() => {
    dragRef.current = null
    setDragging(false)
    setHover(false)
  }, [])

  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault()
      if (locked || !typeable) return
      dragRef.current = null
      setDragging(false)
      setEditValue(String(Math.round(value * 100) / 100))
      setEditing(true)
    },
    [locked, typeable, value]
  )

  const commitEdit = useCallback(() => {
    const parsed = parseFloat(editValue)
    if (Number.isFinite(parsed)) onChange(Math.max(min, Math.min(max, parsed)))
    setEditing(false)
  }, [editValue, min, max, onChange])

  // Autofocus + select-all when the field appears, so typing immediately replaces the value
  // rather than requiring a click first.
  useEffect(() => {
    if (editing) editInputRef.current?.select()
  }, [editing])

  // Ring buffer of tap timestamps, capped at 4 — matches how a real tap-tempo pedal settles
  // (typically ~4 taps to lock a reading), not component state — a tap needs to feel
  // instantaneous, and there's nothing here worth a re-render on its own (the resulting value
  // change re-renders via onChange/editValue anyway). A gap over 2s resets the sequence, same as
  // hardware footswitches, so an old sequence doesn't quietly average into a new one you meant to
  // start fresh.
  //
  // An earlier version kept up to 8 timestamps (7 intervals) and averaged all of them evenly,
  // which meant one imprecise early tap (the usual case: your very first tap before you've
  // settled into the beat) kept dragging the result down until enough later taps pushed it out of
  // that much longer buffer. A pure single-interval blend (tried next) converged in 2 taps but
  // carried too much raw human jitter through untouched. Averaging only the last 3 intervals is
  // the middle ground: always reflects your most recent tapping, smooths ordinary jitter across a
  // few taps rather than one, and — since the buffer holds at most 4 timestamps — is fully caught
  // up to a deliberately changed tempo within 4 taps, same as hardware.
  const tapTimesRef = useRef<number[]>([])
  const handleTap = useCallback(() => {
    const now = performance.now()
    const times = tapTimesRef.current
    if (times.length > 0 && now - times[times.length - 1] > 2000) times.length = 0
    times.push(now)
    if (times.length > 4) times.shift()
    if (times.length < 2) return
    const intervals: number[] = []
    for (let i = 1; i < times.length; i++) intervals.push(times[i] - times[i - 1])
    const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length
    const next = Math.max(min, Math.min(max, Math.round(avgMs)))
    setEditValue(String(next))
    onChange(next)
  }, [min, max, onChange])

  // Read as "this ms value, as a quarter note, is X BPM" — shown whenever tapTempo is on, not
  // just right after tapping, so a typed value gets the same feedback as a tapped one.
  const editValueMs = parseFloat(editValue)
  const tapBpm = tapTempo && Number.isFinite(editValueMs) && editValueMs > 0 ? 60000 / editValueMs : null

  return (
    <>
    <button
      onPointerDown={locked ? undefined : handlePointerDown}
      onPointerMove={locked ? undefined : handlePointerMove}
      onPointerUp={locked ? undefined : handlePointerUp}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={handlePointerLeave}
      onDoubleClick={locked || resetTo === undefined ? undefined : () => onChange(resetTo)}
      onContextMenu={handleContextMenu}
      title={
        locked
          ? 'Inactive in this mode'
          : typeable
            ? tapTempo
              ? 'Right-click to type a value or tap tempo'
              : 'Right-click to type a value'
            : resetTo === undefined
              ? undefined
              : 'Double-click to reset'
      }
      aria-label={label}
      aria-disabled={locked}
      style={{
        position: 'absolute',
        left: `${centerXPct}%`,
        top: `${centerYPct}%`,
        width: `${diameterPct}%`,
        aspectRatio: '1 / 1',
        transform: 'translate(-50%, -50%)',
        cursor: locked ? 'default' : 'ns-resize',
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
          // Solid but desaturated/darkened, not faded — an inert control still needs to read as
          // a real physical knob sitting on the panel, not a translucent ghost of one. Raised
          // shadow layers on top when both apply (a locked knob is still a raised knob).
          filter: [
            raised ? 'drop-shadow(0 3px 3px rgba(0,0,0,0.65))' : '',
            locked ? 'grayscale(1) brightness(0.55)' : ''
          ].filter(Boolean).join(' ') || 'none',
          transition: 'filter .15s',
          pointerEvents: 'none',
          userSelect: 'none'
        }}
      />
      {locked && lockScrim && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '50%',
            background: 'rgba(10,10,10,0.5)',
            pointerEvents: 'none'
          }}
        />
      )}
      {label && format && !editing && (
        <RackValueTip label={label} value={format(value)} visible={hover || dragging} />
      )}
    </button>
    {editing && (
      <div
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: `${centerXPct}%`,
          // Anchored by its BOTTOM edge and growing upward, rather than a fixed subtraction sized
          // for one line — the popover's height now varies (a bare field vs. field+TAP vs.
          // field+preset grid), and this way none of those overlap the knob regardless.
          top: `calc(${centerYPct}% - ${diameterPct / 2}% - 8px)`,
          transform: 'translate(-50%, -100%)',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          padding: 8,
          borderRadius: 6,
          background: 'rgba(0,0,0,0.92)',
          border: '1px solid rgba(255,255,255,0.3)',
          boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
          // Sizes to whatever's widest inside (the BPM readout is usually the widest line) rather
          // than to the input+TAP row alone — without this the row above set the effective width
          // and the BPM text wrapped/clipped inside it.
          width: 'max-content',
          zIndex: 30
        }}
      >
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            ref={editInputRef}
            type="number"
            value={editValue}
            autoFocus
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit()
              else if (e.key === 'Escape') setEditing(false)
            }}
            style={{
              width: 64,
              padding: '3px 6px',
              borderRadius: 4,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.25)',
              color: '#f4f4f5',
              font: "500 12px 'IBM Plex Sans', sans-serif",
              textAlign: 'center'
            }}
          />
          {tapTempo && (
            <button
              type="button"
              onClick={handleTap}
              // Clicking a button normally shifts focus to it first, which fires the input's
              // onBlur -> commitEdit -> closes the whole popover after a single tap, exactly the
              // "clicking tap closes the window" bug — you'd never get a second tap to average
              // against. preventDefault on mousedown stops that focus shift without stopping the
              // click itself (mousedown -> mouseup -> click still fires), the standard fix for
              // "keep the field focused while clicking a sibling control."
              onMouseDown={(e) => e.preventDefault()}
              style={{
                padding: '3px 10px',
                borderRadius: 4,
                background: 'rgba(255,174,46,0.16)',
                border: '1px solid rgba(255,174,46,0.5)',
                color: '#ffae2e',
                font: "600 11px 'IBM Plex Sans', sans-serif",
                letterSpacing: '0.03em',
                cursor: 'pointer'
              }}
            >
              TAP
            </button>
          )}
        </div>
        {tapBpm !== null && (
          <div style={{ fontSize: 10, color: '#a1a1aa', textAlign: 'center', whiteSpace: 'nowrap' }}>
            &asymp; {Math.round(tapBpm)} BPM (as 1/4)
          </div>
        )}
        {presets && presets.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: 148 }}>
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  const next = Math.max(min, Math.min(max, p.value))
                  setEditValue(String(next))
                  onChange(next)
                }}
                onMouseDown={(e) => e.preventDefault()}
                style={{
                  padding: '2px 6px',
                  borderRadius: 3,
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.2)',
                  color: '#d4d4d8',
                  font: "500 10px 'IBM Plex Sans', sans-serif",
                  cursor: 'pointer'
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>
    )}
    </>
  )
}
