import { useMemo, useState } from 'react'
import { IR_METADATA_SUGGEST_FIELD_OPTIONS, IrMetadataSuggestField, IrMetadataSuggestRule } from '../../types/settings'
import { buildIrMetadataSuggestionMatches, IrSuggestionTarget } from '../../utils/irMetadataSuggest'

/**
 * Rule library management for IR filename metadata suggestions (parity backlog item 20). A
 * deliberately simpler editor than NAM mode's `FilenameRecipeBuilderModal`/
 * `MetadataSuggestRuleLibraryModal` pair — one flat list, inline add/edit form, no per-folder
 * scoped rule sets — see `types/settings.ts`'s own comment on `IrMetadataSuggestRule` for why.
 * "Build a rule from one example" (the item's own "Done when" wording) is covered by the live Test
 * panel below the form rather than an interactive click-to-select filename UI: type an example
 * filename, see immediately whether the rule you're building matches it and what it would produce.
 */

const MATCH_IN_OPTIONS: Array<{ value: IrMetadataSuggestRule['matchIn']; label: string }> = [
  { value: 'filename', label: 'Filename' },
  { value: 'folder', label: 'Folder path' },
  { value: 'either', label: 'Either' }
]
const MATCH_TYPE_OPTIONS: Array<{ value: IrMetadataSuggestRule['matchType']; label: string }> = [
  { value: 'exact', label: 'Exact token' },
  { value: 'contains', label: 'Contains' },
  { value: 'starts_with', label: 'Starts with' },
  { value: 'ends_with', label: 'Ends with' },
  { value: 'prefix_value', label: 'Prefix + number (e.g. "SM57" → distance "3.5")' }
]

function blankDraft(): Omit<IrMetadataSuggestRule, 'id'> {
  return {
    token: '',
    segmentIndex: null,
    field: 'manufacturer',
    value: '',
    matchIn: 'filename',
    matchType: 'exact',
    enabled: true,
    overwriteExisting: false
  }
}

