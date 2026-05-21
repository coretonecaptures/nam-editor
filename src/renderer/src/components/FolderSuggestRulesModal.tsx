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

function buildPrefixValuePreview(rule: MetadataSuggestRule): string {
  const prefix = rule.token.trim() || 'G'
  const sampleValue = '10'
  const sampleToken = `${prefix}${sampleValue}`
  const template = rule.value.trim() || `${prefix} {value}`
  const output = template.replaceAll('{value}', sampleValue).replaceAll('{match}', sampleToken)
  return `e.g. "${sampleToken}" → "${output}"`
}

function makeBlankRule(): MetadataSuggestRule {
  return {
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
  }
}

function RuleCard({
  rule,
  index,
  draftRules,
  setDraftRules,
}: {
  rule: MetadataSuggestRule
  index: number
  draftRules: MetadataSuggestRule[]
  setDraftRules: React.Dispatch<React.SetStateAction<MetadataSuggestRule[]>>
}) {
  const update = (patch: Partial<MetadataSuggestRule>) =>
    setDraftRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))

  const isBlankToken = !rule.token.trim() && rule.matchType !== 'prefix_value'
  const prefixPreview = rule.matchType === 'prefix_value' ? buildPrefixValuePreview(rule) : null
  const hasLookup = Boolean(METADATA_SUGGEST_LOOKUP_VALUES[rule.field])

  return (
    <div
      className={`rounded-lg border ${
        rule.overwriteExisting
          ? 'border-amber-300/70 dark:border-amber-700/70 bg-amber-50/30 dark:bg-amber-900/10'
          : 'border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900/40'
      }`}
    >
      {/* Single main row */}
      <div className="flex items-center gap-2 px-3 py-2">
        <input
          type="checkbox"
          checked={rule.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
          className="accent-indigo-600 flex-shrink-0"
          title="Enable this rule"
        />
        {/* Token */}
        <input
          value={rule.token}
          placeholder={rule.matchType === 'prefix_value' ? 'Prefix, e.g. G' : 'Token, e.g. Mesa'}
          onChange={(e) => update({ token: e.target.value })}
          className={`w-36 flex-shrink-0 px-2 py-1 text-xs rounded border focus:outline-none focus:border-indigo-500 ${
            isBlankToken
              ? 'bg-violet-50 dark:bg-violet-900/20 border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 placeholder-violet-400 dark:placeholder-violet-500'
              : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100'
          }`}
        />
        {/* Match type */}
        <select
          value={rule.matchType}
          onChange={(e) => update({ matchType: e.target.value as MetadataSuggestMatchType })}
          className="w-28 flex-shrink-0 px-2 py-1 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
        >
          {METADATA_SUGGEST_MATCH_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {/* Look in */}
        <select
          value={rule.matchIn}
          onChange={(e) => update({ matchIn: e.target.value as MetadataSuggestMatchIn })}
          className="w-32 flex-shrink-0 px-2 py-1 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
        >
          <option value="either">Filename or folder</option>
          <option value="filename">Filename only</option>
          <option value="folder">Folder only</option>
        </select>
        {/* Seg */}
        <input
          type="number"
          min={1}
          value={rule.segmentIndex ?? ''}
          placeholder="seg"
          onChange={(e) => {
            const raw = e.target.value.trim()
            update({ segmentIndex: raw === '' ? null : Math.max(1, Math.floor(Number(raw) || 1)) })
          }}
          title="Segment: 1 = first word, 2 = second, blank = anywhere"
          className="w-10 flex-shrink-0 px-1.5 py-1 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500 text-center"
        />
        {/* Divider arrow */}
        <span className="text-gray-300 dark:text-gray-700 flex-shrink-0 select-none text-base">→</span>
        {/* Field */}
        <select
          value={rule.field}
          onChange={(e) => {
            const field = e.target.value as typeof rule.field
            update({ field, value: METADATA_SUGGEST_LOOKUP_VALUES[field]?.includes(rule.value) ? rule.value : '' })
          }}
          className="w-32 flex-shrink-0 px-2 py-1 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
        >
          {METADATA_SUGGEST_FIELD_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {/* Value */}
        {hasLookup ? (
          <select
            value={rule.value}
            onChange={(e) => update({ value: e.target.value })}
            className="w-32 flex-shrink-0 px-2 py-1 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
          >
            <option value="">Pick value…</option>
            {METADATA_SUGGEST_LOOKUP_VALUES[rule.field]!.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        ) : (
          <input
            value={rule.value}
            placeholder={rule.matchType === 'prefix_value' ? 'Template, e.g. Gain {value}' : 'Value'}
            onChange={(e) => update({ value: e.target.value })}
            className="flex-1 min-w-0 px-2 py-1 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
          />
        )}
        {/* Overwrite */}
        <label className={`inline-flex items-center gap-1 text-[11px] font-medium whitespace-nowrap flex-shrink-0 ${rule.overwriteExisting ? 'text-amber-700 dark:text-amber-300' : 'text-gray-400 dark:text-gray-600'}`}>
          <input
            type="checkbox"
            checked={rule.overwriteExisting}
            onChange={(e) => update({ overwriteExisting: e.target.checked })}
            className="accent-amber-600"
          />
          Overwrite
        </label>
        {/* Clone */}
        <button
          onClick={() =>
            setDraftRules((prev) => [
              ...prev.slice(0, index + 1),
              cloneMetadataSuggestRule(rule, 'scoped-rule-clone'),
              ...prev.slice(index + 1),
            ])
          }
          className="text-gray-400 hover:text-violet-500 transition-colors flex-shrink-0"
          title="Clone rule"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h8a2 2 0 012 2v8m-2 0H8a2 2 0 01-2-2V7m2-2h8a2 2 0 012 2v8" />
          </svg>
        </button>
        {/* Delete */}
        <button
          onClick={() => setDraftRules((prev) => prev.filter((r) => r.id !== rule.id))}
          className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"
          title="Remove rule"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Overwrite guard sub-row */}
      {rule.overwriteExisting && (
        <div className="flex items-center gap-2 px-3 pb-2 border-t border-amber-200/50 dark:border-amber-700/30 pt-1.5">
          <span className="w-4 flex-shrink-0" />
          <span className="text-[11px] text-amber-600 dark:text-amber-400 whitespace-nowrap flex-shrink-0">
            Guard — only overwrite if current value is:
          </span>
          <input
            value={rule.overwriteOnlyValues}
            placeholder="Comma list, e.g. tz-model, Unknown, N/A  (blank = overwrite anything)"
            onChange={(e) => update({ overwriteOnlyValues: e.target.value })}
            className="flex-1 min-w-0 px-2 py-1 text-xs bg-white dark:bg-gray-800 border border-amber-300/60 dark:border-amber-700/60 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-amber-500"
          />
        </div>
      )}

      {/* Prefix+value preview sub-row */}
      {prefixPreview && (
        <div className="px-3 pb-1.5 pl-8 flex items-center gap-1.5 text-[11px] text-indigo-600 dark:text-indigo-400">
          <span className="opacity-50">→</span>
          <span className="font-mono">{prefixPreview}</span>
        </div>
      )}

      {/* Scope-default note */}
      {isBlankToken && (
        <div className="px-3 pb-1.5 pl-8 text-[11px] text-violet-500 dark:text-violet-400">
          Scope default — fills this field for any file in this folder where the field is empty
        </div>
      )}
    </div>
  )
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
  const [confirmSave, setConfirmSave] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const dragStateRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)

  const enabledCount = useMemo(() => draftRules.filter((r) => r.enabled).length, [draftRules])
  const overwriteCount = useMemo(() => draftRules.filter((r) => r.overwriteExisting && r.enabled).length, [draftRules])
  const availableScopedSources = useMemo(
    () => scopedRuleSets.filter((set) => set.scopePath.replace(/\\/g, '/') !== folderPath.replace(/\\/g, '/')),
    [scopedRuleSets, folderPath]
  )

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const ds = dragStateRef.current
      if (!ds) return
      setDragOffset({ x: ds.originX + (event.clientX - ds.startX), y: ds.originY + (event.clientY - ds.startY) })
    }
    const handleMouseUp = () => { dragStateRef.current = null }
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  const beginDrag = (event: React.MouseEvent<HTMLDivElement>) => {
    dragStateRef.current = { startX: event.clientX, startY: event.clientY, originX: dragOffset.x, originY: dragOffset.y }
  }

  const addRule = () => setDraftRules((prev) => [...prev, makeBlankRule()])

  const ensureLibraryMerged = () => {
    const existing = new Set(ruleLibrary.map(metadataSuggestRuleSignature))
    const additions = draftRules
      .filter(isMetadataSuggestRuleLibraryCandidate)
      .filter((rule) => !existing.has(metadataSuggestRuleSignature(rule)))
      .map((rule) => cloneMetadataSuggestRule(rule, 'library'))
    if (additions.length > 0) onSaveRuleLibrary([...ruleLibrary, ...additions])
  }

  const copyGlobals = () => setDraftRules(globalRules.map((rule) => cloneMetadataSuggestRule(rule, 'scoped-copy')))

  const addFromLibrary = (selectedRules: MetadataSuggestRule[]) => {
    if (selectedRules.length === 0) return
    setDraftRules((prev) => [...prev, ...selectedRules.map((rule) => cloneMetadataSuggestRule(rule, 'scoped-lib'))])
    setShowRuleLibraryPicker(false)
  }

  const addFromExample = (selectedRules: MetadataSuggestRule[]) => {
    if (selectedRules.length === 0) return
    setDraftRules((prev) => [...prev, ...selectedRules])
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
    setDraftRules((prev) => [...prev, ...source.rules.map((rule) => cloneMetadataSuggestRule(rule, 'scoped-copy'))])
    setShowScopedPicker(false)
  }

  const handleSave = () => {
    ensureLibraryMerged()
    onSave(draftRules)
  }

  const handleSaveAndNew = () => {
    ensureLibraryMerged()
    const nextRules = [...draftRules, makeBlankRule()]
    setDraftRules(nextRules)
    onSaveAndStayOpen(nextRules)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-[90rem] mx-4 flex flex-col max-h-[88vh] fixed left-1/2 top-1/2"
        style={{ transform: `translate(calc(-50% + ${dragOffset.x}px), calc(-50% + ${dragOffset.y}px))` }}
      >
        {/* Header */}
        <div
          className="px-5 pt-4 pb-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 cursor-move select-none"
          onMouseDown={beginDrag}
        >
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Folder Suggestion Rules</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Scope: {formatPath(folderPath)}</p>
        </div>

        {/* Info strip */}
        <div className="mx-5 mt-3 px-3 py-2.5 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-lg flex-shrink-0 text-xs text-violet-700 dark:text-violet-400 space-y-0.5">
          <p className="font-semibold text-violet-800 dark:text-violet-300">Each rule: when a token matches in a filename or folder → set a metadata field to a value</p>
          <p>These rules apply to this folder and its children, overriding any global rule with the same token. You can repeat a token across rows to fill multiple fields from one match. A blank token acts as a scope default, filling a field for all files where it is empty.</p>
        </div>

        {/* Prefix + value guide */}
        <div className="mx-5 mt-2 px-3 py-2 bg-indigo-50 dark:bg-indigo-900/15 border border-indigo-200 dark:border-indigo-800 rounded-lg flex-shrink-0 text-xs text-indigo-700 dark:text-indigo-400">
          <span className="font-semibold text-indigo-800 dark:text-indigo-300">Prefix + value</span>
          {' — '}use <code className="font-mono bg-indigo-100 dark:bg-indigo-900/40 px-0.5 rounded">{'{value}'}</code> for the part after the prefix,{' '}
          <code className="font-mono bg-indigo-100 dark:bg-indigo-900/40 px-0.5 rounded">{'{match}'}</code> for the full token.{' '}
          Example: prefix <span className="font-mono">G</span> + template <span className="font-mono">Gain {'{value}'}</span> → <span className="font-mono">G10</span> becomes <span className="font-mono">Gain 10</span>.
        </div>

        {/* Toolbar */}
        <div className="px-5 py-2.5 flex items-center justify-between gap-3 flex-wrap flex-shrink-0 border-b border-gray-100 dark:border-gray-800">
          <div className="text-xs text-gray-600 dark:text-gray-400">
            <span className="font-semibold text-violet-600 dark:text-violet-400">{enabledCount}</span> rule{enabledCount !== 1 ? 's' : ''} enabled
            {overwriteCount > 0 && (
              <span className="ml-2 text-amber-600 dark:text-amber-400">
                · <span className="font-semibold">{overwriteCount}</span> overwrite
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setShowRecipeBuilder(true)}
              className="px-2.5 py-1.5 rounded border border-indigo-400 dark:border-indigo-600 bg-indigo-600 text-xs text-white hover:bg-indigo-700 transition-colors font-medium"
            >
              Build from example…
            </button>
            <button
              onClick={() => setShowRuleLibraryPicker(true)}
              className="px-2.5 py-1.5 rounded border border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/20 text-xs text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors"
            >
              Add from library…
            </button>
            <button
              onClick={copyGlobals}
              className="px-2.5 py-1.5 rounded border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              Start from global rules
            </button>
            <button
              onClick={() => setShowScopedPicker(true)}
              disabled={availableScopedSources.length === 0}
              className={`px-2.5 py-1.5 rounded border text-xs transition-colors ${
                availableScopedSources.length === 0
                  ? 'border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-default'
                  : 'border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              Copy from folder…
            </button>
            <button
              onClick={addRule}
              className="px-2.5 py-1.5 rounded border border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/20 text-xs text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors"
            >
              + Add rule
            </button>
          </div>
        </div>

        {/* Column header hint */}
        {draftRules.length > 0 && (
          <div className="mx-5 mt-3 mb-1 flex items-center gap-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 select-none flex-shrink-0">
            <span className="w-4 flex-shrink-0" />
            <span className="w-36 flex-shrink-0">Token</span>
            <span className="w-28 flex-shrink-0">Match type</span>
            <span className="w-32 flex-shrink-0">Look in</span>
            <span className="w-10 flex-shrink-0">Seg</span>
            <span className="w-4 flex-shrink-0" />
            <span className="w-32 flex-shrink-0">Field</span>
            <span className="flex-1 min-w-0">Value</span>
            <span className="w-16 flex-shrink-0">Overwrite</span>
            <span className="w-14 flex-shrink-0" />
          </div>
        )}

        {/* Rules list */}
        <div className="px-5 pb-5 flex-1 overflow-y-auto">
          <div className="space-y-2">
            {draftRules.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 px-4 py-8 text-center space-y-3">
                <p className="text-sm text-gray-500 dark:text-gray-500">No rules yet for this folder.</p>
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  <button
                    onClick={() => setShowRecipeBuilder(true)}
                    className="px-3 py-1.5 rounded border border-indigo-400 dark:border-indigo-600 bg-indigo-600 text-xs text-white hover:bg-indigo-700 transition-colors"
                  >
                    Build from example filename…
                  </button>
                  <button
                    onClick={addRule}
                    className="px-3 py-1.5 rounded border border-violet-300 dark:border-violet-700 bg-violet-50 dark:bg-violet-900/20 text-xs text-violet-700 dark:text-violet-300 hover:bg-violet-100 transition-colors"
                  >
                    + Add blank rule
                  </button>
                </div>
                <p className="text-[11px] text-gray-400 dark:text-gray-600">
                  Tip: "Build from example" is the fastest way — paste a real filename and map each segment to a field.
                </p>
              </div>
            ) : (
              draftRules.map((rule, index) => (
                <RuleCard key={rule.id} rule={rule} index={index} draftRules={draftRules} setDraftRules={setDraftRules} />
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-gray-200 dark:border-gray-700 flex justify-between items-center gap-2 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            Cancel
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveAndNew}
              className="px-4 py-1.5 text-sm rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              Save and add rule
            </button>
            {overwriteCount > 0 && !confirmSave ? (
              <button
                onClick={() => setConfirmSave(true)}
                className="px-4 py-1.5 text-sm rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors"
              >
                Save folder rules…
              </button>
            ) : confirmSave ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-amber-700 dark:text-amber-400">
                  {overwriteCount} overwrite rule{overwriteCount !== 1 ? 's' : ''} will replace existing values — confirm?
                </span>
                <button
                  onClick={() => setConfirmSave(false)}
                  className="px-3 py-1.5 text-xs rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleSave}
                  className="px-4 py-1.5 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors"
                >
                  Confirm save
                </button>
              </div>
            ) : (
              <button
                onClick={handleSave}
                className="px-4 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-colors"
              >
                Save folder rules
              </button>
            )}
          </div>
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
