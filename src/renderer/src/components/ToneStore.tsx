import React, { useState, useEffect, useCallback, useRef } from 'react'

interface ToneUser { username: string }
interface ToneResult {
  id: number
  title: string
  user: ToneUser
  gear: string
  sizes: string[]
  images: string[] | null
  downloads_count: number
  models_count: number
  created_at?: string
}
interface ToneDetail {
  id: number
  title: string
  description: string | null
  user: ToneUser
  gear: string
  makes: { name: string }[]
  tags: { name: string }[]
  links: string[] | null
  images: string[] | null
  downloads_count: number
  favorites_count: number
  models_count: number
  created_at?: string
}
export interface ToneModel {
  id: number
  name: string
  size: string
  model_url: string
}
interface SearchResponse {
  data: ToneResult[]
  page: number
  page_size: number
  total: number
}

interface UserSearchResponse {
  data: ToneUser[]
}

export interface ToneStoreDownloadQueueJob {
  toneId: number
  toneTitle: string
  destDir: string
  folderName: string
  items: ToneModel[]
  nextIndex: number
  downloadedPaths: string[]
  skipped: number
  resumePass: number
  status: 'running' | 'cooldown' | 'done' | 'error'
  message: string
  coverImageUrl: string | null
  packInfoSeed: {
    title: string
    capturedBy: string
    description: string
  } | null
}

function normalizeUsername(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

const GEAR_OPTIONS = [
  { value: '', label: 'All Gear' },
  { value: 'amp', label: 'Amp' },
  { value: 'full-rig', label: 'Full Rig' },
  { value: 'pedal', label: 'Pedal' },
  { value: 'outboard', label: 'Outboard' },
  { value: 'ir', label: 'IR' },
]
const GEAR_LABELS: Record<string, string> = { amp: 'Amp', 'full-rig': 'Full Rig', pedal: 'Pedal', outboard: 'Outboard', ir: 'IR' }
const SIZE_ORDER = ['Standard', 'Lite', 'Feather', 'Nano', 'Custom']
const SORT_OPTIONS = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'downloads-all-time', label: 'Most Downloaded' },
  { value: 'trending', label: 'Trending' },
]
const LAST_TONE3000_QUERY_KEY = 'nam-lab-tone3000-last-query'