export function IrMetadataSuggestRulesModal({
  rules,
  onChange,
  onClose
}: {
  rules: IrMetadataSuggestRule[]
  onChange: (rules: IrMetadataSuggestRule[]) => void
  onClose: () => void
}): React.ReactElement {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Omit<IrMetadataSuggestRule, 'id'>>(blankDraft())
  const [testFilename, setTestFilename] = useState('SM57 Cap Edge 1960A.wav')

  const startAdd = (): void => {
    setEditingId('new')
    setDraft(blankDraft())
  }
  const startEdit = (rule: IrMetadataSuggestRule): void => {
    setEditingId(rule.id)
    const { id: _id, ...rest } = rule
    setDraft(rest)
  }
  const cancelEdit = (): void => {
    setEditingId(null)
  }
  const saveDraft = (): void => {
    if (!draft.value.trim()) return
    if (editingId && editingId !== 'new') {
      onChange(rules.map((r) => (r.id === editingId ? { ...draft, id: editingId } : r)))
    } else {
      onChange([...rules, { ...draft, id: crypto.randomUUID() }])
    }
    setEditingId(null)
  }
  const deleteRule = (id: string): void => {
    onChange(rules.filter((r) => r.id !== id))
  }
  const toggleEnabled = (id: string): void => {
    onChange(rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)))
  }

  const testTarget: IrSuggestionTarget = useMemo(
    () => ({ itemId: 'test', displayName: testFilename, relativePath: testFilename, currentValues: {} }),
    [testFilename]
  )
  const testMatches = useMemo(() => {
    if (!draft.token.trim() && draft.matchType !== 'exact') return []
    return buildIrMetadataSuggestionMatches([testTarget], [{ ...draft, id: 'draft', enabled: true }])
  }, [draft, testTarget])
  const testSuggestion = testMatches[0]?.suggestions[0] ?? null

  return (
    <div className="fixed inset-0 z-[9990] bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div className="bg-panel border border-nm-border rounded-xl w-[560px] max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-nm-border">
          <div className="text-sm font-semibold text-nm-text">Metadata suggestion rules</div>
          <div className="text-xs text-nm-text-3 mt-0.5">
            Rules fire when you run &ldquo;Suggest Metadata&rdquo; against a folder — a filename or folder-path
            token maps to a field value, filling in blanks (or overwriting, if checked).
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {rules.length === 0 && <div className="text-xs text-nm-text-3">No rules yet — add one below.</div>}
          {rules.map((rule) => (
            <div key={rule.id} className="flex items-center gap-2 rounded border border-field-bd px-2 py-1.5">
              <input type="checkbox" checked={rule.enabled} onChange={() => toggleEnabled(rule.id)} className="flex-shrink-0" />
              <div className="flex-1 min-w-0 text-xs text-nm-text-2 truncate">
                <span className="font-mono">{rule.token || '(always)'}</span> in {rule.matchIn}
                {rule.matchType !== 'exact' && ` (${MATCH_TYPE_OPTIONS.find((m) => m.value === rule.matchType)?.label})`} →{' '}
                <span className="text-nm-text">{IR_METADATA_SUGGEST_FIELD_OPTIONS.find((f) => f.value === rule.field)?.label}</span> ={' '}
                <span className="font-mono">{rule.value}</span>
                {rule.overwriteExisting && <span className="text-amber-500"> (overwrite)</span>}
              </div>
              <button onClick={() => startEdit(rule)} className="text-[11px] text-nm-text-3 hover:text-nm-accent flex-shrink-0">
                Edit
              </button>
              <button onClick={() => deleteRule(rule.id)} className="text-[11px] text-nm-text-3 hover:text-red-500 flex-shrink-0">
                Delete
              </button>
            </div>
          ))}

          {editingId ? (
            <div className="mt-2 rounded border border-nm-accent p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-nm-text-3">Token (blank = always matches)</span>
                  <input
                    value={draft.token}
                    onChange={(e) => setDraft((d) => ({ ...d, token: e.target.value }))}
                    placeholder="e.g. SM57"
                    className="px-2 py-1 text-xs rounded border border-field-bd bg-field-bg text-nm-text"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-nm-text-3">Match in</span>
                  <select
                    value={draft.matchIn}
                    onChange={(e) => setDraft((d) => ({ ...d, matchIn: e.target.value as IrMetadataSuggestRule['matchIn'] }))}
                    className="px-2 py-1 text-xs rounded border border-field-bd bg-field-bg text-nm-text"
                  >
                    {MATCH_IN_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-nm-text-3">Match type</span>
                  <select
                    value={draft.matchType}
                    onChange={(e) => setDraft((d) => ({ ...d, matchType: e.target.value as IrMetadataSuggestRule['matchType'] }))}
                    className="px-2 py-1 text-xs rounded border border-field-bd bg-field-bg text-nm-text"
                  >
                    {MATCH_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] text-nm-text-3">Field</span>
                  <select
                    value={draft.field}
                    onChange={(e) => setDraft((d) => ({ ...d, field: e.target.value as IrMetadataSuggestField }))}
                    className="px-2 py-1 text-xs rounded border border-field-bd bg-field-bg text-nm-text"
                  >
                    {IR_METADATA_SUGGEST_FIELD_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="col-span-2 flex flex-col gap-1">
                  <span className="text-[11px] text-nm-text-3">
                    Value {draft.matchType === 'prefix_value' && '(use {value} for the extracted number, {match} for the whole match)'}
                  </span>
                  <input
                    value={draft.value}
                    onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))}
                    placeholder={draft.matchType === 'prefix_value' ? 'e.g. {value}in' : 'e.g. Shure SM57'}
                    className="px-2 py-1 text-xs rounded border border-field-bd bg-field-bg text-nm-text font-mono"
                  />
                </label>
                <label className="flex items-center gap-1.5 col-span-2">
                  <input
                    type="checkbox"
                    checked={draft.overwriteExisting}
                    onChange={(e) => setDraft((d) => ({ ...d, overwriteExisting: e.target.checked }))}
                  />
                  <span className="text-[11px] text-nm-text-2">Overwrite an existing value (default: only fill blanks)</span>
                </label>
              </div>

              <div className="rounded bg-field-bg border border-field-bd px-2 py-1.5">
                <div className="text-[10px] text-nm-text-3 uppercase tracking-wide mb-1">Test against an example filename</div>
                <input
                  value={testFilename}
                  onChange={(e) => setTestFilename(e.target.value)}
                  className="w-full px-2 py-1 text-xs rounded border border-field-bd bg-panel text-nm-text font-mono mb-1"
                />
                <div className="text-[11px]">
                  {testSuggestion ? (
                    <span className="text-nm-accent">
                      Matches → {IR_METADATA_SUGGEST_FIELD_OPTIONS.find((f) => f.value === testSuggestion.field)?.label} ={' '}
                      &ldquo;{testSuggestion.value}&rdquo;
                    </span>
                  ) : (
                    <span className="text-nm-text-3">No match against this example.</span>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button onClick={cancelEdit} className="px-3 py-1.5 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov">
                  Cancel
                </button>
                <button
                  onClick={saveDraft}
                  disabled={!draft.value.trim()}
                  className="px-3 py-1.5 text-xs rounded bg-nm-accent text-accent-fg hover:opacity-90 disabled:opacity-50"
                >
                  {editingId === 'new' ? 'Add Rule' : 'Save Rule'}
                </button>
              </div>
            </div>
          ) : (
            <button onClick={startAdd} className="mt-2 px-3 py-1.5 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov">
              + Add Rule
            </button>
          )}
        </div>

        <div className="px-4 py-3 border-t border-nm-border-s flex justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded bg-nm-accent text-accent-fg hover:opacity-90">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
