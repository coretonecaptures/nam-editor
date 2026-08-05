/**
 * Shared furniture for the photoreal rack units.
 *
 * Everything positions as a percentage of its own panel image (measured once, offline) rather
 * than in pixels, so a unit can be drawn at any size — and two units of different native
 * resolutions can sit side by side and still line up.
 */

/**
 * A mode indicator, DRAWN rather than photographed.
 *
 * Photo sprites were tried and cannot work here. The rack has three faceplate colours but only
 * the silver bay carries both a lit and an unlit LED, so the missing states had to be borrowed
 * from silver — which pasted a pale ring onto the navy and purple modules. Cropping tighter did
 * not help, because the lens's own bezel highlight is part of what mismatches.
 *
 * Drawing it also removes a second bug class: a photographed pair whose lenses sit at different
 * offsets inside their own crops makes the light visibly jump as you toggle it. A drawn circle
 * is centred by construction.
 *
 * The panels have their LEDs erased to bare metal, so this supplies the housing as well as the
 * light: a dark recessed bezel always, plus emission and glow only when lit.
 */
export function RackLed({
  active,
  centerXPct,
  centerYPct,
  widthPct,
  colour = '#ffae2e'
}: {
  active: boolean
  centerXPct: number
  centerYPct: number
  /** Lens diameter as a percentage of panel width. */
  widthPct: number
  colour?: string
}) {
  return (
    <span
      style={{
        position: 'absolute',
        left: `${centerXPct}%`,
        top: `${centerYPct}%`,
        width: `${widthPct}%`,
        aspectRatio: '1 / 1',
        transform: 'translate(-50%, -50%)',
        borderRadius: '50%',
        background: active
          ? `radial-gradient(circle at 38% 34%, #fff6df 0%, ${colour} 42%, #a3560a 100%)`
          : 'radial-gradient(circle at 38% 34%, #4a4741 0%, #22201d 55%, #100f0d 100%)',
        // No outer light ring when dark — it read as a pale halo against the navy and purple
        // faceplates. Unlit is pure recess; only the lit state emits.
        boxShadow: active
          ? `0 0 4px 1px ${colour}cc, 0 0 10px 3px ${colour}66, inset 0 0 2px rgba(0,0,0,0.55)`
          : 'inset 0 1px 2px rgba(0,0,0,0.85)',
        transition: 'background 0.12s, box-shadow 0.12s',
        pointerEvents: 'none'
      }}
    />
  )
}

/**
 * A hit region over a photographed rocker switch. There is no button art to move, so the press
 * reads as the face darkening and sinking a hair into its bezel — which is what a real recessed
 * rocker does anyway.
 */
export function RackButton({
  label,
  centerXPct,
  centerYPct,
  widthPct,
  heightPct,
  onClick,
  locked = false,
  pressed
}: {
  label: string
  centerXPct: number
  centerYPct: number
  widthPct: number
  heightPct: number
  onClick: () => void
  /** Dims and disables the button without hiding it — for a switch that is wired up but does
   *  nothing in the unit's current mode. */
  locked?: boolean
  /**
   * CSS-only stand-in for a rocker physically tilting between up (off) and down (on) — there is
   * no second photographed switch position to composite in, so this is a shadow/highlight shift
   * on top of the single static photo, not a real tilt. Omit (undefined) to keep every other
   * unit's switches exactly as before: no overlay at all, LED-only state, same as always. Pass
   * true/false only where a rocker's own on/off state should read on the switch body itself, not
   * just its LED.
   */
  pressed?: boolean
}) {
  return (
    <button
      onClick={locked ? undefined : onClick}
      title={locked ? 'Inactive in this mode' : label}
      aria-label={label}
      aria-disabled={locked}
      className="group"
      style={{
        position: 'absolute',
        left: `${centerXPct}%`,
        top: `${centerYPct}%`,
        width: `${widthPct}%`,
        height: `${heightPct}%`,
        transform: 'translate(-50%, -50%)',
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: locked ? 'default' : 'pointer',
        pointerEvents: locked ? 'none' : 'auto',
        opacity: locked ? 0.4 : 1,
        transition: 'opacity .15s'
      }}
    >
      {pressed !== undefined && (
        <span
          className="pointer-events-none block w-full h-full rounded-[3px] absolute inset-0"
          style={{
            // Up (off): faint top highlight, as if catching light from above. Down (on): the
            // shadow flips to the top edge instead, as if the rocker tipped away from the light
            // toward the viewer at its bottom edge — cheap, but reads as a state change at a
            // glance without needing a second photographed switch position.
            boxShadow: pressed
              ? 'inset 0 3px 5px rgba(0,0,0,0.55), inset 0 -1px 0 rgba(255,255,255,0.08)'
              : 'inset 0 -2px 4px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.12)',
            transition: 'box-shadow 0.15s'
          }}
        />
      )}
      <span
        className="block w-full h-full rounded-[3px] opacity-0 group-active:opacity-100 group-active:translate-y-[1px] transition-[opacity,transform] duration-75"
        style={{ background: 'rgba(0,0,0,0.55)', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.8)' }}
      />
    </button>
  )
}

/**
 * Text on a unit's display glass.
 *
 * The glass is a fixed fraction of the panel, so the character budget is fixed however large the
 * unit is drawn — hence the size step and hard truncation rather than wrapping, which no
 * segmented display does.
 */
export function RackDisplay({
  text,
  centerXPct,
  centerYPct,
  widthPct,
  heightPct,
  colour = '#ffa41f',
  maxFontCqw = 2.6
}: {
  text: string
  centerXPct: number
  centerYPct: number
  widthPct: number
  heightPct: number
  colour?: string
  /** Caps how large the text is ever allowed to render, independent of how much the length-based
   *  formula below would otherwise want. Default (2.6) is what Delay/Reverb have always used —
   *  unchanged for them. Echo Lab's LCD is proportionally wider than either, so the same formula
   *  hit this cap regardless of text length and always rendered at maximum size; a smaller
   *  override there fixes that without touching the other units at all. */
  maxFontCqw?: number
}) {
  // These displays are wide — half the panel on Delay and Reverb — so the budget is generous.
  // Truncating at 18 was wasting most of the glass; a preset name plus a value now fits.
  const shown = text.length > 40 ? `${text.slice(0, 39)}…` : text
  // Fit to the GLASS, not to the panel. Displays differ wildly in size between units — the
  // Gate's little value window is a fraction of the Delay's — so a shared font size overflowed
  // the small ones. Doto is near-monospace at ~0.62em per character; 0.9 leaves a margin.
  const fontCqw = Math.min(maxFontCqw, (widthPct * 0.9) / (Math.max(shown.length, 1) * 0.62))
  return (
    <div
      style={{
        position: 'absolute',
        left: `${centerXPct}%`,
        top: `${centerYPct}%`,
        width: `${widthPct}%`,
        height: `${heightPct}%`,
        transform: 'translate(-50%, -50%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none',
        overflow: 'hidden'
      }}
    >
      <span
        style={{
          fontFamily: "'Doto', monospace",
          fontWeight: 500,
          fontSize: `${fontCqw}cqw`,
          letterSpacing: '0.04em',
          color: colour,
          textShadow: `0 0 6px ${colour}d9, 0 0 14px rgba(255,140,0,0.45)`,
          whiteSpace: 'nowrap'
        }}
      >
        {shown}
      </span>
    </div>
  )
}
