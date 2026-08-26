import { useEffect, useRef, useState } from 'react'
import { formatSampleRate } from '../../../../shared/wavFormat'

type FacetField = 'manufacturer' | 'cabinet' | 'speaker' | 'microphone'
type AudioFacetField = 'sampleRate' | 'bitDepth'
type MultiselectField = 'manufacturer' | 'speaker' | 'microphone'

interface FacetOption {
  value: string
  count: number
}
interface NumericFacetOption {
  value: number
  count: number
}

const MULTISELECT_FIELDS: Array<{ field: MultiselectField; label: string; chipClass: string }> = [
  { field: 'manufacturer', label: 'Makers', chipClass: 'chip-ir-manufacturer' },
  { field: 'speaker', label: 'Speakers', chipClass: 'chip-ir-speaker' },
  { field: 'microphone', label: 'Mics', chipClass: 'chip-ir-mic' }
]

/**
 * Multiselect checklist popover for one descriptive field — same shape as NAM Lab's own column
 * chooser (FileList.tsx: a button opening an absolutely-positioned checkbox list with a header and
 * a footer action), reused here rather than inventing a new picker pattern. Options come from
 * `listFacetOptions`, scoped to the CURRENT library root/folder — "what we have in our list, not
 * all in the world" — so every checkbox shown is guaranteed to match at least one IR.
 */
