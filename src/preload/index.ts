import { contextBridge, ipcRenderer } from 'electron'

const api = {
  openFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:openFiles'),
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
  writeMetadata: (filePath: string, metadata: unknown) =>
    ipcRenderer.invoke('file:writeMetadata', filePath, metadata),
  scanFolder: (folderPath: string) => ipcRenderer.invoke('folder:scanNam', folderPath),
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
