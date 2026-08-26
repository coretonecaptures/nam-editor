import { contextBridge, ipcRenderer, webUtils } from 'electron'
import fs from 'fs'
import path from 'path'
import type { TrainerStartPayload, TrainerStateSnapshot, TrainerHistoryEntry, WatcherFileEntry } from '../renderer/src/types/trainer'

/** One mic slot's structured detail (labProjectEnrichment.ts's ProjectDetailMic) — shared by
 * irLibraryGetProjectDetailForFolder's two mic slots below. */
interface ProjectDetailMicShape {
  type: string | null
  polarPattern: string | null
  targetZone: string | null
  distance: number | null
  distanceUnit: string | null
  axisAngleDeg: number | null
  signalChainOverride: string | null
  notes: string | null
}

// Read settings.json from userData synchronously so the renderer has settings
// available immediately — no async flash, no re-render on load.
let initialSettings: unknown = null
try {
  const userData = ipcRenderer.sendSync('app:getUserDataPath') as string
  const settingsPath = path.join(userData, 'settings.json')
  initialSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
} catch { /* file doesn't exist yet — renderer will migrate from localStorage */ }

const api = {
  openFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:openFiles'),
  openFolder: (defaultPath?: string): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder', defaultPath),
  openImportFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openImportFile'),
  openAudioFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openAudioFile'),
  openAudioFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:openAudioFiles'),
  openImageFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openImageFile'),
  readFileBinary: (filePath: string): Promise<{ data?: string; error?: string }> => ipcRenderer.invoke('file:readBinary', filePath),
  // Used for both the DI clip library and the cabinet IR library — same shape, same scan.
  scanWavLibrary: (
    libraryPath: string
  ): Promise<{ categories: Array<{ name: string; files: Array<{ name: string; path: string }> }>; error?: string }> =>
    ipcRenderer.invoke('player:scanWavLibrary', libraryPath),
  // The IR library is indexed rather than scanned: it recurses the whole tree (bought IR packs
  // nest several folders deep) and stays in the main process, because half a million paths is far
  // too much to hand to the renderer. These three calls are the only view onto it.
  indexIrLibrary: (
    libraryPath: string,
    force?: boolean
  ): Promise<{ count: number; scannedAt?: number; error?: string }> =>
    ipcRenderer.invoke('player:indexIrLibrary', libraryPath, force),
  searchIrLibrary: (
    libraryPath: string,
    query: string,
    limit?: number
  ): Promise<{
    results: Array<{ name: string; path: string; rel: string }>
    total: number
    indexed: boolean
  }> => ipcRenderer.invoke('player:searchIrLibrary', libraryPath, query, limit),
  browseIrLibrary: (
    libraryPath: string,
    relDir: string
  ): Promise<{
    folders: Array<{ name: string; count: number }>
    files: Array<{ name: string; path: string; rel: string }>
    indexed: boolean
  }> => ipcRenderer.invoke('player:browseIrLibrary', libraryPath, relDir),
  listWavSiblings: (filePath: string): Promise<{ files: string[]; error?: string }> =>
    ipcRenderer.invoke('player:listWavSiblings', filePath),
  hashFiles: (filePaths: string[]): Promise<{ filePath: string; success: boolean; hash?: string; error?: string }[]> =>
    ipcRenderer.invoke('file:hashMany', filePaths),
  hashFilesWithoutMetadata: (filePaths: string[]): Promise<{ filePath: string; success: boolean; hash?: string; error?: string }[]> =>
    ipcRenderer.invoke('file:hashManyWithoutMetadata', filePaths),
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
  writeMetadata: (filePath: string, metadata: unknown, context?: unknown) =>
    ipcRenderer.invoke('file:writeMetadata', filePath, metadata, context),
  scanFolder: (folderPath: string, hiddenFolders?: string) => ipcRenderer.invoke('folder:scanNam', folderPath, hiddenFolders),
  scanTree: (folderPath: string, hiddenFolders?: string) => ipcRenderer.invoke('folder:scanTree', folderPath, hiddenFolders),
  listWavFiles: (folderPath: string): Promise<string[]> => ipcRenderer.invoke('folder:listWavFiles', folderPath),
  listNamFiles: (folderPath: string): Promise<string[]> => ipcRenderer.invoke('folder:listNamFiles', folderPath),
  moveFile: (sourcePath: string, destDir: string, force = false, destBaseName?: string) =>
    ipcRenderer.invoke('file:move', sourcePath, destDir, force, destBaseName) as Promise<{ success: boolean; error?: string; destPath?: string }>,
  revealFile: (filePath: string) => ipcRenderer.invoke('shell:revealFile', filePath),
  openFile: (filePath: string): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('shell:openFile', filePath),
  getErrorLogPath: (): Promise<string> => ipcRenderer.invoke('log:getErrorLogPath'),
  getRendererLogPath: (): Promise<string> => ipcRenderer.invoke('log:getRendererLogPath'),
  appendRendererLog: (line: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('log:appendRendererLog', line),
  getStartupLogPath: (): Promise<string> => ipcRenderer.invoke('log:getStartupLogPath'),
  refocusWindow: () => ipcRenderer.invoke('window:refocus'),
  statPath: (p: string): Promise<{ isDirectory: boolean }> => ipcRenderer.invoke('path:stat', p),
  getDeleteBehavior: (filePaths: string[]): Promise<{ permanentOnly: boolean; reason?: string }> =>
    ipcRenderer.invoke('path:getDeleteBehavior', filePaths),
  renameFile: (oldPath: string, newBaseName: string): Promise<{ success: boolean; newPath?: string; error?: string }> =>
    ipcRenderer.invoke('file:rename', oldPath, newBaseName),
  watchFolder: (path: string | null): Promise<void> => ipcRenderer.invoke('folder:watch', path),
  onFolderChanged: (cb: () => void): (() => void) => {
    const handler = () => cb()
    ipcRenderer.on('folder:changed', handler)
    return () => ipcRenderer.removeListener('folder:changed', handler)
  },
  setFolderWatchState: (payload: {
    rules: { sourceFolder: string; destFolder: string; enabled: boolean }[]
    imports: Record<string, { sourcePath: string; sizeBytes: number; mtimeMs: number; importedAt: string; contentHash?: string }[]>
  }): Promise<void> =>
    ipcRenderer.invoke('folderWatch:setState', payload),
  folderWatchResync: (sourceFolder: string): Promise<void> =>
    ipcRenderer.invoke('folderWatch:resync', sourceFolder),
  onFolderWatchCopied: (cb: (event: {
    sourcePath: string
    destPath: string
    sourceFolder: string
    destFolder: string
    importEntry: { sourcePath: string; sizeBytes: number; mtimeMs: number; importedAt: string; contentHash?: string }
  }) => void): (() => void) => {
    const handler = (_event: unknown, payload: {
      sourcePath: string
      destPath: string
      sourceFolder: string
      destFolder: string
      importEntry: { sourcePath: string; sizeBytes: number; mtimeMs: number; importedAt: string; contentHash?: string }
    }) => cb(payload)
    ipcRenderer.on('folderWatch:copied', handler)
    return () => ipcRenderer.removeListener('folderWatch:copied', handler)
  },
  onFolderWatchImportsBackfilled: (cb: (event: { key: string; entries: { sourcePath: string; sizeBytes: number; mtimeMs: number; importedAt: string; contentHash?: string }[] }) => void): (() => void) => {
    const handler = (_event: unknown, payload: { key: string; entries: { sourcePath: string; sizeBytes: number; mtimeMs: number; importedAt: string; contentHash?: string }[] }) => cb(payload)
    ipcRenderer.on('folderWatch:importsBackfilled', handler)
    return () => ipcRenderer.removeListener('folderWatch:importsBackfilled', handler)
  },
  onFolderWatchError: (cb: (event: { sourceFolder: string; destFolder: string; message: string }) => void): (() => void) => {
    const handler = (_event: unknown, payload: { sourceFolder: string; destFolder: string; message: string }) => cb(payload)
    ipcRenderer.on('folderWatch:error', handler)
    return () => ipcRenderer.removeListener('folderWatch:error', handler)
  },
  // Fired when a watch rule's destination folder no longer exists (e.g. deleted in Explorer).
  // The renderer auto-cancels the rule so it stops retrying/erroring forever.
  onFolderWatchDestMissing: (cb: (event: { sourceFolder: string; destFolder: string }) => void): (() => void) => {
    const handler = (_event: unknown, payload: { sourceFolder: string; destFolder: string }) => cb(payload)
    ipcRenderer.on('folderWatch:destMissing', handler)
    return () => ipcRenderer.removeListener('folderWatch:destMissing', handler)
  },
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  createFolder: (parentPath: string, name: string): Promise<{ success: boolean; newPath?: string; error?: string }> =>
    ipcRenderer.invoke('folder:create', parentPath, name),
  renameFolder: (folderPath: string, newName: string): Promise<{ success: boolean; newPath?: string; error?: string }> =>
    ipcRenderer.invoke('folder:rename', folderPath, newName),
  moveFolder: (sourcePath: string, destParentPath: string, allowMerge = false): Promise<{ success: boolean; newPath?: string; error?: string; mergedIntoExisting?: boolean; mergeTargetPath?: string; skippedPaths?: string[] }> =>
    ipcRenderer.invoke('folder:move', sourcePath, destParentPath, allowMerge),
  deleteEmptyFolder: (folderPath: string): Promise<{ success: boolean; error?: string; removedCount?: number }> =>
    ipcRenderer.invoke('folder:deleteEmpty', folderPath),
  trashFiles: (filePaths: string[]): Promise<{ filePath: string; success: boolean; error?: string; deleteMode?: 'trash' | 'delete' }[]> =>
    ipcRenderer.invoke('file:trash', filePaths),
  copyFiles: (filePaths: string[], destDir: string, destBaseNames?: string[]): Promise<{ filePath: string; success: boolean; destPath?: string; error?: string }[]> =>
    ipcRenderer.invoke('file:copy', filePaths, destDir, destBaseNames),
  clearNamLab: (filePaths: string[]): Promise<{ filePath: string; success: boolean; error?: string }[]> =>
    ipcRenderer.invoke('file:clearNamLab', filePaths),
  cleanOutdatedNamBot: (filePaths: string[]): Promise<{ filePath: string; success: boolean; error?: string; changed?: boolean }[]> =>
    ipcRenderer.invoke('file:cleanOutdatedNamBot', filePaths),
  getPendingFiles: (): Promise<string[]> => ipcRenderer.invoke('app:getPendingFiles'),
  checkForUpdates: (includeRc: boolean): Promise<{ hasUpdate?: boolean; latestVersion?: string; releaseUrl?: string; error?: string }> =>
    ipcRenderer.invoke('app:checkForUpdates', includeRc),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:openExternal', url),
  showMessageBox: (options: { type?: 'none' | 'info' | 'error' | 'question' | 'warning'; title?: string; message: string; detail?: string; buttons: string[]; defaultId?: number; cancelId?: number; noLink?: boolean }): Promise<{ response: number }> =>
    ipcRenderer.invoke('app:showMessageBox', options),
  scanImages: (folderPath: string): Promise<{ success: boolean; images: string[] }> => ipcRenderer.invoke('folder:scanImages', folderPath),
  scanChildImages: (folderPath: string): Promise<{ success: boolean; groups: { folderName: string; paths: string[] }[] }> => ipcRenderer.invoke('folder:scanChildImages', folderPath),
  detectNamPlayer: (): Promise<boolean> => ipcRenderer.invoke('app:detectNamPlayer'),
  detectNamVersion: (pythonPath: string): Promise<{ version: 'a1' | 'a2' | 'unknown' }> => ipcRenderer.invoke('trainer:detectNamVersion', pythonPath),
  browseExecutable: (): Promise<string | null> => ipcRenderer.invoke('dialog:browseExecutable'),
  getTrainerState: (): Promise<TrainerStateSnapshot> => ipcRenderer.invoke('trainer:getState'),
  startTrainerRun: (payload: TrainerStartPayload): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('trainer:start', payload),
  enqueueTrainerRuns: (payloads: TrainerStartPayload[], opts?: { staged?: boolean }): Promise<{ success: boolean; error?: string; queued?: number }> =>
    ipcRenderer.invoke('trainer:enqueue', payloads, opts),
  unstageTrainerSubmission: (submissionId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('trainer:unstageSubmission', submissionId),
  stageTrainerJob: (jobId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('trainer:stageJob', jobId),
  stageTrainerSubmission: (submissionId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('trainer:stageSubmission', submissionId),
  setTrainerProfilesState: (payload: unknown): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('trainer:setProfilesState', payload),
  getTrainerProfilesState: (): Promise<unknown> => ipcRenderer.invoke('trainer:getProfilesState'),
  markTrainingWatchCurrentContentsSeen: (profileId: string): Promise<{ success: boolean; error?: string; marked?: number }> =>
    ipcRenderer.invoke('trainer:markWatchCurrentSeen', profileId),
  clearProfileSkippedAndRescan: (profileId: string): Promise<{ success: boolean; error?: string; cleared?: number }> =>
    ipcRenderer.invoke('trainer:clearProfileSkippedAndRescan', profileId),
  getWatcherFilesStatus: (profileId: string, watchFolder: string, architectures: string[]): Promise<{ success: boolean; error?: string; files?: WatcherFileEntry[] }> =>
    ipcRenderer.invoke('trainer:getWatcherFilesStatus', profileId, watchFolder, architectures),
  resetWatcherFile: (profileId: string, filePath: string): Promise<{ success: boolean; error?: string; queued?: number }> =>
    ipcRenderer.invoke('trainer:resetWatcherFile', profileId, filePath),
  retrainFileAction: (profileId: string, filePath: string, action: 'wipe-retrain' | 'retrain-new' | 'mark-skipped'): Promise<{ success: boolean; error?: string; queued?: number }> =>
    ipcRenderer.invoke('trainer:retrainFileAction', profileId, filePath, action),
  setTrainerProfileRunning: (profileId: string, running: boolean): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('trainer:setProfileRunning', profileId, running),
  runTrainerFolderOnce: (payload: unknown): Promise<{ success: boolean; error?: string; queued?: number; scanned?: number }> =>
    ipcRenderer.invoke('trainer:runFolderOnce', payload),
  cancelTrainerRun: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('trainer:cancel'),
  setTrainerPauseAfterCurrent: (pause: boolean): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('trainer:setPauseAfterCurrent', pause),
  startQueuedTrainerRuns: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('trainer:startQueued'),
  retryFailedTrainerRuns: (): Promise<{ success: boolean; retried?: number }> =>
    ipcRenderer.invoke('trainer:retryFailed'),
  retryTrainerJob: (jobId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('trainer:retryJob', jobId),
  clearFinishedTrainerRuns: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('trainer:clearFinished'),
  clearTrainerQueue: (): Promise<{ success: boolean; removed: number }> =>
    ipcRenderer.invoke('trainer:clearQueue'),
  removeQueuedTrainerRuns: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('trainer:removeQueued'),
  clearWatcherTrainerJobs: (): Promise<{ success: boolean; removed: number }> =>
    ipcRenderer.invoke('trainer:clearWatcherJobs'),
  removeTrainerJob: (jobId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('trainer:removeJob', jobId),
  purgeTrainerHistoryEntries: (historyIds: string[]): Promise<{ success: boolean; error?: string; removed: number }> =>
    ipcRenderer.invoke('trainer:purgeHistoryEntries', historyIds),
  watcherQueueAction: (jobId: string, action: 'remove' | 'skip' | 'move-canceled' | 'retry-now'): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('trainer:watcherQueueAction', jobId, action),
  moveTrainerJob: (jobId: string, direction: 'up' | 'down'): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('trainer:moveJob', jobId, direction),
  makeTrainerJobNext: (jobId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('trainer:makeNext', jobId),
  reorderTrainerJob: (jobId: string, beforeJobId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('trainer:reorderJob', jobId, beforeJobId),
  moveSubmissionBefore: (submissionId: string, beforeSubmissionId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('trainer:moveSubmissionBefore', submissionId, beforeSubmissionId),
  moveSubmissionToEnd: (submissionId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('trainer:moveSubmissionToEnd', submissionId),
  editSubmission: (
    submissionId: string,
    changes: { epochs?: number; thresholdEsr?: number | null; lr?: number; lrDecay?: number; submissionLabel?: string; inputPath?: string }
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('trainer:editSubmission', submissionId, changes),
  cancelTrainerBatch: (submissionId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('trainer:cancelBatch', submissionId),
  dismissTrainerBatch: (submissionId: string): Promise<{ success: boolean; removed?: number; error?: string }> =>
    ipcRenderer.invoke('trainer:dismissBatch', submissionId),
  retryTrainerHistoryEntry: (historyId: string): Promise<{ success: boolean; error?: string; queued?: number }> =>
    ipcRenderer.invoke('trainer:retryHistoryEntry', historyId),
  markHistoryRetried: (historyIds: string[]): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('trainer:markHistoryRetried', historyIds),
  clearSupersededQueueRows: (refs: Array<{ submissionId?: string | null; sourcePath: string; architecture: string }>): Promise<{ success: boolean; removed: number }> =>
    ipcRenderer.invoke('trainer:clearSupersededQueueRows', refs),
  onTrainerUpdate: (cb: (state: TrainerStateSnapshot) => void): (() => void) => {
    const handler = (_event: unknown, state: TrainerStateSnapshot) => cb(state)
    ipcRenderer.on('trainer:update', handler)
    return () => ipcRenderer.removeListener('trainer:update', handler)
  },
  onTrainerHistory: (cb: (history: TrainerHistoryEntry[]) => void): (() => void) => {
    const handler = (_event: unknown, history: TrainerHistoryEntry[]) => cb(history)
    ipcRenderer.on('trainer:history', handler)
    return () => ipcRenderer.removeListener('trainer:history', handler)
  },
  openInNam: (filePath: string, standalonePath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('app:openInNam', filePath, standalonePath),
  findPackFolders: (rootPath: string): Promise<string[]> =>
    ipcRenderer.invoke('folder:findPackFolders', rootPath),
  readBundle: (folderPath: string): Promise<{ success: boolean; data: unknown }> =>
    ipcRenderer.invoke('folder:readBundle', folderPath),
  writeBundle: (folderPath: string, data: unknown): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('folder:writeBundle', folderPath, data),
  deleteBundle: (folderPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('folder:deleteBundle', folderPath),
  scanBundlePaths: (rootPath: string): Promise<string[]> =>
    ipcRenderer.invoke('folder:scanBundlePaths', rootPath),
  findBundlePackFolders: (rootPath: string): Promise<{ folderPath: string; title: string }[]> =>
    ipcRenderer.invoke('folder:findBundlePackFolders', rootPath),
  findPackOwner: (folderPath: string, rootPath: string): Promise<string | null> =>
    ipcRenderer.invoke('folder:findPackOwner', folderPath, rootPath),
  readPackInfo: (folderPath: string): Promise<{ success: boolean; data: unknown }> =>
    ipcRenderer.invoke('folder:readPackInfo', folderPath),
  writePackInfo: (folderPath: string, data: unknown): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('folder:writePackInfo', folderPath, data),
  deletePackInfo: (folderPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('folder:deletePackInfo', folderPath),
  readReadme: (folderPath: string): Promise<{ success: boolean; exists: boolean; fileName: string; content: string; error?: string }> =>
    ipcRenderer.invoke('folder:readReadme', folderPath),
  writeReadme: (folderPath: string, fileName: string, content: string): Promise<{ success: boolean; fileName?: string; error?: string }> =>
    ipcRenderer.invoke('folder:writeReadme', folderPath, fileName, content),
  exportPackSheet: (html: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('app:exportPackSheet', html),
  onOpenFiles: (cb: (paths: string[]) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, paths: string[]) => cb(paths)
    ipcRenderer.on('app:openFiles', handler)
    return () => ipcRenderer.removeListener('app:openFiles', handler)
  },
  tone3000Status: (): Promise<{ connected: boolean; username: string | null }> => ipcRenderer.invoke('tone3000:status'),
  tone3000Connect: (): Promise<{ ok: boolean; username?: string | null; error?: string }> => ipcRenderer.invoke('tone3000:connect'),
  tone3000Disconnect: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('tone3000:disconnect'),
  tone3000Search: (params: { query?: string; page?: number; pageSize?: number; gears?: string[]; sizes?: string[]; sort?: string; architecture?: string; platform?: string; format?: string }): Promise<{ ok?: boolean; data?: unknown; error?: string }> => ipcRenderer.invoke('tone3000:search', params),
  tone3000Trending: (gear: string): Promise<{ ok?: boolean; data?: unknown; error?: string }> => ipcRenderer.invoke('tone3000:trending', gear),
  tone3000UsersSearch: (params: { query: string; page?: number; pageSize?: number; sort?: string }): Promise<{ ok?: boolean; data?: unknown; error?: string }> => ipcRenderer.invoke('tone3000:usersSearch', params),
  tone3000Created: (params: { page?: number; pageSize?: number }): Promise<{ ok?: boolean; data?: unknown; error?: string }> => ipcRenderer.invoke('tone3000:created', params),
  tone3000Favorited: (params: { page?: number; pageSize?: number }): Promise<{ ok?: boolean; data?: unknown; error?: string }> => ipcRenderer.invoke('tone3000:favorited', params),
  tone3000GetTone: (toneId: number): Promise<{ ok?: boolean; tone?: unknown; error?: string }> => ipcRenderer.invoke('tone3000:getTone', toneId),
  tone3000GetModels: (toneId: number, architecture?: string): Promise<{ ok?: boolean; models?: unknown[]; error?: string }> => ipcRenderer.invoke('tone3000:getModels', toneId, architecture),
  tone3000Download: (modelUrl: string, name: string): Promise<{ ok?: boolean; localPath?: string; error?: string }> => ipcRenderer.invoke('tone3000:download', modelUrl, name),
  tone3000FileExists: (destDir: string, name: string): Promise<{ exists: boolean; destPath?: string }> => ipcRenderer.invoke('tone3000:fileExists', destDir, name),
  tone3000SaveCoverImage: (imageUrl: string, destDir: string): Promise<{ ok?: boolean; skipped?: boolean; destPath?: string; error?: string }> =>
    ipcRenderer.invoke('tone3000:saveCoverImage', imageUrl, destDir),
  downloadCoverFromUrl: (imageUrl: string, destDir: string): Promise<{ success: boolean; destPath?: string; error?: string }> =>
    ipcRenderer.invoke('cover:downloadFromUrl', imageUrl, destDir),
  copyLocalCoverFile: (srcPath: string, destDir: string): Promise<{ success: boolean; destPath?: string; error?: string }> =>
    ipcRenderer.invoke('cover:copyLocalFile', srcPath, destDir),
  saveLocalCoverFromBase64: (base64: string, mimeType: string, destDir: string): Promise<{ success: boolean; destPath?: string; error?: string }> =>
    ipcRenderer.invoke('cover:saveFromBase64', base64, mimeType, destDir),
  openImagePicker: (): Promise<string | null> =>
    ipcRenderer.invoke('cover:openImagePicker'),
  showTextContextMenu: (params: { hasSelection: boolean; isEditable: boolean }): Promise<void> =>
    ipcRenderer.invoke('app:showTextContextMenu', params),
  setCompanionContext: (payload: { rootFolder?: string; activeFolder?: string }): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('companion:setContext', payload),
  getCompanionBridgeInfo: (): Promise<{ enabled: boolean; running: boolean; port: number; token: string; bindAddress: string; hostHints: string[]; configPath: string; inboxPath: string }> =>
    ipcRenderer.invoke('companion:getBridgeInfo'),
  getCompanionInbox: (): Promise<{ success: boolean; items: Array<{ id: string; kind: string; title: string; detail: string; createdAt: string; folderPath: string; assetPath: string | null; status: 'new' | 'reviewed' }> }> =>
    ipcRenderer.invoke('companion:getInbox'),
  markCompanionInboxReviewed: (itemId: string): Promise<{ success: boolean; error?: string; item?: { id: string; kind: string; title: string; detail: string; createdAt: string; folderPath: string; assetPath: string | null; status: 'new' | 'reviewed' } }> =>
    ipcRenderer.invoke('companion:markInboxReviewed', itemId),
  deleteCompanionInboxItem: (itemId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('companion:deleteInboxItem', itemId),
  updateCompanionBridgeConfig: (payload: { enabled?: boolean; regenerateToken?: boolean }): Promise<{ success: boolean; enabled: boolean; running: boolean; port: number; token: string; bindAddress: string; hostHints: string[]; configPath: string; inboxPath: string }> =>
    ipcRenderer.invoke('companion:updateBridgeConfig', payload),
  platform: process.platform,
  initialSettings,
  saveSettingsToFile: (json: string) => ipcRenderer.send('settings:save', json),
  saveAiKey: (provider: string, key: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('app:saveAiKey', provider, key),
  clearAiKey: (provider: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('app:clearAiKey', provider),
  aiEnrich: (payload: { prompt: string; provider: string; model: string }): Promise<{ success: boolean; text?: string; error?: string }> =>
    ipcRenderer.invoke('app:aiEnrich', payload),
  // IR Lab Manager — Phase 2 (docs/ir-lab-manager-build-plan.md section 10/12).
  irLibraryListRoots: (): Promise<Array<{ id: number; path: string; label: string | null; watch_mode: string; created_at: string }>> =>
    ipcRenderer.invoke('irLibrary:listRoots'),
  irLibraryAddRoot: (folderPath: string, label: string | null): Promise<{ libraryRootId: number }> =>
    ipcRenderer.invoke('irLibrary:addRoot', folderPath, label),
  irLibraryScan: (
    folderPath: string,
    label: string | null
  ): Promise<{ libraryRootId: number; foldersInserted: number; itemsInserted: number; elapsedMs: number }> =>
    ipcRenderer.invoke('irLibrary:scan', folderPath, label),
  irLibraryImportLabProjects: (
    folderPath: string,
    label: string | null
  ): Promise<{
    libraryRootId: number
    foldersInserted: number
    itemsInserted: number
    elapsedMs: number
    projectsFound: number
    itemsEnriched: number
    nonProjectItemsRemoved: number
    reusedExistingRoot: boolean
  }> => ipcRenderer.invoke('irLibrary:importLabProjects', folderPath, label),
  onIrLibraryScanProgress: (
    cb: (p: { filesSeen: number; foldersSeen: number; elapsedMs: number; done: boolean }) => void
  ): (() => void) => {
    const handler = (_event: unknown, p: { filesSeen: number; foldersSeen: number; elapsedMs: number; done: boolean }) => cb(p)
    ipcRenderer.on('irLibrary:scanProgress', handler)
    return () => ipcRenderer.removeListener('irLibrary:scanProgress', handler)
  },
  irLibraryQuery: (options: {
    libraryRootId?: number | null
    folderId?: number | null
    search?: string
    favoritesOnly?: boolean
    minRating?: number
    tagId?: number
    manufacturer?: string | string[]
    cabinet?: string
    speaker?: string | string[]
    microphone?: string | string[]
    sampleRate?: number | number[]
    bitDepth?: number | number[]
    channels?: number
    offset: number
    limit: number
  }): Promise<{
    rows: Array<{
      id: string
      relative_path: string
      display_name: string
      file_size: number | null
      is_favorite: number
      rating: number | null
      missing_since: string | null
      manufacturer: string | null
      manufacturer_source: string | null
      cabinet: string | null
      cabinet_source: string | null
      speaker: string | null
      speaker_source: string | null
      microphone: string | null
      microphone_source: string | null
      sample_rate: number | null
      bit_depth: number | null
      channels: number | null
      duration_seconds: number | null
      audio_format: string | null
      abs_path: string
    }>
    total: number
  }> => ipcRenderer.invoke('irLibrary:query', options),
  irLibrarySetFavorite: (itemId: string, isFavorite: boolean): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('irLibrary:setFavorite', itemId, isFavorite),
  irLibrarySetRating: (itemId: string, rating: number | null): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('irLibrary:setRating', itemId, rating),
  irLibraryListFolders: (
    libraryRootId: number
  ): Promise<
    Array<{ id: number; parent_id: number | null; relative_path: string; direct_item_count: number; is_lab_project: number }>
  > => ipcRenderer.invoke('irLibrary:listFolders', libraryRootId),
  irLibraryListAllFolders: (): Promise<
    Array<{
      id: number
      parent_id: number | null
      relative_path: string
      library_root_id: number
      library_root_label: string
      direct_item_count: number
      is_lab_project: number
    }>
  > => ipcRenderer.invoke('irLibrary:listAllFolders'),
  irLibraryGetLibraryOverview: (libraryRootId: number, folderId?: number | null): Promise<{
    totalItems: number
    totalFolders: number
    favoriteCount: number
    ratedCount: number
    documentCount: number
    taggedCount: number
    manufacturerBreakdown: Array<{ value: string; count: number }>
    microphoneBreakdown: Array<{ value: string; count: number }>
    speakerBreakdown: Array<{ value: string; count: number }>
    cabinetBreakdown: Array<{ value: string; count: number }>
    sampleRateBreakdown: Array<{ value: string; count: number }>
    bitDepthBreakdown: Array<{ value: string; count: number }>
    channelsBreakdown: Array<{ value: string; count: number }>
    totalBytes: number
    missingAudioInfoCount: number
    projectCount: number
  }> => ipcRenderer.invoke('irLibrary:getLibraryOverview', libraryRootId, folderId ?? null),
  irLibraryListFacetOptions: (
    field: 'manufacturer' | 'speaker' | 'microphone',
    libraryRootId: number | null,
    folderId: number | null
  ): Promise<Array<{ value: string; count: number }>> =>
    ipcRenderer.invoke('irLibrary:listFacetOptions', field, libraryRootId, folderId),
  irLibraryListNumericFacetOptions: (
    field: 'sampleRate' | 'bitDepth',
    libraryRootId: number | null,
    folderId: number | null
  ): Promise<Array<{ value: number; count: number }>> =>
    ipcRenderer.invoke('irLibrary:listNumericFacetOptions', field, libraryRootId, folderId),
  irLibraryGetProjectDetailForFolder: (folderId: number): Promise<{
    id: string
    name: string
    createdAt: string | null
    cabinet: string | null
    speaker: string | null
    amplifier: string | null
    room: string | null
    signalChain: string | null
    description: string | null
    projectNotes: string | null
    items: Array<{
      itemId: string
      displayName: string
      captureId: string | null
      cabinet: string | null
      speaker: string | null
      microphone: string | null
      position: string | null
      captureType: string | null
      sampleRate: number | null
      isStereo: boolean
      isTrueStereo: boolean
      speakerPosition: string | null
      modeledMicrophone: string | null
      presetKind: string | null
      micA: ProjectDetailMicShape
      micB: ProjectDetailMicShape
      variants: Array<{ id: string; name: string; isCurrent: boolean; isArchived: boolean; createdAt: string | null }>
    }>
  } | null> => ipcRenderer.invoke('irLibrary:getProjectDetailForFolder', folderId),
  irLibraryPreviewFolderRemoval: (folderId: number): Promise<{ itemCount: number; folderCount: number }> =>
    ipcRenderer.invoke('irLibrary:previewFolderRemoval', folderId),
  irLibraryRemoveFolderFromCatalog: (folderId: number): Promise<{ itemsRemoved: number; foldersRemoved: number }> =>
    ipcRenderer.invoke('irLibrary:removeFolderFromCatalog', folderId),
  irLibraryPreviewLibraryRootRemoval: (libraryRootId: number): Promise<{ itemCount: number; folderCount: number }> =>
    ipcRenderer.invoke('irLibrary:previewLibraryRootRemoval', libraryRootId),
  irLibraryRemoveLibraryRoot: (libraryRootId: number): Promise<{ itemsRemoved: number; foldersRemoved: number }> =>
    ipcRenderer.invoke('irLibrary:removeLibraryRoot', libraryRootId),
  irLibraryCheckItemAvailability: (itemId: string): Promise<{
    fileMissing: boolean
    missingScope?: 'item' | 'folder' | 'root'
    missingFolderId?: number
    missingFolderName?: string
    libraryRootId: number
    libraryRootLabel: string
    affectedItemCount: number
  }> => ipcRenderer.invoke('irLibrary:checkItemAvailability', itemId),
  irLibraryRelinkLibraryRoot: (libraryRootId: number, newPath: string): Promise<void> =>
    ipcRenderer.invoke('irLibrary:relinkLibraryRoot', libraryRootId, newPath),
  irLibraryRemoveItemFromCatalog: (itemId: string): Promise<void> => ipcRenderer.invoke('irLibrary:removeItemFromCatalog', itemId),
  irLibraryGetFolderDetail: (folderId: number): Promise<{
    id: number
    relativePath: string
    notes: string | null
    declared: Array<{ field: string; value: string; source: string }>
    documents: Array<{ id: number; folder_id: number; stored_path: string; original_filename: string | null; imported_at: string }>
    absPath: string
    isLabProject: boolean
  } | null> => ipcRenderer.invoke('irLibrary:getFolderDetail', folderId),
  irLibrarySetFolderMetadata: (folderId: number, field: string, value: string, source: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('irLibrary:setFolderMetadata', folderId, field, value, source),
  irLibraryRemoveFolderMetadata: (folderId: number, field: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('irLibrary:removeFolderMetadata', folderId, field),
  irLibrarySetFolderNotes: (folderId: number, notes: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('irLibrary:setFolderNotes', folderId, notes),
  irLibraryImportFolderDocument: (folderId: number): Promise<{
    id: number
    folder_id: number
    stored_path: string
    original_filename: string | null
    imported_at: string
  } | null> => ipcRenderer.invoke('irLibrary:importFolderDocument', folderId),
  irLibraryDeleteFolderDocument: (documentId: number): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('irLibrary:deleteFolderDocument', documentId),
  irLibraryExtractVendorDocumentFields: (
    folderId: number
  ): Promise<{ documentsProcessed: number; fieldsWritten: number }> =>
    ipcRenderer.invoke('irLibrary:extractVendorDocumentFields', folderId),
  irLibraryAddToTray: (itemId: string): Promise<{ success: boolean; reason?: string }> =>
    ipcRenderer.invoke('irLibrary:addToTray', itemId),
  irLibraryRemoveFromTray: (itemId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('irLibrary:removeFromTray', itemId),
  irLibraryListTray: (): Promise<Array<{ id: string; relative_path: string; display_name: string; abs_path: string; position: number }>> =>
    ipcRenderer.invoke('irLibrary:listTray'),
  irLibraryIsInTray: (itemId: string): Promise<boolean> => ipcRenderer.invoke('irLibrary:isInTray', itemId),
  irLabConnectorAvailable: (): Promise<boolean> => ipcRenderer.invoke('irLibrary:irLabConnectorAvailable'),
  irLibrarySendTrayToIrLab: (): Promise<{ success: boolean; reason?: string }> =>
    ipcRenderer.invoke('irLibrary:sendTrayToIrLab'),
  irLibraryListTags: (): Promise<Array<{ id: number; name: string; itemCount: number }>> =>
    ipcRenderer.invoke('irLibrary:listTags'),
  irLibraryGetOrCreateTag: (name: string): Promise<number> => ipcRenderer.invoke('irLibrary:getOrCreateTag', name),
  irLibraryRenameTag: (tagId: number, name: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('irLibrary:renameTag', tagId, name),
  irLibraryDeleteTag: (tagId: number): Promise<{ success: boolean }> => ipcRenderer.invoke('irLibrary:deleteTag', tagId),
  irLibraryAddItemToTag: (itemId: string, tagId: number): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('irLibrary:addItemToTag', itemId, tagId),
  irLibraryRemoveItemFromTag: (itemId: string, tagId: number): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('irLibrary:removeItemFromTag', itemId, tagId),
  irLibraryListTagsForItem: (itemId: string): Promise<Array<{ id: number; name: string; itemCount: number }>> =>
    ipcRenderer.invoke('irLibrary:listTagsForItem', itemId)
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.api = api
}
