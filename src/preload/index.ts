import { contextBridge, ipcRenderer, webUtils } from 'electron'
import fs from 'fs'
import path from 'path'

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
  openImageFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openImageFile'),
  readFileBinary: (filePath: string): Promise<{ data?: string; error?: string }> => ipcRenderer.invoke('file:readBinary', filePath),
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
  writeMetadata: (filePath: string, metadata: unknown) =>
    ipcRenderer.invoke('file:writeMetadata', filePath, metadata),
  scanFolder: (folderPath: string, hiddenFolders?: string) => ipcRenderer.invoke('folder:scanNam', folderPath, hiddenFolders),
  scanTree: (folderPath: string, hiddenFolders?: string) => ipcRenderer.invoke('folder:scanTree', folderPath, hiddenFolders),
  moveFile: (sourcePath: string, destDir: string, force = false) =>
    ipcRenderer.invoke('file:move', sourcePath, destDir, force) as Promise<{ success: boolean; error?: string; destPath?: string }>,
  revealFile: (filePath: string) => ipcRenderer.invoke('shell:revealFile', filePath),
  openFile: (filePath: string): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('shell:openFile', filePath),
  getErrorLogPath: (): Promise<string> => ipcRenderer.invoke('log:getErrorLogPath'),
  getRendererLogPath: (): Promise<string> => ipcRenderer.invoke('log:getRendererLogPath'),
  appendRendererLog: (line: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('log:appendRendererLog', line),
  getStartupLogPath: (): Promise<string> => ipcRenderer.invoke('log:getStartupLogPath'),
  refocusWindow: () => ipcRenderer.invoke('window:refocus'),
  statPath: (p: string): Promise<{ isDirectory: boolean }> => ipcRenderer.invoke('path:stat', p),
  renameFile: (oldPath: string, newBaseName: string): Promise<{ success: boolean; newPath?: string; error?: string }> =>
    ipcRenderer.invoke('file:rename', oldPath, newBaseName),
  watchFolder: (path: string | null): Promise<void> => ipcRenderer.invoke('folder:watch', path),
  onFolderChanged: (cb: () => void): (() => void) => {
    const handler = () => cb()
    ipcRenderer.on('folder:changed', handler)
    return () => ipcRenderer.removeListener('folder:changed', handler)
  },
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  createFolder: (parentPath: string, name: string): Promise<{ success: boolean; newPath?: string; error?: string }> =>
    ipcRenderer.invoke('folder:create', parentPath, name),
  renameFolder: (folderPath: string, newName: string): Promise<{ success: boolean; newPath?: string; error?: string }> =>
    ipcRenderer.invoke('folder:rename', folderPath, newName),
  moveFolder: (sourcePath: string, destParentPath: string): Promise<{ success: boolean; newPath?: string; error?: string }> =>
    ipcRenderer.invoke('folder:move', sourcePath, destParentPath),
  trashFiles: (filePaths: string[]): Promise<{ filePath: string; success: boolean; error?: string }[]> =>
    ipcRenderer.invoke('file:trash', filePaths),
  copyFiles: (filePaths: string[], destDir: string): Promise<{ filePath: string; success: boolean; destPath?: string; error?: string }[]> =>
    ipcRenderer.invoke('file:copy', filePaths, destDir),
  clearNamLab: (filePaths: string[]): Promise<{ filePath: string; success: boolean; error?: string }[]> =>
    ipcRenderer.invoke('file:clearNamLab', filePaths),
  getPendingFiles: (): Promise<string[]> => ipcRenderer.invoke('app:getPendingFiles'),
  checkForUpdates: (includeRc: boolean): Promise<{ hasUpdate?: boolean; latestVersion?: string; releaseUrl?: string; error?: string }> =>
    ipcRenderer.invoke('app:checkForUpdates', includeRc),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:openExternal', url),
  scanImages: (folderPath: string): Promise<{ success: boolean; images: string[] }> => ipcRenderer.invoke('folder:scanImages', folderPath),
  detectNamPlayer: (): Promise<boolean> => ipcRenderer.invoke('app:detectNamPlayer'),
  browseExecutable: (): Promise<string | null> => ipcRenderer.invoke('dialog:browseExecutable'),
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
  tone3000GetTone: (toneId: number): Promise<{ ok?: boolean; tone?: unknown; error?: string }> => ipcRenderer.invoke('tone3000:getTone', toneId),
  tone3000GetModels: (toneId: number): Promise<{ ok?: boolean; models?: unknown[]; error?: string }> => ipcRenderer.invoke('tone3000:getModels', toneId),
  tone3000Download: (modelUrl: string, name: string): Promise<{ ok?: boolean; localPath?: string; error?: string }> => ipcRenderer.invoke('tone3000:download', modelUrl, name),
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
