/**
 * Shared furniture for the photoreal rack units.
 *
 * Everything positions as a percentage of its own panel image (measured once, offline) rather
 * than in pixels, so a unit can be drawn at any size — and two units of different native
 * resolutions can sit side by side and still line up.
 */

/**
 * A mode indicator. Both states are real photographed lenses cut from the panel render, with no
 * CSS glow layered on: the render's own glow is already correct, and adding a drop-shadow to it
 * reads as a blown-out halo. The panel art has its LEDs erased, so these sprites are lens-only
 * and the metal behind them is the panel's own — which is what keeps a patch square from
 * showing at positions with a different shadow gradient.
 */
export function RackLed({
  on,
  off,
  active,
  centerXPct,
  centerYPct,
  widthPct
}: {
  on: string
  off: string
  active: boolean
  centerXPct: number
  centerYPct: number
  widthPct: number
}) {
  return (
    <img
      src={active ? on : off}
      alt=""
      draggable={false}
      style={{
        position: 'absolute',
        left: `${centerXPct}%`,
        top: `${centerYPct}%`,
        width: `${widthPct}%`,
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
        userSelect: 'none'
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
  onClick
}: {
  label: string
  centerXPct: number
  centerYPct: number
  widthPct: number
  heightPct: number
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
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
        cursor: 'pointer'
      }}
    >
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
  colour = '#ffa41f'
}: {
  text: string
  centerXPct: number
  centerYPct: number
  widthPct: number
  heightPct: number
  colour?: string
}) {
  // These displays are wide — half the panel on Delay and Reverb — so the budget is generous.
  // Truncating at 18 was wasting most of the glass; a preset name plus a value now fits.
  const shown = text.length > 40 ? `${text.slice(0, 39)}…` : text
  // Fit to the GLASS, not to the panel. Displays differ wildly in size between units — the
  // Gate's little value window is a fraction of the Delay's — so a shared font size overflowed
  // the small ones. Doto is near-monospace at ~0.62em per character; 0.9 leaves a margin.
  const fontCqw = Math.min(2.6, (widthPct * 0.9) / (Math.max(shown.length, 1) * 0.62))
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
