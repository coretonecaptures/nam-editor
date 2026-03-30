import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import fs from 'fs'

const isDev = process.env['ELECTRON_RENDERER_URL'] !== undefined

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1100,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform !== 'darwin'
      ? {
          titleBarStyle: 'hidden',
          titleBarOverlay: {
            color: '#111827',
            symbolColor: '#9ca3af',
            height: 32
          }
        }
      : { titleBarStyle: 'hiddenInset' }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#030712'
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // Fix: on Windows with hidden titlebar, window focus doesn't always forward to web contents
  // Symptom: text inputs unresponsive until Alt+Tab
  mainWindow.on('focus', () => {
    mainWindow.webContents.focus()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.nameditor.app')
  }

  // IPC: Open file dialog
  ipcMain.handle('dialog:openFiles', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'NAM Files', extensions: ['nam'] }]
    })
    return result.filePaths
  })

  // IPC: Open folder dialog
  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    return result.filePaths[0] ?? null
  })

  // IPC: Read a NAM file metadata (without exposing weights to renderer)
  ipcMain.handle('file:read', async (_event, filePath: string) => {
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      const data = JSON.parse(content)
      return {
        success: true,
        filePath,
        version: data.version ?? '?',
        metadata: data.metadata ?? {},
        architecture: data.architecture ?? '?',
        config: data.config ?? null
      }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // IPC: Write updated metadata back to file (preserves weights and all non-editable fields)
  // Only updates the fields the editor explicitly manages — never injects new keys
  const EDITABLE_FIELDS = [
    'name', 'modeled_by', 'gear_type', 'gear_make', 'gear_model',
    'tone_type', 'input_level_dbu', 'output_level_dbu'
  ] as const
  ipcMain.handle('file:writeMetadata', async (_event, filePath: string, metadata: unknown) => {
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      const data = JSON.parse(content)
      const orig = data.metadata ?? {}
      const incoming = metadata as Record<string, unknown>
      // Write all editable fields; add key if setting a real value, update/clear if key exists
      for (const key of EDITABLE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(orig, key) || incoming[key] != null) {
          orig[key] = incoming[key] ?? null
        }
      }
      data.metadata = orig
      fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8')
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // IPC: Scan a folder recursively for .nam files (flat list)
  ipcMain.handle('folder:scanNam', async (_event, folderPath: string) => {
    try {
      const files: string[] = []
      const scan = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const full = join(dir, entry.name)
          if (entry.isDirectory()) {
            scan(full)
          } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.nam')) {
            files.push(full.replace(/\\/g, '/'))
          }
        }
      }
      scan(folderPath)
      return { success: true, files }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // IPC: Scan a folder and return a tree structure for the Librarian
  ipcMain.handle('folder:scanTree', async (_event, folderPath: string) => {
    const norm = (p: string) => p.replace(/\\/g, '/')
    interface FolderNode {
      name: string
      path: string
      children: FolderNode[]
      fileCount: number
      totalCount: number
    }
    try {
      const buildTreeFixed = (dir: string): FolderNode => {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        const children: FolderNode[] = []
        let fileCount = 0
        for (const entry of entries) {
          const full = join(dir, entry.name)
          if (entry.isDirectory()) {
            children.push(buildTreeFixed(full))
          } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.nam')) {
            fileCount++
          }
        }
        const totalCount = fileCount + children.reduce((s, c) => s + c.totalCount, 0)
        const name = norm(dir).split('/').pop() ?? dir
        return { name, path: norm(dir), children, fileCount, totalCount }
      }
      const tree = buildTreeFixed(folderPath)
      return { success: true, tree }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // IPC: Reveal a file in Finder / Explorer
  ipcMain.handle('shell:revealFile', (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  // IPC: Refocus webContents — called on every mousedown from renderer to prevent
  // focus loss on Windows with hidden titlebar (focused element removed, native dialogs, etc.)
  ipcMain.handle('window:focus', () => {
    const win = BrowserWindow.getFocusedWindow()
    if (win) win.webContents.focus()
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
