import { useEffect, useMemo, useRef, useState } from 'react'
import { METADATA_SUGGEST_FIELD_OPTIONS, MetadataSuggestRule } from '../types/settings'

interface MetadataSuggestRuleLibraryModalProps {
  rules: MetadataSuggestRule[]
  title?: string
  confirmLabel?: string
  onConfirm: (selectedRules: MetadataSuggestRule[]) => void
  onDeleteRule: (ruleId: string) => void
  onClose: () => void
}

const FIELD_LABELS = new Map(METADATA_SUGGEST_FIELD_OPTIONS.map((option) => [option.value, option.label]))
const MATCH_TYPE_LABELS: Record<MetadataSuggestRule['matchType'], string> = {
  exact: 'Exact token',
  contains: 'Contains',
  starts_with: 'Starts with',
  ends_with: 'Ends with',
  prefix_value: 'Prefix + value',
}

export function MetadataSuggestRuleLibraryModal({
  rules,
  title = 'Rule Library',
  confirmLabel = 'Add selected rules',
  onConfirm,
  onDeleteRule,
  onClose,
}: MetadataSuggestRuleLibraryModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [fieldFilter, setFieldFilter] = useState<string>('all')
  const [matchInFilter, setMatchInFilter] = useState<'all' | MetadataSuggestRule['matchIn']>('all')
  const [overwriteFilter, setOverwriteFilter] = useState<'all' | 'overwrite' | 'non_overwrite'>('all')
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const dragStateRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const dragState = dragStateRef.current
      if (!dragState) return
      setDragOffset({
        x: dragState.originX + (event.clientX - dragState.startX),
        y: dragState.originY + (event.clientY - dragState.startY),
      })
    }

    const handleMouseUp = () => {
      dragStateRef.current = null
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  const beginDrag = (event: React.MouseEvent<HTMLDivElement>) => {
    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: dragOffset.x,
      originY: dragOffset.y,
    }
  }

  const filteredRules = useMemo(() => {
    const searchNeedle = search.trim().toLowerCase()
    return rules.filter((rule) => {
      if (fieldFilter !== 'all' && rule.field !== fieldFilter) return false
      if (matchInFilter !== 'all' && rule.matchIn !== matchInFilter) return false
      if (overwriteFilter === 'overwrite' && !rule.overwriteExisting) return false
      if (overwriteFilter === 'non_overwrite' && rule.overwriteExisting) return false
      if (!searchNeedle) return true
      const hay = [
        rule.token,
        rule.value,
        FIELD_LABELS.get(rule.field) ?? rule.field,
        MATCH_TYPE_LABELS[rule.matchType],
        rule.overwriteOnlyValues,
      ].join(' ').toLowerCase()
      return hay.includes(searchNeedle)
    })
  }, [fieldFilter, matchInFilter, overwriteFilter, rules, search])

  const selectedRules = useMemo(
    () => rules.filter((rule) => selectedIds.has(rule.id)),
    [rules, selectedIds]
  )

  const toggle = (ruleId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(ruleId)) next.delete(ruleId)
      else next.add(ruleId)
      return next
    })
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70">
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-5xl mx-4 flex flex-col max-h-[82vh] fixed left-1/2 top-1/2"
        style={{ transform: `translate(calc(-50% + ${dragOffset.x}px), calc(-50% + ${dragOffset.y}px))` }}
      >
        <div
          className="px-5 pt-5 pb-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 cursor-move select-none"
          onMouseDown={beginDrag}
        >
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Pick one or more saved rules to copy into the current editor.
          </p>
        </div>

        <div className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap flex-shrink-0">
          <div className="text-sm text-gray-700 dark:text-gray-300">
            <span className="font-semibold text-violet-600 dark:text-violet-400">{rules.length}</span> saved rule{rules.length !== 1 ? 's' : ''}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedIds(new Set(filteredRules.map((rule) => rule.id)))}
              className="text-xs px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              Select filtered
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="text-xs px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="px-5 pb-3 flex items-center gap-2 flex-wrap flex-shrink-0">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter token, value, field..."
            className="min-w-[220px] flex-1 px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-violet-500"
          />
          <select
            value={fieldFilter}
            onChange={(e) => setFieldFilter(e.target.value)}
            className="px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-violet-500"
          >
            <option value="all">All fields</option>
            {METADATA_SUGGEST_FIELD_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            value={matchInFilter}
            onChange={(e) => setMatchInFilter(e.target.value as typeof matchInFilter)}
            className="px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-violet-500"
          >
            <option value="all">Any source</option>
            <option value="either">Filename or folder</option>
            <option value="filename">Filename only</option>
            <option value="folder">Folder only</option>
          </select>
          <select
            value={overwriteFilter}
            onChange={(e) => setOverwriteFilter(e.target.value as typeof overwriteFilter)}
            className="px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-violet-500"
          >
            <option value="all">All overwrite states</option>
            <option value="overwrite">Overwrite only</option>
            <option value="non_overwrite">Non-overwrite only</option>
          </select>
        </div>

        <div className="px-5 pb-5 flex-1 overflow-y-auto">
          {filteredRules.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-500">
              {rules.length === 0 ? 'No saved rules in the library yet.' : 'No rules match the current filters.'}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredRules.map((rule) => (
                <div key={rule.id} className="rounded border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/30 px-3 py-2">
                  <div className="grid grid-cols-[auto_1fr_auto] gap-3 items-center">
                    <label className="inline-flex items-center justify-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(rule.id)}
                        onChange={() => toggle(rule.id)}
                        className="accent-indigo-600"
                      />
                    </label>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-800 dark:text-gray-200">
                        <span className="font-semibold text-violet-600 dark:text-violet-400">{rule.token || '(blank token)'}</span>
                        {rule.segmentIndex != null && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded border border-indigo-300/70 dark:border-indigo-700/60 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 font-semibold uppercase tracking-wide">
                            Segment {rule.segmentIndex}
                          </span>
                        )}
                        <span className="text-gray-400 dark:text-gray-500">-&gt;</span>
                        <span>{FIELD_LABELS.get(rule.field) ?? rule.field}</span>
                        <span className="text-gray-400 dark:text-gray-500">=</span>
                        <span className="font-medium">{rule.value}</span>
                        {rule.overwriteExisting && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-400/60 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 font-semibold uppercase tracking-wide">
                            Overwrite
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-500">
                        {MATCH_TYPE_LABELS[rule.matchType]}
                        <span className="mx-1.5">&middot;</span>
                        {rule.matchIn === 'either' ? 'Filename or folder' : rule.matchIn === 'filename' ? 'Filename only' : 'Folder only'}
                        {rule.overwriteExisting && rule.overwriteOnlyValues.trim() && (
                          <>
                            <span className="mx-1.5">&middot;</span>
                            Guarded overwrite: {rule.overwriteOnlyValues}
                          </>
                        )}
                        {!rule.enabled && <span className="ml-2 text-amber-500 dark:text-amber-400">Disabled in library</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => onDeleteRule(rule.id)}
                      className="text-gray-400 hover:text-red-500 transition-colors"
                      title="Remove from library"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(selectedRules)}
            disabled={selectedRules.length === 0}
            className="px-4 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
