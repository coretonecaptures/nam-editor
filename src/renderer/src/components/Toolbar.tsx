import React, { useRef, useState, useEffect } from 'react'

interface ToolbarProps {
  onOpenFiles: () => void
  onOpenFolder: () => void
  onSaveAll: () => void
  dirtyCount: number
  fileCount: number
  unnamedCount: number
  isMac: boolean
  showSettings: boolean
  onToggleSettings: () => void
  onNameFromFilename: () => void
  onCloseAll: () => void
  rootFolder: string | null
  onRefresh: () => void
  recentFolders: string[]
  onOpenRecentFolder: (path: string) => void
  onFindDuplicates?: () => void
  showDashboard?: boolean
  dashboardActive?: boolean
  onToggleDashboard?: () => void
}

export function Toolbar({
  onOpenFiles,
  onOpenFolder,
  onSaveAll,
  dirtyCount,
  fileCount,
  unnamedCount,
  isMac,
  showSettings,
  onToggleSettings,
  onNameFromFilename,
  onCloseAll,
  rootFolder,
  onRefresh,
  recentFolders,
  onOpenRecentFolder,
  onFindDuplicates,
  showDashboard = false,
  dashboardActive = false,
  onToggleDashboard,
}: ToolbarProps) {
  const [showRecent, setShowRecent] = useState(false)
  const recentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showRecent) return
    const handler = (e: MouseEvent) => {
      if (recentRef.current && !recentRef.current.contains(e.target as Node)) setShowRecent(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [showRecent])
  return (
    <div
      className="h-12 flex items-center gap-2 px-4 bg-gray-100 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex-shrink-0"
      style={{ paddingLeft: isMac ? '80px' : '16px', paddingRight: isMac ? '16px' : '150px', WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* App title */}
      <div className="flex items-center gap-2 mr-4">
        <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12h2m0 0V9m0 3v3m4-7v8m0-8v8m4-11v14m0-14v14m4-9v4m0-4v4m4-7v10" />
        </svg>
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">NAM Lab</span>
      </div>

      <div className="w-px h-5 bg-gray-300 dark:bg-gray-700" />

      <button
        onClick={onOpenFiles}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Open Files
      </button>

      <button
        onClick={onOpenFolder}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-l-md text-xs font-medium bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        Open Folder
      </button>
      <div ref={recentRef} className="relative" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          onClick={() => setShowRecent((v) => !v)}
          disabled={recentFolders.length === 0}
          className="flex items-center px-1.5 py-1.5 rounded-r-md text-xs font-medium bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors border-l border-gray-300 dark:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Recent folders"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showRecent && (
          <div className="absolute left-0 top-full mt-1 w-80 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 py-1">
            <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
              Recent Folders
            </div>
            {recentFolders.map((folder) => {
              const name = folder.replace(/\\/g, '/').split('/').pop() ?? folder
              return (
                <button
                  key={folder}
                  onClick={() => { setShowRecent(false); onOpenRecentFolder(folder) }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  title={folder}
                >
                  <div className="font-medium text-gray-700 dark:text-gray-300 truncate">{name}</div>
                  <div className="text-xs text-gray-400 dark:text-gray-600 truncate">{folder}</div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {fileCount > 0 && (
        <button
          onClick={onCloseAll}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-gray-200 dark:bg-gray-800 hover:bg-red-900/60 text-gray-700 dark:text-gray-300 hover:text-red-300 transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title="Close all files"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          Close All
        </button>
      )}

      {rootFolder && (
        <button
          onClick={onRefresh}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title="Rescan folder for new or removed files"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      )}

      {onFindDuplicates && fileCount > 1 && (
        <button
          onClick={onFindDuplicates}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title="Find duplicate .nam files across your library"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          Duplicates
        </button>
      )}

      <div className="w-px h-5 bg-gray-300 dark:bg-gray-700" />

      <button
        onClick={onSaveAll}
        disabled={dirtyCount === 0}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-indigo-700 hover:bg-indigo-600 disabled:hover:bg-indigo-700 text-white"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
        </svg>
        {dirtyCount > 1 ? 'Save All' : 'Save'}
        {dirtyCount > 0 && (
          <span className="ml-1 bg-white/20 text-white text-xs px-1.5 py-0.5 rounded-full">
            {dirtyCount}
          </span>
        )}
      </button>


      {unnamedCount > 0 && (
        <>
          <div className="w-px h-5 bg-gray-300 dark:bg-gray-700" />
          <button
            onClick={onNameFromFilename}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            title={`Set capture name from filename for ${unnamedCount} unnamed file${unnamedCount !== 1 ? 's' : ''}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
            Name from File ({unnamedCount})
          </button>
        </>
      )}

      <div className="flex-1" />

      {showDashboard && onToggleDashboard && (
        <>
          <div className="w-px h-5 bg-gray-300 dark:bg-gray-700" />
          <button
            onClick={onToggleDashboard}
            title="Library overview"
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              dashboardActive
                ? 'bg-teal-600 hover:bg-teal-500 text-white'
                : 'bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
            }`}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Overview
          </button>
        </>
      )}

      <div className="w-px h-5 bg-gray-300 dark:bg-gray-700" />
      <button
        onClick={onToggleSettings}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
          showSettings
            ? 'bg-gray-400 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-gray-900 dark:text-white'
            : 'bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
        }`}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        Settings
      </button>
    </div>
  )
}
