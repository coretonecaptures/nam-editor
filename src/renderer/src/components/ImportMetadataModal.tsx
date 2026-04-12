import { useState } from 'react'
import { NamFile } from '../types/nam'

export interface ImportMatch {
  file: NamFile
  incoming: Partial<NamFile['metadata']>
  changedFields: string[]
}

interface ImportMetadataModalProps {
  folderName: string
  matches: ImportMatch[]
  unmatchedNames: string[]
  onConfirm: () => void
  onClose: () => void
}

export function ImportMetadataModal({ folderName, matches, unmatchedNames, onConfirm, onClose }: ImportMetadataModalProps) {
  const [understood, setUnderstood] = useState(false)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="px-5 pt-5 pb-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Import Metadata</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Folder: {folderName}</p>
        </div>

        {/* Warning */}
        <div className="mx-5 mt-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700 rounded-lg flex-shrink-0">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-400 mb-1">⚠ This action cannot be undone</p>
          <p className="text-xs text-amber-700 dark:text-amber-500">
            All non-empty cells in the spreadsheet will overwrite the matching capture's metadata on disk.
            Empty cells are skipped — existing values are kept.
            Read-only fields (NAM-BOT Preset, ESR, etc.) are ignored even if present.
          </p>
        </div>

        {/* Match summary */}
        <div className="px-5 py-3 flex-shrink-0">
          <p className="text-sm text-gray-800 dark:text-gray-200">
            <span className="font-semibold text-teal-600 dark:text-teal-400">{matches.length} capture{matches.length !== 1 ? 's' : ''}</span> matched and will be updated.
          </p>
          {unmatchedNames.length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                {unmatchedNames.length} row{unmatchedNames.length !== 1 ? 's' : ''} had no matching capture (will be skipped):
              </p>
              <div className="max-h-20 overflow-y-auto bg-gray-100 dark:bg-gray-800 rounded p-2">
                {unmatchedNames.map((n) => (
                  <p key={n} className="text-xs text-gray-500 dark:text-gray-400 font-mono">{n}</p>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Checkbox */}
        <div className="px-5 pb-3 flex-shrink-0">
          <label className="flex items-start gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={understood}
              onChange={(e) => setUnderstood(e.target.checked)}
              className="mt-0.5 accent-teal-600"
            />
            <span className="text-xs text-gray-700 dark:text-gray-300">
              I understand this will overwrite metadata for {matches.length} capture{matches.length !== 1 ? 's' : ''} on disk and cannot be undone.
            </span>
          </label>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!understood || matches.length === 0}
            className="px-4 py-1.5 text-sm rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Import {matches.length} capture{matches.length !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