function MultiselectFacet({
  label,
  chipClass,
  options,
  selected,
  onToggle
}: {
  label: string
  chipClass: string
  options: FacetOption[]
  selected: string[]
  onToggle: (value: string) => void
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const dismiss = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', dismiss)
    return () => window.removeEventListener('mousedown', dismiss)
  }, [open])

  const active = selected.length > 0

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`nam-chip ${chipClass} ${active ? '' : 'opacity-60'}`}
        title={`Filter by ${label.toLowerCase()}`}
      >
        <span className="nam-dot" />
        {label}
        {active ? ` (${selected.length})` : '…'}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-56 max-h-80 flex flex-col bg-panel border border-nm-border rounded-lg shadow-xl z-50">
          <div className="px-3 py-1.5 text-[10px] font-semibold text-nm-text-3 uppercase tracking-wider border-b border-nm-border flex-shrink-0">
            {label}
          </div>
          <div className="overflow-y-auto flex-1 py-1">
            {options.length === 0 && <div className="px-3 py-2 text-xs text-nm-text-3">Nothing recognised yet</div>}
            {options.map((o) => (
              <label key={o.value} className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-hov">
                <input
                  type="checkbox"
                  checked={selected.includes(o.value)}
                  onChange={() => onToggle(o.value)}
                  className="w-3.5 h-3.5 rounded border-field-bd text-nm-accent focus:ring-0 cursor-pointer flex-shrink-0"
                />
                <span className="flex-1 min-w-0 truncate text-nm-text">{o.value}</span>
                <span className="text-nm-text-3 flex-shrink-0">{o.count}</span>
              </label>
            ))}
          </div>
          {active && (
            <div className="border-t border-nm-border px-3 py-1.5 flex-shrink-0">
              <button onClick={() => selected.forEach((v) => onToggle(v))} className="text-xs text-nm-accent hover:underline">
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Search/filter bar for the browse list — deliberately scoped to sit above the CENTER list column
 * only, not spanning the folder tree or the right panel, matching where NAM Lab's own equivalent
 * (FileList.tsx's search+filter row) lives: inside the file list component, not a page-wide header.
 *
 * Quick filters: sample rate / bit depth (multi-select toggle pills, since a library legitimately
 * mixes 44.1k/48k/96k content someone might want together), Favorites/Rated (existing single
 * toggles), Groups (existing single-select dropdown, unchanged), and three NEW multiselect
 * checklists — manufacturer/speaker/microphone — populated from what's actually in the current
 * library scope rather than a fixed global vocabulary list.
 */
export function IrFilterBar({
  search,
  onSearchChange,
  favoritesOnly,
  onToggleFavoritesOnly,
  ratedOnly,
  onToggleRatedOnly,
  tags,
  tagFilterId,
  onSelectTag,
  libraryRootId,
  folderId,
  facets,
  audioFacets,
  onToggleFacet,
  onToggleAudioFacet,
  onClearAll,
  refreshKey
}: {
  search: string
  onSearchChange: (value: string) => void
  favoritesOnly: boolean
  onToggleFavoritesOnly: () => void
  ratedOnly: boolean
  onToggleRatedOnly: () => void
  tags: Array<{ id: number; name: string; itemCount: number }>
  tagFilterId: number | null
  onSelectTag: (id: number | null) => void
  libraryRootId: number | null
  folderId: number | null
  facets: { manufacturer?: string[]; cabinet?: string; speaker?: string[]; microphone?: string[] }
  audioFacets: { sampleRate?: number[]; bitDepth?: number[] }
  onToggleFacet: (field: FacetField, value: string) => void
  onToggleAudioFacet: (field: AudioFacetField, value: number) => void
  onClearAll: () => void
  refreshKey: number
}): React.ReactElement {
  const [groupsOpen, setGroupsOpen] = useState(false)
  const groupsRef = useRef<HTMLDivElement>(null)
  const [sampleRates, setSampleRates] = useState<NumericFacetOption[]>([])
  const [bitDepths, setBitDepths] = useState<NumericFacetOption[]>([])
  const [manufacturers, setManufacturers] = useState<FacetOption[]>([])
  const [speakers, setSpeakers] = useState<FacetOption[]>([])
  const [microphones, setMicrophones] = useState<FacetOption[]>([])

  useEffect(() => {
    if (!groupsOpen) return
    const dismiss = (e: MouseEvent): void => {
      if (groupsRef.current && !groupsRef.current.contains(e.target as Node)) setGroupsOpen(false)
    }
    window.addEventListener('mousedown', dismiss)
    return () => window.removeEventListener('mousedown', dismiss)
  }, [groupsOpen])

  // Re-fetches whenever the scope (root/folder) changes or a scan completes (refreshKey) — the
  // library's own gear vocabulary shifts as content gets added, so this can't be fetched once.
  useEffect(() => {
    let cancelled = false
    window.api.irLibraryListNumericFacetOptions('sampleRate', libraryRootId, folderId).then((r) => {
      if (!cancelled) setSampleRates(r)
    })
    window.api.irLibraryListNumericFacetOptions('bitDepth', libraryRootId, folderId).then((r) => {
      if (!cancelled) setBitDepths(r)
    })
    window.api.irLibraryListFacetOptions('manufacturer', libraryRootId, folderId).then((r) => {
      if (!cancelled) setManufacturers(r)
    })
    window.api.irLibraryListFacetOptions('speaker', libraryRootId, folderId).then((r) => {
      if (!cancelled) setSpeakers(r)
    })
    window.api.irLibraryListFacetOptions('microphone', libraryRootId, folderId).then((r) => {
      if (!cancelled) setMicrophones(r)
    })
    return () => {
      cancelled = true
    }
  }, [libraryRootId, folderId, refreshKey])

  const hasActiveFilters =
    favoritesOnly ||
    ratedOnly ||
    tagFilterId != null ||
    Object.values(facets).some((v) => (Array.isArray(v) ? v.length > 0 : v != null)) ||
    Object.values(audioFacets).some((v) => Array.isArray(v) && v.length > 0)

  const multiselectState: Record<MultiselectField, { options: FacetOption[]; selected: string[] }> = {
    manufacturer: { options: manufacturers, selected: facets.manufacturer ?? [] },
    speaker: { options: speakers, selected: facets.speaker ?? [] },
    microphone: { options: microphones, selected: facets.microphone ?? [] }
  }

  return (
    <div className="border-b border-nm-border flex-shrink-0">
      <div className="px-3 pt-2 pb-1.5 flex items-center gap-1.5">
        <div className="relative flex-1 min-w-0 max-w-md">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-nm-text-3 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search IRs…"
            title="Searches filename, manufacturer, cabinet, speaker, microphone and audio format"
            className="w-full pl-7 pr-7 py-1.5 bg-field-bg border border-field-bd rounded-md text-xs text-nm-text placeholder-nm-text-3 focus:outline-none focus:border-nm-accent transition-colors"
          />
          {search && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-nm-text-3 hover:text-nm-text"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* All quick filters in one wrapping row, same idiom as NAM Lab's FileList.tsx filter row. */}
      <div className="px-3 pb-2 flex gap-1.5 flex-wrap items-center">
        <button
          onClick={onToggleFavoritesOnly}
          className={`nam-chip ${favoritesOnly ? 'chip-ir-manufacturer' : 'chip-ir-channels opacity-60'}`}
        >
          <span className="nam-dot" />★ Favorites
        </button>
        <button onClick={onToggleRatedOnly} className={`nam-chip ${ratedOnly ? 'chip-ir-manufacturer' : 'chip-ir-channels opacity-60'}`}>
          <span className="nam-dot" />
          Rated
        </button>

        {tags.length > 0 && (
          <div ref={groupsRef} className="relative flex-shrink-0">
            <button
              onClick={() => setGroupsOpen((v) => !v)}
              className={`nam-chip chip-ir-cabinet ${tagFilterId != null ? '' : 'opacity-60'}`}
            >
              <span className="nam-dot" />
              {tagFilterId != null ? tags.find((t) => t.id === tagFilterId)?.name ?? 'Group' : 'Groups'} ▾
            </button>
            {groupsOpen && (
              <div className="absolute left-0 top-full mt-1 min-w-[180px] max-h-72 overflow-y-auto py-1 rounded-lg border border-nm-border bg-panel shadow-xl z-50">
                {tagFilterId != null && (
                  <button
                    onClick={() => {
                      onSelectTag(null)
                      setGroupsOpen(false)
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-hov text-nm-accent"
                  >
                    Clear group filter
                  </button>
                )}
                {tags.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      onSelectTag(t.id)
                      setGroupsOpen(false)
                    }}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-hov text-nm-text flex items-center justify-between gap-2"
                  >
                    <span className="truncate">{t.name}</span>
                    <span className="text-nm-text-3 flex-shrink-0">{t.itemCount}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Sample rate / bit depth — multi-select toggle pills rather than a dropdown, since the
            set of values in a real library is small (typically 2-4 rates) and seeing them all at
            once as clickable pills is faster than opening a list to pick one. */}
        {sampleRates.map((o) => {
          const isActive = audioFacets.sampleRate?.includes(o.value) ?? false
          return (
            <button
              key={`rate-${o.value}`}
              onClick={() => onToggleAudioFacet('sampleRate', o.value)}
              title={`${o.count} IR${o.count === 1 ? '' : 's'} at ${formatSampleRate(o.value)}`}
              className={`nam-chip chip-ir-rate ${isActive ? 'ring-1 ring-nm-accent' : 'opacity-60'}`}
            >
              <span className="nam-dot" />
              {formatSampleRate(o.value)}
            </button>
          )
        })}
        {bitDepths.map((o) => {
          const isActive = audioFacets.bitDepth?.includes(o.value) ?? false
          return (
            <button
              key={`depth-${o.value}`}
              onClick={() => onToggleAudioFacet('bitDepth', o.value)}
              title={`${o.count} IR${o.count === 1 ? '' : 's'} at ${o.value}-bit`}
              className={`nam-chip chip-ir-depth ${isActive ? 'ring-1 ring-nm-accent' : 'opacity-60'}`}
            >
              <span className="nam-dot" />
              {o.value}-bit
            </button>
          )
        })}

        {MULTISELECT_FIELDS.map(({ field, label, chipClass }) => (
          <MultiselectFacet
            key={field}
            label={label}
            chipClass={chipClass}
            options={multiselectState[field].options}
            selected={multiselectState[field].selected}
            onToggle={(value) => onToggleFacet(field, value)}
          />
        ))}

        {hasActiveFilters && (
          <button onClick={onClearAll} className="text-xs text-nm-accent hover:underline ml-1">
            Clear all
          </button>
        )}
      </div>
    </div>
  )
}
