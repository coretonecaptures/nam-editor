import { useEffect, useRef, useState } from 'react'
import { formatSampleRate } from '../../../../shared/wavFormat'

type FacetField = 'manufacturer' | 'cabinet' | 'speaker' | 'microphone'
type AudioFacetField = 'sampleRate' | 'bitDepth'
type MultiselectField = 'manufacturer' | 'speaker' | 'microphone'
type KindFilter = 'cab' | 'reverb' | null

// Mirrors IrModeShell.tsx's own IR_SORT_KEYS/IR_SORT_LABELS (exported from there too) -- duplicated
// here rather than imported to avoid a circular module dependency (IrModeShell already imports
// this file). Keep both lists in sync if the sort vocabulary ever changes.
const SORT_KEYS = ['name', 'size', 'rate', 'depth', 'duration', 'favorite', 'missing'] as const
type SortKey = (typeof SORT_KEYS)[number]
const SORT_LABELS: Record<SortKey, string> = {
  name: 'Name / path',
  size: 'File size',
  rate: 'Sample rate',
  depth: 'Bit depth',
  duration: 'Length',
  favorite: 'Favorites first',
  missing: 'Missing first'
}

interface FacetOption {
  value: string
  count: number
}
interface NumericFacetOption {
  value: number
  count: number
}

function Chevron(): React.ReactElement {
  return (
    <svg className="w-2.5 h-2.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 9l6 6 6-6" />
    </svg>
  )
}

/** Neutral bordered dropdown button — the mock's "Type All ▾" / "Format All ▾" / "Mic All ▾"
 * are plain, un-colored controls, not one of this app's tinted `.nam-chip` pills. Getting THESE
 * three right (not colorful) is as much the point as the row-list de-pilling work was. */
function FilterDropdownButton({
  label,
  active,
  onClick
}: {
  label: string
  active: boolean
  onClick: () => void
}): React.ReactElement {
  return (
    <button
      onClick={onClick}
      className={`h-7 px-2.5 rounded border text-xs flex items-center gap-1 flex-shrink-0 ${
        active ? 'border-nm-accent text-nm-text bg-active-bg' : 'border-field-bd text-nm-text-2 hover:bg-hov'
      }`}
    >
      {label}
      <Chevron />
    </button>
  )
}

/**
 * Multiselect checklist popover for one descriptive field — same shape as NAM Lab's own column
 * chooser (FileList.tsx: a button opening an absolutely-positioned checkbox list with a header and
 * a footer action), reused here rather than inventing a new picker pattern. Options come from
 * `listFacetOptions`, scoped to the CURRENT library root/folder — "what we have in our list, not
 * all in the world" — so every checkbox shown is guaranteed to match at least one IR.
 */
