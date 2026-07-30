import React, { useRef, useState, useEffect } from 'react'

interface ToolbarProps {
  onOpenFiles: () => void
  onOpenFolder: () => void
  onSaveAll: () => void
  saveProgress?: { label: string; completed: number; total: number } | null
  dirtyCount: number
  autoFilledCount: number
  fileCount: number
  unnamedCount: number
  isMac: boolean
  showSettings: boolean
  onToggleSettings: () => void
  onNameFromFilename: () => void
  onClearSuggestionsAll?: () => void
  onCloseAll: () => void
  rootFolder: string | null
  onRefresh: () => void
  recentFolders: string[]
  onOpenRecentFolder: (path: string) => void
  onFindDuplicates?: () => void
  onOpenLibraryCleanup?: () => void
  showExperimentalTraining?: boolean
  onOpenExperimentalTraining?: () => void
  trainingQueueCount?: number
  trainingQueueActive?: boolean
  trainingModelName?: string | null
  onOpenTrainingQueue?: () => void
  onOpenTrainingLive?: () => void
  showDashboard?: boolean
  dashboardActive?: boolean
  onToggleDashboard?: () => void
  historyOpen?: boolean
  onHistoryToggle?: () => void
  companionInboxOpen?: boolean
  companionInboxCount?: number
  onCompanionInboxToggle?: () => void
  toneStoreActive?: boolean
  onToggleToneStore?: () => void
  helpOpen?: boolean
  onOpenHelp?: () => void
  onOpenFeatureHelp?: () => void
  onOpenAbout?: () => void
  cardViewActive?: boolean
  cardViewEnabled?: boolean
  onToggleCardView?: () => void
  homeViewActive?: boolean
  toneMapActive?: boolean
  toneMapEnabled?: boolean
  onToggleToneMap?: () => void
  onGoHomeView?: () => void
}

