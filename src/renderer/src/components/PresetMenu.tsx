import { useEffect, useRef, useState } from 'react'

/**
 * Preset picker used by the rig bar and each rack unit.
 *
 * Everything here is theme-token driven — no hardcoded surface, text or border colours — so it
 * recolours correctly in dark, midnight, blue, charcoal and light. Label text never drops below
 * 10px, which was the readability complaint against the prototype.
 *
 * One behavioural note that is easy to get wrong: this is a button plus a menu, NOT a native
 * <select>. A native select does not fire onChange when you re-pick the option already selected,
 * so "load the preset I just saved" silently does nothing. Choosing a row here always recalls.
 */
export interface PresetOption {
  id: string
  name: string
}

export function PresetMenu({
  label,
  options,
  activeId,
  placeholder,
  searchable = false,
  width = 158,
  onRecall,
  onSaveAs
}: {
  /** Small mono caption to the left. Omit for the bare control. */
  label?: string
  options: PresetOption[]
  activeId: string | null
  placeholder: string
  searchable?: boolean
  width?: number | string
  onRecall: (id: string) => void
  onSaveAs: () => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent): void => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', away)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', away)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  const active = options.find((o) => o.id === activeId) ?? null
  const shown = query.trim()
    ? options.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()))
    : options

  return (
    <div ref={wrap} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 8 }}>
      {label && (
        <span style={{ font: "600 10px 'IBM Plex Mono', monospace", letterSpacing: '.1em', color: 'var(--text-2)', flexShrink: 0 }}>
          {label}
        </span>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '0 11px',
          borderRadius: 8,
          background: 'var(--field)',
          border: '1px solid var(--field-border)',
          color: 'var(--text)',
          font: "500 11px 'IBM Plex Sans', sans-serif",
          cursor: 'pointer'
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {active ? active.name : placeholder}
        </span>
        <span style={{ color: 'var(--text-2)', flexShrink: 0 }}>{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 36,
            right: 0,
            minWidth: typeof width === 'number' ? width : 200,
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            borderRadius: 9,
            boxShadow: '0 14px 34px rgba(0,0,0,.45)',
            overflow: 'hidden',
            zIndex: 60
          }}
        >
          {searchable && (
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="search…"
              style={{
                margin: 8,
                width: 'calc(100% - 16px)',
                height: 30,
                padding: '0 10px',
                border: '1px solid var(--field-border)',
                borderRadius: 7,
                background: 'var(--field)',
                color: 'var(--text)',
                font: "500 11px 'IBM Plex Sans', sans-serif",
                outline: 'none'
              }}
            />
          )}
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {shown.length === 0 && (
              <div style={{ padding: '10px 12px', color: 'var(--text-2)', font: "500 11px 'IBM Plex Sans', sans-serif" }}>
                {options.length === 0 ? 'No presets saved' : 'No match'}
              </div>
            )}
            {shown.map((o) => {
              const isActive = o.id === activeId
              return (
                <button
                  key={o.id}
                  onClick={() => {
                    onRecall(o.id)
                    setOpen(false)
                    setQuery('')
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '9px 12px',
                    borderTop: '1px solid var(--border-soft)',
                    background: isActive ? 'var(--active)' : 'transparent',
                    color: isActive ? 'var(--accent-text)' : 'var(--text)',
                    font: `${isActive ? 600 : 500} 11px 'IBM Plex Sans', sans-serif`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10,
                    cursor: 'pointer',
                    border: 'none'
                  }}
                >
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</span>
                  {isActive && (
                    <span style={{ color: 'var(--text-2)', font: "500 10px 'IBM Plex Mono', monospace", flexShrink: 0 }}>recall ↺</span>
                  )}
                </button>
              )
            })}
          </div>
          <button
            onClick={() => {
              onSaveAs()
              setOpen(false)
            }}
            style={{
              width: '100%',
              textAlign: 'left',
              padding: '9px 12px',
              borderTop: '1px solid var(--border-soft)',
              background: 'transparent',
              color: 'var(--accent)',
              font: "600 11px 'IBM Plex Sans', sans-serif",
              cursor: 'pointer',
              border: 'none'
            }}
          >
            ＋ Save current as…
          </button>
        </div>
      )}
    </div>
  )
}
