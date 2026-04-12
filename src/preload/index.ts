import { contextBridge, ipcRenderer, webUtils } from 'electron'

const api = {
  openFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:openFiles'),
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
  openImportFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openImportFile'),
  readFileBinary: (filePath: string): Promise<{ data?: string; error?: string }> => ipcRenderer.invoke('file:readBinary', filePath),
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
  writeMetadata: (filePath: string, metadata: unknown) =>
    ipcRenderer.invoke('file:writeMetadata', filePath, metadata),
  scanFolder: (folderPath: string, hiddenFolders?: string) => ipcRenderer.invoke('folder:scanNam', folderPath, hiddenFolders),
  scanTree: (folderPath: string, hiddenFolders?: string) => ipcRenderer.invoke('folder:scanTree', folderPath, hiddenFolders),
  moveFile: (sourcePath: string, destDir: string) =>
    ipcRenderer.invoke('file:move', sourcePath, destDir) as Promise<{ success: boolean; error?: string; destPath?: string }>,
  revealFile: (filePath: string) => ipcRenderer.invoke('shell:revealFile', filePath),
  getErrorLogPath: (): Promise<string> => ipcRenderer.invoke('log:getErrorLogPath'),
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
  onOpenFiles: (cb: (paths: string[]) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, paths: string[]) => cb(paths)
    ipcRenderer.on('app:openFiles', handler)
    return () => ipcRenderer.removeListener('app:openFiles', handler)
  },
  platform: process.platform
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
