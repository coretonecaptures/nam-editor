import { useEffect, useState } from 'react'

interface Props {
  folderPath: string
  folderName: string
}

export function FolderReadmePanel({ folderPath, folderName }: Props) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [exists, setExists] = useState(false)
  const [fileName, setFileName] = useState('README.txt')
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setEditing(false)
    setError(null)
    setStatus(null)
    window.api.readReadme(folderPath).then((res) => {
      if (cancelled) return
      if (!res.success) {
        setError(res.error ?? 'Could not load README.txt')
        setExists(false)
        setFileName('README.txt')
        setContent('')
        setSavedContent('')
      } else {
        setExists(res.exists)
        setFileName(res.fileName || 'README.txt')
        setContent(res.content || '')
        setSavedContent(res.content || '')
      }
      setLoading(false)
    }).catch((err) => {
      if (cancelled) return
      setError(String(err))
      setExists(false)
      setFileName('README.txt')
      setContent('')
      setSavedContent('')
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [folderPath])

  const dirty = content !== savedContent

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    setStatus(null)
    const result = await window.api.writeReadme(folderPath, fileName || 'README.txt', content)
    setSaving(false)
    if (!result.success) {
      setError(result.error ?? 'Save failed')
      return
    }
    const nextFileName = result.fileName || 'README.txt'
    setExists(true)
    setFileName(nextFileName)
    setSavedContent(content)
    setEditing(false)
    setStatus(`${nextFileName} saved for ${folderName}`)
  }

  const showNativeTextContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    const selection = window.getSelection()?.toString().trim() ?? ''
    const target = event.target as HTMLElement | null
    const isEditable = !!target?.closest('input, textarea, [contenteditable="true"]')
    if (!selection && !isEditable) return
    event.preventDefault()
    void window.api.showTextContextMenu({ hasSelection: !!selection, isEditable })
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-3">
      <div className="max-w-5xl space-y-4">
        <div className="rounded-lg border border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-950/20 px-4 py-3">
          <p className="text-sm font-medium text-blue-900 dark:text-blue-200">Folder Read Me</p>
          <p className="mt-1 text-xs leading-relaxed text-blue-800/80 dark:text-blue-300/80">
            Readmes are usually only distributed in the root folder, but you can keep a plain-text README in any folder when needed.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-blue-800/70 dark:text-blue-300/70">
            NAM Lab looks for plain-text files ending in <code className="px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40">.txt</code> whose filename contains <code className="px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40">README</code>. The preferred convention is <code className="px-1 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40">README.txt</code>.
          </p>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">{fileName || 'README.txt'}</p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {exists ? 'Loaded from this folder' : 'No README.txt found in this folder yet'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <button
                  onClick={() => {
                    setContent(savedContent)
                    setEditing(false)
                    setError(null)
                    setStatus(null)
                  }}
                  className="px-3 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { void handleSave() }}
                  disabled={saving || !dirty}
                  className={`px-3 py-1.5 text-xs rounded text-white transition-colors ${saving || !dirty ? 'bg-teal-600/50 cursor-default' : 'bg-teal-600 hover:bg-teal-700'}`}
                >
                  {saving ? 'Saving...' : exists ? 'Save Read Me' : 'Create Read Me'}
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  setEditing(true)
                  setError(null)
                  setStatus(null)
                }}
                className="px-3 py-1.5 text-xs rounded bg-teal-600 hover:bg-teal-700 text-white transition-colors"
              >
                {exists ? 'Edit Read Me' : 'Create Read Me'}
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="rounded border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
        {status && (
          <div className="rounded border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/20 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
            {status}
          </div>
        )}

        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onContextMenu={showNativeTextContextMenu}
          disabled={!editing || loading}
          placeholder={loading ? 'Loading README...' : 'Add plain-text release notes, install notes, or folder-specific details here...'}
          rows={22}
          className={`w-full rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-3 text-sm leading-relaxed bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-teal-500 resize-y min-h-[420px] ${!editing ? 'opacity-80 cursor-default' : ''}`}
        />
      </div>
    </div>
  )
}
