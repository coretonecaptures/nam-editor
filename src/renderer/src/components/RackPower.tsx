/**
 * On/off for a whole rack unit.
 *
 * Deliberately an ordinary software switch rather than a painted one: the Delay and Reverb
 * renders have no power switch on them, and the honest options were to invent a fake hotspot
 * over blank metal or to put a real control where the rest of the app's controls live. It sits
 * with the preset bar, matching the Cab IR toggle elsewhere in the player.
 */
export function RackPower({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center gap-2 flex-shrink-0">
      <span className="text-[10px] uppercase tracking-[0.18em] text-gray-400 dark:text-gray-500">{label}</span>
      <span className={`text-[10px] font-semibold ${on ? 'text-[var(--accent)]' : 'text-gray-500'}`}>{on ? 'ON' : 'OFF'}</span>
      <button
        role="switch"
        aria-checked={on}
        aria-label={`${label} on/off`}
        onClick={onToggle}
        className="relative"
        style={{
          width: 34,
          height: 19,
          borderRadius: 10,
          background: on ? 'rgba(45,212,191,.3)' : 'var(--field)',
          border: `1px solid ${on ? 'rgba(45,212,191,.5)' : 'var(--field-border)'}`,
          cursor: 'pointer'
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 1.5,
            left: on ? 16 : 1.5,
            width: 14,
            height: 14,
            borderRadius: '50%',
            background: on ? 'var(--accent)' : 'var(--text-3)',
            transition: 'left .15s'
          }}
        />
      </button>
    </div>
  )
}

/** Dims a unit's panel when it is switched off, so "off" reads at a glance from across the rig. */
export function rackDimStyle(on: boolean): React.CSSProperties {
  return {
    // Readable when off, not obliterated — you still need to see where the controls are.
    opacity: on ? 1 : 0.62,
    filter: on ? 'none' : 'saturate(0.55)',
    transition: 'opacity 0.18s, filter 0.18s'
  }
}
