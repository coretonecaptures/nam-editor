/**
 * Stacks a rack unit's header, panel and IR footer.
 *
 * This is deliberately almost nothing. A plain `flex-direction:column` container's default
 * `align-items:stretch` already makes every child exactly as wide as the column — which is all
 * "header and footer must match the panel's width" ever needed, once the panel itself is sized by
 * `width:100%` (RackCrop) rather than by height. Three prior versions of this file did real work
 * (a ResizeObserver, then a CSS Grid with a computed column width) to solve a problem that only
 * existed because the panel used to be sized from height instead — see RackCrop's comment.
 */
export function RackColumn({
  panel,
  header,
  footer
}: {
  panel: React.ReactNode
  header?: React.ReactNode
  footer?: React.ReactNode
}) {
  return (
    <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {header}
      {panel}
      {footer}
    </div>
  )
}
