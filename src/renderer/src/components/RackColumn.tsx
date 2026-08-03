/**
 * Keeps a unit's header and IR row the same width as the panel above them — pure CSS, no
 * measurement.
 *
 * The previous version measured the panel's rendered width with a ResizeObserver and copied it
 * onto the header/footer. That broke as soon as two units (Delay, Reverb) sat in the same flex
 * column: both observers fired and pushed state independently, so header widths lagged a frame
 * behind the panel they were supposed to match, and the two units' heights could momentarily
 * disagree enough to overlap.
 *
 * CSS Grid solves the same problem without JS. A `1fr` row is sized first, from the space left
 * over after the `auto` header/footer rows. Once that row's height is known, the panel's
 * `aspect-ratio` gives it a concrete preferred WIDTH — and because grid resolves column width
 * from the widest cell in ANY row of that column, the header and footer (placed in the same
 * single-column grid) are stretched to that same width automatically. This is deterministic:
 * there is no observer, no re-render, no race between siblings.
 */
export function RackColumn({
  panel,
  header,
  footer,
  align = 'stretch'
}: {
  /** The RackCrop. Its aspect-ratio sets the width of the whole column. */
  panel: React.ReactNode
  header?: React.ReactNode
  footer?: React.ReactNode
  /** How the unit sits in a column wider than itself. */
  align?: 'stretch' | 'flex-start' | 'flex-end'
}) {
  const justify = align === 'flex-end' ? 'end' : align === 'flex-start' ? 'start' : 'stretch'
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateRows: `${header ? 'auto ' : ''}1fr${footer ? ' auto' : ''}`,
        gridTemplateColumns: 'auto',
        justifyContent: justify,
        rowGap: 8,
        flex: '1 1 0',
        minHeight: 0,
        minWidth: 0
      }}
    >
      {header && <div style={{ minWidth: 0 }}>{header}</div>}
      {/* minHeight:0 defeats the automatic minimum size a grid item otherwise takes from its
          own content (here, the aspect-ratio box), which would refuse to shrink below that and
          push the row taller than the 1fr track actually has room for. */}
      <div style={{ minHeight: 0, minWidth: 0, display: 'flex' }}>{panel}</div>
      {footer && <div style={{ minWidth: 0 }}>{footer}</div>}
    </div>
  )
}
