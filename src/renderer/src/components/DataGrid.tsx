import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Generic, data-agnostic table grid — the reusable core lifted out of FileList.tsx's `GridView`
 * (docs: "extract this into a reusable component that we can use on IR and NAM Project lists").
 *
 * What it owns: the column model (visibility + order + width, all persisted per `storageKey`),
 * the column chooser, drag-to-reorder, drag-to-resize + double-click autosize, a per-column
 * filter popover (a "contains" text box OR a distinct-value checklist), sortable headers, and
 * click / ctrl-click / shift-range / ctrl-A / arrow-key selection.
 *
 * What it does NOT know: the row type. Every consumer supplies `columns` where each column has a
 * `getValue(row) => string` (used for filtering / the value checklist / autosize / the default
 * cell) and optionally `render(row)` and `sortValue(row)`. Row identity comes from `getRowId`.
 *
 * Client-side only for now — it filters and sorts the `rows` array it is handed. Server-paged
 * consumers (IR view) need a controlled/virtualised mode; that's Phase 2.
 */

export type SortDir = 'asc' | 'desc'

export interface DataGridColumn<T> {
  key: string
  label: string
  minWidth: number
  defaultWidth?: number
  defaultVisible: boolean
  /** Plain-text value — filtering, the value checklist, autosize, and the default cell. */
  getValue: (row: T) => string
  /** Sort comparator value. Defaults to `getValue(row).toLowerCase()`. Return a number for
   * numeric sort (NaN / null-ish should map to ±Infinity so blanks sink). */
  sortValue?: (row: T) => string | number
  /** Custom cell content. Defaults to the plain text of `getValue`. */
  render?: (row: T) => React.ReactNode
  align?: 'left' | 'right'
  /** Free-text columns (comments, settings) — drop the distinct-value checklist, keep "contains". */
  filter?: 'both' | 'text' | 'none'
}

interface ColFilterState {
  text: string
  selected: string[]
}

function readLS(key: string): string {
  try {
    return localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}
function writeLS(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* non-fatal */
  }
}

