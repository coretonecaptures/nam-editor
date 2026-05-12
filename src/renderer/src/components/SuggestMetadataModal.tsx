import { useMemo, useState } from 'react'
import { MetadataSuggestionMatch } from '../utils/metadataSuggest'

interface SuggestMetadataModalProps {
  folderName: string
  matches: MetadataSuggestionMatch[]
  onConfirm: (matches: MetadataSuggestionMatch[]) => void
  onClose: () => void
}

export function SuggestMetadataModal({ folderName, matches, onConfirm, onClose }: SuggestMetadataModalProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(matches.flatMap((match) => match.suggestions.map((suggestion) => suggestion.id)))
  )

  const selectedMatches = useMemo(
    () =>
      matches
        .map((match) => ({
          ...match,
          suggestions: match.suggestions.filter((suggestion) => selectedIds.has(suggestion.id)),
        }))
        .filter((match) => match.suggestions.length > 0),
    [matches, selectedIds]
  )

  const selectedFieldCount = selectedMatches.reduce((sum, match) => sum + match.suggestions.length, 0)
  const selectedFileCount = selectedMatches.length

  const toggleSuggestion = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-4xl mx-4 flex flex-col max-h-[85vh]">
        <div className="px-5 pt-5 pb-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Suggest Metadata</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Folder: {folderName}</p>
        </div>

        <div className="mx-5 mt-4 p-3 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800 rounded-lg flex-shrink-0">
          <p className="text-xs font-semibold text-indigo-800 dark:text-indigo-300 mb-1">Preview first, then apply</p>
          <p className="text-xs text-indigo-700 dark:text-indigo-400">
            Suggestions are written directly into the <code>.nam</code> files on disk when you apply them. Overwrite rules are highlighted and show the current value they will replace.
          </p>
        </div>

        <div className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap flex-shrink-0">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            <span className="font-semibold text-teal-600 dark:text-teal-400">{selectedFileCount}</span> file{selectedFileCount !== 1 ? 's' : ''} with{' '}
            <span className="font-semibold text-teal-600 dark:text-teal-400">{selectedFieldCount}</span> selected suggestion{selectedFieldCount !== 1 ? 's' : ''}
          </p>
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => setSelectedIds(new Set(matches.flatMap((match) => match.suggestions.map((suggestion) => suggestion.id))))}
              className="px-2.5 py-1 rounded border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              Select all
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="px-2.5 py-1 rounded border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              Clear all
            </button>
          </div>
        </div>

        <div className="px-5 pb-5 flex-1 overflow-y-auto">
          <div className="space-y-3">
            {matches.map((match) => {
              const pathLabel = match.file.filePath.replace(/\\/g, '/').split('/').slice(-2).join('/')
              return (
                <div key={match.file.filePath} className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/30 overflow-hidden">
                  <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {match.file.metadata.name || match.file.fileName.replace(/\.nam$/i, '')}
                    </div>
                    <div className="text-[11px] text-gray-500 dark:text-gray-500 mt-0.5">{pathLabel}</div>
                  </div>
                  <div className="divide-y divide-gray-200 dark:divide-gray-800">
                    {match.suggestions.map((suggestion) => (
                      <label key={suggestion.id} className={`flex items-start gap-3 px-3 py-2 cursor-pointer select-none transition-colors ${suggestion.overwriteExisting ? 'bg-amber-50/70 dark:bg-amber-900/10 hover:bg-amber-100/70 dark:hover:bg-amber-900/20' : 'hover:bg-gray-100/70 dark:hover:bg-gray-800/40'}`}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(suggestion.id)}
                          onChange={() => toggleSuggestion(suggestion.id)}
                          className="mt-0.5 accent-teal-600"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{suggestion.label}</span>
                            <span className="text-[11px] px-1.5 py-0.5 rounded bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 font-medium">
                              {suggestion.value}
                            </span>
                            {suggestion.overwriteExisting && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-400/60 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 font-semibold uppercase tracking-wide">
                                Overwrite
                              </span>
                            )}
                          </div>
                          {suggestion.overwriteExisting && suggestion.currentValue !== undefined && (
                            <div className="text-[11px] text-amber-700 dark:text-amber-300 mt-1">
                              Replacing current value: <span className="font-medium">{suggestion.currentValue}</span>
                            </div>
                          )}
                          <div className="text-[11px] text-gray-500 dark:text-gray-500 mt-1">{suggestion.reason}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
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
            onClick={() => onConfirm(selectedMatches)}
            disabled={selectedFieldCount === 0}
            className="px-4 py-1.5 text-sm rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Apply {selectedFieldCount} suggestion{selectedFieldCount !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
