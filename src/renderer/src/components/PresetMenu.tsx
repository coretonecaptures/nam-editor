import { useEffect, useMemo, useRef, useState } from 'react'
import { loadFavorites, loadRecents, pushRecent, toggleFavorite, type FavRef } from '../utils/favoritesRecents'

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
 *
 * Favourites/recents (`favoritesKind`) mirror the Cab IR picker's own — a star per row, favourites
 * pinned to the top, a small recent strip when you haven't typed a search yet. Own localStorage
 * side-table (favoritesRecents.ts), not a field on the preset objects: this is a per-device
 * convenience, not something that belongs in exported settings.
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
  onSaveAs,
  favoritesKind
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
  /** Enables the star/favourites/recent UI, keyed to its own localStorage namespace — pass a
   *  stable, unique string per picker (e.g. "rig-preset", "delay-preset"). Omit to leave this
   *  picker exactly as it was, no star column, no recent strip. */
  favoritesKind?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [favorites, setFavorites] = useState<FavRef[]>(() => (favoritesKind ? loadFavorites(favoritesKind) : []))
  const [recents, setRecents] = useState<FavRef[]>(() => (favoritesKind ? loadRecents(favoritesKind) : []))
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
  const favoriteIds = useMemo(() => new Set(favorites.map((f) => f.id)), [favorites])
  const recentIds = useMemo(() => new Set(recents.map((f) => f.id)), [recents])

  const shown = query.trim()
    ? options.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()))
    : options

  // Favourites first, then everything else in its original order — recents get their own compact
  // strip above this list instead of a third section, since "recent" and "the rest" would
  // otherwise be the same list with an arbitrary line through it.
  const ordered = favoritesKind
    ? [...shown].sort((a, b) => Number(favoriteIds.has(b.id)) - Number(favoriteIds.has(a.id)))
    : shown
  const recentOptions = favoritesKind && !query.trim()
    ? recents.map((r) => options.find((o) => o.id === r.id)).filter((o): o is PresetOption => Boolean(o))
    : []

  const recall = (id: string): void => {
    if (favoritesKind) {
      const opt = options.find((o) => o.id === id)
      if (opt) setRecents(pushRecent(favoritesKind, { id: opt.id, label: opt.name }))
    }
    onRecall(id)
    setOpen(false)
    setQuery('')
  }

  const star = (opt: PresetOption): React.ReactNode =>
    favoritesKind && (
      <span
        role="button"
        onClick={(e) => {
          e.stopPropagation()
          setFavorites(toggleFavorite(favoritesKind, { id: opt.id, label: opt.name }))
        }}
        title={favoriteIds.has(opt.id) ? 'Remove from favorites' : 'Add to favorites'}
        style={{ flexShrink: 0, color: favoriteIds.has(opt.id) ? '#e8b04a' : 'var(--text-3)', fontSize: 12, lineHeight: 1, padding: 2 }}
      >
        {favoriteIds.has(opt.id) ? '★' : '☆'}
      </span>
    )

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
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5 }}>
          {favoritesKind && active && favoriteIds.has(active.id) && <span style={{ color: '#e8b04a' }}>★</span>}
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
          {recentOptions.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: '8px 10px', borderBottom: '1px solid var(--border-soft)' }}>
              <span style={{ width: '100%', font: "600 9px 'IBM Plex Mono', monospace", letterSpacing: '.08em', color: 'var(--text-3)', textTransform: 'uppercase' }}>
                Recent
              </span>
              {recentOptions.map((o) => (
                <button
                  key={o.id}
                  onClick={() => recall(o.id)}
                  style={{
                    padding: '3px 9px', borderRadius: 12, border: '1px solid var(--field-border)',
                    background: o.id === activeId ? 'var(--active)' : 'var(--field)',
                    color: o.id === activeId ? 'var(--accent-text)' : 'var(--text-2)',
                    font: "500 10px 'IBM Plex Sans', sans-serif", cursor: 'pointer', maxWidth: 140,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                  }}
                >
                  {o.name}
                </button>
              ))}
            </div>
          )}
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {ordered.length === 0 && (
              <div style={{ padding: '10px 12px', color: 'var(--text-2)', font: "500 11px 'IBM Plex Sans', sans-serif" }}>
                {options.length === 0 ? 'No presets saved' : 'No match'}
              </div>
            )}
            {ordered.map((o, i) => {
              const isActive = o.id === activeId
              // A rule between the favourited run and the rest, so pinning to the top doesn't
              // read as "the list got reordered for no reason."
              const isDividerBefore = favoritesKind && i > 0 && favoriteIds.has(ordered[i - 1].id) && !favoriteIds.has(o.id)
              return (
                <button
                  key={o.id}
                  onClick={() => recall(o.id)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '9px 12px',
                    background: isActive ? 'var(--active)' : 'transparent',
                    color: isActive ? 'var(--accent-text)' : 'var(--text)',
                    font: `${isActive ? 600 : 500} 11px 'IBM Plex Sans', sans-serif`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                    cursor: 'pointer',
                    border: 'none',
                    borderTopWidth: 1,
                    borderTopStyle: 'solid',
                    borderTopColor: isDividerBefore ? 'var(--border)' : 'var(--border-soft)'
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                    {star(o)}
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</span>
                  </span>
                  {isActive && (
                    <span style={{ color: 'var(--text-2)', font: "500 10px 'IBM Plex Mono', monospace", flexShrink: 0 }}>recall ↺</span>
                  )}
                  {!isActive && favoritesKind && recentIds.has(o.id) && (
                    <span style={{ color: 'var(--text-3)', font: "500 9px 'IBM Plex Mono', monospace", flexShrink: 0 }}>recent</span>
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
