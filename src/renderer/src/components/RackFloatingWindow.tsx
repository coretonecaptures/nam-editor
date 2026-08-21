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
// Hard ceiling regardless of native art size — was previously unbounded above the viewport-minus-
// margin cap, which meant a wide-native unit (Delay/Reverb, 2172px) rendered nearly full-screen
// on any normal monitor. 1300 is still plenty large to read clearly, just not overwhelming.
const MAX_WIDTH = 1300

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
   * doesn't balloon to nearly the whole screen on a large monitor.
   */
  nativeWidth: number
  onClose: () => void
  children: React.ReactNode
}) {
  const [width] = useState(() => Math.min(nativeWidth, MAX_WIDTH, Math.max(560, window.innerWidth - 60)))
  const [pos, setPos] = useState(() => ({
    x: Math.max(20, window.innerWidth / 2 - width / 2),
    y: 90
  }))
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null)
  const [dragging, setDragging] = useState(false)

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
        overflow: 'hidden'
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
    </div>
  )
}
