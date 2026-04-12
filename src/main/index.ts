import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, dirname, basename, normalize as normalizePath } from 'path'
import fs from 'fs'
import os from 'os'

const isDev = process.env['ELECTRON_RENDERER_URL'] !== undefined

// Module-level reference so IPC handlers can always reach the window
let mainWindow: BrowserWindow | null = null

// Folder watcher for auto-refresh feature
let folderWatcher: import('fs').FSWatcher | null = null

// ---- Startup logger ----
// Writes to os.tmpdir() immediately (safe before app ready), then moves to
// userData once the app is initialized. This lets us capture crashes that
// happen before any window appears.
const LOG_FILENAME = 'nam-lab-startup.log'
let logPath = join(os.tmpdir(), LOG_FILENAME)

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  try { fs.appendFileSync(logPath, line, 'utf-8') } catch { /* best effort */ }
  if (isDev) process.stdout.write(line)
}

function switchLogToUserData(): void {
  try {
    const newPath = join(app.getPath('userData'), LOG_FILENAME)
    // Copy existing log over then continue writing to the new location
    if (fs.existsSync(logPath)) fs.copyFileSync(logPath, newPath)
    logPath = newPath
  } catch { /* keep writing to tmpdir if this fails */ }
}

// Catch uncaught exceptions before anything else
process.on('uncaughtException', (err) => {
  log(`UNCAUGHT EXCEPTION: ${err.message}\n${err.stack ?? ''}`)
})
process.on('unhandledRejection', (reason) => {
  log(`UNHANDLED REJECTION: ${String(reason)}`)
})

log(`NAM Lab starting — platform: ${process.platform}, arch: ${process.arch}, node: ${process.version}`)
log(`Electron: ${process.versions.electron}, Chrome: ${process.versions.chrome}`)
log(`Args: ${process.argv.join(' ')}`)
log(`isDev: ${isDev}`)

// Persist window size and maximized state between launches
// Path is computed lazily inside each function — app.getPath() must not be
// called at module load time (before app ready) or it throws on some macOS configs
function winStatePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

function loadWinState(): { width: number; height: number; maximized: boolean } {
  try {
    return JSON.parse(fs.readFileSync(winStatePath(), 'utf-8'))
  } catch {
    return { width: 1280, height: 800, maximized: false }
  }
}

function saveWinState(): void {
  if (!mainWindow) return
  const maximized = mainWindow.isMaximized()
  const { width, height } = maximized ? { width: 1280, height: 800 } : mainWindow.getBounds()
  fs.writeFileSync(winStatePath(), JSON.stringify({ width, height, maximized }), 'utf-8')
}

