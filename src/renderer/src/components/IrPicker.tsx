/**
 * Cabinet IR picker for a library too large to list.
 *
 * The old picker was a <select> fed by a two-level scan, which on a real bought library reached a
 * fraction of a percent of the files and would have been unusable had it reached the rest — nobody
 * scrolls a dropdown of half a million options. So the primary control here is a search box, and
 * the list only ever shows a page of ranked matches. Recents and favourites cover the handful of
 * IRs actually in rotation; Browse covers "I know it's in the OwnHammer folder somewhere".
 *
 * Searching and browsing both run against an index held in the main process (see
 * player:indexIrLibrary) — the renderer never holds the whole library.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  loadIrFavorites,
  loadIrRecents,
  pushIrRecent,
  splitIrRel,
  toggleIrFavorite,
  type IrRef
} from '../utils/irLibrary'

const RESULT_LIMIT = 200
/** Long enough that typing a word doesn't fire a scan per keystroke, short enough to feel live. */
const SEARCH_DEBOUNCE_MS = 130


/**
 * Pick an impulse from anywhere on disk, outside the configured library.
 *
 * The library is indexed and searchable, which is what makes a large collection usable — but it
 * is one folder, and an impulse you just bought or were sent lives wherever you put it. This is
 * the escape hatch. The returned `rel` is the file's own last two path segments rather than a
 * path relative to a root, since there is no root here.
 */
async function browseForImpulse(): Promise<IrRef | null> {
  const path = await window.api.openAudioFile()
  if (!path) return null
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
  return { path, rel: parts.slice(-2).join('/') }
}

type Tab = 'search' | 'recent' | 'favorites' | 'browse'

interface IrPickerProps {
  libraryPath: string
  /** Currently selected absolute path, or null. */
  value: string | null
  onChange: (ref: IrRef) => void
  disabled?: boolean
  /** Rendered into the trigger when nothing is chosen yet. */
  placeholder?: string
  /** 'field' fills its column in the player; 'inline' fits the Tone Map's toolbar row. */
  variant?: 'field' | 'inline'
  /** Offer a "None (dry)" entry — the Tone Map allows no cab, the player uses its own toggle. */
  allowNone?: boolean
  onClear?: () => void
}

