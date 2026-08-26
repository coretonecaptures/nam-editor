import { useEffect, useState } from 'react'
import { IrFolderPanel } from './IrFolderPanel'
import { IrLibraryOverview } from './IrLibraryOverview'
import { IrGalleryTab } from './IrGalleryTab'
import { IrReadMeTab } from './IrReadMeTab'
import { IrProjectTab } from './IrProjectTab'

type Tab = 'overview' | 'project' | 'pack-info' | 'gallery' | 'readme'

const BASE_TABS: Array<{ key: Tab; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'pack-info', label: 'Pack Info' },
  { key: 'gallery', label: 'Gallery' },
  { key: 'readme', label: 'Read Me' }
]

/**
 * Right panel with tabs — Overview/Pack Info/Gallery/Read Me, matching NAM Lab's own pack-detail
 * tabbed panel (screenshot supplied by the user, plan section 8, item 8). Root scope (no folder
 * selected) and folder scope share the same tab set: Overview generalizes via
 * `libraryOverview.ts`'s new optional folderId (root = whole library, folder = that subtree);
 * Pack Info/Gallery/Read Me operate on whichever folder is selected, and read-only-explain
 * themselves when nothing is selected (IrFolderPanel/IrGalleryTab/IrReadMeTab each already handle
 * a null folder/path). WAV Check is deliberately not included — NAM Lab's version compares
 * against trained NAM captures, a concept that doesn't apply to IRs.
 */
export function IrRightPanel({
  libraryRootId,
  libraryRootPath,
  folderId,
  folderName,
  onFacet,
  onAudioFacet,
  activeFacets,
  activeAudioFacets
}: {
  libraryRootId: number | null
  libraryRootPath: string | null
  folderId: number | null
  folderName: string | null
  /** Clicking a bar in the Overview report filters the browse list — the report is a way into the
   * list, not a dead-end infographic. */
  onFacet?: (field: 'manufacturer' | 'cabinet' | 'speaker' | 'microphone', value: string) => void
  onAudioFacet?: (field: 'sampleRate' | 'bitDepth', value: number) => void
  activeFacets?: { manufacturer?: string; cabinet?: string; speaker?: string; microphone?: string }
  activeAudioFacets?: { sampleRate?: number; bitDepth?: number }
}): React.ReactElement {
  const [tab, setTab] = useState<Tab>('overview')
  const [folderAbsPath, setFolderAbsPath] = useState<string | null>(null)
  const [isLabProject, setIsLabProject] = useState(false)

  // Overview/Pack Info don't need absPath (folderId is enough), but Gallery/Read Me do — fetched
  // once per folder selection rather than per-tab-switch, since switching tabs shouldn't re-fetch.
  useEffect(() => {
    if (folderId == null) {
      setFolderAbsPath(null)
      setIsLabProject(false)
      return
    }
    let cancelled = false
    window.api.irLibraryGetFolderDetail(folderId).then((detail) => {
      if (cancelled) return
      setFolderAbsPath(detail?.absPath ?? null)
      const labProject = detail?.isLabProject ?? false
      setIsLabProject(labProject)
      // Jump straight to the Project tab on selecting a newly-detected Project folder, since its
      // variant history isn't visible anywhere else in the UI — otherwise keep whichever tab was
      // active (a user browsing Gallery folder to folder shouldn't get bounced back every click).
      setTab((current) => (labProject ? 'project' : current === 'project' ? 'overview' : current))
    })
    return () => {
      cancelled = true
    }
  }, [folderId])

  const tabs = isLabProject ? [BASE_TABS[0], { key: 'project' as const, label: 'Project' }, ...BASE_TABS.slice(1)] : BASE_TABS

  const effectiveAbsPath = folderId == null ? libraryRootPath : folderAbsPath

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-0.5 px-2 pt-2 border-b border-nm-border-s flex-shrink-0">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-2.5 py-1.5 text-xs rounded-t border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-nm-accent text-nm-text bg-panel-2'
                : 'border-transparent text-nm-text-3 hover:text-nm-text-2'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'overview' && (
          <IrLibraryOverview
            libraryRootId={libraryRootId}
            folderId={folderId}
            folderName={folderName}
            onFacet={onFacet}
            onAudioFacet={onAudioFacet}
            activeFacets={activeFacets}
            activeAudioFacets={activeAudioFacets}
          />
        )}
        {tab === 'project' && <IrProjectTab folderId={folderId} />}
        {tab === 'pack-info' && <IrFolderPanel folderId={folderId} />}
        {tab === 'gallery' && <IrGalleryTab absPath={effectiveAbsPath} />}
        {tab === 'readme' && <IrReadMeTab absPath={effectiveAbsPath} />}
      </div>
    </div>
  )
}