function MultiselectFacet({
  label,
  options,
  selected,
  onToggle
}: {
  label: string
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

  // Handoff wording: "All" when empty, the option's own label when exactly one is picked,
  // "N selected" when more than one -- not a bare count suffix on the facet's own label.
  const valueLabel = selected.length === 0 ? 'All' : selected.length === 1 ? selected[0] : `${selected.length} selected`

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <FilterDropdownButton label={`${label} ${valueLabel}`} active={selected.length > 0} onClick={() => setOpen((v) => !v)} />
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
          {selected.length > 0 && (
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

/** "Format" — sample rate + bit depth consolidated into ONE dropdown (the mock has no separate
 * pill-per-value row for these; a real library still legitimately mixes several of each, so this
 * stays a multiselect checklist, just with both dimensions in one popover instead of two rows of
 * loose toggle pills). */
function FormatFacet({
  sampleRates,
  bitDepths,
  selectedRates,
  selectedDepths,
  onToggleRate,
  onToggleDepth
}: {
  sampleRates: NumericFacetOption[]
  bitDepths: NumericFacetOption[]
  selectedRates: number[]
  selectedDepths: number[]
  onToggleRate: (v: number) => void
  onToggleDepth: (v: number) => void
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

  const selectedLabels = [...selectedRates.map(formatSampleRate), ...selectedDepths.map((d) => `${d}-bit`)]
  const valueLabel = selectedLabels.length === 0 ? 'All' : selectedLabels.length === 1 ? selectedLabels[0] : `${selectedLabels.length} selected`

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <FilterDropdownButton label={`Format ${valueLabel}`} active={selectedLabels.length > 0} onClick={() => setOpen((v) => !v)} />
      {open && (
        <div className="absolute left-0 top-full mt-1 w-52 max-h-96 flex flex-col bg-panel border border-nm-border rounded-lg shadow-xl z-50">
          <div className="px-3 py-1.5 text-[10px] font-semibold text-nm-text-3 uppercase tracking-wider border-b border-nm-border flex-shrink-0">
            Format
          </div>
          <div className="overflow-y-auto flex-1 py-1">
            <div className="px-3 pt-1.5 pb-0.5 text-[10px] text-nm-text-3 uppercase tracking-wide">Sample rate</div>
            {sampleRates.length === 0 && <div className="px-3 py-1 text-xs text-nm-text-3">—</div>}
            {sampleRates.map((o) => (
              <label key={`rate-${o.value}`} className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-hov">
                <input
                  type="checkbox"
                  checked={selectedRates.includes(o.value)}
                  onChange={() => onToggleRate(o.value)}
                  className="w-3.5 h-3.5 rounded border-field-bd text-nm-accent focus:ring-0 cursor-pointer flex-shrink-0"
                />
                <span className="flex-1 min-w-0 truncate text-nm-text">{formatSampleRate(o.value)}</span>
                <span className="text-nm-text-3 flex-shrink-0">{o.count}</span>
              </label>
            ))}
            <div className="px-3 pt-2 pb-0.5 text-[10px] text-nm-text-3 uppercase tracking-wide border-t border-nm-border-s mt-1">Bit depth</div>
            {bitDepths.length === 0 && <div className="px-3 py-1 text-xs text-nm-text-3">—</div>}
            {bitDepths.map((o) => (
              <label key={`depth-${o.value}`} className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-hov">
                <input
                  type="checkbox"
                  checked={selectedDepths.includes(o.value)}
                  onChange={() => onToggleDepth(o.value)}
                  className="w-3.5 h-3.5 rounded border-field-bd text-nm-accent focus:ring-0 cursor-pointer flex-shrink-0"
                />
                <span className="flex-1 min-w-0 truncate text-nm-text">{o.value}-bit</span>
                <span className="text-nm-text-3 flex-shrink-0">{o.count}</span>
              </label>
            ))}
          </div>
          {selectedLabels.length > 0 && (
            <div className="border-t border-nm-border px-3 py-1.5 flex-shrink-0">
              <button
                onClick={() => {
                  selectedRates.forEach(onToggleRate)
                  selectedDepths.forEach(onToggleDepth)
                }}
                className="text-xs text-nm-accent hover:underline"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** "Type" — cab vs reverb (design_handoff_ir_prototype's new facet). Mutually exclusive, so a
 * plain 3-way single-select (All/Cab/Reverb) rather than a checklist. Uses the SAME classification
 * IrModeShell.tsx's own kindTag() and queryLibrary.ts's `kind` query option use (preset_kind when
 * IR Lab wrote it, else a folder-name heuristic) -- this filter and the row's own CAB/VERB tag can
 * never disagree with each other. */
function TypeFacet({ value, onChange }: { value: KindFilter; onChange: (v: KindFilter) => void }): React.ReactElement {
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

  const valueLabel = value === 'cab' ? 'Cab' : value === 'reverb' ? 'Reverb' : 'All'
  const options: Array<{ v: KindFilter; label: string }> = [
    { v: null, label: 'All' },
    { v: 'cab', label: 'Cab' },
    { v: 'reverb', label: 'Reverb' }
  ]

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <FilterDropdownButton label={`Type ${valueLabel}`} active={value != null} onClick={() => setOpen((v) => !v)} />
      {open && (
        <div className="absolute left-0 top-full mt-1 w-40 bg-panel border border-nm-border rounded-lg shadow-xl z-50 py-1">
          {options.map((o) => (
            <button
              key={o.label}
              onClick={() => {
                onChange(o.v)
                setOpen(false)
              }}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-hov ${value === o.v ? 'text-nm-accent' : 'text-nm-text'}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Search/filter bar for the browse list, restyled to match design_handoff_ir_prototype's mock:
 * a plain "SEARCH" row (big, un-boxed search input, amber eyebrow label, result count) over a
 * "FILTER" row (Type/Format/Mic dropdowns, "SORT" control at the right) -- deliberately sparser
 * than the old bordered-input + wall-of-pills layout. Favorites/Rated/Groups/Makers/Speakers keep
 * their full working capability (nothing removed) but sit in a smaller secondary row underneath,
 * since none of the mock's three screenshots show a control for them.
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
  kindFilter,
  onSetKindFilter,
  total,
  sortKey,
  sortDir,
  onSetSort,
  onToggleSortDir,
  showSort,
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
  kindFilter: KindFilter
  onSetKindFilter: (v: KindFilter) => void
  total: number
  sortKey: SortKey
  sortDir: 'asc' | 'desc'
  onSetSort: (k: SortKey) => void
  onToggleSortDir: () => void
  showSort: boolean
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
    kindFilter != null ||
    Object.values(facets).some((v) => (Array.isArray(v) ? v.length > 0 : v != null)) ||
    Object.values(audioFacets).some((v) => Array.isArray(v) && v.length > 0)

  const multiselectState: Record<MultiselectField, { options: FacetOption[]; selected: string[] }> = {
    manufacturer: { options: manufacturers, selected: facets.manufacturer ?? [] },
    speaker: { options: speakers, selected: facets.speaker ?? [] },
    microphone: { options: microphones, selected: facets.microphone ?? [] }
  }

  return (
    <div className="border-b border-nm-border flex-shrink-0">
      {/* SEARCH row — plain, un-boxed, the single largest text element on the page per the handoff. */}
      <div className="flex items-center gap-3 px-4 pt-2.5 pb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--ir-label-amber)] flex-shrink-0">
          Search
        </span>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="mic, speaker, maker, filename, format…"
          title="Searches filename, manufacturer, cabinet, speaker, microphone and audio format"
          className="flex-1 min-w-0 bg-transparent text-[21px] font-light text-nm-text placeholder-nm-text-3 focus:outline-none"
        />
        {search && (
          <button onClick={() => onSearchChange('')} className="text-nm-text-3 hover:text-nm-text flex-shrink-0" title="Clear search">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        <span className="text-xs text-[color:var(--ir-muted)] flex-shrink-0 tabular-nums">{total.toLocaleString()}</span>
      </div>

      {/* FILTER row — Type / Format / Mic, Sort at the right. */}
      <div className="flex items-center gap-2 px-4 pb-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--ir-label-amber)] flex-shrink-0">
          Filter
        </span>
        <TypeFacet value={kindFilter} onChange={onSetKindFilter} />
        <FormatFacet
          sampleRates={sampleRates}
          bitDepths={bitDepths}
          selectedRates={audioFacets.sampleRate ?? []}
          selectedDepths={audioFacets.bitDepth ?? []}
          onToggleRate={(v) => onToggleAudioFacet('sampleRate', v)}
          onToggleDepth={(v) => onToggleAudioFacet('bitDepth', v)}
        />
        <MultiselectFacet
          label="Mic"
          options={multiselectState.microphone.options}
          selected={multiselectState.microphone.selected}
          onToggle={(v) => onToggleFacet('microphone', v)}
        />
        {hasActiveFilters && (
          <button onClick={onClearAll} className="text-xs text-nm-accent hover:underline ml-1 flex-shrink-0">
            Clear all
          </button>
        )}
        {showSort && (
          <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--ir-label-amber)]">Sort</span>
            <select
              value={sortKey}
              onChange={(e) => onSetSort(e.target.value as SortKey)}
              title="Sort the IR list"
              className="text-xs px-1.5 py-1 rounded-l border border-field-bd bg-field-bg text-nm-text-2"
            >
              {SORT_KEYS.map((k) => (
                <option key={k} value={k}>
                  {SORT_LABELS[k]}
                </option>
              ))}
            </select>
            <button
              onClick={onToggleSortDir}
              title={sortDir === 'asc' ? 'Ascending — click for descending' : 'Descending — click for ascending'}
              className="text-xs px-1.5 py-1 rounded-r border border-l-0 border-field-bd text-nm-text-2 hover:bg-hov"
            >
              {sortDir === 'asc' ? '↑' : '↓'}
            </button>
          </div>
        )}
      </div>

      {/* Secondary row — Favorites/Rated/Groups/Makers/Speakers. None of the mock's 3 screenshots
          show a control for these, but nothing here gets removed, only demoted below the primary
          Type/Format/Mic row. Kept visually quiet (chip-force-minimal) rather than colorful pills. */}
      <div className="flex items-center gap-1.5 px-4 pb-2 flex-wrap">
        <button
          onClick={onToggleFavoritesOnly}
          className={`nam-chip chip-force-minimal chip-ir-manufacturer ${favoritesOnly ? '' : 'opacity-60'}`}
        >
          <span className="nam-dot" />★ Favorites
        </button>
        <button onClick={onToggleRatedOnly} className={`nam-chip chip-force-minimal chip-ir-manufacturer ${ratedOnly ? '' : 'opacity-60'}`}>
          <span className="nam-dot" />
          Rated
        </button>
        {tags.length > 0 && (
          <div ref={groupsRef} className="relative flex-shrink-0">
            <button
              onClick={() => setGroupsOpen((v) => !v)}
              className={`nam-chip chip-force-minimal chip-ir-cabinet ${tagFilterId != null ? '' : 'opacity-60'}`}
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
        <MultiselectFacet
          label="Makers"
          options={multiselectState.manufacturer.options}
          selected={multiselectState.manufacturer.selected}
          onToggle={(v) => onToggleFacet('manufacturer', v)}
        />
        <MultiselectFacet
          label="Speakers"
          options={multiselectState.speaker.options}
          selected={multiselectState.speaker.selected}
          onToggle={(v) => onToggleFacet('speaker', v)}
        />
      </div>
    </div>
  )
}
