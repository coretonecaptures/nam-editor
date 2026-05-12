import { useMemo, useState } from 'react'
import {
  METADATA_SUGGEST_FIELD_OPTIONS,
  MetadataSuggestMatchIn,
  MetadataSuggestRule,
} from '../types/settings'
import { MetadataSuggestRuleLibraryModal } from './MetadataSuggestRuleLibraryModal'
import {
  cloneMetadataSuggestRule,
  isMetadataSuggestRuleLibraryCandidate,
  isMetadataSuggestRuleComplete,
  metadataSuggestRuleSignature,
} from '../utils/metadataSuggestRuleLibrary'

interface FolderSuggestRulesModalProps {
  folderPath: string
  globalRules: MetadataSuggestRule[]
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

export function FolderSuggestRulesModal({
  folderPath,
  globalRules,
  initialRules,
  ruleLibrary,
  onSaveRuleLibrary,
  onSave,
  onSaveAndStayOpen,
  onClose,
}: FolderSuggestRulesModalProps) {
  const [draftRules, setDraftRules] = useState<MetadataSuggestRule[]>(initialRules)
  const [showRuleLibraryPicker, setShowRuleLibraryPicker] = useState(false)

  const enabledCount = useMemo(() => draftRules.filter((rule) => rule.enabled).length, [draftRules])

  const addRule = () => {
    setDraftRules((prev) => [
      ...prev,
      {
        id: `scoped-rule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        token: '',
        field: 'gear_make',
        value: '',
        matchIn: 'either',
        enabled: true,
        overwriteExisting: false,
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-4xl mx-4 flex flex-col max-h-[85vh]">
        <div className="px-5 pt-5 pb-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Folder Suggestion Rules</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Scope: {formatPath(folderPath)}</p>
        </div>

        <div className="mx-5 mt-4 p-3 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800 rounded-lg flex-shrink-0">
          <p className="text-xs font-semibold text-violet-800 dark:text-violet-300 mb-1">Folder rules override global token meanings</p>
          <p className="text-xs text-violet-700 dark:text-violet-400">
            These rules apply to this folder and its children. If the same token exists globally, this scoped meaning wins here. You can also repeat the same token across multiple rows to drive multiple fields from one detection.
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
              draftRules.map((rule, index) => (
                <div key={rule.id} className={`rounded border p-2 ${rule.overwriteExisting ? 'border-amber-300/70 dark:border-amber-700/70 bg-amber-50/40 dark:bg-amber-900/10' : 'border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/30'}`}>
                  <div className="grid grid-cols-1 md:grid-cols-[auto_minmax(0,1.05fr)_minmax(0,0.95fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto_auto_auto] gap-2 items-center">
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
                      placeholder="Token, e.g. Mesa (blank = scope-wide default)"
                      onChange={(e) => {
                        const next = draftRules.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, token: e.target.value } : item
                        )
                        setDraftRules(next)
                      }}
                      className="px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                    />
                    <select
                      value={rule.field}
                      onChange={(e) => {
                        const next = draftRules.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, field: e.target.value as typeof rule.field } : item
                        )
                        setDraftRules(next)
                      }}
                      className="px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                    >
                      {METADATA_SUGGEST_FIELD_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <input
                      value={rule.value}
                      placeholder="Suggested value"
                      onChange={(e) => {
                        const next = draftRules.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, value: e.target.value } : item
                        )
                        setDraftRules(next)
                      }}
                      className="px-2 py-1.5 text-xs bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                    />
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
                    <label className="inline-flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300 font-medium whitespace-nowrap justify-self-start">
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
                    <button
                      onClick={() => setDraftRules([
                        ...draftRules.slice(0, index + 1),
                        cloneMetadataSuggestRule(rule, 'scoped-rule-clone'),
                        ...draftRules.slice(index + 1),
                      ])}
                      className="text-gray-400 hover:text-violet-500 transition-colors justify-self-center"
                      title="Clone rule"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h8a2 2 0 012 2v8m-2 0H8a2 2 0 01-2-2V7m2-2h8a2 2 0 012 2v8" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setDraftRules(draftRules.filter((item) => item.id !== rule.id))}
                      className="text-gray-400 hover:text-red-500 transition-colors justify-self-center"
                      title="Remove rule"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))
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
                  field: 'gear_make',
                  value: '',
                  matchIn: 'either' as const,
                  enabled: true,
                  overwriteExisting: false,
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
      </div>
    </div>
  )
}
