import { useEffect, useMemo, useState } from 'react'
import { IrMetadataSuggestRule } from '../../types/settings'
import { buildIrMetadataSuggestionMatches, IrSuggestionTarget } from '../../utils/irMetadataSuggest'

/**
 * Runs the metadata suggestion rule library against a folder scope and previews the result before
 * anything is written — same preview-then-apply discipline as `IrLibraryCleanupModal`/
 * `IrSpreadsheetImportModal`. Applying reuses the ordinary `irLibrarySetItemMetadata` channel (the
 * same 'user_entered' write every other manual edit in this app goes through), so a suggestion
 * accepted here is indistinguishable afterward from one typed by hand — including being
 * unconditionally protected from a later automated rescan.
 */
export function IrApplySuggestionsModal({
  libraryRootId,
  folderId,
  scopeLabel,
  rules,
  onClose,
  onApplied
}: {
  libraryRootId: number | null
  folderId: number | null
  scopeLabel: string
  rules: IrMetadataSuggestRule[]
  onClose: () => void
  onApplied: () => void
}): React.ReactElement {
  const [loading, setLoading] = useState(true)
  const [truncated, setTruncated] = useState(false)
  const [targets, setTargets] = useState<IrSuggestionTarget[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [applying, setApplying] = useState(false)
  const [resultMessage, setResultMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.irLibraryQueryItemsForSuggestions({ libraryRootId, folderId }).then(({ rows, truncated: t }) => {
      if (cancelled) return
      setTargets(
        rows.map((r) => ({
          itemId: r.id,
          displayName: r.display_name,
          relativePath: r.relative_path,
          currentValues: { manufacturer: r.manufacturer, cabinet: r.cabinet, speaker: r.speaker, microphone: r.microphone, position: r.position }
        }))
      )
      setTruncated(t)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [libraryRootId, folderId])

  const matches = useMemo(() => buildIrMetadataSuggestionMatches(targets, rules), [targets, rules])
  const allKeys = useMemo(
    () => matches.flatMap((m) => m.suggestions.map((s) => `${m.target.itemId}::${s.field}`)),
    [matches]
  )

  // Default every suggestion to checked once the match set changes (rules/scope loaded).
  useEffect(() => {
    setChecked(new Set(allKeys))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches.length])

  const toggle = (key: string): void => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const apply = async (): Promise<void> => {
    setApplying(true)
    try {
      let applied = 0
      let failed = 0
      for (const match of matches) {
        for (const suggestion of match.suggestions) {
          const key = `${match.target.itemId}::${suggestion.field}`
          if (!checked.has(key)) continue
          const result = await window.api.irLibrarySetItemMetadata(match.target.itemId, suggestion.field, suggestion.value)
          if (result.success) applied++
          else failed++
        }
      }
      setResultMessage(failed === 0 ? `Applied ${applied} suggestion${applied === 1 ? '' : 's'}.` : `Applied ${applied}, ${failed} refused.`)
      onApplied()
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[9990] bg-black/60 flex items-center justify-center" onClick={() => !applying && onClose()}>
      <div className="bg-panel border border-nm-border rounded-xl w-[540px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-nm-border">
          <div className="text-sm font-semibold text-nm-text">Suggest Metadata</div>
          <div className="text-xs text-nm-text-3 mt-0.5">
            Scope: {scopeLabel}
            {truncated && ' (truncated at 5,000 items — narrow the folder for the rest)'}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading ? (
            <div className="text-xs text-nm-text-3">Scanning…</div>
          ) : resultMessage ? (
            <div className="text-xs text-nm-text-2">{resultMessage}</div>
          ) : rules.length === 0 ? (
            <div className="text-xs text-nm-text-3">
              No suggestion rules yet — add some from &ldquo;Manage Suggestion Rules…&rdquo; first.
            </div>
          ) : matches.length === 0 ? (
            <div className="text-xs text-nm-text-3">No rules matched anything in this scope.</div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs text-nm-text-3">
                {allKeys.length} suggestion{allKeys.length === 1 ? '' : 's'} across {matches.length} item{matches.length === 1 ? '' : 's'} —
                uncheck any you don&apos;t want before applying.
              </div>
              {matches.map((match) => (
                <div key={match.target.itemId} className="rounded border border-field-bd p-2">
                  <div className="text-xs font-medium text-nm-text truncate">{match.target.displayName}</div>
                  <div className="mt-1 space-y-1">
                    {match.suggestions.map((s) => {
                      const key = `${match.target.itemId}::${s.field}`
                      return (
                        <label key={key} className="flex items-start gap-2 cursor-pointer">
                          <input type="checkbox" checked={checked.has(key)} onChange={() => toggle(key)} className="mt-0.5 flex-shrink-0" />
                          <div className="text-[11px] text-nm-text-2">
                            <span className="text-nm-text">{s.label}</span> {s.currentValue && <span className="line-through opacity-60">{s.currentValue}</span>}
                            {s.currentValue && ' → '}
                            <span className="font-mono text-nm-accent">{s.value}</span>
                            <div className="text-nm-text-3">{s.reason}</div>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-nm-border-s flex justify-end gap-2">
          <button onClick={onClose} disabled={applying} className="px-3 py-1.5 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov disabled:opacity-50">
            {resultMessage ? 'Close' : 'Cancel'}
          </button>
          {!resultMessage && matches.length > 0 && (
            <button
              onClick={() => void apply()}
              disabled={applying || checked.size === 0}
              className="px-3 py-1.5 text-xs rounded bg-nm-accent text-accent-fg hover:opacity-90 disabled:opacity-50"
            >
              {applying ? 'Applying…' : `Apply ${checked.size} suggestion${checked.size === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
