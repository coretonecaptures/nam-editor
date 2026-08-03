/**
 * The little black readout that appears over a control while you hover or drag it.
 *
 * These panels deliberately carry no printed scales or numbers — real hardware would, but a
 * baked-in "0..10" would be a lie the moment a range changed, and it would have to be patched
 * out of the artwork like the pointer notches were. So the number lives here instead, on demand.
 */
export function RackValueTip({ label, value, visible }: { label: string; value: string; visible: boolean }) {
  return (
    <span
      style={{
        position: 'absolute',
        left: '50%',
        bottom: 'calc(100% + 6px)',
        transform: 'translateX(-50%)',
        padding: '3px 7px',
        borderRadius: 4,
        background: 'rgba(0,0,0,0.88)',
        border: '1px solid rgba(255,255,255,0.14)',
        color: '#f4f4f5',
        font: "500 11px 'IBM Plex Sans', sans-serif",
        letterSpacing: '0.02em',
        whiteSpace: 'nowrap',
        opacity: visible ? 1 : 0,
        transition: 'opacity 0.1s ease-out',
        pointerEvents: 'none',
        zIndex: 20
      }}
    >
      <span style={{ color: '#a1a1aa' }}>{label}</span>
      {'  '}
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </span>
  )
}
