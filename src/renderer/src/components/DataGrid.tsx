import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Generic, data-agnostic grid — the reusable core lifted out of FileList.tsx's `GridView`
 * (docs: "extract this into a reusable component that we can use on IR and NAM Project lists").
 *
 * Owns: the column model (visibility + order + width, persisted per `storageKey`), the column
 * chooser, drag-to-reorder, drag-to-resize + double-click autosize, a per-column filter popover
 * (contains-text OR distinct-value checklist), sortable headers, and — when a selection model is
 * supplied — click / ctrl-click / shift-range / ctrl-A / arrow selection.
 *
 * Does NOT know the row type. Consumers pass `columns` (each with `getValue(row) => string` plus
 * optional `render` / `sortValue` / `align` / `filter` / `sortable`) and `getRowId`.
 *
 * Two data modes:
 *   • **client** (default): hand it the full `rows` array; it filters + sorts in memory.
 *   • **controlled + virtualised**: pass `rowCount` + `getRow(index)` + `onRangeChange`. The grid
 *     windows the DOM and asks for the ranges it needs; sorting is controlled via `sort` /
 *     `onSortChange`, and per-column filters are surfaced via `onColumnFiltersChange` (or set
 *     `disableColumnFilters` and filter outside the grid, as IR view does with its facet bar).
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
  /** Sort comparator value. Defaults to `getValue(row).toLowerCase()`. */
  sortValue?: (row: T) => string | number
  render?: (row: T) => React.ReactNode
  align?: 'left' | 'right'
  /** Column-filter popover mode. Default 'both'. */
  filter?: 'both' | 'text' | 'none'
  /** Header click sorts. Default true. Set false for columns the backend can't sort by. */
  sortable?: boolean
}

