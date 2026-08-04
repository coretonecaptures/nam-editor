import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Searchable picker for choosing a capture already in the library — used by the pedal-capture
 * chip so picking a second capture works the same way finding any other capture in this app
 * does, rather than dropping into a bare OS file dialog with no context of what's already here.
 *
 * Deliberately a separate component from PresetMenu rather than a reuse of it: PresetMenu's
 * bottom row is "save the CURRENT settings as a new preset," which has no equivalent here — there
 * is no "current" capture to save, only a library to search and, failing that, browse to.
 */
export interface CaptureOption {
  filePath: string
  label: string
  sublabel?: string
}

export function CapturePicker({
  options,
  activePath,
  placeholder,
  onPick,
  onBrowse,
  width = 220,
  renderTrigger
}: {
  options: CaptureOption[]
  activePath: string | null
  placeholder: string
  onPick: (filePath: string) => void
  /** Falls back to the OS file dialog, for a capture not in the loaded library. */
  onBrowse: () => void
  width?: number | string
  /** Replaces the default field-style button — for a caller that needs this trigger to match
   *  surrounding UI it doesn't otherwise resemble (a pill chip in a signal-chain rail, say)
   *  while still reusing the search/browse dropdown underneath. */
  renderTrigger?: (props: { onClick: () => void; open: boolean }) => React.ReactNode
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

  const active = options.find((o) => o.filePath === activePath) ?? null
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.sublabel?.toLowerCase().includes(q))
  }, [options, query])

  return (
    <div ref={wrap} style={{ position: 'relative', display: 'inline-flex' }}>
      {renderTrigger ? (
        renderTrigger({ onClick: () => setOpen((v) => !v), open })
      ) : (
        <button
          onClick={() => setOpen((v) => !v)}
          style={{
            width, height: 40, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
            padding: '0 6px 0 12px', borderRadius: 8, background: 'var(--field)', border: '1px solid var(--field-border)',
            color: 'var(--text)', font: "500 11px 'IBM Plex Sans', sans-serif", cursor: 'pointer'
          }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{active ? active.label : placeholder}</span>
          <span style={{ color: 'var(--text-2)', flexShrink: 0 }}>{open ? '▴' : '▾'}</span>
        </button>
      )}

      {open && (
        <div
          style={{
            position: 'absolute', top: 44, left: 0, minWidth: Math.max(260, typeof width === 'number' ? width : 260),
            background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 9,
            boxShadow: '0 14px 34px rgba(0,0,0,.45)', overflow: 'hidden', zIndex: 60
          }}
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="search your library…"
            style={{
              margin: 8, width: 'calc(100% - 16px)', height: 30, padding: '0 10px', border: '1px solid var(--field-border)',
              borderRadius: 7, background: 'var(--field)', color: 'var(--text)', font: "500 11px 'IBM Plex Sans', sans-serif", outline: 'none'
            }}
          />
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            {shown.length === 0 && (
              <div style={{ padding: '10px 12px', color: 'var(--text-2)', font: "500 11px 'IBM Plex Sans', sans-serif" }}>No match</div>
            )}
            {shown.map((o) => (
              <button
                key={o.filePath}
                onClick={() => { onPick(o.filePath); setOpen(false); setQuery('') }}
                style={{
                  width: '100%', textAlign: 'left', padding: '8px 12px', borderTop: '1px solid var(--border-soft)',
                  background: o.filePath === activePath ? 'var(--active)' : 'transparent',
                  color: o.filePath === activePath ? 'var(--accent-text)' : 'var(--text)',
                  border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 1
                }}
              >
                <span style={{ font: "500 11.5px 'IBM Plex Sans', sans-serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.label}</span>
                {o.sublabel && (
                  <span style={{ font: "500 10px 'IBM Plex Mono', monospace", color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.sublabel}</span>
                )}
              </button>
            ))}
          </div>
          <button
            onClick={() => { onBrowse(); setOpen(false); setQuery('') }}
            style={{
              width: '100%', textAlign: 'left', padding: '9px 12px', borderTop: '1px solid var(--border-soft)',
              background: 'transparent', color: 'var(--accent)', font: "600 11px 'IBM Plex Sans', sans-serif", cursor: 'pointer', border: 'none'
            }}
          >
            ⌕ Browse for a file…
          </button>
        </div>
      )}
    </div>
  )
}
