import { useState, useEffect, useCallback } from 'react'

export interface FolderImagesData {
  own: string[]
  inherited: { folderName: string; paths: string[] }[]
}

function toFileUrl(p: string): string {
  return p.startsWith('/') ? `local-file://${p}` : `local-file:///${p}`
}

function Lightbox({ path, onClose }: { path: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={toFileUrl(path)}
          alt=""
          className="rounded-md shadow-2xl"
          style={{ maxWidth: '85vw', maxHeight: '85vh', width: 'auto', height: 'auto' }}
        />
        <div className="flex items-center gap-3 mt-3">
          <button
            onClick={() => window.api.openFile(path)}
            className="text-xs text-gray-300 hover:text-white transition-colors px-3 py-1.5 rounded bg-white/10 hover:bg-white/20"
          >
            Open in viewer
          </button>
          <button
            onClick={onClose}
            className="text-xs text-gray-300 hover:text-white transition-colors px-3 py-1.5 rounded bg-white/10 hover:bg-white/20"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function ImageGrid({ paths, onOpen }: { paths: string[]; onOpen: (p: string) => void }) {
  const count = paths.length
  const cols = count >= 5 ? 'grid-cols-3' : count === 1 ? 'grid-cols-1' : 'grid-cols-2'
  return (
    <div className={`grid ${cols} gap-2`}>
      {paths.map((p, i) => {
        const spanFull = count === 3 && i === 2
        return (
          <div
            key={p}
            className={`overflow-hidden rounded-md cursor-pointer bg-gray-100 dark:bg-gray-800${spanFull ? ' col-span-2' : ''}`}
            onClick={() => onOpen(p)}
          >
            <img
              src={toFileUrl(p)}
              alt=""
              className="w-full h-auto block hover:opacity-90 transition-opacity"
              loading="lazy"
            />
          </div>
        )
      })}
    </div>
  )
}

function Divider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 my-1">
      <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
      <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">From {label}</span>
      <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
    </div>
  )
}

export function FolderGallery({ data }: { data: FolderImagesData }) {
  const [lightbox, setLightbox] = useState<string | null>(null)
  const hasOwn = data.own.length > 0
  const validInherited = data.inherited.filter((g) => g.paths.length > 0)
  const onOpen = useCallback((p: string) => setLightbox(p), [])
  const onClose = useCallback(() => setLightbox(null), [])

  if (!hasOwn && validInherited.length === 0) return null

  return (
    <>
      <div className="h-full overflow-y-auto">
        <div className="min-h-full flex flex-col items-center justify-center gap-3 p-4 w-full">
          {hasOwn && <div className="w-full"><ImageGrid paths={data.own} onOpen={onOpen} /></div>}
          {validInherited.map((group, idx) => (
            <div key={group.folderName} className="w-full">
              {(hasOwn || idx > 0) && <Divider label={group.folderName} />}
              {!hasOwn && idx === 0 && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">From {group.folderName}</p>
              )}
              <ImageGrid paths={group.paths} onOpen={onOpen} />
            </div>
          ))}
        </div>
      </div>
      {lightbox && <Lightbox path={lightbox} onClose={onClose} />}
    </>
  )
}
