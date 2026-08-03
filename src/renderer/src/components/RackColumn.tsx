import { useLayoutEffect, useRef, useState } from 'react'

/**
 * Keeps a unit's header and IR row the same width as the panel above them.
 *
 * Since the panels became height-driven, a panel is usually NARROWER than the column it sits in —
 * its width falls out of the available height and its aspect ratio. A header stretched to the
 * full column then runs past the metal, so its preset dropdown floats out in space to the right
 * of the unit instead of sitting flush with it.
 *
 * The width cannot be derived in CSS: it comes from the panel's height, and the surrounding rows
 * would in turn affect that height, which is circular. So it is measured instead. A
 * ResizeObserver is the honest tool for "however wide that ended up being".
 */
export function RackColumn({
  panel,
  header,
  footer,
  align = 'stretch'
}: {
  /** The RackCrop. Its rendered width sets the width of everything else. */
  panel: React.ReactNode
  header?: React.ReactNode
  footer?: React.ReactNode
  /** How the unit sits in a column wider than itself. */
  align?: 'stretch' | 'flex-start' | 'flex-end'
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width
      // Ignore sub-pixel noise; re-rendering on every fractional change causes a feedback loop
      // with the flex layout that produced the width in the first place.
      setWidth((prev) => (prev === null || Math.abs(prev - w) > 1 ? w : prev))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const matched: React.CSSProperties = width ? { width, maxWidth: '100%' } : {}

  return (
    <div style={{ flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 8, alignItems: align }}>
      {header && <div style={{ ...matched, flex: 'none' }}>{header}</div>}
      <div ref={ref} style={{ flex: '1 1 0', minHeight: 0, display: 'flex' }}>
        {panel}
      </div>
      {footer && <div style={{ ...matched, flex: 'none' }}>{footer}</div>}
    </div>
  )
}
