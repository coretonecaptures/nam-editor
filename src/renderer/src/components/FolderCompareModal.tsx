import { useMemo, useState } from 'react'
import { NamFile } from '../types/nam'

interface Props {
  folderPaths: string[]
  files: NamFile[]
  onClose: () => void
}

type ShowMode = 'all' | 'missing'

function lastSegments(p: string, n: number) {
  const parts = p.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.slice(-n).join('/')
}

function disambiguatedLabel(folderPath: string, allPaths: string[]) {
  const name = lastSegments(folderPath, 1)
  const hasDupe = allPaths.some((p) => p !== folderPath && lastSegments(p, 1) === name)
  return hasDupe ? lastSegments(folderPath, 2) : name
}

function normPath(p: string) {
  return p.replace(/\\/g, '/').replace(/\/$/, '')
}

function inFolder(filePath: string, folderPath: string) {
  const fp = normPath(filePath.replace(/\\/g, '/'))
  const folder = normPath(folderPath)
  return fp.startsWith(folder + '/')
}

export function FolderCompareModal({ folderPaths, files, onClose }: Props) {
  const [showMode, setShowMode] = useState<ShowMode>('all')
  const [search, setSearch] = useState('')

  const { rows, folders } = useMemo(() => {
    const folders = folderPaths.map((p) => normPath(p))

    // Map: normalized capture name → map of folder → files
    const nameMap = new Map<string, Map<string, NamFile[]>>()

    for (const f of files) {
      const folder = folders.find((fp) => inFolder(f.filePath, fp))
      if (!folder) continue
      const captureName = (f.metadata.name?.trim() || f.fileName).toLowerCase()
      if (!nameMap.has(captureName)) nameMap.set(captureName, new Map())
      const byFolder = nameMap.get(captureName)!
      if (!byFolder.has(folder)) byFolder.set(folder, [])
      byFolder.get(folder)!.push(f)
    }

    // Build rows sorted by name
    const rows = Array.from(nameMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, byFolder]) => ({
        name,
        displayName: byFolder.values().next().value?.[0]?.metadata.name?.trim() || name,
        byFolder,
        presentIn: new Set(byFolder.keys()),
        missingFrom: folders.filter((fp) => !byFolder.has(fp)),
      }))

    return { rows, folders }
  }, [folderPaths, files])

  const filtered = useMemo(() => {
    let r = rows
    if (showMode === 'missing') r = r.filter((row) => row.missingFrom.length > 0)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      r = r.filter((row) => row.name.includes(q))
    }
    return r
  }, [rows, showMode, search])

  const missingCount = rows.filter((r) => r.missingFrom.length > 0).length

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-gray-100 dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-300 dark:border-gray-700 w-full max-w-5xl mx-4 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-300 dark:border-gray-700 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Compare Folders</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {rows.length} unique capture{rows.length !== 1 ? 's' : ''} across {folders.length} folders
              {missingCount > 0 && (
                <span className="ml-2 text-amber-500">{missingCount} missing from at least one folder</span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors p-1"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-300 dark:border-gray-700 flex-shrink-0">
          <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600 text-xs">
            <button
              className={`px-3 py-1.5 transition-colors ${showMode === 'all' ? 'bg-indigo-600 text-white' : 'bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-700'}`}
              onClick={() => setShowMode('all')}
            >All ({rows.length})</button>
            <button
              className={`px-3 py-1.5 transition-colors ${showMode === 'missing' ? 'bg-amber-600 text-white' : 'bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-700'}`}
              onClick={() => setShowMode('missing')}
            >Missing ({missingCount})</button>
          </div>
          <input
            type="text"
            placeholder="Search captures…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 text-xs bg-gray-200 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {/* Table */}
        <div className="overflow-auto flex-1">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-200 dark:bg-gray-800 border-b border-gray-300 dark:border-gray-700">
                <th className="text-left px-4 py-2 font-medium text-gray-600 dark:text-gray-400 w-64 min-w-48">
                  Capture Name
                </th>
                {folders.map((fp) => (
                  <th key={fp} className="text-center px-3 py-2 font-medium text-gray-600 dark:text-gray-400 max-w-36 truncate" title={fp}>
                    {disambiguatedLabel(fp, folders)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={folders.length + 1} className="px-4 py-8 text-center text-gray-400">
                    {search ? 'No captures match your search.' : 'All captures are present in all folders.'}
                  </td>
                </tr>
              ) : (
                filtered.map((row) => {
                  const hasMissing = row.missingFrom.length > 0
                  return (
                    <tr
                      key={row.name}
                      className={`border-b border-gray-200 dark:border-gray-800 ${hasMissing ? 'bg-amber-50 dark:bg-amber-950/20' : 'hover:bg-gray-100 dark:hover:bg-gray-800/50'}`}
                    >
                      <td className="px-4 py-2 text-gray-900 dark:text-gray-100 font-medium truncate max-w-64" title={row.displayName}>
                        {row.displayName}
                      </td>
                      {folders.map((fp) => {
                        const present = row.presentIn.has(fp)
                        return (
                          <td key={fp} className="text-center px-3 py-2">
                            {present ? (
                              <span className="text-green-500" title="Present">
                                <svg className="w-4 h-4 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                </svg>
                              </span>
                            ) : (
                              <span className="text-amber-500" title="Missing">
                                <svg className="w-4 h-4 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                                </svg>
                              </span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-300 dark:border-gray-700 flex-shrink-0 text-xs text-gray-500">
          <span>{filtered.length} of {rows.length} shown</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 rounded-lg transition-colors text-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