export function IrPicker({
  libraryPath,
  value,
  onChange,
  disabled,
  placeholder = 'Choose a cabinet IR…',
  variant = 'field',
  allowNone = false,
  onClear
}: IrPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('search')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<IrRef[]>([])
  const [total, setTotal] = useState(0)
  const [indexCount, setIndexCount] = useState<number | null>(null)
  const [indexing, setIndexing] = useState(false)
  const [indexError, setIndexError] = useState('')
  const [favorites, setFavorites] = useState<IrRef[]>(() => loadIrFavorites())
  const [recents, setRecents] = useState<IrRef[]>(() => loadIrRecents())

  // Browse state: the folder trail from the library root, plus that folder's contents.
  const [trail, setTrail] = useState<string[]>([])
  const [browseFolders, setBrowseFolders] = useState<Array<{ name: string; count: number }>>([])
  const [browseFiles, setBrowseFiles] = useState<IrRef[]>([])

  const searchRef = useRef<HTMLInputElement | null>(null)

  /** Label for the trigger button — the folder trail is what disambiguates near-identical names. */
  const valueLabel = useMemo(() => {
    if (!value) return null
    const known = [...recents, ...favorites].find((r) => r.path === value)
    if (known) return splitIrRel(known.rel)
    // Not in either list (e.g. picked before this UI existed) — fall back to the file name.
    const name = value.replace(/\\/g, '/').split('/').pop() ?? value
    return { folder: '', name: name.replace(/\.wav$/i, '') }
  }, [value, recents, favorites])

  // Build the index once the library is known. Cached in main, so reopening is instant.
  useEffect(() => {
    if (!libraryPath) {
      setIndexCount(null)
      return
    }
    let cancelled = false
    setIndexing(true)
    setIndexError('')
    void (async () => {
      try {
        const res = await window.api.indexIrLibrary(libraryPath)
        if (cancelled) return
        if (res.error) setIndexError(res.error)
        setIndexCount(res.count)
      } catch (err) {
        if (!cancelled) setIndexError(String(err))
      } finally {
        if (!cancelled) setIndexing(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [libraryPath])

  // Debounced search. Runs for an empty query too, which is what fills the list on open.
  useEffect(() => {
    if (!open || tab !== 'search' || !libraryPath || indexCount === null) return
    let cancelled = false
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await window.api.searchIrLibrary(libraryPath, query, RESULT_LIMIT)
          if (cancelled) return
          setResults(res.results)
          setTotal(res.total)
        } catch {
          if (!cancelled) {
            setResults([])
            setTotal(0)
          }
        }
      })()
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, tab, query, libraryPath, indexCount])

  // Browse the current folder.
  useEffect(() => {
    if (!open || tab !== 'browse' || !libraryPath || indexCount === null) return
    let cancelled = false
    void (async () => {
      try {
        const res = await window.api.browseIrLibrary(libraryPath, trail.join('/'))
        if (cancelled) return
        setBrowseFolders(res.folders)
        setBrowseFiles(res.files)
      } catch {
        if (!cancelled) {
          setBrowseFolders([])
          setBrowseFiles([])
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, tab, trail, libraryPath, indexCount])

  useEffect(() => {
    if (open && tab === 'search') searchRef.current?.focus()
  }, [open, tab])

  // Escape closes; the picker is a transient overlay, not a mode to get stuck in.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  const choose = useCallback(
    (ref: IrRef) => {
      setRecents(pushIrRecent(ref))
      onChange(ref)
      setOpen(false)
    },
    [onChange]
  )

  const onToggleFavorite = useCallback((ref: IrRef) => {
    setFavorites(toggleIrFavorite(ref))
  }, [])

  const rescan = useCallback(async () => {
    if (!libraryPath) return
    setIndexing(true)
    setIndexError('')
    try {
      const res = await window.api.indexIrLibrary(libraryPath, true)
      if (res.error) setIndexError(res.error)
      setIndexCount(res.count)
      // Force the visible tab to refetch against the rebuilt index.
      if (tab === 'search') setQuery((q) => q)
      else setTrail((t) => [...t])
    } catch (err) {
      setIndexError(String(err))
    } finally {
      setIndexing(false)
    }
  }, [libraryPath, tab])

  const favoritePaths = useMemo(() => new Set(favorites.map((f) => f.path)), [favorites])

  const listForTab: IrRef[] =
    tab === 'search' ? results : tab === 'recent' ? recents : tab === 'favorites' ? favorites : browseFiles

  return (
    <>
      {variant === 'inline' ? (
        <button
          onClick={() => setOpen(true)}
          disabled={disabled}
          className="h-6 max-w-[190px] flex items-center gap-1.5 px-1.5 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 disabled:opacity-40 hover:border-[var(--accent)] transition-colors"
          title={value ?? 'Applied only to captures that do not already include a cab.'}
        >
          <span className="flex-1 min-w-0 truncate text-left">{valueLabel ? valueLabel.name : 'None (dry)'}</span>
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth={2} className="flex-shrink-0">
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          disabled={disabled}
          className="w-full flex items-center gap-2.5 h-9 px-3 rounded-[9px] bg-gray-50 dark:bg-[var(--field)] border border-gray-200 dark:border-[var(--field-border)] text-left disabled:opacity-40 hover:border-[var(--accent)] transition-colors"
          title={value ?? placeholder}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="var(--text-3)" strokeWidth={1.8} className="flex-shrink-0">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <circle cx="9" cy="12" r="3.2" />
            <circle cx="16.5" cy="12" r="1.6" />
          </svg>
          <span className="flex-1 min-w-0">
            {valueLabel ? (
              <>
                <span className="block text-xs text-gray-800 dark:text-gray-100 truncate">{valueLabel.name}</span>
                {valueLabel.folder && (
                  <span className="block text-[9.5px] text-gray-400 dark:text-gray-500 truncate leading-tight">{valueLabel.folder}</span>
                )}
              </>
            ) : (
              <span className="text-xs text-gray-400 dark:text-gray-500">{placeholder}</span>
            )}
          </span>
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="var(--text-3)" strokeWidth={2} className="flex-shrink-0">
            <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-6"
          style={{ background: 'rgba(0,0,0,.55)' }}
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-xl overflow-hidden flex flex-col bg-white dark:bg-[var(--panel)] border border-gray-200 dark:border-[var(--border)]"
            style={{ maxHeight: '78vh', boxShadow: '0 24px 60px rgba(0,0,0,.5)' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header + search */}
            <div className="px-4 pt-3.5 pb-3 border-b border-gray-200 dark:border-[var(--border-soft)]">
              <div className="flex items-center justify-between mb-2.5">
                <span style={{ font: "600 8.5px 'IBM Plex Sans', sans-serif", letterSpacing: '.16em', color: 'var(--text-3)', textTransform: 'uppercase' }}>
                  Cabinet IR
                </span>
                <div className="flex items-center gap-2.5">
                  <span className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">
                    {indexing ? 'indexing…' : indexCount !== null ? `${indexCount.toLocaleString()} IRs` : '—'}
                  </span>
                  <button
                    onClick={() => {
                      void (async () => {
                        const ref = await browseForImpulse()
                        if (ref) choose(ref)
                      })()
                    }}
                    className="text-[10px] text-gray-400 hover:text-[var(--accent)] transition-colors"
                    title="Choose an impulse from anywhere on disk"
                  >
                    Browse&hellip;
                  </button>
                  <button
                    onClick={() => void rescan()}
                    disabled={indexing}
                    className="text-[10px] text-gray-400 hover:text-[var(--accent)] disabled:opacity-40 transition-colors"
                    title="Rescan the IR library folder"
                  >
                    Rescan
                  </button>
                  <button
                    onClick={() => setOpen(false)}
                    className="w-[22px] h-[22px] flex items-center justify-center rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-[var(--hover)]"
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2 h-9 px-3 rounded-[9px] bg-gray-50 dark:bg-[var(--field)] border border-gray-200 dark:border-[var(--field-border)]">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--text-3)" strokeWidth={2} className="flex-shrink-0">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
                </svg>
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setTab('search')
                  }}
                  placeholder="Search — try: v30 4x12 57"
                  className="flex-1 min-w-0 bg-transparent text-sm text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none"
                />
                {query && (
                  <button onClick={() => setQuery('')} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 flex-shrink-0">
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 px-4 py-2 border-b border-gray-200 dark:border-[var(--border-soft)]">
              {([
                ['search', query ? `Results${total > 0 ? ` (${total.toLocaleString()})` : ''}` : 'All'],
                ['recent', `Recent${recents.length ? ` (${recents.length})` : ''}`],
                ['favorites', `Favorites${favorites.length ? ` (${favorites.length})` : ''}`],
                ['browse', 'Browse']
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={`h-7 px-3 rounded-full text-[11.5px] font-medium transition-colors ${
                    tab === id
                      ? 'bg-[var(--accent)] text-[#06201d]'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[var(--hover)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Browse breadcrumb */}
            {tab === 'browse' && (
              <div className="flex items-center gap-1 flex-wrap px-4 py-2 border-b border-gray-200 dark:border-[var(--border-soft)] text-[11px]">
                <button
                  onClick={() => setTrail([])}
                  className={trail.length === 0 ? 'text-gray-800 dark:text-gray-100' : 'text-[var(--accent)] hover:underline'}
                >
                  Library
                </button>
                {trail.map((part, i) => (
                  <span key={`${part}-${i}`} className="flex items-center gap-1">
                    <span className="text-gray-300 dark:text-gray-600">/</span>
                    <button
                      onClick={() => setTrail(trail.slice(0, i + 1))}
                      className={i === trail.length - 1 ? 'text-gray-800 dark:text-gray-100' : 'text-[var(--accent)] hover:underline'}
                    >
                      {part}
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* List */}
            <div className="flex-1 overflow-y-auto">
              {indexError && (
                <p className="px-4 py-3 text-[11px] text-red-600 dark:text-red-400">{indexError}</p>
              )}

              {allowNone && onClear && (
                <button
                  onClick={() => {
                    onClear()
                    setOpen(false)
                  }}
                  className={`w-full flex items-center gap-2.5 py-2 px-4 text-left border-b border-gray-100 dark:border-[#1a2027] ${
                    value === null ? 'bg-[var(--active)]' : 'hover:bg-gray-50 dark:hover:bg-[var(--hover)]'
                  }`}
                  style={value === null ? { boxShadow: 'inset 3px 0 0 var(--accent)' } : undefined}
                >
                  <span className="text-[13px] text-gray-700 dark:text-gray-200">None (dry)</span>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">no cabinet applied</span>
                </button>
              )}

              {tab === 'browse' &&
                browseFolders.map((folder) => (
                  <button
                    key={folder.name}
                    onClick={() => setTrail([...trail, folder.name])}
                    className="w-full flex items-center gap-2.5 h-[38px] px-4 text-left border-b border-gray-100 dark:border-[#1a2027] hover:bg-gray-50 dark:hover:bg-[var(--hover)] transition-colors"
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--accent)" strokeWidth={1.8} className="flex-shrink-0">
                      <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                    </svg>
                    <span className="flex-1 text-[13px] text-gray-700 dark:text-gray-200 truncate">{folder.name}</span>
                    <span className="text-[10px] font-mono text-gray-400 dark:text-gray-500">{folder.count.toLocaleString()}</span>
                  </button>
                ))}

              {listForTab.map((ref) => {
                const { folder, name } = splitIrRel(ref.rel)
                const selected = ref.path === value
                const fav = favoritePaths.has(ref.path)
                return (
                  <div
                    key={ref.path}
                    className={`flex items-center gap-2 border-b border-gray-100 dark:border-[#1a2027] ${
                      selected ? 'bg-[var(--active)]' : 'hover:bg-gray-50 dark:hover:bg-[var(--hover)]'
                    }`}
                    style={selected ? { boxShadow: 'inset 3px 0 0 var(--accent)' } : undefined}
                  >
                    <button onClick={() => choose(ref)} className="flex-1 min-w-0 flex items-center gap-2.5 py-2 pl-4 text-left">
                      <svg viewBox="0 0 24 24" width="13" height="13" fill={selected ? 'var(--accent)' : 'currentColor'} className={`flex-shrink-0 ${selected ? '' : 'text-gray-300 dark:text-gray-600'}`}>
                        <path d="M8 5.14v14l11-7-11-7z" />
                      </svg>
                      <span className="flex-1 min-w-0">
                        <span className={`block text-[13px] truncate ${selected ? 'text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-200'}`}>{name}</span>
                        {folder && <span className="block text-[10px] text-gray-400 dark:text-gray-500 truncate leading-tight">{folder}</span>}
                      </span>
                    </button>
                    <button
                      onClick={() => onToggleFavorite(ref)}
                      className="flex-shrink-0 w-8 h-8 mr-2 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-[#1a2027]"
                      title={fav ? 'Remove from favorites' : 'Add to favorites'}
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14" fill={fav ? '#f0b84a' : 'none'} stroke={fav ? '#f0b84a' : 'var(--text-3)'} strokeWidth={1.7}>
                        <path d="M12 3.5l2.6 5.3 5.9.85-4.25 4.15 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.65l5.9-.85z" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                )
              })}

              {/* Empty / truncation states — each says what to do next rather than just "none". */}
              {listForTab.length === 0 && (tab !== 'browse' || browseFolders.length === 0) && !indexing && (
                <p className="px-4 py-6 text-center text-[11.5px] text-gray-400 dark:text-gray-500">
                  {tab === 'favorites'
                    ? 'No favorites yet — click the star beside an IR to keep it here.'
                    : tab === 'recent'
                      ? 'Nothing played yet. Pick an IR and it will show up here.'
                      : query
                        ? `No IR matches “${query}”.`
                        : indexCount === 0
                          ? 'No .wav files found in the IR library folder.'
                          : 'Set an IR Library folder in Settings → Player.'}
                </p>
              )}

              {tab === 'search' && total > results.length && (
                <p className="px-4 py-3 text-center text-[10.5px] text-gray-400 dark:text-gray-600">
                  Showing the {results.length} best of {total.toLocaleString()} matches — type more to narrow it.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
