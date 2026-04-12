import { useState, useEffect, useRef } from 'react'
import { NamFile } from '../types/nam'

type Mode = 'suffix' | 'prefix' | 'find-replace' | 'template'

interface Props {
  files: NamFile[]         // the selected files (in display order)
  onApply: (renames: { filePath: string; newBaseName: string }[]) => void
  onClose: () => void
}

const TOKEN_HINT = '{name} {gear_make} {gear_model} {gear_type} {tone_type} {modeled_by}'

function applyTemplate(template: string, file: NamFile): string {
  const m = file.metadata
  return template
    .replace(/\{name\}/g,        m.name        || file.fileName)
    .replace(/\{gear_make\}/g,   m.gear_make   || '')
    .replace(/\{gear_model\}/g,  m.gear_model  || '')
    .replace(/\{gear_type\}/g,   m.gear_type   || '')
    .replace(/\{tone_type\}/g,   m.tone_type   || '')
    .replace(/\{modeled_by\}/g,  m.modeled_by  || '')
    .trim()
}

function computeNewName(mode: Mode, file: NamFile, a: string, b: string): string {
  const base = file.fileName
  switch (mode) {
    case 'suffix':       return a ? `${base} ${a}`.trim() : base
    case 'prefix':       return a ? `${a} ${base}`.trim() : base
    case 'find-replace': return a ? base.replaceAll(a, b) : base
    case 'template':     return a ? applyTemplate(a, file) : base
  }
}

export function BatchRenameModal({ files, onApply, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('suffix')
  const [inputA, setInputA] = useState('')
  const [inputB, setInputB] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [mode])

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const previews = files.map((f) => ({
    filePath: f.filePath,
    oldName: f.fileName,
    newName: computeNewName(mode, f, inputA, inputB)
  }))

  // Conflicts are scoped per-directory: same new name in the same folder is a conflict,
  // but identical names across different folders are fine (rename is always in-place)
  const dirNameCounts = new Map<string, number>()
  for (const p of previews) {
    const dir = p.filePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
    const key = `${dir}::${p.newName}`
    dirNameCounts.set(key, (dirNameCounts.get(key) ?? 0) + 1)
  }
  const conflictKeys = new Set(
    [...dirNameCounts.entries()].filter(([, count]) => count > 1).map(([key]) => key)
  )

  const unchanged = previews.filter((p) => p.newName === p.oldName)
  const hasChanges = unchanged.length < previews.length
  const hasConflicts = conflictKeys.size > 0

  const handleApply = () => {
    const toRename = previews.filter((p) => p.newName !== p.oldName && p.newName.trim() !== '')
    if (toRename.length === 0) return
    onApply(toRename.map((p) => ({ filePath: p.filePath, newBaseName: p.newName })))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded-xl shadow-2xl w-[520px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Rename {files.length} file{files.length !== 1 ? 's' : ''}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
          {(['suffix', 'prefix', 'find-replace', 'template'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setInputA(''); setInputB('') }}
              className={`px-4 py-2.5 text-xs font-medium transition-colors capitalize ${
                mode === m
                  ? 'border-b-2 border-indigo-500 text-indigo-600 dark:text-indigo-400'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {m === 'find-replace' ? 'Find & Replace' : m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        {/* Inputs */}
        <div className="px-5 py-4 flex-shrink-0 space-y-2.5">
          {mode === 'suffix' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 w-16 text-right flex-shrink-0">Add after</span>
              <input
                ref={inputRef}
                type="text"
                value={inputA}
                onChange={(e) => setInputA(e.target.value)}
                placeholder="e.g. REVxSTD"
                className="flex-1 px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>
          )}
          {mode === 'prefix' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 w-16 text-right flex-shrink-0">Add before</span>
              <input
                ref={inputRef}
                type="text"
                value={inputA}
                onChange={(e) => setInputA(e.target.value)}
                placeholder="e.g. 2025 -"
                className="flex-1 px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>
          )}
          {mode === 'find-replace' && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-16 text-right flex-shrink-0">Find</span>
                <input
                  ref={inputRef}
                  type="text"
                  value={inputA}
                  onChange={(e) => setInputA(e.target.value)}
                  placeholder="text to find"
                  className="flex-1 px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-16 text-right flex-shrink-0">Replace</span>
                <input
                  type="text"
                  value={inputB}
                  onChange={(e) => setInputB(e.target.value)}
                  placeholder="replacement (blank to delete)"
                  className="flex-1 px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>
            </>
          )}
          {mode === 'template' && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 w-16 text-right flex-shrink-0">Template</span>
                <input
                  ref={inputRef}
                  type="text"
                  value={inputA}
                  onChange={(e) => setInputA(e.target.value)}
                  placeholder="{gear_make} {gear_model} - {name}"
                  className="flex-1 px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:border-indigo-500 font-mono"
                />
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 pl-[72px]">{TOKEN_HINT}</p>
            </div>
          )}
        </div>

        {/* Preview list */}
        <div className="flex-1 overflow-y-auto border-t border-gray-200 dark:border-gray-800 min-h-0">
          <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Preview</span>
            {hasConflicts && (
              <span className="text-xs text-red-500 font-medium">Duplicate names detected</span>
            )}
            {!hasConflicts && !hasChanges && inputA && (
              <span className="text-xs text-gray-400">No changes</span>
            )}
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {previews.map((p) => {
              const changed = p.newName !== p.oldName
              const dir = p.filePath.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
              const isConflict = conflictKeys.has(`${dir}::${p.newName}`) && changed
              const isEmpty = p.newName.trim() === ''
              return (
                <div key={p.filePath} className={`px-4 py-2 ${isConflict || isEmpty ? 'bg-red-50 dark:bg-red-900/10' : ''}`}>
                  <div className="text-xs text-gray-400 dark:text-gray-500 truncate">{p.oldName}</div>
                  <div className={`text-xs font-medium truncate mt-0.5 ${
                    isEmpty ? 'text-red-500'
                    : isConflict ? 'text-red-500'
                    : changed ? 'text-indigo-600 dark:text-indigo-400'
                    : 'text-gray-400 dark:text-gray-600'
                  }`}>
                    {isEmpty ? '(empty — will be skipped)' : isConflict ? `${p.newName} ⚠ duplicate` : p.newName}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5 border-t border-gray-200 dark:border-gray-800 flex-shrink-0">
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {hasChanges
              ? `${previews.filter((p) => p.newName !== p.oldName && p.newName.trim() !== '').length} file${previews.filter((p) => p.newName !== p.oldName && p.newName.trim() !== '').length !== 1 ? 's' : ''} will be renamed`
              : 'No changes'}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={!hasChanges || hasConflicts}
              className="px-4 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Rename
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
