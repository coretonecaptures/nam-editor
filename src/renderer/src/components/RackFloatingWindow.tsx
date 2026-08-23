import { useCallback, useRef, useState } from 'react'

/**
 * A rack unit's floating view — an in-page floating panel, not a modal and not a separate OS
 * window. Generalized from the original EchoLabFloatingWindow (2026-08-04) so Delay and Reverb
 * could get the same treatment without three near-identical drag implementations.
 *
 * Deliberately not a real second BrowserWindow: that would need IPC state-syncing between two
 * renderer processes editing the same live settings object, with all the desync risk that
 * implies, for a want ("see several units at once, move them around") that a same-window
 * floating overlay already satisfies completely — it shares React state directly, sits above
 * everything via z-index with no backdrop, and everything outside its own bounds stays fully
 * interactive since there is no full-screen click-catcher behind it like a real modal has.
 *
 * Any number of these can be open at once — each carries its own position/drag state, and
 * z-index only needs to clear the rest of the player chrome, not each other, since overlapping
 * floating windows are the user's own arrangement to make.
 */
// Ceiling for the STARTING (auto-sized-on-open) width only — was previously unbounded above the
// viewport-minus-margin cap, which meant a wide-native unit (Delay/Reverb, 2172px) rendered
// nearly full-screen on any normal monitor. 1300 is still plenty large to read clearly, just not
// overwhelming. NOT the resize handle's ceiling: Echo Lab (1748) and Delay/Reverb (2172) both
// have native art wider than this, so using it as the resize ceiling too meant those panels
// opened already AT the ceiling with zero headroom to grow — the resize handle worked for
// shrinking only, never growing, no matter what. See RESIZE_MAX_WIDTH below.
const MAX_WIDTH = 1300
// Lower clamp for the resize handle — below this the panel art (percentage-positioned knobs,
// cqw-sized shadows/text) starts crowding into itself rather than just looking smaller.
const MIN_WIDTH = 420

export function RackFloatingWindow({
  title,
  nativeWidth,
  onClose,
  children
}: {
  /** Shown in the drag handle, e.g. "DELAY" or "REVERB". */
  title: string
  /**
   * The wrapped panel's own native pixel width (matches that panel's own P.w) — sized to this
   * rather than a smaller fixed constant so floating is never a readability downgrade from the
   * inline rack-column rendering. Capped against the viewport so it still fits a narrower window,
   * and against MAX_WIDTH below so a unit whose native art is very wide (Delay/Reverb at 2172)
   * doesn't balloon to nearly the whole screen on a large monitor. Just the starting width — the
   * corner handle lets it grow past this up to MAX_WIDTH, or shrink down to MIN_WIDTH.
   */
  nativeWidth: number
  onClose: () => void
  children: React.ReactNode
}) {
  const [width, setWidth] = useState(() => Math.min(nativeWidth, MAX_WIDTH, Math.max(560, window.innerWidth - 60)))
  // The resize handle's own ceiling — a panel's native art resolution if that's wider than
  // MAX_WIDTH (Echo Lab, Delay, Reverb all are), otherwise MAX_WIDTH so a smaller panel isn't
  // needlessly capped at its own native size either. Deliberately NOT just MAX_WIDTH — see that
  // constant's comment for why sharing one ceiling between "starting size" and "how big a user
  // can drag it" broke growing entirely for every wide panel.
  const resizeMaxWidth = Math.max(nativeWidth, MAX_WIDTH)
  const [pos, setPos] = useState(() => ({
    x: Math.max(20, window.innerWidth / 2 - width / 2),
    y: 90
  }))
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  // Separate from dragRef/setDragging: resizing changes width, not position, and the two must
  // never run at once (a pointer is either on the header bar or the corner handle, never both).
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const [resizing, setResizing] = useState(false)

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId)
      dragRef.current = { startX: e.clientX, startY: e.clientY, startPosX: pos.x, startPosY: pos.y }
      setDragging(true)
    },
    [pos]
  )

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    setPos({
      x: drag.startPosX + (e.clientX - drag.startX),
      y: drag.startPosY + (e.clientY - drag.startY)
    })
  }, [])

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    setDragging(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // Already released.
    }
  }, [])

  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.stopPropagation()
      e.currentTarget.setPointerCapture(e.pointerId)
      resizeRef.current = { startX: e.clientX, startWidth: width }
      setResizing(true)
    },
    [width]
  )

  const handleResizePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current
    if (!resize) return
    const proposed = resize.startWidth + (e.clientX - resize.startX)
    const clampedWidth = Math.max(MIN_WIDTH, Math.min(resizeMaxWidth, proposed))
    setWidth(clampedWidth)
    // Keep the panel on-screen as it grows by nudging its position left if needed, rather than
    // capping the width itself at whatever happens to fit at the CURRENT x — that previously
    // capped growth almost immediately for any centered panel, since a centered panel's distance
    // to the right edge is rarely much more than its own starting width, especially for Delay/
    // Reverb's wide native art, which is already sized close to the available window width.
    setPos((prev) => {
      const maxX = window.innerWidth - clampedWidth - 20
      return prev.x > maxX ? { ...prev, x: Math.max(20, maxX) } : prev
    })
  }, [resizeMaxWidth])

  const handleResizePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    resizeRef.current = null
    setResizing(false)
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      // Already released.
    }
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width,
        zIndex: 450,
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        boxShadow: '0 24px 60px rgba(0,0,0,.55)',
        overflow: 'hidden',
        // While resizing, the browser's own text-selection/drag-image affordances fight the
        // pointer-driven width tracking above — same reason the header drag bar sets this.
        userSelect: resizing ? 'none' : undefined
      }}
    >
      <div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          cursor: dragging ? 'grabbing' : 'grab',
          background: 'var(--field)',
          borderBottom: '1px solid var(--border)',
          userSelect: 'none',
          touchAction: 'none'
        }}
      >
        <span style={{ font: "600 11px 'IBM Plex Mono', monospace", letterSpacing: '.06em', color: 'var(--text-2)' }}>
          ⠿ {title}
        </span>
        <button
          onClick={onClose}
          onPointerDown={(e) => e.stopPropagation()}
          title={`Close — ${title} returns to its normal slot`}
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--panel)',
            color: 'var(--text-2)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            font: "600 12px 'IBM Plex Sans', sans-serif",
            flexShrink: 0
          }}
        >
          ✕
        </button>
      </div>
      <div style={{ padding: 14 }}>{children}</div>
      <div
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerUp}
        title="Drag to resize"
        style={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          width: 18,
          height: 18,
          cursor: 'ew-resize',
          touchAction: 'none',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'flex-end',
          padding: 3
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" style={{ opacity: resizing ? 1 : 0.45 }}>
          <path d="M9 1 L1 9 M9 5 L5 9" stroke="var(--text-2)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  )
}