function fmtDate(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function buildTone3000ToneUrl(tone: Pick<ToneResult, 'id' | 'title'> | Pick<ToneDetail, 'id' | 'title'>): string {
  const slug = tone.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `https://www.tone3000.com/tones/${slug}-${tone.id}`
}

function showNativeTextContextMenu(event: React.MouseEvent<HTMLElement>) {
  const selection = window.getSelection()?.toString().trim() ?? ''
  const target = event.target as HTMLElement | null
  const isEditable = !!target?.closest('input, textarea, [contenteditable="true"]')
  if (!selection && !isEditable) return
  event.preventDefault()
  void window.api.showTextContextMenu({ hasSelection: !!selection, isEditable })
}

export function ToneStore({
  onClose,
  onDownloaded,
  onFilterLocalCreator,
  savedTone3000Username,
  searchRequest,
  queueJob,
  onStartQueue,
  onCancelQueue,
}: {
  onClose: () => void
  onDownloaded: (paths: string[]) => void
  onFilterLocalCreator: (creator: string) => void
  savedTone3000Username: string
  searchRequest: { key: number; query: string } | null
  queueJob: ToneStoreDownloadQueueJob | null
  onStartQueue: (job: ToneStoreDownloadQueueJob) => void
  onCancelQueue: () => void
}) {
  // Auth state
  const [connected, setConnected] = useState(false)
  const [username, setUsername] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [statusChecked, setStatusChecked] = useState(false)

  // Browse state
  const [query, setQuery] = useState(() => {
    try {
      return localStorage.getItem(LAST_TONE3000_QUERY_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [creatorUsername, setCreatorUsername] = useState('')
  const [gear, setGear] = useState('')
  const [sort, setSort] = useState('trending')
  const [scope, setScope] = useState<'all' | 'mine'>('all')
  const [results, setResults] = useState<ToneResult[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const queryRef = useRef(query)
  const creatorUsernameRef = useRef(creatorUsername)
  const gearRef = useRef(gear)
  const sortRef = useRef(sort)
  const scopeRef = useRef(scope)

  // Detail / download state
  const [selectedTone, setSelectedTone] = useState<ToneResult | null>(null)
  const [toneDetail, setToneDetail] = useState<ToneDetail | null>(null)
  const [models, setModels] = useState<ToneModel[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set())
  const [sizeFilter, setSizeFilter] = useState<string>('')
  const [downloadDone, setDownloadDone] = useState<{ count: number; folderName: string; msg: string } | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  useEffect(() => { queryRef.current = query }, [query])
  useEffect(() => {
    try {
      localStorage.setItem(LAST_TONE3000_QUERY_KEY, query)
    } catch {
      /* ignore localStorage failures */
    }
  }, [query])
  useEffect(() => { creatorUsernameRef.current = creatorUsername }, [creatorUsername])
  useEffect(() => { gearRef.current = gear }, [gear])
  useEffect(() => { sortRef.current = sort }, [sort])
  useEffect(() => { scopeRef.current = scope }, [scope])
  const queueLocked = queueJob !== null && (queueJob.status === 'running' || queueJob.status === 'cooldown')

  useEffect(() => {
    window.api.tone3000Status().then((s) => {
      if (s.connected) { setConnected(true); setUsername(s.username) }
      setStatusChecked(true)
    })
  }, [])

  const resolveUsername = useCallback(async (value: string): Promise<string> => {
    const trimmed = value.trim()
    if (!trimmed) return ''
    const result = await window.api.tone3000UsersSearch({ query: trimmed, page: 1, pageSize: 10, sort: 'tones' })
    if (result.error) return trimmed
    const data = result.data as UserSearchResponse
    const target = normalizeUsername(trimmed)
    const exact = (data.data ?? []).find((u) => normalizeUsername(u.username) === target)
    return exact?.username ?? trimmed
  }, [])

  const handleSearch = useCallback(async (
    p = 1,
    q = queryRef.current,
    g = gearRef.current,
    s = sortRef.current,
    user = creatorUsernameRef.current,
    searchScope = scopeRef.current
  ) => {
    setSearching(true)
    setSearchError(null)
    const resolvedUsername = user.trim() ? await resolveUsername(user) : ''
    const requestedUsername = normalizeUsername(resolvedUsername)
    const authUsername = normalizeUsername(username ?? '')
    const savedUsername = normalizeUsername(savedTone3000Username)
    const useCreated = searchScope === 'mine'
      || (!!requestedUsername && (requestedUsername === authUsername || (!!savedUsername && requestedUsername === savedUsername)))

    const result = useCreated
      ? await window.api.tone3000Created({ page: p, pageSize: 100 })
      : await window.api.tone3000Search({ query: q || undefined, page: p, pageSize: 24, gears: g ? [g] : undefined, sort: s })
    setSearching(false)
    if (result.error) { setSearchError(result.error); return }
    const data = result.data as SearchResponse
    let filtered = data.data ?? []
    if (useCreated) {
      if (q.trim()) {
        const needle = q.toLowerCase()
        filtered = filtered.filter((tone) => [tone.title, tone.user?.username].filter(Boolean).join(' ').toLowerCase().includes(needle))
      }
      if (g) filtered = filtered.filter((tone) => tone.gear === g)
      filtered = [...filtered].sort((a, b) => {
        const aTime = a.created_at ? new Date(a.created_at).getTime() : 0
        const bTime = b.created_at ? new Date(b.created_at).getTime() : 0
        return bTime - aTime
      })
    } else if (requestedUsername) {
      filtered = filtered.filter((tone) => normalizeUsername(tone.user?.username ?? '').includes(requestedUsername))
    }
    setResults(filtered)
    setTotal((useCreated || requestedUsername) ? filtered.length : (data.total ?? 0))
    setPage(p)
  }, [resolveUsername, savedTone3000Username, username])

  useEffect(() => {
    if (!connected || !statusChecked) return
    if (searchRequest) {
      setQuery(searchRequest.query)
      setCreatorUsername('')
      setGear('')
      setSort('trending')
      setScope('all')
      handleSearch(1, searchRequest.query, '', 'trending', '', 'all')
      return
    }
    handleSearch(1, queryRef.current, '', 'trending', '', 'all')
  }, [connected, statusChecked, searchRequest, handleSearch])

  const handleConnect = async () => {
    setConnecting(true); setConnectError(null)
    const result = await window.api.tone3000Connect()
    setConnecting(false)
    if (result.ok) { setConnected(true); setUsername(result.username ?? null) }
    else setConnectError(result.error ?? 'Connection failed')
  }

  const handleDisconnect = async () => {
    if (queueLocked) return
    await window.api.tone3000Disconnect()
    setConnected(false); setUsername(null); setResults([]); setTotal(0); setSelectedTone(null)
  }

  const filterLocalCreator = (creator: string | undefined) => {
    if (!creator) return
    onFilterLocalCreator(creator)
  }

  const openDetail = async (tone: ToneResult) => {
    if (queueLocked) return
    setSelectedTone(tone)
    setToneDetail(null)
    setModels([])
    setModelsError(null)
    setModelsLoading(true)
    setCheckedIds(new Set())
    setSizeFilter('')
    setDownloadDone(null)
    setDownloadError(null)

    const [detailResult, modelsResult] = await Promise.all([
      window.api.tone3000GetTone(tone.id),
      window.api.tone3000GetModels(tone.id),
    ])

    setModelsLoading(false)
    if (detailResult.ok && detailResult.tone) setToneDetail(detailResult.tone as ToneDetail)
    if (modelsResult.error || !modelsResult.models) { setModelsError(modelsResult.error ?? 'Failed to load'); return }
    const ms = modelsResult.models as ToneModel[]
    setModels(ms)
    setCheckedIds(new Set(ms.map((m) => m.id)))
  }

  const visibleModels = sizeFilter ? models.filter((m) => m.size === sizeFilter) : models
  const availableSizes = [...new Set(models.map((m) => m.size))].sort((a, b) => SIZE_ORDER.indexOf(a) - SIZE_ORDER.indexOf(b))
  const checkedVisible = visibleModels.filter((m) => checkedIds.has(m.id))
  const allVisibleChecked = visibleModels.length > 0 && checkedVisible.length === visibleModels.length

  const toggleAll = () => {
    if (allVisibleChecked) {
      setCheckedIds((prev) => { const next = new Set(prev); visibleModels.forEach((m) => next.delete(m.id)); return next })
    } else {
      setCheckedIds((prev) => { const next = new Set(prev); visibleModels.forEach((m) => next.add(m.id)); return next })
    }
  }

  const handleBatchDownload = async () => {
    if (!selectedTone) return
    const toDownload = visibleModels.filter((m) => checkedIds.has(m.id))
    if (!toDownload.length) return

    if (toDownload.length > 50) {
      const ok = window.confirm(
        `This Tone3000 pack has ${toDownload.length} files.\n\n` +
        'Due to Tone3000 API and download limitations, large packs download in the background and can take a while. ' +
        'Find Tones browsing will stay locked until the queue finishes or you cancel it.\n\n' +
        'Do you want to start this background download?'
      )
      if (!ok) return
    }

    const destDir = await window.api.openFolder()
    if (!destDir) return

    const folderName = destDir.replace(/\\/g, '/').split('/').pop() ?? destDir
    setDownloadError(null)
    setDownloadDone(null)
    const detailImage = toneDetail?.images?.[0] ?? selectedTone.images?.[0] ?? null
    onStartQueue({
      toneId: selectedTone.id,
      toneTitle: selectedTone.title,
      destDir,
      folderName,
      items: toDownload,
      nextIndex: 0,
      downloadedPaths: [],
      skipped: 0,
      resumePass: 0,
      status: 'running',
      message: toDownload.length > 50
        ? `Starting background Tone3000 download queue for ${toDownload.length} files...`
        : `Starting Tone3000 download for ${toDownload.length} files...`,
      coverImageUrl: detailImage,
      packInfoSeed: {
        title: toneDetail?.title ?? selectedTone.title,
        capturedBy: toneDetail?.user?.username ?? selectedTone.user?.username ?? '',
        description: [
          toneDetail?.description?.trim() || '',
          '',
          `Imported from Tone3000`,
          `Creator: @${toneDetail?.user?.username ?? selectedTone.user?.username ?? 'unknown'}`,
          `Source: ${buildTone3000ToneUrl(toneDetail ?? selectedTone)}`,
        ].filter((line, index, arr) => line || (index > 0 && arr[index - 1] && arr[index + 1])).join('\n'),
      },
    })
  }

  const totalPages = Math.ceil(total / 24)

  const queueProgress = queueJob && (queueJob.status === 'running' || queueJob.status === 'cooldown')
    ? { current: queueJob.nextIndex, total: queueJob.items.length, folderName: queueJob.folderName }
    : null
  const queuePercent = queueProgress
    ? Math.round((queueProgress.current / Math.max(queueProgress.total, 1)) * 100)
    : 0

  // Loading
  if (!statusChecked) {
    return <div className="flex items-center justify-center h-full text-sm text-gray-500 dark:text-gray-400">Loading...</div>
  }

  // Not connected
  if (!connected) {
    return (
      <div className="flex flex-col h-full overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Find New Tones</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="max-w-xs">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-5">
            Browse and download captures from the{' '}
            <button onClick={() => window.api.openExternal('https://tone3000.com')} className="text-violet-500 hover:underline">tone3000</button>
            {' '}community. Sign in with your free tone3000 account to get started.
          </p>
          {connectError && <p className="text-xs text-red-500 mb-3">{connectError}</p>}
          <button onClick={handleConnect} disabled={connecting}
            className="px-4 py-2 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
          >
            {connecting ? 'Opening browser...' : 'Connect to tone3000'}
          </button>
          {connecting && <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Complete sign-in in your browser, then return here.</p>}
        </div>
      </div>
    )
  }

  // Detail view
  if (selectedTone) {
    const checkedCount = visibleModels.filter((m) => checkedIds.has(m.id)).length
    const detailImage = toneDetail?.images?.[0] ?? selectedTone.images?.[0] ?? null

    return (
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <button onClick={() => { if (!queueLocked) setSelectedTone(null) }} disabled={queueLocked} className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            Back
          </button>
          <span className="text-xs text-gray-300 dark:text-gray-600">|</span>
          <span className="text-sm font-medium text-gray-900 dark:text-white truncate flex-1">{selectedTone.title}</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors flex-shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Tone summary */}
          <div
            className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 space-y-2 select-text"
            onContextMenu={showNativeTextContextMenu}
          >
            {detailImage && (
              <img
                src={detailImage}
                alt={selectedTone.title}
                className="w-full h-44 object-cover rounded-lg border border-gray-200 dark:border-gray-700"
              />
            )}
            <div className="flex items-center gap-2 flex-wrap text-xs text-gray-500 dark:text-gray-400">
              <button
                onClick={() => filterLocalCreator((toneDetail ?? selectedTone).user?.username)}
                className="hover:text-violet-500 transition-colors"
                title="Filter local NAM Lab files by this creator"
              >
                @{(toneDetail ?? selectedTone).user?.username}
              </button>
              <span>|</span>
              <span className="px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">
                {GEAR_LABELS[selectedTone.gear] ?? selectedTone.gear}
              </span>
              {!modelsLoading && models.length > 0 && (
                <><span>|</span><span>{models.length} file{models.length !== 1 ? 's' : ''}</span></>
              )}
              {toneDetail && toneDetail.favorites_count > 0 && (
                <><span>|</span><span>Favorites {toneDetail.favorites_count.toLocaleString()}</span></>
              )}
              {toneDetail?.created_at && (
                <><span>|</span><span>{fmtDate(toneDetail.created_at)}</span></>
              )}
            </div>

            {toneDetail?.makes && toneDetail.makes.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                {toneDetail.makes.map((m, i) => (
                  <span key={i} className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">{m.name}</span>
                ))}
              </div>
            )}

            {toneDetail?.tags && toneDetail.tags.length > 0 && (
              <div className="flex items-center gap-1 flex-wrap">
                {toneDetail.tags.map((t, i) => (
                  <span key={i} className="text-xs text-gray-400 dark:text-gray-500">#{t.name}</span>
                ))}
              </div>
            )}

            {toneDetail?.description && (
              <p className="text-xs text-gray-600 dark:text-gray-400 whitespace-pre-line leading-relaxed select-text">{toneDetail.description}</p>
            )}

            <div>
              <button
                onClick={() => window.api.openExternal(buildTone3000ToneUrl(toneDetail ?? selectedTone))}
                className="text-xs text-violet-500 hover:underline"
              >
                Open on Tone3000
              </button>
            </div>

            {toneDetail?.links && toneDetail.links.length > 0 && (
              <div className="flex flex-col gap-0.5">
                {toneDetail.links.map((link, i) => (
                  <a
                    key={i}
                    href={link}
                    onClick={(e) => {
                      e.preventDefault()
                      window.api.openExternal(link)
                    }}
                    className="text-xs text-violet-500 hover:underline text-left truncate select-text"
                  >
                    {link}
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Models list */}
          {modelsLoading && (
            <div className="flex items-center justify-center py-10 text-sm text-gray-500 dark:text-gray-400">Loading files...</div>
          )}
          {modelsError && (
            <div className="px-4 py-4 text-sm text-red-500">{modelsError}</div>
          )}

          {!modelsLoading && !modelsError && models.length > 0 && (
            <>
              {/* Controls row */}
              <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input type="checkbox" checked={allVisibleChecked} onChange={toggleAll}
                    className="rounded border-gray-300 dark:border-gray-600 text-violet-600 focus:ring-violet-500"
                  />
                  <span className="text-xs text-gray-700 dark:text-gray-300">
                    {allVisibleChecked ? 'Deselect all' : 'Select all'}
                    {checkedVisible.length > 0 && checkedVisible.length < visibleModels.length ? ` (${checkedVisible.length}/${visibleModels.length})` : ''}
                  </span>
                </label>
                {availableSizes.length > 1 && (
                  <div className="flex items-center gap-1 ml-auto">
                    <button onClick={() => setSizeFilter('')}
                      className={`px-2 py-0.5 text-xs rounded transition-colors ${sizeFilter === '' ? 'bg-violet-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'}`}
                    >All</button>
                    {availableSizes.map((s) => (
                      <button key={s} onClick={() => setSizeFilter(s)}
                        className={`px-2 py-0.5 text-xs rounded transition-colors ${sizeFilter === s ? 'bg-violet-600 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'}`}
                      >{s}</button>
                    ))}
                  </div>
                )}
              </div>

              {/* File list */}
              <div className="divide-y divide-gray-100 dark:divide-gray-800">
                {visibleModels.map((model) => (
                  <label key={model.id} className="flex items-center gap-3 px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer">
                    <input type="checkbox" checked={checkedIds.has(model.id)} disabled={queueLocked}
                      onChange={(e) => {
                        setCheckedIds((prev) => {
                          const next = new Set(prev)
                          e.target.checked ? next.add(model.id) : next.delete(model.id)
                          return next
                        })
                      }}
                      className="rounded border-gray-300 dark:border-gray-600 text-violet-600 focus:ring-violet-500 flex-shrink-0"
                    />
                    <span className="text-xs text-gray-900 dark:text-white flex-1 truncate">{model.name}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 flex-shrink-0">{model.size}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Download footer */}
        {!modelsLoading && !modelsError && models.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-700 flex-shrink-0 space-y-2">
            {downloadError && <p className="text-xs text-red-500">{downloadError}</p>}
            {downloadDone && (
              <p className="text-xs text-green-500 dark:text-green-400">
                Saved: {downloadDone.msg}{' -> '}"{downloadDone.folderName}"
              </p>
            )}
            {queueProgress ? (
              <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                    <span>{queueJob?.status === 'cooldown' ? 'Waiting for Tone3000 access to resume...' : `Downloading ${queueProgress.current + 1} of ${queueProgress.total}...`}</span>
                    <span>{Math.round((queueProgress.current / Math.max(queueProgress.total, 1)) * 100)}%</span>
                  </div>
                <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                  <div
                    className="bg-violet-600 h-1.5 rounded-full transition-all"
                    style={{ width: `${(queueProgress.current / Math.max(queueProgress.total, 1)) * 100}%` }}
                  />
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500">{queueJob?.message ?? `Saving to "${queueProgress.folderName}"`}</p>
                <p className="text-xs text-amber-500 dark:text-amber-400">Tone3000 browsing is locked while this queue runs.</p>
                <div className="flex justify-end">
                  <button
                    onClick={onCancelQueue}
                    className="text-xs px-2 py-1 rounded bg-red-500/15 hover:bg-red-500/25 text-red-500 dark:text-red-400 transition-colors"
                  >
                    Give Up
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={handleBatchDownload}
                disabled={checkedCount === 0 || queueLocked}
                className="w-full py-2 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
              >
                More Info / Download {checkedCount > 0 ? `${checkedCount} file${checkedCount !== 1 ? 's' : ''}` : '(none selected)'}
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  // Browse view
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <svg className="w-3.5 h-3.5 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <span className="text-sm font-semibold text-gray-900 dark:text-white flex-1">Find New Tones</span>
        {username && <span className="text-xs text-gray-500 dark:text-gray-400">@{username}</span>}
        <button onClick={handleDisconnect} disabled={queueLocked} className="text-xs text-gray-400 hover:text-red-400 transition-colors ml-2 disabled:opacity-40 disabled:cursor-not-allowed">Disconnect</button>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors ml-1">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>

      {/* Search bar */}
      <div className="flex flex-col gap-1.5 px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setScope('all'); handleSearch(1, query, gear, sort, creatorUsername, 'all') }}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${scope === 'all' ? 'bg-violet-600 text-white' : 'bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-700'}`}
          >
            All tones
          </button>
          <button
            onClick={() => { setScope('mine'); handleSearch(1, query, gear, sort, creatorUsername, 'mine') }}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${scope === 'mine' ? 'bg-violet-600 text-white' : 'bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-700'}`}
          >
            My files
          </button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative min-w-[220px] flex-[1.3]">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !queueLocked && handleSearch(1, query, gear, sort, creatorUsername, scope)}
              placeholder="Search tones..."
              disabled={queueLocked}
              className="w-full px-3 py-1.5 pr-8 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            {query && (
              <button
                onClick={() => { if (!queueLocked) { setQuery(''); handleSearch(1, '', gear, sort, creatorUsername, scope) } }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 px-1"
              >x</button>
            )}
          </div>
          <div className="relative min-w-[220px] flex-1">
            <svg className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <input
              type="text"
              value={creatorUsername}
              onChange={(e) => setCreatorUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !queueLocked && handleSearch(1, query, gear, sort, creatorUsername, scope)}
              placeholder={`Tone3000 username${savedTone3000Username ? ` (saved: ${savedTone3000Username})` : ''}`}
              title="Tone3000 does not currently expose a direct tones-by-user endpoint. NAM Lab filters search results by username, so this may not include every capture from that creator."
              disabled={queueLocked}
              className="w-full px-3 py-1.5 pl-8 pr-8 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            {creatorUsername && (
              <button
                onClick={() => { if (!queueLocked) { setCreatorUsername(''); handleSearch(1, query, gear, sort, '', scope) } }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 px-1"
              >x</button>
            )}
          </div>
          <select value={gear} onChange={(e) => { const g = e.target.value; setGear(g); if (!queueLocked) handleSearch(1, query, g, sort, creatorUsername, scope) }}
            disabled={queueLocked}
            className="px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            {GEAR_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={sort} onChange={(e) => { const s = e.target.value; setSort(s); if (!queueLocked) handleSearch(1, query, gear, s, creatorUsername, scope) }}
            disabled={scope === 'mine' || queueLocked}
            className="px-2 py-1.5 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button onClick={() => handleSearch(1, query, gear, sort, creatorUsername, scope)} disabled={searching || queueLocked}
            className="px-3 py-1.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white transition-colors"
          >Search</button>
        </div>
        {queueLocked && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-amber-500 dark:text-amber-400">
                  Tone3000 background download queue in progress
                </p>
                <p className="text-xs text-amber-500/90 dark:text-amber-300/90">
                  Due to Tone3000 API and download limitations, Find Tones browsing is locked until this queue finishes or you cancel it.
                </p>
              </div>
              <button
                onClick={onCancelQueue}
                className="shrink-0 text-xs px-2 py-1 rounded bg-red-500/15 hover:bg-red-500/25 text-red-500 dark:text-red-400 transition-colors"
              >
                Cancel
              </button>
            </div>
            {queueProgress && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-300">
                  <span>{queueJob?.status === 'cooldown' ? 'Waiting for Tone3000 access to resume...' : `Downloading ${queueProgress.current + 1} of ${queueProgress.total}...`}</span>
                  <span>{queuePercent}%</span>
                </div>
                <div className="w-full bg-gray-200/60 dark:bg-gray-700 rounded-full h-1.5">
                  <div
                    className="bg-amber-400 h-1.5 rounded-full transition-all"
                    style={{ width: `${queuePercent}%` }}
                  />
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-300">{queueJob?.message ?? `Saving to "${queueProgress.folderName}"`}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto p-3">
        {searching && <div className="flex items-center justify-center py-12 text-sm text-gray-500 dark:text-gray-400">Searching...</div>}
        {!searching && searchError && <div className="text-sm text-red-500 text-center py-8">{searchError}</div>}
        {!searching && !searchError && results.length === 0 && <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-12">No results</div>}

        {!searching && results.length > 0 && (
          <>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{total.toLocaleString()} tones found</p>
            <div className="grid grid-cols-2 gap-3">
              {results.map((tone) => (
                <div key={tone.id} className={`rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden flex flex-col ${queueLocked ? 'opacity-60' : ''}`}>
                  {tone.images?.[0] ? (
                    <img src={tone.images[0]} alt={tone.title} className="w-full h-24 object-cover" loading="lazy" />
                  ) : (
                    <div className="w-full h-24 bg-gray-100 dark:bg-gray-750 flex items-center justify-center">
                      <svg className="w-7 h-7 text-gray-300 dark:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
                      </svg>
                    </div>
                  )}
                  <div className="p-2 flex flex-col gap-1 flex-1">
                    <div className="text-xs font-medium text-gray-900 dark:text-white truncate" title={tone.title}>{tone.title}</div>
                    <button
                      onClick={() => filterLocalCreator(tone.user?.username)}
                      disabled={queueLocked}
                      className="text-xs text-left text-gray-500 dark:text-gray-400 hover:text-violet-500 transition-colors"
                      title="Filter local NAM Lab files by this creator"
                    >
                      @{tone.user?.username}
                    </button>
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">
                        {GEAR_LABELS[tone.gear] ?? tone.gear}
                      </span>
                      {tone.models_count > 0 && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                          {tone.models_count} file{tone.models_count !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-xs text-gray-400 dark:text-gray-500">
                      <span>Downloads {tone.downloads_count?.toLocaleString()}</span>
                      {tone.created_at && <span>{fmtDate(tone.created_at)}</span>}
                    </div>
                    <button onClick={() => openDetail(tone)} disabled={queueLocked}
                      className="mt-1 w-full py-1 text-xs font-medium rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
                    >
                      More Info / Download
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-4 pb-2">
                <button onClick={() => handleSearch(page - 1, query, gear, sort, creatorUsername, scope)} disabled={page <= 1}
                  className="px-3 py-1 text-xs rounded-md bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >Prev</button>
                <span className="text-xs text-gray-500 dark:text-gray-400">Page {page} of {totalPages}</span>
                <button onClick={() => handleSearch(page + 1, query, gear, sort, creatorUsername, scope)} disabled={page >= totalPages}
                  className="px-3 py-1 text-xs rounded-md bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >Next</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
