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
 * Favourites/recents (`favoritesKind`) mirror the Cab IR picker's own idea — three small tabs
 * (All / Fav / Recent), NOT Cab IR's full-screen search-and-browse dialog: that dialog earns its
 * size searching a library of hundreds of thousands of files, but a preset list here is a handful
 * of items a user made themselves, and blowing that up full-screen would be solving a problem
 * this list doesn't have. Own localStorage side-table (favoritesRecents.ts), not a field on the
 * preset objects — favouriting is a per-device convenience, not something that belongs in
 * exported settings.
 */
export interface PresetOption {
  id: string
  name: string
}

type Tab = 'all' | 'favorites' | 'recent'

export function PresetMenu({
  label,
  options,
  activeId,
  placeholder,
  searchable = false,
  width = 158,
  onRecall,
  onSaveAs,
  onUpdate,
  onDelete,
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
  /** Overwrites this preset's saved settings with whatever is dialed in right now. Omit to leave
   *  no "Update" affordance — only Save-as-new. */
  onUpdate?: (id: string) => void
  /** Omit to leave a row with no delete affordance at all. */
  onDelete?: (id: string) => void
  /** Enables the star/favourites/recent UI, keyed to its own localStorage namespace — pass a
   *  stable, unique string per picker (e.g. "rig-preset", "delay-preset"). Omit to fall back to a
   *  single flat list with no tabs, no star, no recent tracking. */
  favoritesKind?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<Tab>('all')
  const [favorites, setFavorites] = useState<FavRef[]>(() => (favoritesKind ? loadFavorites(favoritesKind) : []))
  const [recents, setRecents] = useState<FavRef[]>(() => (favoritesKind ? loadRecents(favoritesKind) : []))
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  // The preset last explicitly recalled from this menu — stays set even after you've since
  // tweaked a knob and activeId (settings-match) has gone null, which is exactly the case this
  // exists for: "I loaded X, changed some things, now I want to update X" needs to remember X
  // independent of whether the CURRENT settings still equal it.
  const [lastRecalledId, setLastRecalledId] = useState<string | null>(activeId)
  const [confirmUpdate, setConfirmUpdate] = useState(false)
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

  // Reset to a clean slate every time the menu opens, so a stale search/tab/pending-delete from
  // last time you had this open doesn't greet you.
  useEffect(() => {
    if (open) {
      setQuery('')
      setTab('all')
      setConfirmDeleteId(null)
      setConfirmUpdate(false)
    }
  }, [open])

  // Keeps lastRecalledId in sync with whatever the live settings currently exactly match — not
  // just clicks inside this menu. A Rig preset recall, for instance, can make a block's own
  // activeId change without that block's own menu ever being clicked. Never clears it back to
  // null on its own: once something has been recalled, "Update" should keep pointing at it even
  // after a knob tweak makes activeId go null.
  useEffect(() => {
    if (activeId) setLastRecalledId(activeId)
  }, [activeId])

  const active = options.find((o) => o.id === activeId) ?? null
  const favoriteIds = useMemo(() => new Set(favorites.map((f) => f.id)), [favorites])
  const recentIds = useMemo(() => new Set(recents.map((f) => f.id)), [recents])

  const tabFiltered = useMemo(() => {
    if (tab === 'favorites') return options.filter((o) => favoriteIds.has(o.id))
    if (tab === 'recent') return recents.map((r) => options.find((o) => o.id === r.id)).filter((o): o is PresetOption => Boolean(o))
    return options
  }, [tab, options, favoriteIds, recents])

  const shown = query.trim()
    ? tabFiltered.filter((o) => o.name.toLowerCase().includes(query.trim().toLowerCase()))
    : tabFiltered

  const recall = (id: string): void => {
    if (favoritesKind) {
      const opt = options.find((o) => o.id === id)
      if (opt) setRecents(pushRecent(favoritesKind, { id: opt.id, label: opt.name }))
    }
    setLastRecalledId(id)
    onRecall(id)
    setOpen(false)
  }

  const lastRecalled = lastRecalledId ? options.find((o) => o.id === lastRecalledId) ?? null : null

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
            width: typeof width === 'number' ? Math.max(width, 220) : 220,
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            borderRadius: 9,
            boxShadow: '0 14px 34px rgba(0,0,0,.45)',
            overflow: 'hidden',
            zIndex: 60
          }}
        >
          {favoritesKind && (
            <div style={{ display: 'flex', gap: 4, padding: '8px 8px 0' }}>
              {(
                [
                  ['all', 'All'],
                  ['favorites', `Fav${favorites.length ? ` (${favorites.length})` : ''}`],
                  ['recent', `Recent${recents.length ? ` (${recents.length})` : ''}`]
                ] as [Tab, string][]
              ).map(([t, tabLabel]) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  style={{
                    flex: 1,
                    height: 24,
                    borderRadius: 6,
                    border: 'none',
                    cursor: 'pointer',
                    background: tab === t ? 'var(--active)' : 'transparent',
                    color: tab === t ? 'var(--accent-text)' : 'var(--text-2)',
                    font: "600 10px 'IBM Plex Sans', sans-serif"
                  }}
                >
                  {tabLabel}
                </button>
              ))}
            </div>
          )}

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
                {tab === 'favorites' ? 'No favorites yet — tap the star on a preset to keep it here.'
                  : tab === 'recent' ? 'Nothing recalled yet.'
                  : options.length === 0 ? 'No presets saved' : 'No match'}
              </div>
            )}
            {shown.map((o) => {
              const isActive = o.id === activeId
              const isFav = favoriteIds.has(o.id)
              const confirming = confirmDeleteId === o.id
              return (
                <div
                  key={o.id}
                  onClick={() => { if (!confirming) recall(o.id) }}
                  role="button"
                  tabIndex={0}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderTop: '1px solid var(--border-soft)',
                    background: confirming ? 'rgba(220,80,60,.12)' : isActive ? 'var(--active)' : 'transparent',
                    color: isActive ? 'var(--accent-text)' : 'var(--text)',
                    font: `${isActive ? 600 : 500} 11px 'IBM Plex Sans', sans-serif`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                    cursor: confirming ? 'default' : 'pointer'
                  }}
                >
                  {confirming ? (
                    <>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>
                        Delete "{o.name}"?
                      </span>
                      <span style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        <span
                          role="button"
                          onClick={(e) => { e.stopPropagation(); onDelete?.(o.id); setConfirmDeleteId(null) }}
                          style={{ padding: '3px 8px', borderRadius: 6, background: '#dc4c3c', color: '#fff', font: "600 10px 'IBM Plex Sans', sans-serif", cursor: 'pointer' }}
                        >
                          Delete
                        </span>
                        <span
                          role="button"
                          onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null) }}
                          style={{ padding: '3px 8px', borderRadius: 6, background: 'var(--raised)', color: 'var(--text-2)', font: "600 10px 'IBM Plex Sans', sans-serif", cursor: 'pointer' }}
                        >
                          Cancel
                        </span>
                      </span>
                    </>
                  ) : (
                    <>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                        {favoritesKind && (
                          <span
                            role="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setFavorites(toggleFavorite(favoritesKind, { id: o.id, label: o.name }))
                            }}
                            title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                            style={{ flexShrink: 0, color: isFav ? '#e8b04a' : 'var(--text-3)', fontSize: 12, lineHeight: 1, padding: 2, cursor: 'pointer' }}
                          >
                            {isFav ? '★' : '☆'}
                          </span>
                        )}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.name}</span>
                        {!isActive && favoritesKind && recentIds.has(o.id) && tab !== 'recent' && (
                          <span style={{ color: 'var(--text-3)', font: "500 9px 'IBM Plex Mono', monospace", flexShrink: 0 }}>recent</span>
                        )}
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
                        {onDelete && (
                          <span
                            role="button"
                            onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(o.id) }}
                            title="Delete this preset"
                            style={{ color: 'var(--text-3)', fontSize: 13, lineHeight: 1, padding: '2px 3px', cursor: 'pointer' }}
                          >
                            ×
                          </span>
                        )}
                      </span>
                    </>
                  )}
                </div>
              )
            })}
          </div>
          {/* Only appears once something has actually been recalled — there is nothing to
              "update" otherwise. A separate, clearly-labelled row rather than folding this into
              Save-as, and its own confirm step before it touches anything: this overwrites a
              preset in place, which Save-as's normal "type a name" flow never risks doing by
              accident. */}
          {onUpdate && lastRecalled && (
            confirmUpdate ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '9px 12px', borderTop: '1px solid var(--border-soft)', background: 'rgba(232,176,74,.12)' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: "500 11px 'IBM Plex Sans', sans-serif", color: 'var(--text)' }}>
                  Overwrite "{lastRecalled.name}"?
                </span>
                <span style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <span
                    role="button"
                    onClick={() => { onUpdate(lastRecalled.id); setConfirmUpdate(false); setOpen(false) }}
                    style={{ padding: '3px 8px', borderRadius: 6, background: '#e8b04a', color: '#2a1e08', font: "600 10px 'IBM Plex Sans', sans-serif", cursor: 'pointer' }}
                  >
                    Update
                  </span>
                  <span
                    role="button"
                    onClick={() => setConfirmUpdate(false)}
                    style={{ padding: '3px 8px', borderRadius: 6, background: 'var(--raised)', color: 'var(--text-2)', font: "600 10px 'IBM Plex Sans', sans-serif", cursor: 'pointer' }}
                  >
                    Cancel
                  </span>
                </span>
              </div>
            ) : (
              <button
                onClick={() => setConfirmUpdate(true)}
                style={{
                  width: '100%', textAlign: 'left', padding: '9px 12px', borderTop: '1px solid var(--border-soft)',
                  background: 'transparent', color: '#e8b04a', font: "600 11px 'IBM Plex Sans', sans-serif", cursor: 'pointer', border: 'none',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                }}
              >
                ⟳ Update "{lastRecalled.name}" with current settings
              </button>
            )
          )}
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
