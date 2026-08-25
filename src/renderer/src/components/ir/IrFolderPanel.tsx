import { useCallback, useEffect, useState } from 'react'

type FolderDetail = {
  id: number
  relativePath: string
  notes: string | null
  declared: Array<{ field: string; value: string; source: string }>
  documents: Array<{ id: number; folder_id: number; stored_path: string; original_filename: string | null; imported_at: string }>
}

const FIELDS = ['manufacturer', 'cabinet', 'speaker', 'microphone'] as const

/**
 * Folder-level metadata editor — docs/ir-lab-manager-build-plan.md section 12 Phase 5's
 * folder-notes UI, the part backend work alone couldn't finish. Edits here always write with
 * source='user_entered' (the confidence ladder's protected tier, section 3) — this panel is a
 * human declaring a fact, not a parser guessing one, and a hand-typed value here is never
 * overwritten by a rescan per that tier's rule.
 *
 * `notes` (free prose) is a plain `folder` column, saved separately from the structured fields
 * (`folder_metadata`, inheritable/confidence-ranked) — see folderMetadata.ts.
 */
export function IrFolderPanel({ folderId }: { folderId: number | null }): React.ReactElement {
  const [detail, setDetail] = useState<FolderDetail | null>(null)
  const [notesDraft, setNotesDraft] = useState('')
  const [fieldDrafts, setFieldDrafts] = useState<Record<string, string>>({})
  const [importing, setImporting] = useState(false)

  const reload = useCallback(() => {
    if (folderId == null) {
      setDetail(null)
      return
    }
    window.api.irLibraryGetFolderDetail(folderId).then((d) => {
      setDetail(d)
      setNotesDraft(d?.notes ?? '')
      const drafts: Record<string, string> = {}
      for (const f of d?.declared ?? []) drafts[f.field] = f.value
      setFieldDrafts(drafts)
    })
  }, [folderId])

  useEffect(() => {
    reload()
  }, [reload])

  const saveNotes = useCallback(() => {
    if (folderId == null) return
    window.api.irLibrarySetFolderNotes(folderId, notesDraft)
  }, [folderId, notesDraft])

  const saveField = useCallback(
    (field: string) => {
      if (folderId == null) return
      const value = (fieldDrafts[field] ?? '').trim()
      if (value) {
        window.api.irLibrarySetFolderMetadata(folderId, field, value, 'user_entered').then(reload)
      } else {
        window.api.irLibraryRemoveFolderMetadata(folderId, field).then(reload)
      }
    },
    [folderId, fieldDrafts, reload]
  )

  const addDocument = useCallback(async () => {
    if (folderId == null) return
    setImporting(true)
    try {
      await window.api.irLibraryImportFolderDocument(folderId)
      reload()
    } finally {
      setImporting(false)
    }
  }, [folderId, reload])

  const removeDocument = useCallback(
    (documentId: number) => {
      window.api.irLibraryDeleteFolderDocument(documentId).then(reload)
    },
    [reload]
  )

  if (folderId == null || !detail) {
    return <div className="p-3 text-xs text-gray-400 dark:text-gray-600">Select a folder to view or edit its metadata.</div>
  }

  return (
    <div className="p-3 flex flex-col gap-3 overflow-y-auto">
      <div className="text-sm font-medium truncate" title={detail.relativePath}>
        {detail.relativePath.split('/').pop() || detail.relativePath}
      </div>

      <div>
        <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Notes</label>
        <textarea
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          onBlur={saveNotes}
          rows={3}
          className="w-full text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
        />
      </div>

      <div className="flex flex-col gap-2">
        {FIELDS.map((field) => (
          <div key={field}>
            <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1 capitalize">{field}</label>
            <input
              value={fieldDrafts[field] ?? ''}
              onChange={(e) => setFieldDrafts((d) => ({ ...d, [field]: e.target.value }))}
              onBlur={() => saveField(field)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
              placeholder="Applies to every item in this folder and below"
              className="w-full text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900"
            />
          </div>
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-gray-500 dark:text-gray-400">Vendor documents</label>
          <button
            onClick={addDocument}
            disabled={importing}
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
          >
            {importing ? 'Adding…' : '+ Add PDF/CSV'}
          </button>
        </div>
        {detail.documents.length === 0 ? (
          <div className="text-xs text-gray-400 dark:text-gray-600">None yet.</div>
        ) : (
          <ul className="flex flex-col gap-1">
            {detail.documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between text-xs">
                <span className="truncate" title={doc.original_filename ?? undefined}>
                  {doc.original_filename ?? '(unnamed)'}
                </span>
                <button
                  onClick={() => removeDocument(doc.id)}
                  className="text-gray-400 hover:text-red-500 flex-shrink-0 ml-2"
                  title="Remove"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
