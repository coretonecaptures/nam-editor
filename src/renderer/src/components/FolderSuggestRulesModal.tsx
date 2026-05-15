import { useEffect, useMemo, useRef, useState } from 'react'
import {
  METADATA_SUGGEST_FIELD_OPTIONS,
  METADATA_SUGGEST_LOOKUP_VALUES,
  MetadataSuggestMatchIn,
  MetadataSuggestMatchType,
  MetadataSuggestRule,
  MetadataSuggestScopedRuleSet,
} from '../types/settings'
import { MetadataSuggestRuleLibraryModal } from './MetadataSuggestRuleLibraryModal'
import { FilenameRecipeBuilderModal } from './FilenameRecipeBuilderModal'
import {
  cloneMetadataSuggestRule,
  isMetadataSuggestRuleLibraryCandidate,
  isMetadataSuggestRuleComplete,
  metadataSuggestRuleSignature,
} from '../utils/metadataSuggestRuleLibrary'

interface FolderSuggestRulesModalProps {
  folderPath: string
  initialExample?: string
  globalRules: MetadataSuggestRule[]
  scopedRuleSets: MetadataSuggestScopedRuleSet[]
  initialRules: MetadataSuggestRule[]
  ruleLibrary: MetadataSuggestRule[]
  onSaveRuleLibrary: (rules: MetadataSuggestRule[]) => void
  onSave: (rules: MetadataSuggestRule[]) => void
  onSaveAndStayOpen: (rules: MetadataSuggestRule[]) => void
  onClose: () => void
}

function formatPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  return parts.length <= 5 ? normalized : `.../${parts.slice(-5).join('/')}`
}

const METADATA_SUGGEST_MATCH_TYPE_OPTIONS: Array<{ value: MetadataSuggestMatchType; label: string }> = [
  { value: 'exact', label: 'Exact token' },
  { value: 'contains', label: 'Contains' },
  { value: 'starts_with', label: 'Starts with' },
  { value: 'ends_with', label: 'Ends with' },
  { value: 'prefix_value', label: 'Prefix + value' },
]

function buildPrefixValueExample(rule: MetadataSuggestRule): {
  sampleToken: string
  sampleValue: string
  sampleMatch: string
  sampleOutput: string
} {
  const prefix = rule.token.trim() || 'G'
  const sampleValue = '10'
  const sampleToken = `${prefix}${sampleValue}`
  const sampleMatch = sampleToken
  const template = rule.value.trim() || `${prefix} {value}`
  const sampleOutput = template
    .replaceAll('{value}', sampleValue)
    .replaceAll('{match}', sampleMatch)

  return {
    sampleToken,
    sampleValue,
    sampleMatch,
    sampleOutput,
  }
}

