import { useEffect, useState } from 'react'

/**
 * Read Me tab (plan section 8 / 8a) — reuses NAM Lab's existing generic, path-based
 * `window.api.readReadme`/`writeReadme` (no new backend). Styled with design tokens rather than
 * copied from `FolderReadmePanel.tsx` (that component hardcodes Tailwind grays/blues, which IR
 * mode's UI pass has moved away from — plan section 12 Phase 6).
 */
export function IrReadMeTab({ absPath }: { absPath: string | null }): React.ReactElement {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [exists, setExists] = useState(false)
  const [fileName, setFileName] = useState('README.txt')
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!absPath) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setEditing(false)
    setError(null)
    window.api.readReadme(absPath).then((res) => {
      if (cancelled) return
      if (!res.success) {
        setError(res.error ?? 'Could not load README.txt')
      } else {
        setExists(res.exists)
        setFileName(res.fileName || 'README.txt')
        setContent(res.content || '')
        setSavedContent(res.content || '')
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [absPath])

  if (!absPath) {
    return <div className="p-3 text-xs text-nm-text-3">Select a folder to view or edit its Read Me.</div>
  }

  const dirty = content !== savedContent

  const handleSave = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    const result = await window.api.writeReadme(absPath, fileName || 'README.txt', content)
    setSaving(false)
    if (!result.success) {
      setError(result.error ?? 'Save failed')
      return
    }
    setExists(true)
    setFileName(result.fileName || 'README.txt')
    setSavedContent(content)
    setEditing(false)
  }

  return (
    <div className="p-3 flex flex-col gap-2 h-full overflow-y-auto">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-nm-text truncate">{fileName}</div>
        {editing ? (
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => {
                setContent(savedContent)
                setEditing(false)
                setError(null)
              }}
              className="px-2 py-1 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={saving || !dirty}
              className="px-2 py-1 text-xs rounded bg-nm-accent text-accent-fg hover:opacity-90 disabled:opacity-40"
            >
              {saving ? 'Saving…' : exists ? 'Save' : 'Create'}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="px-2 py-1 text-xs rounded bg-nm-accent text-accent-fg hover:opacity-90 flex-shrink-0"
          >
            {exists ? 'Edit' : 'Create'}
          </button>
        )}
      </div>

      {error && <div className="text-xs text-red-600 dark:text-red-400">{error}</div>}
      {!exists && !editing && !loading && (
        <div className="text-xs text-nm-text-3">No README.txt found in this folder yet.</div>
      )}

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        disabled={!editing || loading}
        placeholder={loading ? 'Loading…' : 'Plain-text notes for this folder…'}
        rows={16}
        className="flex-1 w-full text-xs px-2 py-2 rounded border border-field-bd bg-field-bg resize-y disabled:opacity-70"
      />
    </div>
  )
}