interface ColFilterState {
  text: string
  selected: string[]
}
export type ColumnFilters = Record<string, ColFilterState>

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
  rowCount,
  getRow,
  onRangeChange,
  rowHeight = 40,
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
  disableColumnFilters,
  onColumnFiltersChange,
  onVisibleRowsChange,
  emptyText = 'No rows',
  toolbar,
  className
}: {
  /** Client mode: the full row set. Controlled mode: leave empty and pass rowCount/getRow. */
  rows?: T[]
  /** Controlled mode: total row count known to the backend. */
  rowCount?: number
  /** Controlled mode: random access into the windowed cache; undefined = not loaded yet. */
  getRow?: (index: number) => T | undefined
  /** Controlled mode: the grid needs rows [start, end). */
  onRangeChange?: (start: number, end: number) => void
  rowHeight?: number
  getRowId: (row: T) => string
  columns: DataGridColumn<T>[]
  storageKey: string
  /** Omit to render without a selection column. */
  selectedIds?: Set<string>
  onSelectionChange?: (ids: string[]) => void
  onRowOpen?: (row: T) => void
  onRowContextMenu?: (row: T, x: number, y: number) => void
  rowActions?: (row: T) => React.ReactNode
  rowActionsWidth?: number
  /** Controlled sort. Header clicks call `onSortChange` instead of local state. */
  sort?: { key: string; dir: SortDir }
  onSortChange?: (key: string, dir: SortDir) => void
  /** Hide the per-column filter affordance entirely (filtering happens outside the grid). */
  disableColumnFilters?: boolean
  /** Controlled mode: report column-filter changes so the parent can re-query. */
  onColumnFiltersChange?: (filters: ColumnFilters) => void
  onVisibleRowsChange?: (rows: T[]) => void
  emptyText?: string
  toolbar?: React.ReactNode
  className?: string
}): React.ReactElement {
  const controlled = rowCount != null && typeof getRow === 'function'
  const allRows = rows ?? []
  const colByKey = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns])
  const allKeys = useMemo(() => columns.map((c) => c.key), [columns])
  const selectable = !!(selectedIds && onSelectionChange)

  // ── persisted column model ──────────────────────────────────────────────
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

  const [columnFilters, setColumnFilters] = useState<ColumnFilters>({})

  useEffect(() => {
    writeLS(`${storageKey}:cols`, visibleCols.join(','))
  }, [visibleCols, storageKey])
  useEffect(() => {
    writeLS(`${storageKey}:widths`, JSON.stringify(colWidths))
  }, [colWidths, storageKey])
  useEffect(() => {
    if (!sort) writeLS(`${storageKey}:sort`, `${localSort.key ?? ''}:${localSort.dir}`)
  }, [localSort, sort, storageKey])
  useEffect(() => {
    onColumnFiltersChange?.(columnFilters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnFilters])

  const activeColumns = useMemo(
    () => visibleCols.map((k) => colByKey.get(k)).filter((c): c is DataGridColumn<T> => c != null),
    [visibleCols, colByKey]
  )

  // ── client-side filter + sort ───────────────────────────────────────────
  const filtered = useMemo(() => {
    if (controlled) return allRows
    const entries = Object.entries(columnFilters).filter(([, s]) => s.text || s.selected.length)
    if (entries.length === 0) return allRows
    return allRows.filter((row) =>
      entries.every(([key, s]) => {
        const col = colByKey.get(key)
        if (!col) return true
        const v = col.getValue(row)
        if (s.selected.length) return s.selected.includes(v)
        return v.toLowerCase().includes(s.text.toLowerCase())
      })
    )
  }, [controlled, allRows, columnFilters, colByKey])

  const sorted = useMemo(() => {
    if (controlled || !sortKey) return filtered
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
  }, [controlled, filtered, sortKey, sortDir, colByKey, getRowId])

  useEffect(() => {
    if (!controlled) onVisibleRowsChange?.(sorted)
  }, [controlled, sorted, onVisibleRowsChange])

  const displayCount = controlled ? (rowCount as number) : sorted.length

  const handleSortClick = useCallback(
    (col: DataGridColumn<T>) => {
      if (col.sortable === false) return
      const key = col.key
      const nextDir: SortDir = sortKey === key && sortDir === 'asc' ? 'desc' : 'asc'
      const dir = sortKey === key ? nextDir : 'asc'
      if (onSortChange) onSortChange(key, dir)
      else setLocalSort({ key, dir })
    },
    [sortKey, sortDir, onSortChange]
  )

  // ── selection (client mode only) ────────────────────────────────────────
  const anchorRef = useRef<number>(-1)
  const idList = useMemo(() => (controlled ? [] : sorted.map(getRowId)), [controlled, sorted, getRowId])
  const selectOne = useCallback(
    (index: number, additive: boolean) => {
      if (!selectable) return
      anchorRef.current = index
      const id = idList[index]
      if (additive) {
        const next = new Set(selectedIds)
        next.has(id) ? next.delete(id) : next.add(id)
        onSelectionChange?.([...next])
      } else {
        onSelectionChange?.([id])
      }
    },
    [selectable, idList, selectedIds, onSelectionChange]
  )
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!selectable || controlled) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        onSelectionChange?.(idList)
        return
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
      e.preventDefault()
      const cur = anchorRef.current
      const nextIdx =
        e.key === 'ArrowDown'
          ? Math.min(idList.length - 1, (cur < 0 ? -1 : cur) + 1)
          : Math.max(0, (cur < 0 ? 0 : cur) - 1)
      if (nextIdx >= 0) selectOne(nextIdx, false)
    },
    [selectable, controlled, idList, onSelectionChange, selectOne]
  )

  // ── column resize / autosize ───────────────────────────────────────────
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
      const headerW = 12 + ctx.measureText(col.label.toUpperCase()).width * 1.2 + 40
      ctx.font = '400 12px ui-sans-serif,system-ui,sans-serif'
      let dataW = 0
      const sample = controlled ? [] : allRows
      for (const row of sample) dataW = Math.max(dataW, ctx.measureText(col.getValue(row)).width + 32)
      setColWidths((prev) => ({ ...prev, [key]: Math.max(headerW, dataW, col.minWidth) }))
    },
    [colByKey, allRows, controlled]
  )

  // ── column reorder ─────────────────────────────────────────────────────
  const headerRefs = useRef<Record<string, HTMLDivElement | null>>({})
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

  // ── per-column filter popover ──────────────────────────────────────────
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
      if (!col || controlled) return []
      const s = new Set<string>()
      for (const row of allRows) {
        const v = col.getValue(row)
        if (v) s.add(v)
      }
      return [...s].sort()
    },
    [colByKey, allRows, controlled]
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

  // ── chooser ────────────────────────────────────────────────────────────
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

  // ── virtualisation ─────────────────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(0)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver((ents) => {
      if (ents[0]) setViewportH(ents[0].contentRect.height)
    })
    ro.observe(el)
    setViewportH(el.clientHeight)
    return () => ro.disconnect()
  }, [])
  const overscan = 12
  const firstIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const lastIdx = Math.min(displayCount, firstIdx + Math.ceil(viewportH / rowHeight) + overscan * 2)
  useEffect(() => {
    if (controlled && displayCount > 0) onRangeChange?.(firstIdx, lastIdx)
  }, [controlled, firstIdx, lastIdx, displayCount, onRangeChange])

  // ── layout ─────────────────────────────────────────────────────────────
  const parts: string[] = []
  if (rowActions) parts.push(`${rowActionsWidth}px`)
  if (selectable) parts.push('28px')
  for (const c of activeColumns) parts.push(`${colWidths[c.key]}px`)
  const template = parts.join(' ')
  const totalWidth = parts.reduce((s, p) => s + parseInt(p, 10), 0)

  const anyColFilter = Object.keys(columnFilters).length > 0

  const HeaderRow = (
    <div
      className="grid sticky top-0 z-10 bg-panel-2 border-b border-nm-border text-[10px] uppercase tracking-wide text-nm-text-3"
      style={{ gridTemplateColumns: template, width: Math.max(totalWidth, 100) }}
    >
      {rowActions && <div />}
      {selectable && (
        <div className="flex items-center justify-center border-r border-nm-border-s">
          <input
            type="checkbox"
            checked={!controlled && sorted.length > 0 && sorted.every((r) => selectedIds!.has(getRowId(r)))}
            onChange={(e) => onSelectionChange?.(e.target.checked ? idList : [])}
          />
        </div>
      )}
      {activeColumns.map((col) => {
        const state = columnFilters[col.key] ?? { text: '', selected: [] }
        const hasFilter = !!(state.text || state.selected.length)
        const isFilterOpen = openFilterCol === col.key
        const canFilter = !disableColumnFilters && (col.filter ?? 'both') !== 'none'
        return (
          <div
            key={col.key}
            ref={(el) => {
              headerRefs.current[col.key] = el
            }}
            className={`relative select-none border-r border-nm-border-s ${
              columnDrag?.over === col.key ? 'bg-active-bg' : ''
            }`}
          >
            <button
              type="button"
              onMouseDown={(e) => onGripMouseDown(e, col.key)}
              title={`Drag to reorder ${col.label}`}
              className="absolute left-0 top-0 z-20 flex h-full w-4 items-center justify-center border-r border-nm-border-s bg-panel-2 text-nm-text-3 cursor-grab active:cursor-grabbing hover:text-nm-text-2"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01" />
              </svg>
            </button>
            <div
              className={`flex items-center gap-1 pl-6 pr-5 py-1.5 truncate ${
                col.sortable === false ? '' : 'cursor-pointer'
              }`}
              onClick={() => handleSortClick(col)}
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
            {canFilter && (
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
                    const host = (e.currentTarget as HTMLElement).closest('div[class*="relative"]')
                    if (host) {
                      const r = host.getBoundingClientRect()
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
            {isFilterOpen &&
              filterAnchorRef.current &&
              createPortal(
                (() => {
                  const all = distinctValues(col.key)
                  const shown = filterSearch
                    ? all.filter((v) => v.toLowerCase().includes(filterSearch.toLowerCase()))
                    : all
                  const a = filterAnchorRef.current as { top: number; left: number; width: number }
                  const mode = col.filter ?? 'both'
                  return (
                    <div
                      ref={filterPopupRef}
                      className="fixed bg-panel border border-nm-border rounded-lg shadow-xl z-[9999] flex flex-col normal-case tracking-normal"
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
                      {mode !== 'text' && state.selected.length === 0 && (
                        <div className="px-2 pt-1.5 pb-1 border-b border-nm-border-s">
                          <input
                            value={state.text}
                            onChange={(e) => setColFilter(col.key, { ...state, text: e.target.value })}
                            placeholder="Contains text…"
                            className="w-full text-xs px-2 py-1 rounded border border-field-bd bg-field-bg text-nm-text focus:outline-none focus:border-nm-accent"
                          />
                        </div>
                      )}
                      {mode !== 'text' && (
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
            <div
              className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-nm-accent/40 z-20"
              onMouseDown={(e) => onResizeStart(e, col.key)}
              onDoubleClick={(e) => {
                e.preventDefault()
                onAutoSize(col.key)
              }}
            />
          </div>
        )
      })}
    </div>
  )

  const renderRow = (row: T, index: number, style?: React.CSSProperties): React.ReactElement => {
    const id = getRowId(row)
    const isSel = selectable && selectedIds!.has(id)
    return (
      <div
        key={id}
        className={`grid border-b border-nm-border-s text-xs cursor-pointer ${
          isSel ? 'bg-active-bg' : 'hover:bg-hov'
        }`}
        style={{ gridTemplateColumns: template, width: Math.max(totalWidth, 100), ...style }}
        onClick={(e) => {
          if (selectable && e.shiftKey) {
            const from = anchorRef.current < 0 ? index : anchorRef.current
            const [lo, hi] = from < index ? [from, index] : [index, from]
            onSelectionChange?.(idList.slice(lo, hi + 1))
          } else if (selectable && (e.ctrlKey || e.metaKey)) {
            selectOne(index, true)
          } else {
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
          <div className="flex items-center justify-center border-r border-nm-border-s" onClick={(e) => e.stopPropagation()}>
            {rowActions(row)}
          </div>
        )}
        {selectable && (
          <div className="flex items-center justify-center border-r border-nm-border-s">
            <input
              type="checkbox"
              checked={isSel}
              onChange={() => selectOne(index, true)}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
        {activeColumns.map((col) => (
          <div
            key={col.key}
            className={`px-3 py-2 overflow-hidden border-r border-nm-border-s ${
              col.align === 'right' ? 'text-right tabular-nums' : ''
            }`}
            title={col.getValue(row) || undefined}
          >
            <div className="truncate">
              {col.render ? col.render(row) : col.getValue(row) || <span className="text-nm-text-3">—</span>}
            </div>
          </div>
        ))}
      </div>
    )
  }

  const skeletonRow = (index: number): React.ReactElement => (
    <div
      key={`sk-${index}`}
      className="grid border-b border-nm-border-s"
      style={{ gridTemplateColumns: template, width: Math.max(totalWidth, 100), position: 'absolute', top: index * rowHeight, height: rowHeight }}
    >
      {rowActions && <div />}
      {selectable && <div />}
      {activeColumns.map((col) => (
        <div key={col.key} className="px-3 py-2">
          <div className="h-3 rounded bg-nm-border-s/60" />
        </div>
      ))}
    </div>
  )

  const visIndices: number[] = []
  if (controlled) for (let i = firstIdx; i < lastIdx; i++) visIndices.push(i)

  return (
    <div className={`flex flex-col min-h-0 ${className ?? ''}`}>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-nm-border-s flex-shrink-0 text-[11px]">
        {toolbar}
        <div className="ml-auto flex items-center gap-2">
          {anyColFilter && (
            <button onClick={() => setColumnFilters({})} className="text-nm-accent hover:underline">
              Clear column filters
            </button>
          )}
          <span className="text-nm-text-3">{displayCount.toLocaleString()}</span>
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
                  <button onClick={() => setVisibleCols(allKeys.slice())} className="text-[11px] text-nm-accent hover:underline">
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
        ref={scrollRef}
        tabIndex={selectable ? 0 : -1}
        onKeyDown={onKeyDown}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="flex-1 overflow-auto focus:outline-none"
      >
        <div style={{ width: Math.max(totalWidth, 100) }}>
          {HeaderRow}
          {controlled ? (
            <div style={{ height: displayCount * rowHeight, position: 'relative' }}>
              {displayCount === 0 && (
                <div className="absolute inset-x-0 top-0 text-center py-8 text-nm-text-3">{emptyText}</div>
              )}
              {visIndices.map((i) => {
                const row = getRow!(i)
                return row
                  ? renderRow(row, i, { position: 'absolute', top: i * rowHeight, height: rowHeight })
                  : skeletonRow(i)
              })}
            </div>
          ) : sorted.length === 0 ? (
            <div className="text-center py-8 text-nm-text-3">{emptyText}</div>
          ) : (
            sorted.map((row, i) => renderRow(row, i))
          )}
        </div>
      </div>
    </div>
  )
}