export function FolderSuggestRulesModal({
  folderPath,
  initialExample = '',
  globalRules,
  scopedRuleSets,
  initialRules,
  ruleLibrary,
  onSaveRuleLibrary,
  onSave,
  onSaveAndStayOpen,
  onClose,
}: FolderSuggestRulesModalProps) {
  const [draftRules, setDraftRules] = useState<MetadataSuggestRule[]>(initialRules)
  const [showRuleLibraryPicker, setShowRuleLibraryPicker] = useState(false)
  const [showRecipeBuilder, setShowRecipeBuilder] = useState(false)
  const [showScopedPicker, setShowScopedPicker] = useState(false)
  const [expandedOverwriteGuards, setExpandedOverwriteGuards] = useState<Record<string, boolean>>({})
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const dragStateRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)

  const enabledCount = useMemo(() => draftRules.filter((rule) => rule.enabled).length, [draftRules])
  const availableScopedSources = useMemo(
    () => scopedRuleSets.filter((set) => set.scopePath.replace(/\\/g, '/') !== folderPath.replace(/\\/g, '/')),
    [scopedRuleSets, folderPath]
  )

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

  const addRule = () => {
    setDraftRules((prev) => [
      ...prev,
      {
        id: `scoped-rule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        token: '',
        segmentIndex: null,
        field: 'gear_make',
        value: '',
        matchIn: 'either',
        matchType: 'exact',
        enabled: true,
        overwriteExisting: false,
        overwriteOnlyValues: '',
      },
    ])
  }

  const ensureLibraryMerged = () => {
              const existing = new Set(ruleLibrary.map(metadataSuggestRuleSignature))
              const additions = draftRules
                .filter(isMetadataSuggestRuleLibraryCandidate)
                .filter((rule) => !existing.has(metadataSuggestRuleSignature(rule)))
                .map((rule) => cloneMetadataSuggestRule(rule, 'library'))
    if (additions.length > 0) onSaveRuleLibrary([...ruleLibrary, ...additions])
  }

  const copyGlobals = () => {
    const copied = globalRules.map((rule) => cloneMetadataSuggestRule(rule, 'scoped-copy'))
    setDraftRules(copied)
  }

  const addFromLibrary = (selectedRules: MetadataSuggestRule[]) => {
    if (selectedRules.length === 0) return
    setDraftRules((prev) => [
      ...prev,
      ...selectedRules.map((rule) => cloneMetadataSuggestRule(rule, 'scoped-lib')),
    ])
    setShowRuleLibraryPicker(false)
  }

  const addFromExample = (selectedRules: MetadataSuggestRule[]) => {
    if (selectedRules.length === 0) return
    setDraftRules((prev) => [
      ...prev,
      ...selectedRules,
    ])
    setShowRecipeBuilder(false)
  }

  const replaceFromScopedSource = (scopePath: string) => {
    const source = scopedRuleSets.find((set) => set.scopePath.replace(/\\/g, '/') === scopePath.replace(/\\/g, '/'))
    if (!source) return
    setDraftRules(source.rules.map((rule) => cloneMetadataSuggestRule(rule, 'scoped-copy')))
    setShowScopedPicker(false)
  }

  const appendFromScopedSource = (scopePath: string) => {
    const source = scopedRuleSets.find((set) => set.scopePath.replace(/\\/g, '/') === scopePath.replace(/\\/g, '/'))
    if (!source) return
    setDraftRules((prev) => [
      ...prev,
      ...source.rules.map((rule) => cloneMetadataSuggestRule(rule, 'scoped-copy')),
    ])
    setShowScopedPicker(false)
  }

  const hasGuardValues = (rule: MetadataSuggestRule) => Boolean(rule.overwriteOnlyValues.trim())

  const isGuardExpanded = (rule: MetadataSuggestRule) =>
    expandedOverwriteGuards[rule.id] ?? hasGuardValues(rule)

  const toggleGuardExpanded = (ruleId: string) => {
    setExpandedOverwriteGuards((prev) => ({
      ...prev,
      [ruleId]: !prev[ruleId],
    }))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-[78rem] mx-4 flex flex-col max-h-[85vh] fixed left-1/2 top-1/2"
        style={{ transform: `translate(calc(-50% + ${dragOffset.x}px), calc(-50% + ${dragOffset.y}px))` }}
      >
        <div
          className="px-5 pt-5 pb-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 cursor-move select-none"
          onMouseDown={beginDrag}
        >
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Folder Suggestion Rules</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Scope: {formatPath(folderPath)}</p>
        </div>

        <div className="mx-5 mt-4 p-3 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-lg flex-shrink-0">
          <p className="text-xs font-semibold text-violet-800 dark:text-violet-300 mb-1">Folder rules override global token meanings</p>
          <p className="text-xs text-violet-700 dark:text-violet-400">
            These rules apply to this folder and its children. If the same token exists globally, this scoped meaning wins here. You can also repeat the same token across multiple rows to drive multiple fields from one detection.
          </p>
        </div>

        <div className="mx-5 mt-3 p-3 bg-indigo-50 dark:bg-indigo-900/15 border border-indigo-200 dark:border-indigo-800 rounded-lg flex-shrink-0">
          <p className="text-xs font-semibold text-indigo-800 dark:text-indigo-300 mb-1">Prefix + value quick guide</p>
          <p className="text-xs text-indigo-700 dark:text-indigo-400">
            Use <span className="font-mono">{'{value}'}</span> for the part after the prefix, and <span className="font-mono">{'{match}'}</span> for the full token. Example: prefix <span className="font-mono">G</span> with template <span className="font-mono">Gain {'{value}'}</span> turns <span className="font-mono">G10</span> into <span className="font-mono">Gain 10</span>.
          </p>
        </div>

        <div className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap flex-shrink-0">
          <div className="text-sm text-gray-700 dark:text-gray-300">
            <span className="font-semibold text-violet-600 dark:text-violet-400">{enabledCount}</span> enabled rule{enabledCount !== 1 ? 's' : ''}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={copyGlobals}
              className="px-3 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              Start from global rules
            </button>
            <button
              onClick={() => setShowRuleLibraryPicker(true)}
              className="px-3 py-1.5 rounded border border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/20 text-xs text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors"
            >
              Add from library…
            </button>
            <button
              onClick={() => setShowRecipeBuilder(true)}
              className="px-3 py-1.5 rounded border border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 text-xs text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors"
            >
              Build from example…
            </button>
            <button
              onClick={() => setShowScopedPicker(true)}
              disabled={availableScopedSources.length === 0}
              className={`px-3 py-1.5 rounded border text-xs transition-colors ${
                availableScopedSources.length === 0
                  ? 'border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-default'
                  : 'border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/30'
              }`}
            >
              Copy from folder…
            </button>
            <button
              onClick={addRule}
              className="px-3 py-1.5 rounded border border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/20 text-xs text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors"
            >
              + Add rule
            </button>
          </div>
        </div>

        <div className="px-5 pb-5 flex-1 overflow-y-auto">
          <div className="space-y-2">
            {draftRules.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-500">
                No scoped rules yet for this folder.
              </div>
            ) : (
              draftRules.map((rule, index) => {
                const prefixExample = rule.matchType === 'prefix_value' ? buildPrefixValueExample(rule) : null
                return (
                <div key={rule.id} className={`rounded border p-2 ${rule.overwriteExisting ? 'border-amber-300/70 dark:border-amber-700/70 bg-amber-50/40 dark:bg-amber-900/10' : 'border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/30'}`}>
                  <div className="grid grid-cols-[auto_150px_82px_138px_150px_138px_138px_auto] gap-2 items-center">
                    <label className="inline-flex items-center justify-center text-xs text-gray-600 dark:text-gray-400">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(e) => {
                          const next = draftRules.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, enabled: e.target.checked } : item
                          )
                          setDraftRules(next)
                        }}
                        className="accent-indigo-600"
                        title="Rule enabled"
                      />
                    </label>
                    <input
                      value={rule.token}
                      placeholder={rule.matchType === 'prefix_value' ? 'Prefix, e.g. G' : 'Token, e.g. Mesa (blank = scope-wide default)'}
                      onChange={(e) => {
                        const next = draftRules.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, token: e.target.value } : item
                        )
                        setDraftRules(next)
                      }}
                      className="px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                    />
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min={1}
                        value={rule.segmentIndex ?? ''}
                        placeholder="#"
                        onChange={(e) => {
                          const raw = e.target.value.trim()
                          const next = draftRules.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, segmentIndex: raw === '' ? null : Math.max(1, Math.floor(Number(raw) || 1)) } : item
                          )
                          setDraftRules(next)
                        }}
                        className="w-full px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                        title="Segment number: 1 means the first space-separated part of the filename, 2 means the second, and so on. Leave blank to match anywhere in the full filename."
                      />
                      <span
                        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 dark:border-gray-600 text-[10px] font-semibold text-gray-500 dark:text-gray-400 cursor-help"
                        title="Segment number: 1 means the first space-separated part of the filename, 2 means the second, and so on. Leave blank to match anywhere in the full filename."
                      >
                        ?
                      </span>
                    </div>
                    <select
                      value={rule.field}
                      onChange={(e) => {
                        const next = draftRules.map((item, itemIndex) =>
                          itemIndex === index ? {
                            ...item,
                            field: e.target.value as typeof rule.field,
                            value: METADATA_SUGGEST_LOOKUP_VALUES[e.target.value as typeof rule.field]?.includes(item.value)
                              ? item.value
                              : ''
                          } : item
                        )
                        setDraftRules(next)
                      }}
                      className="px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                    >
                      {METADATA_SUGGEST_FIELD_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <div className="flex items-center gap-1">
                      <select
                        value={rule.matchType}
                        onChange={(e) => {
                          const next = draftRules.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, matchType: e.target.value as MetadataSuggestMatchType } : item
                          )
                          setDraftRules(next)
                        }}
                        className="w-full px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                        title={rule.matchType === 'prefix_value'
                          ? 'Prefix + value: match the letter part and reuse the rest with templates like Gain {value} or {match}. Example: G10 + Gain {value} becomes Gain 10.'
                          : undefined}
                      >
                        {METADATA_SUGGEST_MATCH_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                      {rule.matchType === 'prefix_value' ? (
                        <span
                          className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-indigo-300 dark:border-indigo-700 text-[10px] font-semibold text-indigo-600 dark:text-indigo-300 cursor-help"
                          title="Prefix + value: match the letter part and reuse the rest with templates like Gain {value} or {match}. Example: G10 + Gain {value} becomes Gain 10."
                        >
                          ?
                        </span>
                      ) : null}
                    </div>
                    {METADATA_SUGGEST_LOOKUP_VALUES[rule.field] ? (
                      <select
                        value={rule.value}
                        onChange={(e) => {
                          const next = draftRules.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, value: e.target.value } : item
                          )
                          setDraftRules(next)
                        }}
                        className="px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                      >
                        <option value="">Pick value…</option>
                        {METADATA_SUGGEST_LOOKUP_VALUES[rule.field]!.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={rule.value}
                        placeholder={rule.matchType === 'prefix_value' ? 'Template, e.g. Gain {value} or {match}' : 'Suggested value'}
                        onChange={(e) => {
                          const next = draftRules.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, value: e.target.value } : item
                          )
                          setDraftRules(next)
                        }}
                        className="px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                      />
                    )}
                    <select
                      value={rule.matchIn}
                      onChange={(e) => {
                        const next = draftRules.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, matchIn: e.target.value as MetadataSuggestMatchIn } : item
                        )
                        setDraftRules(next)
                      }}
                      className="px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                    >
                      <option value="either">Filename or folder</option>
                      <option value="filename">Filename only</option>
                      <option value="folder">Folder only</option>
                    </select>
                    <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                      <label className="inline-flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300 font-medium whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={rule.overwriteExisting}
                          onChange={(e) => {
                            const next = draftRules.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, overwriteExisting: e.target.checked } : item
                            )
                            setDraftRules(next)
                          }}
                          className="accent-amber-600"
                        />
                        Overwrite
                      </label>
                      {rule.overwriteExisting ? (
                        <button
                          type="button"
                          onClick={() => toggleGuardExpanded(rule.id)}
                          className={`inline-flex items-center gap-1 px-1.5 py-1 rounded text-[10px] border whitespace-nowrap transition-colors ${
                            hasGuardValues(rule)
                              ? 'text-amber-900 dark:text-amber-200 border-amber-400/80 dark:border-amber-500/80 bg-amber-100/80 dark:bg-amber-900/30'
                              : 'text-amber-700 dark:text-amber-300 border-amber-300/60 dark:border-amber-700/60 hover:bg-amber-100/70 dark:hover:bg-amber-900/20'
                          }`}
                          title={hasGuardValues(rule)
                            ? `Guard active: ${rule.overwriteOnlyValues}`
                            : 'Optional overwrite guard: only overwrite when the current value matches one of your placeholder values'}
                        >
                          <span>Guard</span>
                          {hasGuardValues(rule) ? (
                            <span className="text-[9px] uppercase font-semibold">active</span>
                          ) : (
                            <span className="text-[9px] uppercase opacity-70">off</span>
                          )}
                          <svg className={`w-3 h-3 transition-transform ${isGuardExpanded(rule) ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      ) : (
                        <span
                          aria-hidden="true"
                          className="inline-flex items-center gap-1 px-1.5 py-1 rounded text-[10px] border whitespace-nowrap invisible"
                        >
                          <span>Guard</span>
                          <span className="text-[9px] uppercase">off</span>
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                          </svg>
                        </span>
                      )}
                      <button
                        onClick={() => setDraftRules([
                          ...draftRules.slice(0, index + 1),
                          cloneMetadataSuggestRule(rule, 'scoped-rule-clone'),
                          ...draftRules.slice(index + 1),
                        ])}
                        className="text-gray-400 hover:text-violet-500 transition-colors"
                        title="Clone rule"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h8a2 2 0 012 2v8m-2 0H8a2 2 0 01-2-2V7m2-2h8a2 2 0 012 2v8" />
                        </svg>
                      </button>
                      <button
                        onClick={() => setDraftRules(draftRules.filter((item) => item.id !== rule.id))}
                        className="text-gray-400 hover:text-red-500 transition-colors"
                        title="Remove rule"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                  {prefixExample ? (
                    <div className="mt-2 pl-7 text-[11px] text-indigo-700 dark:text-indigo-300">
                      <span className="font-medium">Quick example:</span>{' '}
                      <span className="font-mono">{'{value}'}</span> = <span className="font-mono">{prefixExample.sampleValue}</span>,{' '}
                      <span className="font-mono">{'{match}'}</span> = <span className="font-mono">{prefixExample.sampleMatch}</span>, so{' '}
                      <span className="font-mono">{prefixExample.sampleToken}</span> becomes{' '}
                      <span className="font-mono">{prefixExample.sampleOutput}</span>
                    </div>
                  ) : null}
                  {rule.overwriteExisting && isGuardExpanded(rule) && (
                    <div className="mt-2 grid grid-cols-1 md:grid-cols-[auto_minmax(0,1fr)] gap-2 items-center">
                      <div className="text-[11px] font-medium text-amber-700 dark:text-amber-300">Overwrite only if current value is</div>
                      <input
                        value={rule.overwriteOnlyValues}
                        placeholder="Optional comma list, e.g. tz-model, Unknown, N/A"
                        onChange={(e) => {
                          const next = draftRules.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, overwriteOnlyValues: e.target.value } : item
                          )
                          setDraftRules(next)
                        }}
                        className="px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-amber-300/60 dark:border-amber-700/60 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  )}
                </div>
              )})
            )}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              ensureLibraryMerged()
              onSave(draftRules)
            }}
            className="px-4 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-colors"
          >
            Save folder rules
          </button>
          <button
            onClick={() => {
              ensureLibraryMerged()
              const nextRules = [
                ...draftRules,
                {
                  id: `scoped-rule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  token: '',
                  segmentIndex: null,
                  field: 'gear_make',
                  value: '',
                  matchIn: 'either' as const,
                  matchType: 'exact' as const,
                  enabled: true,
                  overwriteExisting: false,
                  overwriteOnlyValues: '',
                },
              ]
              setDraftRules(nextRules)
              onSaveAndStayOpen(nextRules)
            }}
            className="px-4 py-1.5 text-sm rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            Save and new
          </button>
        </div>

        {showRuleLibraryPicker && (
          <MetadataSuggestRuleLibraryModal
            title="Rule Library"
            confirmLabel="Add selected to folder rules"
            rules={ruleLibrary}
            onConfirm={addFromLibrary}
            onDeleteRule={(ruleId) => onSaveRuleLibrary(ruleLibrary.filter((rule) => rule.id !== ruleId))}
            onClose={() => setShowRuleLibraryPicker(false)}
          />
        )}
        {showRecipeBuilder && (
          <FilenameRecipeBuilderModal
            title="Build Folder Rules From Example Filename"
            initialExample={initialExample}
            onConfirm={addFromExample}
            onClose={() => setShowRecipeBuilder(false)}
          />
        )}
        {showScopedPicker && (
          <ScopedRuleSetPickerModal
            currentFolderPath={folderPath}
            ruleSets={availableScopedSources}
            onAppend={appendFromScopedSource}
            onReplace={replaceFromScopedSource}
            onClose={() => setShowScopedPicker(false)}
          />
        )}
      </div>
    </div>
  )
}

function ScopedRuleSetPickerModal({
  currentFolderPath,
  ruleSets,
  onAppend,
  onReplace,
  onClose,
}: {
  currentFolderPath: string
  ruleSets: MetadataSuggestScopedRuleSet[]
  onAppend: (scopePath: string) => void
  onReplace: (scopePath: string) => void
  onClose: () => void
}) {
  const [selectedPath, setSelectedPath] = useState<string>(ruleSets[0]?.scopePath ?? '')

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-2xl mx-4 flex flex-col max-h-[80vh]">
        <div className="px-5 pt-5 pb-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Copy Rules from Another Folder</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Import scoped rules from another folder into {formatPath(currentFolderPath)}.
          </p>
        </div>
        <div className="px-5 py-4 flex-1 overflow-y-auto space-y-2">
          {ruleSets.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-500">
              No other folder-scoped rule sets exist yet.
            </div>
          ) : (
            ruleSets.map((set) => (
              <label
                key={set.scopePath}
                className={`flex items-start gap-3 rounded-lg border px-3 py-3 cursor-pointer transition-colors ${
                  selectedPath === set.scopePath
                    ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-900/20'
                    : 'border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                }`}
              >
                <input
                  type="radio"
                  name="scoped-rule-source"
                  checked={selectedPath === set.scopePath}
                  onChange={() => setSelectedPath(set.scopePath)}
                  className="mt-0.5 accent-indigo-600"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-gray-900 dark:text-gray-100 truncate">{formatPath(set.scopePath)}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {set.rules.length} rule{set.rules.length !== 1 ? 's' : ''}
                  </div>
                </div>
              </label>
            ))
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
            onClick={() => selectedPath && onAppend(selectedPath)}
            disabled={!selectedPath}
            className={`px-4 py-1.5 text-sm rounded-lg transition-colors ${
              selectedPath
                ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-900/40'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-default'
            }`}
          >
            Append rules
          </button>
          <button
            onClick={() => selectedPath && onReplace(selectedPath)}
            disabled={!selectedPath}
            className={`px-4 py-1.5 text-sm rounded-lg transition-colors ${
              selectedPath
                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-default'
            }`}
          >
            Replace current rules
          </button>
        </div>
      </div>
    </div>
  )
}