export function Toolbar({
  onOpenFiles,
  onOpenFolder,
  onSaveAll,
  saveProgress = null,
  dirtyCount,
  autoFilledCount,
  fileCount,
  unnamedCount,
  isMac,
  showSettings,
  onToggleSettings,
  onNameFromFilename,
  onClearSuggestionsAll,
  onCloseAll,
  rootFolder,
  onRefresh,
  recentFolders,
  onOpenRecentFolder,
  onFindDuplicates,
  onOpenLibraryCleanup,
  showExperimentalTraining = false,
  onOpenExperimentalTraining,
  trainingQueueCount = 0,
  trainingQueueActive = false,
  trainingModelName = null,
  onOpenTrainingQueue,
  onOpenTrainingLive,
  showDashboard = false,
  dashboardActive = false,
  onToggleDashboard,
  historyOpen = false,
  onHistoryToggle,
  companionInboxOpen = false,
  companionInboxCount = 0,
  onCompanionInboxToggle,
  toneStoreActive = false,
  onToggleToneStore,
  helpOpen = false,
  onOpenHelp,
  onOpenFeatureHelp,
  onOpenAbout,
  cardViewActive = false,
  cardViewEnabled = false,
  onToggleCardView,
  homeViewActive = false,
  toneMapActive = false,
  toneMapEnabled = false,
  onToggleToneMap,
  onGoHomeView,
}: ToolbarProps) {
  const [showFileMenu, setShowFileMenu] = useState(false)
  const [showActionsMenu, setShowActionsMenu] = useState(false)
  const [showLibraryTools, setShowLibraryTools] = useState(false)
  const [showHelpMenu, setShowHelpMenu] = useState(false)
  const fileMenuRef = useRef<HTMLDivElement>(null)
  const actionsMenuRef = useRef<HTMLDivElement>(null)
  const libraryToolsRef = useRef<HTMLDivElement>(null)
  const helpMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showFileMenu) return
    const handler = (e: MouseEvent) => {
      if (fileMenuRef.current && !fileMenuRef.current.contains(e.target as Node)) setShowFileMenu(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [showFileMenu])

  useEffect(() => {
    if (!showActionsMenu) return
    const handler = (e: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target as Node)) setShowActionsMenu(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [showActionsMenu])

  useEffect(() => {
    if (!showLibraryTools) return
    const handler = (e: MouseEvent) => {
      if (libraryToolsRef.current && !libraryToolsRef.current.contains(e.target as Node)) setShowLibraryTools(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [showLibraryTools])

  useEffect(() => {
    if (!showHelpMenu) return
    const handler = (e: MouseEvent) => {
      if (helpMenuRef.current && !helpMenuRef.current.contains(e.target as Node)) setShowHelpMenu(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [showHelpMenu])
  const saveBusy = !!saveProgress
  return (
    <div
      className="h-12 flex items-center gap-1 flex-shrink-0 border-b relative"
      style={{
        paddingLeft: isMac ? '80px' : '10px',
        paddingRight: isMac ? '10px' : '155px',
        WebkitAppRegion: 'drag',
        background: 'var(--panel-2, #171c22)',
        borderColor: 'var(--border, #242b34)',
      } as React.CSSProperties}
    >
      {/* Training-active indicator &mdash; centered in toolbar, visible from anywhere in the app */}
      {trainingQueueActive && (
        <div
          className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 cursor-pointer select-none"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onClick={onOpenTrainingLive}
          title={"Training in progress \u2014 click to open live run"}
        >
          <span className="w-2 h-2 rounded-full bg-emerald-400 nm-lpulse flex-shrink-0" />
          <span className="text-[11px] font-[580] text-emerald-400 whitespace-nowrap">
            {trainingModelName ? trainingModelName.replace(/\.nam$/i, '').split(/[/\\]/).pop()?.slice(0, 40) || 'Training' : 'Training'}
          </span>
        </div>
      )}
      {/* NAM Lab logo chip */}
      <div className="nam-logo-chip flex items-center gap-2 mr-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <div className="nam-logo-icon">
          <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M3 12h2m0 0V9m0 3v3m4-7v8m0-8v8m4-11v14m0-14v14m4-9v4m0-4v4m4-7v10" />
          </svg>
        </div>
        <span className="nam-logo-name">NAM Lab</span>
      </div>

      <div className="tb-sep-v" />

      <div ref={fileMenuRef} className="relative" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          onClick={() => setShowFileMenu((v) => !v)}
          className="tb-menu-btn"
          title="Open files, folders, and recent locations"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          File
          <svg className="cv w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showFileMenu && (
          <div className="absolute left-0 top-full mt-1 w-80 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 py-1">
            <button
              onClick={() => { setShowFileMenu(false); onOpenFiles() }}
              className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Open Files...
            </button>
            <button
              onClick={() => { setShowFileMenu(false); onOpenFolder() }}
              className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Open Folder...
            </button>
            {recentFolders.length > 0 && (
              <>
                <div className="mx-3 my-1 border-t border-gray-200 dark:border-gray-700" />
                <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Recent Folders
                </div>
                {recentFolders.slice(0, 6).map((folder) => {
                  const name = folder.replace(/\\/g, '/').split('/').pop() ?? folder
                  return (
                    <button
                      key={folder}
                      onClick={() => { setShowFileMenu(false); onOpenRecentFolder(folder) }}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      title={folder}
                    >
                      <div className="font-medium text-gray-700 dark:text-gray-300 truncate">{name}</div>
                      <div className="text-xs text-gray-400 dark:text-gray-600 truncate">{folder}</div>
                    </button>
                  )
                })}
              </>
            )}
            {(fileCount > 0 || rootFolder) && <div className="mx-3 my-1 border-t border-gray-200 dark:border-gray-700" />}
            {fileCount > 0 && (
              <button
                onClick={() => { setShowFileMenu(false); onCloseAll() }}
                className="w-full text-left px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                Close All
              </button>
            )}
          </div>
        )}
      </div>

      {rootFolder && (
        <button
          onClick={onRefresh}
          className="tb-menu-btn"
          title="Refresh the current library folder"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0A8.003 8.003 0 016.227 19" />
          </svg>
          Refresh
        </button>
      )}

      {(onFindDuplicates || onOpenLibraryCleanup || (showExperimentalTraining && onOpenExperimentalTraining)) && (
        <div ref={libraryToolsRef} className="relative" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={() => setShowLibraryTools((v) => !v)}
            className="tb-menu-btn"
            title="Library maintenance tools"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M7 12h10M10 18h4" />
            </svg>
            Library Tools
            <svg className="cv w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showLibraryTools && (
            <div className="absolute left-0 top-full mt-1 w-64 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 py-1">
              <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
                Library Tools
              </div>
              {onFindDuplicates && fileCount > 1 && (
                <button
                  onClick={() => { setShowLibraryTools(false); onFindDuplicates() }}
                  className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Find Duplicates...
                </button>
              )}
              {onOpenLibraryCleanup && (
                <button
                  onClick={() => { setShowLibraryTools(false); onOpenLibraryCleanup() }}
                  className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Clean Up / Build Library...
                </button>
              )}
              {showExperimentalTraining && onOpenExperimentalTraining && (
                <button
                  onClick={() => { setShowLibraryTools(false); onOpenExperimentalTraining() }}
                  className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Training...
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="tb-sep-v" />

      <button
        onClick={onSaveAll}
        disabled={dirtyCount === 0 || saveBusy}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed text-white ${saveBusy ? 'animate-pulse' : ''}`}
        style={{ WebkitAppRegion: 'no-drag', background: 'var(--accent)', opacity: dirtyCount === 0 || saveBusy ? 0.4 : undefined } as React.CSSProperties}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
        </svg>
        {saveProgress ? `Saving ${saveProgress.completed}/${saveProgress.total}` : dirtyCount > 1 ? 'Save All' : 'Save'}
        {!saveProgress && dirtyCount > 0 && (
          <span className="ml-1 bg-white/20 text-white text-xs px-1.5 py-0.5 rounded-full">
            {dirtyCount}
          </span>
        )}
      </button>
      {saveProgress && (
        <div
          className="flex items-center gap-2 ml-2 px-2.5 py-1 rounded-full border border-amber-400/30 bg-amber-500/10 text-amber-300"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title={`${saveProgress.label} ${saveProgress.completed} of ${saveProgress.total} files`}
        >
          <span className="w-2 h-2 rounded-full bg-amber-300 animate-pulse flex-shrink-0" />
          <span className="text-[11px] font-medium whitespace-nowrap">
            {saveProgress.label} {saveProgress.completed} / {saveProgress.total}
          </span>
        </div>
      )}


      {(unnamedCount > 0 || (autoFilledCount > 0 && onClearSuggestionsAll)) && (
        <>
          <div className="tb-sep-v" />
          <div ref={actionsMenuRef} className="relative" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <button
              onClick={() => setShowActionsMenu((v) => !v)}
              className="tb-menu-btn"
              title="Loaded-file cleanup and helper actions"
            >
              Actions
              <svg className="cv w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {showActionsMenu && (
              <div className="absolute left-0 top-full mt-1 w-72 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 py-1">
                {unnamedCount > 0 && (
                  <button
                    onClick={() => { setShowActionsMenu(false); onNameFromFilename() }}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    title={`Set capture name from filename for ${unnamedCount} unnamed file${unnamedCount !== 1 ? 's' : ''}`}
                  >
                    Name from File ({unnamedCount})
                  </button>
                )}
                {autoFilledCount > 0 && onClearSuggestionsAll && (
                  <button
                    onClick={() => { setShowActionsMenu(false); onClearSuggestionsAll() }}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    title={`Clear auto-filled suggestion/default values from ${autoFilledCount} loaded file${autoFilledCount !== 1 ? 's' : ''}`}
                  >
                    Clear Suggestions ({autoFilledCount})
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      )}

      <div className="flex-1" />

      {onGoHomeView && (
        <button
          onClick={onGoHomeView}
          title="Default view — folder tree, file list, and detail panel"
          className={`tb-menu-btn ${homeViewActive ? 'active' : ''}`}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
            <rect x="3" y="3" width="7" height="18" rx="1" strokeLinejoin="round" />
            <rect x="12" y="3" width="5" height="18" rx="1" strokeLinejoin="round" />
            <rect x="19" y="3" width="2" height="18" rx="1" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {onToggleCardView && (
        <button
          onClick={cardViewEnabled ? onToggleCardView : undefined}
          title={cardViewEnabled ? 'Toggle folder card view' : 'Open a folder to use card view'}
          disabled={!cardViewEnabled}
          className={`tb-menu-btn relative ${!cardViewEnabled ? 'opacity-40 cursor-not-allowed' : ''} ${cardViewActive ? 'active' : ''}`}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
            <rect x="1" y="1" width="6" height="6" rx="1" />
            <rect x="9" y="1" width="6" height="6" rx="1" />
            <rect x="1" y="9" width="6" height="6" rx="1" />
            <rect x="9" y="9" width="6" height="6" rx="1" />
          </svg>
        </button>
      )}

      {onToggleToneMap && (
        <button
          onClick={toneMapEnabled ? onToggleToneMap : undefined}
          title={
            toneMapEnabled
              ? 'Tone Map — browse every capture by amp and measured saturation'
              : 'Load a library to use the Tone Map'
          }
          disabled={!toneMapEnabled}
          className={`tb-menu-btn relative ${!toneMapEnabled ? 'opacity-40 cursor-not-allowed' : ''} ${toneMapActive ? 'active' : ''}`}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* Scattered marks rising left-to-right — the map's clean-to-heavy reading. */}
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
            <circle cx="2.5" cy="12.5" r="1.4" />
            <circle cx="6" cy="9.5" r="1.4" />
            <circle cx="6.5" cy="13" r="1.1" opacity="0.6" />
            <circle cx="9.5" cy="6" r="1.4" />
            <circle cx="10" cy="10" r="1.1" opacity="0.6" />
            <circle cx="13.5" cy="3" r="1.4" />
            <circle cx="13" cy="7" r="1.1" opacity="0.6" />
          </svg>
        </button>
      )}

      {showExperimentalTraining && onOpenTrainingQueue && (
        <button
          onClick={onOpenTrainingQueue}
          title={trainingQueueCount > 0 ? `${trainingQueueCount} training queue item${trainingQueueCount === 1 ? '' : 's'} \u2014 open training dashboard` : 'Open training dashboard'}
          className={`tb-menu-btn relative ${trainingQueueActive ? 'active' : ''}`}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
          </svg>
          {trainingQueueCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold flex items-center justify-center leading-none">
              {trainingQueueCount > 99 ? '99+' : trainingQueueCount}
            </span>
          )}
        </button>
      )}

      {showDashboard && onToggleDashboard && (
        <>
          <div className="tb-sep-v" />
          <button
            onClick={onToggleDashboard}
            title="Library overview"
            className={`tb-menu-btn ${dashboardActive ? 'active' : ''}`}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Overview
          </button>
        </>
      )}

      {onHistoryToggle && (
        <button
          onClick={onHistoryToggle}
          title="Session history"
          className={`tb-menu-btn ${historyOpen ? 'active' : ''}`}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          History
        </button>
      )}

      {onCompanionInboxToggle && (
        <button
          onClick={onCompanionInboxToggle}
          title="Review photos, notes, and cover candidates from the companion app"
          className={`tb-menu-btn relative ${companionInboxOpen ? 'active' : ''}`}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 7h16M4 12h16M4 17h10" />
          </svg>
          Inbox
          {companionInboxCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-amber-500 text-white text-[10px] font-semibold flex items-center justify-center leading-none">
              {companionInboxCount > 99 ? '99+' : companionInboxCount}
            </span>
          )}
        </button>
      )}

      {onToggleToneStore && (
        <button
          onClick={onToggleToneStore}
          title="Browse and download tones from tone3000"
          className={`tb-menu-btn ${toneStoreActive ? 'active' : ''}`}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          Find Tones
        </button>
      )}

      {(onOpenHelp || onOpenFeatureHelp || onOpenAbout) && (
        <div ref={helpMenuRef} className="relative" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            onClick={() => setShowHelpMenu((v) => !v)}
            title="Help, guides, and about NAM Lab"
            className={`tb-menu-btn ${helpOpen ? 'active' : ''}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <circle cx="12" cy="12" r="9" strokeWidth="1.8" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9.4 9.2a2.7 2.7 0 115.06 1.35c0 .84-.42 1.35-1.06 1.86-.61.48-1.17.96-1.17 1.96" />
              <circle cx="12" cy="17.2" r="0.7" fill="currentColor" stroke="none" />
            </svg>
            Help
            <svg className="cv w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {showHelpMenu && (
            <div className="absolute right-0 top-full mt-1 w-64 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-50 py-1">
              <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
                Help
              </div>
              {onOpenHelp && (
                <button
                  onClick={() => { setShowHelpMenu(false); onOpenHelp() }}
                  className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Workflow Guide
                </button>
              )}
              {onOpenFeatureHelp && (
                <button
                  onClick={() => { setShowHelpMenu(false); onOpenFeatureHelp() }}
                  className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  Feature Reference
                </button>
              )}
              {onOpenAbout && (
                <>
                  <div className="mx-3 my-1 border-t border-gray-200 dark:border-gray-700" />
                  <button
                    onClick={() => { setShowHelpMenu(false); onOpenAbout() }}
                    className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    About NAM Lab
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div className="tb-sep-v" />
      <button
        onClick={onToggleSettings}
        className={`tb-menu-btn ${showSettings ? 'active' : ''}`}
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
