import { contextBridge, ipcRenderer, webUtils } from 'electron'
import fs from 'fs'
import path from 'path'
import type { TrainerStartPayload, TrainerStateSnapshot } from '../renderer/src/types/trainer'

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
  hashFiles: (filePaths: string[]): Promise<{ filePath: string; success: boolean; hash?: string; error?: string }[]> =>
    ipcRenderer.invoke('file:hashMany', filePaths),
  hashFilesWithoutMetadata: (filePaths: string[]): Promise<{ filePath: string; success: boolean; hash?: string; error?: string }[]> =>
    ipcRenderer.invoke('file:hashManyWithoutMetadata', filePaths),
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
  writeMetadata: (filePath: string, metadata: unknown) =>
    ipcRenderer.invoke('file:writeMetadata', filePath, metadata),
  scanFolder: (folderPath: string, hiddenFolders?: string) => ipcRenderer.invoke('folder:scanNam', folderPath, hiddenFolders),
  scanTree: (folderPath: string, hiddenFolders?: string) => ipcRenderer.invoke('folder:scanTree', folderPath, hiddenFolders),
  listWavFiles: (folderPath: string): Promise<string[]> => ipcRenderer.invoke('folder:listWavFiles', folderPath),
  moveFile: (sourcePath: string, destDir: string, force = false, destBaseName?: string) =>
    ipcRenderer.invoke('file:move', sourcePath, destDir, force, destBaseName) as Promise<{ success: boolean; error?: string; destPath?: string }>,
  revealFile: (filePath: string) => ipcRenderer.invoke('shell:revealFile', filePath),
  openFile: (filePath: string): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('shell:openFile', filePath),
  getErrorLogPath: (): Promise<string> => ipcRenderer.invoke('log:getErrorLogPath'),
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
    imports: Record<string, { sourcePath: string; sizeBytes: number; mtimeMs: number; importedAt: string }[]>
  }): Promise<void> =>
    ipcRenderer.invoke('folderWatch:setState', payload),
  onFolderWatchCopied: (cb: (event: {
    sourcePath: string
    destPath: string
    sourceFolder: string
    destFolder: string
    importEntry: { sourcePath: string; sizeBytes: number; mtimeMs: number; importedAt: string }
  }) => void): (() => void) => {
    const handler = (_event: unknown, payload: {
      sourcePath: string
      destPath: string
      sourceFolder: string
      destFolder: string
      importEntry: { sourcePath: string; sizeBytes: number; mtimeMs: number; importedAt: string }
    }) => cb(payload)
    ipcRenderer.on('folderWatch:copied', handler)
    return () => ipcRenderer.removeListener('folderWatch:copied', handler)
  },
  onFolderWatchError: (cb: (event: { sourceFolder: string; destFolder: string; message: string }) => void): (() => void) => {
    const handler = (_event: unknown, payload: { sourceFolder: string; destFolder: string; message: string }) => cb(payload)
    ipcRenderer.on('folderWatch:error', handler)
    return () => ipcRenderer.removeListener('folderWatch:error', handler)
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
  detectNamPlayer: (): Promise<boolean> => ipcRenderer.invoke('app:detectNamPlayer'),
  browseExecutable: (): Promise<string | null> => ipcRenderer.invoke('dialog:browseExecutable'),
  getTrainerState: (): Promise<TrainerStateSnapshot> => ipcRenderer.invoke('trainer:getState'),
  startTrainerRun: (payload: TrainerStartPayload): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('trainer:start', payload),
  enqueueTrainerRuns: (payloads: TrainerStartPayload[]): Promise<{ success: boolean; error?: string; queued?: number }> =>
    ipcRenderer.invoke('trainer:enqueue', payloads),
  setTrainerProfilesState: (payload: unknown): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('trainer:setProfilesState', payload),
  getTrainerProfilesState: (): Promise<unknown> => ipcRenderer.invoke('trainer:getProfilesState'),
  markTrainingWatchCurrentContentsSeen: (profileId: string): Promise<{ success: boolean; error?: string; marked?: number }> =>
    ipcRenderer.invoke('trainer:markWatchCurrentSeen', profileId),
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
  removeQueuedTrainerRuns: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('trainer:removeQueued'),
  removeTrainerJob: (jobId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('trainer:removeJob', jobId),
  watcherQueueAction: (jobId: string, action: 'remove' | 'skip' | 'move-canceled' | 'retry-now'): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('trainer:watcherQueueAction', jobId, action),
  moveTrainerJob: (jobId: string, direction: 'up' | 'down'): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('trainer:moveJob', jobId, direction),
  makeTrainerJobNext: (jobId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('trainer:makeNext', jobId),
  retryTrainerHistoryEntry: (historyId: string): Promise<{ success: boolean; error?: string; queued?: number }> =>
    ipcRenderer.invoke('trainer:retryHistoryEntry', historyId),
  onTrainerUpdate: (cb: (state: TrainerStateSnapshot) => void): (() => void) => {
    const handler = (_event: unknown, state: TrainerStateSnapshot) => cb(state)
    ipcRenderer.on('trainer:update', handler)
    return () => ipcRenderer.removeListener('trainer:update', handler)
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
  tone3000Search: (params: { query?: string; page?: number; pageSize?: number; gears?: string[]; sizes?: string[]; sort?: string }): Promise<{ ok?: boolean; data?: unknown; error?: string }> => ipcRenderer.invoke('tone3000:search', params),
  tone3000UsersSearch: (params: { query: string; page?: number; pageSize?: number; sort?: string }): Promise<{ ok?: boolean; data?: unknown; error?: string }> => ipcRenderer.invoke('tone3000:usersSearch', params),
  tone3000Created: (params: { page?: number; pageSize?: number }): Promise<{ ok?: boolean; data?: unknown; error?: string }> => ipcRenderer.invoke('tone3000:created', params),
  tone3000Favorited: (params: { page?: number; pageSize?: number }): Promise<{ ok?: boolean; data?: unknown; error?: string }> => ipcRenderer.invoke('tone3000:favorited', params),
  tone3000GetTone: (toneId: number): Promise<{ ok?: boolean; tone?: unknown; error?: string }> => ipcRenderer.invoke('tone3000:getTone', toneId),
  tone3000GetModels: (toneId: number): Promise<{ ok?: boolean; models?: unknown[]; error?: string }> => ipcRenderer.invoke('tone3000:getModels', toneId),
  tone3000Download: (modelUrl: string, name: string): Promise<{ ok?: boolean; localPath?: string; error?: string }> => ipcRenderer.invoke('tone3000:download', modelUrl, name),
  tone3000FileExists: (destDir: string, name: string): Promise<{ exists: boolean; destPath?: string }> => ipcRenderer.invoke('tone3000:fileExists', destDir, name),
  tone3000SaveCoverImage: (imageUrl: string, destDir: string): Promise<{ ok?: boolean; skipped?: boolean; destPath?: string; error?: string }> =>
    ipcRenderer.invoke('tone3000:saveCoverImage', imageUrl, destDir),
  showTextContextMenu: (params: { hasSelection: boolean; isEditable: boolean }): Promise<void> =>
    ipcRenderer.invoke('app:showTextContextMenu', params),
  platform: process.platform,
  initialSettings,
  saveSettingsToFile: (json: string) => ipcRenderer.send('settings:save', json)
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
