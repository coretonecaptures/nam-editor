import { useCallback, useRef, useState } from 'react'
import { RackEchoLab } from './RackEchoLab'
import type { EchoLabSettings } from '../utils/liveEngine'

/**
 * Echo Lab's floating view — an in-page floating panel, not a modal and not a separate OS window.
 *
 * Deliberately not a real second BrowserWindow: that would need IPC state-syncing between two
 * renderer processes editing the same live EchoLabSettings object, with all the desync risk that
 * implies, for a want ("see Delay and Echo Lab at once, move it around") that a same-window
 * floating overlay already satisfies completely — it shares React state directly, sits above
 * everything via z-index with no backdrop, and everything outside its own bounds stays fully
 * interactive since there is no full-screen click-catcher behind it like a real modal has.
 *
 * Sized to the panel's own NATIVE pixel width (matches RackEchoLab's own P.w) rather than a
 * smaller fixed constant — an earlier version used 900px, which on any reasonably wide window was
 * actually SMALLER than the inline rack-column rendering already gets, making "float it for
 * readability" a downgrade. Capped against the viewport so it still fits on a narrower window.
 */
const NATIVE_WIDTH = 1748

export function EchoLabFloatingWindow({
  echoLab,
  onChange,
  onClose
}: {
  echoLab: EchoLabSettings
  onChange: (patch: Partial<EchoLabSettings>) => void
  onClose: () => void
}) {
  const [width] = useState(() => Math.min(NATIVE_WIDTH, Math.max(560, window.innerWidth - 60)))
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
          ⠿ ECHO LAB — FLOATING · drag to move
        </span>
        <button
          onClick={onClose}
          onPointerDown={(e) => e.stopPropagation()}
          title="Close — Echo Lab returns to its normal slot"
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
      <div style={{ padding: 14 }}>
        <RackEchoLab echoLab={echoLab} onChange={onChange} />
      </div>
    </div>
  )
}