export function DataGrid<T>({
  rows,
  getRowId,
  columns,
  storageKey,
  selectedIds,
  onSelectionChange,
  onRowOpen,
  onRowContextMenu,
  rowActions,
  rowActionsWidth = 84,
  sort,
  onSortChange,
  onVisibleRowsChange,
  emptyText = 'No rows',
  toolbar,
  className
}: {
  rows: T[]
  getRowId: (row: T) => string
  columns: DataGridColumn<T>[]
  /** Namespaces the persisted column visibility / order / width / sort under this prefix. */
  storageKey: string
  selectedIds: Set<string>
  onSelectionChange: (ids: string[]) => void
  onRowOpen?: (row: T) => void
  onRowContextMenu?: (row: T, x: number, y: number) => void
  /** Pinned leading cell (Play / menu / …). Omit for no actions column. */
  rowActions?: (row: T) => React.ReactNode
  rowActionsWidth?: number
  /** Controlled sort. When provided, header clicks call `onSortChange` instead of local state —
   * lets a parent share one sort across this grid and another view (e.g. a card grid). */
  sort?: { key: string; dir: SortDir }
  onSortChange?: (key: string, dir: SortDir) => void
  /** Post-filter/sort rows in display order — for the parent's export / keyboard nav / counts. */
  onVisibleRowsChange?: (rows: T[]) => void
  emptyText?: string
  /** Extra controls rendered in the grid's own toolbar, left of the column chooser. */
  toolbar?: React.ReactNode
  className?: string
}): React.ReactElement {
  const colByKey = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns])
  const allKeys = useMemo(() => columns.map((c) => c.key), [columns])

  // ── persisted column model ────────────────────────────────────────────────
  const [visibleCols, setVisibleCols] = useState<string[]>(() => {
    const stored = readLS(`${storageKey}:cols`)
    if (stored) {
      const known = new Set(allKeys)
      const parsed = stored.split(',').filter((k) => known.has(k))
      if (parsed.length) return parsed
    }
    return columns.filter((c) => c.defaultVisible).map((c) => c.key)
  })
  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    const base: Record<string, number> = {}
    for (const c of columns) base[c.key] = c.defaultWidth ?? Math.max(c.minWidth, 120)
    try {
      const stored = JSON.parse(readLS(`${storageKey}:widths`) || '{}') as Record<string, number>
      for (const k of Object.keys(stored)) if (base[k] != null) base[k] = stored[k]
    } catch {
      /* ignore */
    }
    return base
  })
  const [localSort, setLocalSort] = useState<{ key: string | null; dir: SortDir }>(() => {
    const [k, d] = readLS(`${storageKey}:sort`).split(':')
    return { key: allKeys.includes(k) ? k : null, dir: d === 'desc' ? 'desc' : 'asc' }
  })
  const sortKey = sort ? sort.key : localSort.key
  const sortDir: SortDir = sort ? sort.dir : localSort.dir

  const [columnFilters, setColumnFilters] = useState<Record<string, ColFilterState>>({})

  useEffect(() => {
    writeLS(`${storageKey}:cols`, visibleCols.join(','))
  }, [visibleCols, storageKey])
  useEffect(() => {
    writeLS(`${storageKey}:widths`, JSON.stringify(colWidths))
  }, [colWidths, storageKey])
  useEffect(() => {
    if (!sort) writeLS(`${storageKey}:sort`, `${localSort.key ?? ''}:${localSort.dir}`)
  }, [localSort, sort, storageKey])

  const activeColumns = useMemo(
    () => visibleCols.map((k) => colByKey.get(k)).filter((c): c is DataGridColumn<T> => c != null),
    [visibleCols, colByKey]
  )

  // ── filter + sort pipeline (client-side) ──────────────────────────────────
  const filtered = useMemo(() => {
    const entries = Object.entries(columnFilters).filter(([, s]) => s.text || s.selected.length)
    if (entries.length === 0) return rows
    return rows.filter((row) =>
      entries.every(([key, s]) => {
        const col = colByKey.get(key)
        if (!col) return true
        const v = col.getValue(row)
        if (s.selected.length) return s.selected.includes(v)
        return v.toLowerCase().includes(s.text.toLowerCase())
      })
    )
  }, [rows, columnFilters, colByKey])

  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const col = colByKey.get(sortKey)
    if (!col) return filtered
    const val = col.sortValue ?? ((r: T) => col.getValue(r).toLowerCase())
    const mul = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const av = val(a)
      const bv = val(b)
      if (av < bv) return -mul
      if (av > bv) return mul
      return getRowId(a) < getRowId(b) ? -1 : 1
    })
  }, [filtered, sortKey, sortDir, colByKey, getRowId])

  useEffect(() => {
    onVisibleRowsChange?.(sorted)
  }, [sorted, onVisibleRowsChange])

  const handleSortClick = useCallback(
    (key: string) => {
      const nextDir: SortDir = sortKey === key && sortDir === 'asc' ? 'desc' : 'asc'
      if (onSortChange) onSortChange(key, sortKey === key ? nextDir : 'asc')
      else setLocalSort({ key, dir: sortKey === key ? nextDir : 'asc' })
    },
    [sortKey, sortDir, onSortChange]
  )

  // ── selection ────────────────────────────────────────────────────────────
  const anchorRef = useRef<number>(-1)
  const idList = useMemo(() => sorted.map(getRowId), [sorted, getRowId])

  const selectOne = useCallback(
    (index: number, additive: boolean) => {
      anchorRef.current = index
      const id = idList[index]
      if (additive) {
        const next = new Set(selectedIds)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        onSelectionChange([...next])
      } else {
        onSelectionChange([id])
      }
    },
    [idList, selectedIds, onSelectionChange]
  )
  const selectRangeTo = useCallback(
    (index: number) => {
      const from = anchorRef.current < 0 ? index : anchorRef.current
      const [lo, hi] = from < index ? [from, index] : [index, from]
      onSelectionChange(idList.slice(lo, hi + 1))
    },
    [idList, onSelectionChange]
  )

  const gridRef = useRef<HTMLDivElement>(null)
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        onSelectionChange(idList)
        return
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const cur = anchorRef.current
      const nextIdx =
        e.key === 'ArrowDown'
          ? Math.min(idList.length - 1, (cur < 0 ? -1 : cur) + 1)
          : Math.max(0, (cur < 0 ? 0 : cur) - 1)
      if (nextIdx >= 0 && nextIdx < idList.length) selectOne(nextIdx, false)
    },
    [idList, onSelectionChange, selectOne]
  )

  // ── column resize / autosize ─────────────────────────────────────────────
  const resizingRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null)
  const onResizeStart = useCallback(
    (e: React.MouseEvent, key: string) => {
      e.preventDefault()
      e.stopPropagation()
      resizingRef.current = { key, startX: e.clientX, startWidth: colWidths[key] }
      const onMove = (ev: MouseEvent): void => {
        const r = resizingRef.current
        if (!r) return
        setColWidths((prev) => ({ ...prev, [r.key]: Math.max(60, r.startWidth + ev.clientX - r.startX) }))
      }
      const onUp = (): void => {
        resizingRef.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [colWidths]
  )
  const onAutoSize = useCallback(
    (key: string) => {
      const col = colByKey.get(key)
      if (!col) return
      const ctx = document.createElement('canvas').getContext('2d')
      if (!ctx) return
      ctx.font = '600 11px ui-sans-serif,system-ui,sans-serif'
      const headerW = 12 + ctx.measureText(col.label.toUpperCase()).width * 1.2 + 28 + 12 + 8
      ctx.font = '400 12px ui-sans-serif,system-ui,sans-serif'
      let dataW = 0
      for (const row of rows) dataW = Math.max(dataW, ctx.measureText(col.getValue(row)).width + 32)
      setColWidths((prev) => ({ ...prev, [key]: Math.max(headerW, dataW, col.minWidth) }))
    },
    [colByKey, rows]
  )

  // ── column reorder (drag the grip) ───────────────────────────────────────
  const headerRefs = useRef<Record<string, HTMLTableCellElement | null>>({})
  const [columnDrag, setColumnDrag] = useState<{ from: string; over: string | null; side: 'before' | 'after' } | null>(null)
  const columnDragRef = useRef(columnDrag)
  useEffect(() => {
    columnDragRef.current = columnDrag
  }, [columnDrag])

  const onGripMouseDown = useCallback(
    (e: React.MouseEvent, key: string) => {
      if (e.button !== 0 || resizingRef.current) return
      e.preventDefault()
      e.stopPropagation()
      document.body.style.cursor = 'grabbing'
      const onMove = (ev: MouseEvent): void => {
        let over: string | null = null
        let side: 'before' | 'after' = 'after'
        for (const c of activeColumns) {
          const el = headerRefs.current[c.key]
          if (!el || c.key === key) continue
          const r = el.getBoundingClientRect()
          if (ev.clientX >= r.left && ev.clientX <= r.right) {
            over = c.key
            side = ev.clientX < r.left + r.width / 2 ? 'before' : 'after'
            break
          }
        }
        setColumnDrag({ from: key, over, side })
      }
      const onUp = (): void => {
        document.body.style.cursor = ''
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        const d = columnDragRef.current
        setColumnDrag(null)
        if (!d || !d.over || d.over === d.from) return
        setVisibleCols((prev) => {
          const next = prev.filter((k) => k !== d.from)
          const idx = next.indexOf(d.over as string)
          if (idx < 0) return prev
          next.splice(d.side === 'before' ? idx : idx + 1, 0, d.from)
          return next
        })
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [activeColumns]
  )

  // ── per-column filter popover ────────────────────────────────────────────
  const [openFilterCol, setOpenFilterCol] = useState<string | null>(null)
  const [filterSearch, setFilterSearch] = useState('')
  const filterPopupRef = useRef<HTMLDivElement>(null)
  const filterAnchorRef = useRef<{ top: number; left: number; width: number } | null>(null)

  useEffect(() => {
    if (!openFilterCol) return
    const h = (e: MouseEvent): void => {
      if (filterPopupRef.current && !filterPopupRef.current.contains(e.target as Node)) {
        setOpenFilterCol(null)
        setFilterSearch('')
      }
    }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [openFilterCol])

  const distinctValues = useCallback(
    (key: string): string[] => {
      const col = colByKey.get(key)
      if (!col) return []
      const s = new Set<string>()
      for (const row of rows) {
        const v = col.getValue(row)
        if (v) s.add(v)
      }
      return [...s].sort()
    },
    [colByKey, rows]
  )
  const setColFilter = useCallback((key: string, state: ColFilterState) => {
    setColumnFilters((prev) => {
      if (!state.text && state.selected.length === 0) {
        const { [key]: _drop, ...rest } = prev
        return rest
      }
      return { ...prev, [key]: state }
    })
  }, [])

  // ── chooser ──────────────────────────────────────────────────────────────
  const [chooserOpen, setChooserOpen] = useState(false)
  const chooserRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!chooserOpen) return
    const h = (e: MouseEvent): void => {
      if (chooserRef.current && !chooserRef.current.contains(e.target as Node)) setChooserOpen(false)
    }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [chooserOpen])

  const anyColFilter = Object.keys(columnFilters).length > 0
  const actionsWidth = rowActions ? rowActionsWidth : 0
  const tableWidth = activeColumns.reduce((s, c) => s + colWidths[c.key], 26 + actionsWidth)

  return (
    <div className={`flex flex-col min-h-0 ${className ?? ''}`}>
      {/* toolbar: chooser + parent extras + filter-clear */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-nm-border-s flex-shrink-0 text-[11px]">
        {toolbar}
        <div className="ml-auto flex items-center gap-2">
          {anyColFilter && (
            <button onClick={() => setColumnFilters({})} className="text-nm-accent hover:underline">
              Clear column filters
            </button>
          )}
          <span className="text-nm-text-3">{sorted.length}</span>
          <div ref={chooserRef} className="relative">
            <button
              onClick={() => setChooserOpen((v) => !v)}
              title="Choose columns"
              className="px-1.5 py-1 rounded border border-field-bd text-nm-text-2 hover:bg-hov"
            >
              Columns
            </button>
            {chooserOpen && (
              <div className="absolute right-0 top-full mt-1 w-56 max-h-80 overflow-y-auto py-1 rounded-lg border border-nm-border bg-panel shadow-xl z-50">
                {columns.map((col) => {
                  const on = visibleCols.includes(col.key)
                  return (
                    <label
                      key={col.key}
                      className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-hov text-nm-text"
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          setVisibleCols((prev) =>
                            on
                              ? prev.filter((k) => k !== col.key)
                              : [...prev, col.key].sort((a, b) => allKeys.indexOf(a) - allKeys.indexOf(b))
                          )
                        }
                        className="w-3.5 h-3.5 rounded border-field-bd flex-shrink-0"
                      />
                      <span className="flex-1 truncate">{col.label}</span>
                    </label>
                  )
                })}
                <div className="border-t border-nm-border-s mt-1 pt-1 flex gap-3 px-3 py-1">
                  <button
                    onClick={() => setVisibleCols(allKeys.slice())}
                    className="text-[11px] text-nm-accent hover:underline"
                  >
                    Show all
                  </button>
                  <button
                    onClick={() => setVisibleCols(columns.filter((c) => c.defaultVisible).map((c) => c.key))}
                    className="text-[11px] text-nm-accent hover:underline"
                  >
                    Reset
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        ref={gridRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="flex-1 overflow-auto focus:outline-none"
      >
        <table className="text-xs border-collapse" style={{ width: Math.max(tableWidth, 100), tableLayout: 'fixed' }}>
          <colgroup>
            {rowActions && <col style={{ width: actionsWidth }} />}
            <col style={{ width: 26 }} />
            {activeColumns.map((c) => (
              <col key={c.key} style={{ width: colWidths[c.key] }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="bg-panel-2">
              {rowActions && <th className="border-b border-nm-border" />}
              <th className="border-b border-r border-nm-border-s px-1 text-center">
                <input
                  type="checkbox"
                  checked={sorted.length > 0 && sorted.every((r) => selectedIds.has(getRowId(r)))}
                  onChange={(e) => onSelectionChange(e.target.checked ? idList : [])}
                />
              </th>
              {activeColumns.map((col) => {
                const filterMode = col.filter ?? 'both'
                const state = columnFilters[col.key] ?? { text: '', selected: [] }
                const hasFilter = !!(state.text || state.selected.length)
                const isFilterOpen = openFilterCol === col.key
                const dragOver = columnDrag?.over === col.key
                return (
                  <th
                    key={col.key}
                    ref={(el) => {
                      headerRefs.current[col.key] = el
                    }}
                    className={`relative select-none border-b border-r border-nm-border-s text-left ${
                      dragOver ? 'bg-active-bg' : 'bg-panel-2'
                    }`}
                  >
                    <button
                      type="button"
                      onMouseDown={(e) => onGripMouseDown(e, col.key)}
                      title={`Drag to reorder ${col.label}`}
                      className="absolute left-0 top-0 z-20 flex h-full w-5 items-center justify-center border-r border-nm-border-s bg-panel-2 text-nm-text-3 cursor-grab active:cursor-grabbing hover:text-nm-text-2"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01" />
                      </svg>
                    </button>
                    <div
                      className="flex items-center gap-1 pl-7 pr-6 py-1.5 whitespace-nowrap overflow-hidden cursor-pointer text-[10px] uppercase tracking-wide text-nm-text-3"
                      onClick={() => handleSortClick(col.key)}
                    >
                      <span className="truncate">{col.label}</span>
                      {sortKey === col.key && <span className="flex-shrink-0 text-nm-accent">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                    </div>
                    {columnDrag?.over === col.key && (
                      <div
                        className={`absolute top-0.5 bottom-0.5 w-0.5 rounded-full bg-nm-accent z-30 ${
                          columnDrag.side === 'before' ? 'left-0' : 'right-0'
                        }`}
                      />
                    )}
                    {filterMode !== 'none' && (
                      <button
                        className={`absolute right-1.5 top-1/2 -translate-y-1/2 z-20 p-0.5 ${
                          hasFilter ? 'text-nm-accent' : 'text-nm-text-3 hover:text-nm-text-2'
                        }`}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (isFilterOpen) {
                            setOpenFilterCol(null)
                            setFilterSearch('')
                          } else {
                            const th = (e.currentTarget as HTMLElement).closest('th')
                            if (th) {
                              const r = th.getBoundingClientRect()
                              filterAnchorRef.current = { top: r.bottom, left: r.left, width: r.width }
                            }
                            setOpenFilterCol(col.key)
                            setFilterSearch('')
                          }
                        }}
                        title={hasFilter ? 'Filter active — click to edit' : 'Filter column'}
                      >
                        <svg className="w-3 h-3" fill={hasFilter ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
                        </svg>
                      </button>
                    )}
                    <div
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-nm-accent/40 z-20"
                      onMouseDown={(e) => onResizeStart(e, col.key)}
                      onDoubleClick={(e) => {
                        e.preventDefault()
                        onAutoSize(col.key)
                      }}
                    />
                    {isFilterOpen &&
                      filterAnchorRef.current &&
                      createPortal(
                        (() => {
                          const all = distinctValues(col.key)
                          const shown = filterSearch
                            ? all.filter((v) => v.toLowerCase().includes(filterSearch.toLowerCase()))
                            : all
                          const a = filterAnchorRef.current as { top: number; left: number; width: number }
                          return (
                            <div
                              ref={filterPopupRef}
                              className="fixed bg-panel border border-nm-border rounded-lg shadow-xl z-[9999] flex flex-col"
                              style={{ top: a.top + 2, left: a.left, minWidth: 200, maxHeight: 320, width: Math.max(a.width, 200) }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="p-1.5 border-b border-nm-border-s flex gap-1">
                                <input
                                  autoFocus
                                  value={filterSearch}
                                  onChange={(e) => setFilterSearch(e.target.value)}
                                  placeholder="Search values…"
                                  className="flex-1 text-xs px-2 py-1 bg-field-bg border border-field-bd rounded focus:outline-none focus:border-nm-accent text-nm-text"
                                />
                                {hasFilter && (
                                  <button
                                    onClick={() => {
                                      setColFilter(col.key, { text: '', selected: [] })
                                      setOpenFilterCol(null)
                                    }}
                                    className="text-xs text-nm-accent hover:underline px-1.5 flex-shrink-0"
                                  >
                                    Clear
                                  </button>
                                )}
                              </div>
                              {filterMode !== 'text' && state.selected.length === 0 && (
                                <div className="px-2 pt-1.5 pb-1 border-b border-nm-border-s">
                                  <input
                                    value={state.text}
                                    onChange={(e) => setColFilter(col.key, { ...state, text: e.target.value })}
                                    placeholder="Contains text…"
                                    className="w-full text-xs px-2 py-1 rounded border border-field-bd bg-field-bg text-nm-text focus:outline-none focus:border-nm-accent"
                                  />
                                </div>
                              )}
                              {filterMode !== 'text' && (
                                <div className="overflow-y-auto flex-1 py-1">
                                  {shown.length === 0 ? (
                                    <div className="px-3 py-2 text-xs text-nm-text-3">No values</div>
                                  ) : (
                                    shown.map((val) => (
                                      <label
                                        key={val}
                                        className="flex items-center gap-2 px-2.5 py-1 cursor-pointer hover:bg-hov text-xs text-nm-text"
                                      >
                                        <input
                                          type="checkbox"
                                          checked={state.selected.includes(val)}
                                          onChange={() => {
                                            const next = state.selected.includes(val)
                                              ? state.selected.filter((v) => v !== val)
                                              : [...state.selected, val]
                                            setColFilter(col.key, { text: '', selected: next })
                                          }}
                                          className="w-3 h-3 rounded border-field-bd flex-shrink-0"
                                        />
                                        <span className="truncate">{val}</span>
                                      </label>
                                    ))
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })(),
                        document.body
                      )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td
                  colSpan={activeColumns.length + 1 + (rowActions ? 1 : 0)}
                  className="text-center py-8 text-nm-text-3"
                >
                  {emptyText}
                </td>
              </tr>
            ) : (
              sorted.map((row, index) => {
                const id = getRowId(row)
                const isSel = selectedIds.has(id)
                return (
                  <tr
                    key={id}
                    className={`border-b border-nm-border-s cursor-pointer ${
                      isSel ? 'bg-active-bg' : 'hover:bg-hov'
                    }`}
                    onClick={(e) => {
                      if (e.shiftKey) selectRangeTo(index)
                      else if (e.ctrlKey || e.metaKey) selectOne(index, true)
                      else {
                        anchorRef.current = index
                        onRowOpen?.(row)
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      anchorRef.current = index
                      onRowContextMenu?.(row, e.clientX, e.clientY)
                    }}
                    onMouseDown={(e) => {
                      if (e.shiftKey) e.preventDefault()
                    }}
                  >
                    {rowActions && (
                      <td className="border-r border-nm-border-s text-center align-middle" onClick={(e) => e.stopPropagation()}>
                        {rowActions(row)}
                      </td>
                    )}
                    <td className="border-r border-nm-border-s px-1 text-center align-middle">
                      <input
                        type="checkbox"
                        checked={isSel}
                        onChange={() => selectOne(index, true)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </td>
                    {activeColumns.map((col) => (
                      <td
                        key={col.key}
                        className={`border-r border-nm-border-s px-3 py-1.5 overflow-hidden ${
                          col.align === 'right' ? 'text-right tabular-nums' : ''
                        }`}
                        title={col.getValue(row) || undefined}
                      >
                        <div className="truncate">
                          {col.render ? col.render(row) : col.getValue(row) || <span className="text-nm-text-3">—</span>}
                        </div>
                      </td>
                    ))}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
