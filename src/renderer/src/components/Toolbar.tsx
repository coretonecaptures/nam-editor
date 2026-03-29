import React from 'react'

interface ToolbarProps {
  onOpenFiles: () => void
  onOpenFolder: () => void
  onSaveAll: () => void
  dirtyCount: number
  batchMode: boolean
  onToggleBatch: () => void
  fileCount: number
  unnamedCount: number
  isMac: boolean
  showSettings: boolean
  onToggleSettings: () => void
  onNameFromFilename: () => void
  onCloseAll: () => void
  rootFolder: string | null
  onRefresh: () => void
}

export function Toolbar({
  onOpenFiles,
  onOpenFolder,
  onSaveAll,
  dirtyCount,
  batchMode,
  onToggleBatch,
  fileCount,
  unnamedCount,
  isMac,
  showSettings,
  onToggleSettings,
  onNameFromFilename,
  onCloseAll,
  rootFolder,
  onRefresh
}: ToolbarProps) {
  return (
    <div
      className="h-12 flex items-center gap-2 px-4 bg-gray-900 border-b border-gray-800 flex-shrink-0"
      style={{ paddingLeft: isMac ? '80px' : '16px', paddingRight: isMac ? '16px' : '150px', WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* App title */}
      <div className="flex items-center gap-2 mr-4">
        <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
        </svg>
        <span className="text-sm font-semibold text-gray-300">NAM Editor</span>
      </div>

      <div className="w-px h-5 bg-gray-700" />

      <button
        onClick={onOpenFiles}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Open Files
      </button>

      <button
        onClick={onOpenFolder}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
        Open Folder
      </button>

      {fileCount > 0 && (
        <button
          onClick={onCloseAll}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-gray-800 hover:bg-red-900/60 text-gray-300 hover:text-red-300 transition-colors"
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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title="Rescan folder for new or removed files"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      )}

      <div className="w-px h-5 bg-gray-700" />

      <button
        onClick={onSaveAll}
        disabled={dirtyCount === 0}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-indigo-700 hover:bg-indigo-600 disabled:hover:bg-indigo-700 text-white"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
        </svg>
        Save All
        {dirtyCount > 0 && (
          <span className="ml-1 bg-white/20 text-white text-xs px-1.5 py-0.5 rounded-full">
            {dirtyCount}
          </span>
        )}
      </button>

      {fileCount > 0 && (
        <>
          <div className="w-px h-5 bg-gray-700" />
          <button
            onClick={onToggleBatch}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              batchMode
                ? 'bg-amber-700 hover:bg-amber-600 text-white'
                : 'bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white'
            }`}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
            </svg>
            {batchMode ? 'Exit Batch' : 'Batch Edit'}
          </button>
        </>
      )}

      {unnamedCount > 0 && (
        <>
          <div className="w-px h-5 bg-gray-700" />
          <button
            onClick={onNameFromFilename}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white"
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

      <div className="w-px h-5 bg-gray-700" />
      <button
        onClick={onToggleSettings}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
          showSettings
            ? 'bg-gray-600 hover:bg-gray-500 text-white'
            : 'bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white'
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
