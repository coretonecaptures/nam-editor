/**
 * Grid-based layout for one rack unit: header, panel, IR footer — all sharing one column width,
 * and that width GROWS to use whichever of the surrounding box's two dimensions is more
 * generous, rather than being capped by height alone.
 *
 * Three bugs, in order, got this to its current shape:
 *
 * 1. A ResizeObserver used to measure the rendered panel and copy its width onto the header and
 *    footer. With Delay and Reverb stacked in the same column, both observers fired and pushed
 *    React state independently, so a header could render at a stale width for a frame while its
 *    panel had already resized — producing the overlap/collision that was reported.
 *
 * 2. Fixed with a `1fr`-row CSS Grid column sized to `auto`: the column shrink-wraps to the
 *    widest row (the aspect-ratio panel, once its height is known), which does solve #1 with no
 *    JS at all — but "auto" means "shrink to content," which by definition can never grow past
 *    what height alone demands. So every panel became exactly as big as the available height and
 *    nothing more, even with free width sitting unused next to it. That is the "everything is
 *    tiny" regression.
 *
 * 3. Fixed by replacing `auto` with an explicit width computed from CSS container query units —
 *    `min(100cqw, (100cqh - header - footer - gaps) * aspect)`: use the smaller of "as wide as
 *    the box allows" or "as wide as the box's remaining height allows at this unit's aspect
 *    ratio," i.e. grow into whichever axis is actually scarce, like `object-fit: contain`. That
 *    broke on the FIRST attempt for a subtler reason: `container-type: size` was set on the same
 *    element whose `grid-template-columns` read `cqw`/`cqh` — self-referential (the query units
 *    are defined by the element's own resolved size, which is exactly what that property is
 *    trying to compute), so Chromium silently discards the value and falls back to filling the
 *    full width. Confirmed by isolating it in headless Chrome outside the app before landing this
 *    a second time. The fix is to put `container-type: size` on a wrapper ONE level up (`.src`
 *    below) and read its cqw/cqh from the grid, which is a separate, non-self-referential element.
 *
 * headerPx/footerPx are real measurements, not guesses: PresetMenu's button is a fixed 32px
 * (`PresetMenu.tsx`), IrPicker's is a fixed 36px (`h-9`, `IrPicker.tsx`) — using the true numbers
 * means the reserved column width matches what those rows actually render at.
 */
export function RackColumn({
  panel,
  header,
  footer,
  align = 'stretch',
  aspect,
  headerPx = 32,
  footerPx = 36
}: {
  /** The RackCrop. Its own aspect-ratio + height:100% still does the final no-distortion sizing;
   *  this component only decides how much room to offer it. */
  panel: React.ReactNode
  header?: React.ReactNode
  footer?: React.ReactNode
  /** How the unit sits in a box wider than itself. */
  align?: 'stretch' | 'flex-start' | 'flex-end'
  /** Panel width ÷ height — must match the RackCrop passed in `panel`. */
  aspect: number
  headerPx?: number
  footerPx?: number
}) {
  const justify = align === 'flex-end' ? 'end' : align === 'flex-start' ? 'start' : 'stretch'
  const rows = [header ? 'auto' : null, '1fr', footer ? 'auto' : null].filter(Boolean).join(' ')
  const gapCount = (header ? 1 : 0) + (footer ? 1 : 0)
  const reserved = (header ? headerPx : 0) + (footer ? footerPx : 0) + gapCount * 8
  const colWidth = `min(100cqw, calc((100cqh - ${reserved}px) * ${aspect}))`

  return (
    <div
      // The container-query SOURCE. Deliberately a separate element from the grid below — see
      // point 3 above.
      style={{ containerType: 'size', width: '100%', height: '100%', flex: '1 1 0', minHeight: 0, minWidth: 0 }}
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'grid',
          gridTemplateRows: rows,
          gridTemplateColumns: colWidth,
          justifyContent: justify,
          rowGap: 8
        }}
      >
        {header && <div style={{ minWidth: 0 }}>{header}</div>}
        {/* minHeight:0 defeats the automatic minimum size a grid item otherwise takes from its
            own content (the aspect-ratio box), which would refuse to shrink below that. */}
        <div style={{ minHeight: 0, minWidth: 0, display: 'flex' }}>{panel}</div>
        {footer && <div style={{ minWidth: 0 }}>{footer}</div>}
      </div>
    </div>
  )
}