function createWindow(): void {
  log('loadWinState...')
  const winState = loadWinState()
  log(`winState: ${JSON.stringify(winState)}`)
  mainWindow = new BrowserWindow({
    width: winState.width,
    height: winState.height,
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

  log('BrowserWindow created')
  mainWindow.on('ready-to-show', () => {
    log('ready-to-show fired — showing window')
    if (winState.maximized) mainWindow!.maximize()
    mainWindow!.show()
  })

  mainWindow.on('focus', () => {
    mainWindow!.webContents.focus()
  })

  // Save window size/maximize state on close and on resize (debounced)
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const debouncedSave = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(saveWinState, 500)
  }
  mainWindow.on('resize', debouncedSave)
  mainWindow.on('close', saveWinState)

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Prevent Electron from navigating to dropped file URLs — without this,
  // dropping a file onto the window replaces the app with the raw file contents.
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Surgically patch only the changed metadata fields in the raw file text.
// All original formatting, whitespace, field order, and non-metadata content
// (weights, config, etc.) are preserved byte-for-byte.
function patchMetadataFields(content: string, patches: Record<string, unknown>): string {
  // Find the "metadata": { block
  const metaKeyMatch = /"metadata"\s*:\s*\{/.exec(content)
  if (!metaKeyMatch) throw new Error('No "metadata" block found in file')

  const openBrace = metaKeyMatch.index + metaKeyMatch[0].length - 1
  const closeBrace = findMatchingBrace(content, openBrace)
  if (closeBrace === -1) throw new Error('Malformed metadata block')

  const prefix = content.slice(0, openBrace + 1) // up to and including {
  let inner = content.slice(openBrace + 1, closeBrace)
  const tail = content.slice(closeBrace)           // } onwards

  for (const [key, value] of Object.entries(patches)) {
    const newVal = serializeJsonValue(value)
    // Match "key"\s*:\s*<JSON-value> — handles null, strings, and numbers
    const re = new RegExp(
      `("${escapeRe(key)}")(\\s*:\\s*)(null|"(?:[^"\\\\]|\\\\.)*"|-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)`
    )
    if (re.test(inner)) {
      // Replace only the value; keep the key token and spacing intact
      inner = inner.replace(re, (_m, k, sep) => k + sep + newVal)
    } else if (value !== null && value !== undefined) {
      // Field doesn't exist yet — insert it, matching the file's indentation style
      const indentMatch = /\n([ \t]+)"/.exec(inner)
      const indent = indentMatch ? indentMatch[1] : '    '
      const trimmed = inner.trimEnd()
      const needsComma = trimmed.length > 0 && !trimmed.endsWith(',')
      // Preserve whatever trailing whitespace/newline was before the closing brace
      const trailing = inner.slice(trimmed.length)
      inner = trimmed + (needsComma ? ',' : '') + `\n${indent}"${key}": ${newVal}` + trailing
    }
  }

  return prefix + inner + tail
}

// Find the matching closing brace/bracket, correctly skipping strings
function findMatchingBrace(content: string, openPos: number): number {
  let depth = 0
  let i = openPos
  while (i < content.length) {
    const ch = content[i]
    if (ch === '"') {
      i++
      while (i < content.length) {
        if (content[i] === '\\') { i += 2; continue }
        if (content[i] === '"') break
        i++
      }
    } else if (ch === '{' || ch === '[') {
      depth++
    } else if (ch === '}' || ch === ']') {
      depth--
      if (depth === 0) return i
    }
    i++
  }
  return -1
}

function serializeJsonValue(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'number') return String(value)
  return JSON.stringify(String(value))
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Surgically remove the entire "nam_lab": {...} block from metadata.
// Handles leading comma (block in middle/end) and trailing comma (block at start).
function removeNamLabBlock(content: string): string {
  const namLabRe = /"nam_lab"\s*:\s*\{/
  const match = namLabRe.exec(content)
  if (!match) return content
  const openBrace = match.index + match[0].length - 1
  const closeBrace = findMatchingBrace(content, openBrace)
  if (closeBrace === -1) return content
  // The full block span: from `"nam_lab"` key to closing `}`
  const blockStart = match.index
  const blockEnd = closeBrace + 1
  // Remove preceding comma+whitespace if present, otherwise trailing comma+whitespace
  const before = content.slice(0, blockStart)
  const after = content.slice(blockEnd)
  const precedingComma = /,\s*$/.exec(before)
  if (precedingComma) {
    return before.slice(0, precedingComma.index) + after
  }
  const trailingComma = /^\s*,/.exec(after)
  if (trailingComma) {
    return before + after.slice(trailingComma[0].length)
  }
  return before + after
}

// Patch a field inside metadata.nam_lab, creating the block if needed.
// field = bare key (e.g. "mics"), NOT the nl_-prefixed renderer key
function patchNamLabField(content: string, field: string, value: unknown): string {
  const newVal = serializeJsonValue(value)
  const fieldRe = new RegExp(
    `("${escapeRe(field)}")(\\s*:\\s*)(null|"(?:[^"\\\\]|\\\\.)*"|-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)`
  )

  // Try to find existing nam_lab block inside metadata and update/insert the field
  const namLabRe = /"nam_lab"\s*:\s*\{/
  const namLabMatch = namLabRe.exec(content)
  if (namLabMatch) {
    const openBrace = namLabMatch.index + namLabMatch[0].length - 1
    const closeBrace = findMatchingBrace(content, openBrace)
    if (closeBrace !== -1) {
      let inner = content.slice(openBrace + 1, closeBrace)
      if (fieldRe.test(inner)) {
        inner = inner.replace(fieldRe, (_m, k, sep) => k + sep + newVal)
        return content.slice(0, openBrace + 1) + inner + content.slice(closeBrace)
      } else if (value !== null && value !== undefined) {
        const indentMatch = /\n([ \t]+)"/.exec(inner)
        const indent = indentMatch ? indentMatch[1] : '    '
        const trimmed = inner.trimEnd()
        const needsComma = trimmed.length > 0 && !trimmed.endsWith(',')
        const trailing = inner.slice(trimmed.length)
        inner = trimmed + (needsComma ? ',' : '') + `\n${indent}"${field}": ${newVal}` + trailing
        return content.slice(0, openBrace + 1) + inner + content.slice(closeBrace)
      }
      return content
    }
  }

  // No nam_lab block — inject it directly into the metadata block
  if (value === null || value === undefined) return content
  const metaKeyMatch = /"metadata"\s*:\s*\{/.exec(content)
  if (!metaKeyMatch) return content
  const openBrace = metaKeyMatch.index + metaKeyMatch[0].length - 1
  const closeBrace = findMatchingBrace(content, openBrace)
  if (closeBrace === -1) return content
  let inner = content.slice(openBrace + 1, closeBrace)
  const indentMatch = /\n([ \t]+)"/.exec(inner)
  const indent = indentMatch ? indentMatch[1] : '    '
  const trimmed = inner.trimEnd()
  const needsComma = trimmed.length > 0 && !trimmed.endsWith(',')
  const trailing = inner.slice(trimmed.length)
  const namLabBlock = `\n${indent}"nam_lab": {\n${indent}  "${field}": ${newVal}\n${indent}}`
  inner = trimmed + (needsComma ? ',' : '') + namLabBlock + trailing
  return content.slice(0, openBrace + 1) + inner + content.slice(closeBrace)
}

// Patch a field inside metadata.training.nam_bot, creating the structure if needed.
function patchNamBotField(content: string, field: string, value: unknown): string {
  const newVal = serializeJsonValue(value)

  // Try to find an existing nam_bot block inside training and update the field
  const namBotRe = /"nam_bot"\s*:\s*\{/
  const namBotMatch = namBotRe.exec(content)
  if (namBotMatch) {
    const openBrace = namBotMatch.index + namBotMatch[0].length - 1
    const closeBrace = findMatchingBrace(content, openBrace)
    if (closeBrace !== -1) {
      let inner = content.slice(openBrace + 1, closeBrace)
      const fieldRe = new RegExp(
        `("${escapeRe(field)}")(\\s*:\\s*)(null|"(?:[^"\\\\]|\\\\.)*"|-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)`
      )
      if (fieldRe.test(inner)) {
        inner = inner.replace(fieldRe, (_m, k, sep) => k + sep + newVal)
        return content.slice(0, openBrace + 1) + inner + content.slice(closeBrace)
      } else if (value !== null && value !== undefined) {
        // Insert field into existing nam_bot block
        const indentMatch = /\n([ \t]+)"/.exec(inner)
        const indent = indentMatch ? indentMatch[1] : '      '
        const trimmed = inner.trimEnd()
        const needsComma = trimmed.length > 0 && !trimmed.endsWith(',')
        const trailing = inner.slice(trimmed.length)
        inner = trimmed + (needsComma ? ',' : '') + `\n${indent}"${field}": ${newVal}` + trailing
        return content.slice(0, openBrace + 1) + inner + content.slice(closeBrace)
      }
      return content
    }
  }

  // No nam_bot block — find training block and inject nam_bot into it
  if (value === null || value === undefined) return content
  const trainingRe = /"training"\s*:\s*\{/
  const trainingMatch = trainingRe.exec(content)
  if (trainingMatch) {
    const openBrace = trainingMatch.index + trainingMatch[0].length - 1
    const closeBrace = findMatchingBrace(content, openBrace)
    if (closeBrace !== -1) {
      let inner = content.slice(openBrace + 1, closeBrace)
      const indentMatch = /\n([ \t]+)"/.exec(inner)
      const indent = indentMatch ? indentMatch[1] : '    '
      const trimmed = inner.trimEnd()
      const needsComma = trimmed.length > 0 && !trimmed.endsWith(',')
      const trailing = inner.slice(trimmed.length)
      const namBotBlock = `\n${indent}"nam_bot": {\n${indent}  "${field}": ${newVal}\n${indent}}`
      inner = trimmed + (needsComma ? ',' : '') + namBotBlock + trailing
      return content.slice(0, openBrace + 1) + inner + content.slice(closeBrace)
    }
  }

  // No training block at all — inject training.nam_bot into the metadata block
  const metaKeyMatch = /"metadata"\s*:\s*\{/.exec(content)
  if (!metaKeyMatch) return content
  const openBrace = metaKeyMatch.index + metaKeyMatch[0].length - 1
  const closeBrace = findMatchingBrace(content, openBrace)
  if (closeBrace === -1) return content
  let inner = content.slice(openBrace + 1, closeBrace)
  const indentMatch = /\n([ \t]+)"/.exec(inner)
  const indent = indentMatch ? indentMatch[1] : '    '
  const trimmed = inner.trimEnd()
  const needsComma = trimmed.length > 0 && !trimmed.endsWith(',')
  const trailing = inner.slice(trimmed.length)
  const trainingBlock = `\n${indent}"training": {\n${indent}  "nam_bot": {\n${indent}    "${field}": ${newVal}\n${indent}  }\n${indent}}`
  inner = trimmed + (needsComma ? ',' : '') + trainingBlock + trailing
  return content.slice(0, openBrace + 1) + inner + content.slice(closeBrace)
}

// ---- File association / open-with handling ----
// Paths queued before the window is ready are sent once it loads.
const pendingOpenPaths: string[] = []

function sendOpenPaths(paths: string[]) {
  const valid = paths.filter((p) => p.toLowerCase().endsWith('.nam') && fs.existsSync(p))
  if (valid.length === 0) return
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:openFiles', valid)
  } else {
    pendingOpenPaths.push(...valid)
  }
}

// macOS: file opened via Finder "Open With" or double-click after association
app.on('open-file', (event, path) => {
  event.preventDefault()
  sendOpenPaths([path])
})

// Windows/Linux: passed as CLI argument
function getArgvFiles(): string[] {
  // In packaged app, argv[1] may be the file path; skip electron/app executables
  return process.argv.slice(isDev ? 2 : 1).filter((a) => !a.startsWith('--') && a.toLowerCase().endsWith('.nam'))
}

app.whenReady().then(() => {
  log('app.whenReady fired')
  switchLogToUserData()
  log(`log file moved to userData: ${logPath}`)

  app.setName('NAM Lab')
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.coretonecaptures.namlab')
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
  const errorLogPath = join(app.getPath('userData'), 'parse-errors.log')
  ipcMain.handle('file:read', async (_event, filePath: string) => {
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      const data = JSON.parse(content)
      const meta = data.metadata ?? {}
      // Lift nested NAM-BOT fields up to flat metadata for the UI
      const nb = meta.training?.nam_bot
      if (nb?.trained_epochs != null) meta.nb_trained_epochs = nb.trained_epochs
      if (nb?.preset_name != null) meta.nb_preset_name = nb.preset_name
      // Lift NAM Lab extended fields (metadata.nam_lab.*) up to flat nl_ keys
      const nl = meta.nam_lab
      if (nl) {
        const nlKeys = ['mics','cabinet','cabinet_config','amp_channel','boost_pedal','amp_settings','pedal_settings','amp_switches','comments'] as const
        for (const k of nlKeys) {
          if (nl[k] != null) (meta as Record<string, unknown>)[`nl_${k}`] = nl[k]
        }
      }
      return {
        success: true,
        filePath,
        version: data.version ?? '?',
        metadata: meta,
        architecture: data.architecture ?? '?',
        config: data.config ?? null
      }
    } catch (err) {
      const line = `[${new Date().toISOString()}] ${filePath}\n  ${String(err)}\n`
      fs.appendFileSync(errorLogPath, line, 'utf-8')
      return { success: false, error: String(err) }
    }
  })

  // IPC: Return the path to the parse error log file
  ipcMain.handle('log:getErrorLogPath', () => errorLogPath)

  // IPC: Write updated metadata back to file (preserves weights and all non-editable fields)
  // Only updates the fields the editor explicitly manages — never injects new keys.
  // Uses surgical text replacement so only the changed value bytes are modified;
  // all formatting, spacing, and field order in the original file are preserved exactly.
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

      // Build patch map: only fields that exist on disk or are being set to a real value
      const patches: Record<string, unknown> = {}
      for (const key of EDITABLE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(orig, key) || incoming[key] != null) {
          patches[key] = incoming[key] ?? null
        }
      }

      // Apply surgical patches — only the value bytes for each field are changed
      let patched = patchMetadataFields(content, patches)

      // Handle nb_trained_epochs — stored at metadata.training.nam_bot.trained_epochs
      const origEpochs = orig.training?.nam_bot?.trained_epochs ?? null
      const newEpochs = incoming.nb_trained_epochs != null ? Number(incoming.nb_trained_epochs) : null
      if (newEpochs !== origEpochs) {
        patched = patchNamBotField(patched, 'trained_epochs', newEpochs)
      }

      // Handle NAM Lab extended fields — stored at metadata.nam_lab.*
      const origNl = (orig.nam_lab ?? {}) as Record<string, unknown>
      const nlKeys = ['mics','cabinet','cabinet_config','amp_channel','boost_pedal','amp_settings','pedal_settings','amp_switches','comments'] as const
      for (const k of nlKeys) {
        const rendererKey = `nl_${k}`
        const origVal = origNl[k] ?? null
        const newVal = incoming[rendererKey] != null ? incoming[rendererKey] : null
        if (origVal !== newVal || (origVal == null && newVal != null)) {
          patched = patchNamLabField(patched, k, newVal)
        }
      }

      fs.writeFileSync(filePath, patched, 'utf-8')
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // IPC: Scan a folder recursively for .nam files (flat list)
  // hiddenFolders: comma-separated folder names to skip entirely (case-insensitive)
  ipcMain.handle('folder:scanNam', async (_event, folderPath: string, hiddenFolders?: string) => {
    const hidden = new Set(
      ['_duplicates', ...(hiddenFolders ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)]
    )
    try {
      const files: string[] = []
      const scan = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          const full = join(dir, entry.name)
          if (entry.isDirectory()) {
            if (hidden.has(entry.name.toLowerCase())) continue
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
  // hiddenFolders: comma-separated folder names to skip entirely (case-insensitive)
  ipcMain.handle('folder:scanTree', async (_event, folderPath: string, hiddenFolders?: string) => {
    const norm = (p: string) => p.replace(/\\/g, '/')
    const hidden = new Set(
      ['_duplicates', ...(hiddenFolders ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)]
    )
    interface FolderNode {
      name: string
      path: string
      children: FolderNode[]
      fileCount: number
      totalCount: number
    }
    try {
      const buildTree = (dir: string): FolderNode => {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        const children: FolderNode[] = []
        let fileCount = 0
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (hidden.has(entry.name.toLowerCase())) continue
            children.push(buildTree(join(dir, entry.name)))
          } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.nam')) {
            fileCount++
          }
        }
        const totalCount = fileCount + children.reduce((s, c) => s + c.totalCount, 0)
        const name = norm(dir).split('/').pop() ?? dir
        return { name, path: norm(dir), children, fileCount, totalCount }
      }
      const tree = buildTree(folderPath)
      return { success: true, tree }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // IPC: Move a file to a different folder (physical rename on disk)
  ipcMain.handle('file:move', async (_event, sourcePath: string, destDir: string) => {
    try {
      const fileName = sourcePath.replace(/\\/g, '/').split('/').pop()!
      const destPath = join(destDir, fileName)
      if (fs.existsSync(destPath)) {
        return { success: false, error: 'exists', destPath: destPath.replace(/\\/g, '/') }
      }
      fs.renameSync(sourcePath, destPath)
      return { success: true, destPath: destPath.replace(/\\/g, '/') }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // IPC: Move file(s) to the OS trash (recoverable)
  ipcMain.handle('file:trash', async (_event, filePaths: string[]) => {
    const results: { filePath: string; success: boolean; error?: string }[] = []
    for (const filePath of filePaths) {
      try {
        await shell.trashItem(filePath)
        results.push({ filePath, success: true })
      } catch (err) {
        results.push({ filePath, success: false, error: String(err) })
      }
    }
    return results
  })

  // IPC: Copy file(s) to a destination folder (non-destructive)
  ipcMain.handle('file:copy', async (_event, filePaths: string[], destDir: string) => {
    const results: { filePath: string; success: boolean; destPath?: string; error?: string }[] = []
    for (const filePath of filePaths) {
      try {
        const fileName = filePath.replace(/\\/g, '/').split('/').pop()!
        const destPath = join(destDir, fileName)
        if (fs.existsSync(destPath)) {
          results.push({ filePath, success: false, error: 'exists' })
          continue
        }
        fs.copyFileSync(filePath, destPath)
        results.push({ filePath, success: true, destPath: destPath.replace(/\\/g, '/') })
      } catch (err) {
        results.push({ filePath, success: false, error: String(err) })
      }
    }
    return results
  })

  // IPC: Remove the metadata.nam_lab block from files (cleans up NAM Lab custom fields)
  ipcMain.handle('file:clearNamLab', async (_event, filePaths: string[]) => {
    const results: { filePath: string; success: boolean; error?: string }[] = []
    for (const filePath of filePaths) {
      try {
        const content = fs.readFileSync(filePath, 'utf8')
        const patched = removeNamLabBlock(content)
        if (patched !== content) fs.writeFileSync(filePath, patched, 'utf8')
        results.push({ filePath, success: true })
      } catch (err) {
        results.push({ filePath, success: false, error: String(err) })
      }
    }
    return results
  })

  // IPC: Check whether a path is a directory (used for drag-drop folder detection)
  ipcMain.handle('path:stat', (_event, p: string) => {
    try {
      return { isDirectory: fs.statSync(p).isDirectory() }
    } catch {
      return { isDirectory: false }
    }
  })

  // IPC: Reveal a file in Finder / Explorer
  ipcMain.handle('shell:revealFile', (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  // IPC: Restore keyboard focus after native dialogs or component unmounts.
  // On Windows: blur→focus cycle resets Chromium's stale internal focus state.
  // On macOS: blur() causes a visible window flash — webContents.focus() alone is enough.
  ipcMain.handle('window:refocus', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (process.platform === 'win32') {
      mainWindow.blur()
      mainWindow.focus()
    } else {
      mainWindow.webContents.focus()
    }
  })

  // IPC: expose log file path so Settings panel can show "Open Log" button
  ipcMain.handle('log:getStartupLogPath', () => logPath)

  // IPC: Rename a .nam file on disk
  ipcMain.handle('file:rename', async (_event, oldPath: string, newBaseName: string) => {
    try {
      const newPath = join(dirname(oldPath), newBaseName + '.nam')
      if (fs.existsSync(newPath)) {
        return { success: false, error: 'A file with that name already exists' }
      }
      fs.renameSync(oldPath, newPath)
      return { success: true, newPath: newPath.replace(/\\/g, '/') }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // IPC: Watch a folder for .nam file changes and notify renderer
  ipcMain.handle('folder:watch', async (_event, folderPath: string | null) => {
    // Stop any existing watcher
    if (folderWatcher) {
      try { folderWatcher.close() } catch { /* ignore */ }
      folderWatcher = null
    }
    if (!folderPath) return

    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    try {
      folderWatcher = fs.watch(folderPath, { recursive: true }, (_eventType, filename) => {
        if (!filename || !filename.toLowerCase().endsWith('.nam')) return
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          mainWindow?.webContents.send('folder:changed')
        }, 1500)
      })
    } catch (err) {
      log(`folder:watch error: ${String(err)}`)
    }
  })

  // IPC: Create a subfolder
  ipcMain.handle('folder:create', async (_event, parentPath: string, name: string) => {
    try {
      const newPath = join(parentPath, name)
      if (fs.existsSync(newPath)) {
        return { success: false, error: 'A folder with that name already exists' }
      }
      fs.mkdirSync(newPath)
      return { success: true, newPath: newPath.replace(/\\/g, '/') }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // IPC: Rename a folder on disk and return the new path
  ipcMain.handle('folder:rename', async (_event, folderPath: string, newName: string) => {
    try {
      const normalized = normalizePath(folderPath)
      const parent = dirname(normalized)
      const newPath = join(parent, newName)
      if (fs.existsSync(newPath)) {
        return { success: false, error: 'A folder with that name already exists' }
      }
      fs.renameSync(normalized, newPath)
      return { success: true, newPath: newPath.replace(/\\/g, '/') }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // IPC: Move a folder into another folder
  ipcMain.handle('folder:move', async (_event, sourcePath: string, destParentPath: string) => {
    try {
      const normSource = normalizePath(sourcePath)
      const name = basename(normSource)
      const newPath = join(normalizePath(destParentPath), name)
      log(`folder:move source="${sourcePath}" normSource="${normSource}" dest="${destParentPath}" newPath="${newPath}" srcExists=${fs.existsSync(normSource)}`)
      if (fs.existsSync(newPath)) {
        return { success: false, error: 'A folder with that name already exists at the destination' }
      }
      fs.renameSync(normSource, newPath)
      return { success: true, newPath: newPath.replace(/\\/g, '/') }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  log('creating window...')
  createWindow()
  log('window created')

  // Send any files queued before window was ready (macOS open-file events + Windows argv)
  const argvFiles = getArgvFiles()
  if (argvFiles.length > 0) pendingOpenPaths.push(...argvFiles)

  // Pull model: renderer calls this once mounted to get any startup files.
  // This avoids the race where did-finish-load fires before React subscribes.
  ipcMain.handle('app:getPendingFiles', () => {
    const valid = pendingOpenPaths.splice(0).filter((p) => p.toLowerCase().endsWith('.nam') && fs.existsSync(p))
    return valid
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
