import { useRef, useState, useCallback, useEffect } from 'react'

/**
 * Minimal fixed-row-height virtualizer over a SPARSE, paginated dataset — no react-window
 * dependency, since this app otherwise carries zero UI-library dependencies beyond dnd-kit and
 * fonts. `total` is the full row count (up to ~282K, see docs/ir-lab-manager-build-plan.md's
 * Phase 1 numbers) even though only the visible range is ever fetched or rendered: one DOM node
 * per visible row, and — via `onVisibleRangeChange` — one query per newly-scrolled-into range,
 * not one fetch for the whole dataset. `renderRow` returns `null` for an index not yet loaded
 * (the caller renders a lightweight placeholder for it); the list re-renders once that index's
 * data arrives without losing scroll position, since `total`'s height is fixed regardless of
 * what's loaded.
 */
export function VirtualList({
  total,
  rowHeight,
  renderRow,
  onVisibleRangeChange,
  overscan = 20,
  className
}: {
  total: number
  rowHeight: number
  renderRow: (index: number) => React.ReactNode
  onVisibleRangeChange: (start: number, end: number) => void
  overscan?: number
  className?: string
}): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setViewportHeight(entry.contentRect.height)
    })
    observer.observe(el)
    setViewportHeight(el.clientHeight)
    return () => observer.disconnect()
  }, [])

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }, [])

  const totalHeight = total * rowHeight
  const firstVisible = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2
  const lastVisible = Math.min(total, firstVisible + visibleCount)

  // Re-request whenever the visible range moves — the caller (IrModeShell) is responsible for
  // caching what it's already fetched and only hitting IPC for genuinely-new indices.
  useEffect(() => {
    if (total > 0) onVisibleRangeChange(firstVisible, lastVisible)
  }, [firstVisible, lastVisible, total, onVisibleRangeChange])

  const indices: number[] = []
  for (let i = firstVisible; i < lastVisible; i++) indices.push(i)

  return (
    <div ref={containerRef} onScroll={handleScroll} className={`overflow-y-auto ${className ?? ''}`}>
      <div style={{ height: totalHeight, position: 'relative' }}>
        {indices.map((index) => (
          <div key={index} style={{ position: 'absolute', top: index * rowHeight, left: 0, right: 0, height: rowHeight }}>
            {renderRow(index)}
          </div>
        ))}
      </div>
    </div>
  )
}
