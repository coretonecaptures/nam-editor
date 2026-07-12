import { app, shell, BrowserWindow, ipcMain, dialog, protocol, net, Menu, safeStorage } from 'electron'
import { join, dirname, basename, extname, normalize as normalizePath, resolve, sep } from 'path'
import fs from 'fs'
import os from 'os'
import http from 'http'
import crypto from 'crypto'

const isDev = process.env['ELECTRON_RENDERER_URL'] !== undefined

// Enforce single instance — prevents double-launch on Windows (e.g. shell file association)
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
}

// Compares two semver strings; pre-release order: alpha < beta < rc < release
// Returns positive if a > b, negative if a < b, 0 if equal
function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [main, pre] = v.split('-')
    const parts = main.split('.').map(Number)
    return { parts, pre: pre ?? null }
  }
  const va = parse(a)
  const vb = parse(b)
  for (let i = 0; i < 3; i++) {
    const diff = (va.parts[i] ?? 0) - (vb.parts[i] ?? 0)
    if (diff !== 0) return diff
  }
  // Same numeric version: release (no pre) beats RC
  if (va.pre === null && vb.pre !== null) return 1
  if (va.pre !== null && vb.pre === null) return -1
  // Both have pre-release: compare label weight first, then numeric suffix
  // alpha < beta < rc
  if (va.pre !== null && vb.pre !== null) {
    const labelWeight = (pre: string) => {
      if (/^rc/i.test(pre)) return 3
      if (/^beta/i.test(pre)) return 2
      if (/^alpha/i.test(pre)) return 1
      return 0
    }
    const lw = labelWeight(va.pre) - labelWeight(vb.pre)
    if (lw !== 0) return lw
    const na = parseInt(va.pre.replace(/\D/g, ''), 10) || 0
    const nb = parseInt(vb.pre.replace(/\D/g, ''), 10) || 0
    return na - nb
  }
  return 0
}

function parseAllowedUrl(raw: string, allowedProtocols: string[]): URL | null {
  try {
    const url = new URL(raw)
    return allowedProtocols.includes(url.protocol) ? url : null
  } catch {
    return null
  }
}

function isAllowedTone3000Url(raw: string): boolean {
  const url = parseAllowedUrl(raw, ['https:'])
  if (!url) return false
  return url.hostname === 'www.tone3000.com' || url.hostname === 'tone3000.com' || url.hostname === 'api.tone3000.com'
}

function openExternalSafe(raw: string, allowedProtocols = ['https:', 'mailto:']): boolean {
  const url = parseAllowedUrl(raw, allowedProtocols)
  if (!url) return false
  void shell.openExternal(url.toString())
  return true
}

// Module-level reference so IPC handlers can always reach the window
let mainWindow: BrowserWindow | null = null

// Robust IPC send. `webContents.isDestroyed()` is NOT sufficient: when the renderer's
// render frame is disposed (renderer crash, or frame-swap on focus-loss/occlusion on
// Windows) isDestroyed() still returns false but `.send()` throws "Render frame was
// disposed before WebFrameMain could be accessed". try/catch is the only reliable guard.
// Returns true if the message was sent.
function safeSend(channel: string, ...args: unknown[]): boolean {
  const wc = mainWindow?.webContents
  if (!mainWindow || mainWindow.isDestroyed() || !wc || wc.isDestroyed()) return false
  try {
    wc.send(channel, ...args)
    return true
  } catch {
    // Frame disposed mid-flight — swallow. The renderer reloads itself or is gone.
    return false
  }
}

// Folder watcher for auto-refresh feature
let folderWatcher: import('fs').FSWatcher | null = null
let folderWatchRules: FolderWatchRule[] = []
const folderWatchers = new Map<string, import('fs').FSWatcher>()
const folderWatchInFlight = new Set<string>()
let folderWatchPollInterval: ReturnType<typeof setInterval> | null = null
// Suppress folder:changed events for 3s after any local write to avoid false-positive banners
let watcherSuppressUntil = 0
function suppressWatcher() { watcherSuppressUntil = Date.now() + 3000 }

interface FolderWatchRule {
  sourceFolder: string
  destFolder: string
  enabled: boolean
}

interface FolderWatchImportEntry {
  sourcePath: string
  sizeBytes: number
  mtimeMs: number
  importedAt: string
  contentHash?: string
}

interface MetadataWriteContext {
  source?: string
  batchId?: string
  index?: number
  total?: number
  fields?: string[]
}

type FolderWatchCopyOutcome = 'copied' | 'existing' | 'already-imported' | 'in-flight' | 'non-file' | 'timeout' | 'error' | 'dest-missing'

type TrainingSourceMode = 'watcher' | 'manual-folder-run' | 'manual-direct'
type TrainingSourcePostProcessMode = 'move' | 'copy' | 'keep'
type TrainingLatencyMode = 'auto' | 'manual'
type TrainingWatchInitialScanMode = 'process-existing' | 'new-only'

interface TrainingProfile {
  id: string
  name: string
  sourceMode: 'watcher' | 'manual-folder-run'
  enabled: boolean
  autoRun: boolean
  initialScanMode?: TrainingWatchInitialScanMode
  namingTemplate: string
  architectures: TrainerArchitecture[]
  epochs: number
  thresholdEsr: number | null
  latencyMode: TrainingLatencyMode
  latencyValue: number | null
  savePlot: boolean
  ignoreChecks: boolean
  sourcePostProcess: TrainingSourcePostProcessMode
  watchFolder: string
  processedWavRoot: string
  graphRoot: string
  effectiveOutputFormula?: string
  effectiveGraphFormula?: string
  finalModelRoot: string
}

let folderWatchImports = new Map<string, FolderWatchImportEntry[]>()

// ---- Startup logger ----
// Writes to os.tmpdir() immediately (safe before app ready), then moves to
// userData once the app is initialized. This lets us capture crashes that
// happen before any window appears.
const LOG_FILENAME = 'nam-lab-startup.log'
let logPath = join(os.tmpdir(), LOG_FILENAME)

// log() is called on hot paths — every fs.watch event (including skipped/suppressed ones)
// and in per-file loops when syncing a watch source. It used to append synchronously
// (fs.appendFileSync), which blocks Electron's single main-process thread — the same thread
// that dispatches all renderer IPC. A busy watch source (many files, or a slow/network drive)
// could stall that thread long enough that IPC calls (cancel, pause, etc.) queued up and the
// app looked hung. Chained async appends here preserve line order without blocking.
let logWriteQueue: Promise<void> = Promise.resolve()

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  logWriteQueue = logWriteQueue
    .then(() => fs.promises.appendFile(logPath, line, 'utf-8'))
    .catch(() => { /* best effort */ })
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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface CompanionBridgeConfig {
  token: string
  port: number
  bindAddress: string
  enabled: boolean
}

// Cap on companion request bodies (covers base64 inbox photo uploads) to bound memory/disk.
const COMPANION_MAX_BODY_BYTES = 25 * 1024 * 1024
const COMPANION_ASSET_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'heic', 'webp'])

interface CompanionContextState {
  rootFolder: string
  activeFolder: string
}

type CompanionInboxKind = 'note' | 'photo' | 'cover'

interface CompanionInboxItem {
  id: string
  kind: CompanionInboxKind
  title: string
  detail: string
  createdAt: string
  folderPath: string
  assetPath: string | null
  status: 'new' | 'reviewed'
}

interface CompanionPackChecklistItemSnapshot {
  id: string
  label: string
  completed: boolean
  completedDate: string
  notes: string
}

interface CompanionPackSummary {
  id: string
  folderPath: string
  title: string
  subtitle: string
  checklistPercent: number
  checklistCompletedCount: number
  checklistTotalCount: number
  targetDate: string
  liveDate: string
  captureCount: number
}

interface CompanionPackDetail extends CompanionPackSummary {
  description: string
  about: string
  capturedBy: string
  checklistNotes: string
  checklistItems: CompanionPackChecklistItemSnapshot[]
}

interface CompanionLibrarySummary {
  rootFolder: string
  activeFolder: string
  packCount: number
  captureCount: number
  completedPackCount: number
  averageChecklistPercent: number
  upcomingPackCount: number
  livePackCount: number
}

interface CompanionSnapshot {
  app: {
    name: string
    version: string
    bridgePort: number
    hostHints: string[]
    rootFolder: string
    activeFolder: string
  }
  trainer: TrainerStateSnapshot
  history: TrainerHistoryEntry[]
  watchers: TrainerWatcherRuntime[]
  library: CompanionLibrarySummary
  packs: CompanionPackSummary[]
  inbox: CompanionInboxItem[]
  tone3000: {
    connected: boolean
    username: string | null
  }
}

const COMPANION_BRIDGE_PORT = 38571
const COMPANION_BRIDGE_BIND_ADDRESS = '0.0.0.0'
const COMPANION_CACHE_TTL_MS = 15_000

let companionBridgeServer: http.Server | null = null
let companionBridgeConfig: CompanionBridgeConfig | null = null
let companionContext: CompanionContextState = { rootFolder: '', activeFolder: '' }
let companionInbox: CompanionInboxItem[] = []
let companionPackCache:
  | { rootFolder: string; activeFolder: string; expiresAt: number; packs: CompanionPackSummary[]; library: CompanionLibrarySummary }
  | null = null

function companionBridgeConfigPath(): string {
  return join(app.getPath('userData'), 'companion-bridge.json')
}

function companionInboxPath(): string {
  return join(app.getPath('userData'), 'companion-inbox.json')
}

function companionInboxAssetsDir(): string {
  return join(app.getPath('userData'), 'companion-inbox-assets')
}

function normalizeSlashPath(value: string | null | undefined): string {
  return (value ?? '').replace(/\\/g, '/').trim()
}

function loadEnableCompanionAppSetting(): boolean {
  try {
    const raw = fs.readFileSync(join(app.getPath('userData'), 'settings.json'), 'utf-8')
    const parsed = JSON.parse(raw) as { enableCompanionApp?: unknown }
    return parsed.enableCompanionApp === true
  } catch {
    return false
  }
}

function saveCompanionBridgeConfig(): void {
  if (!companionBridgeConfig) return
  try {
    fs.writeFileSync(companionBridgeConfigPath(), JSON.stringify(companionBridgeConfig, null, 2), 'utf-8')
  } catch (error) {
    log(`companion bridge config save failed: ${String(error)}`)
  }
}

function loadCompanionBridgeConfig(): CompanionBridgeConfig {
  const fallback: CompanionBridgeConfig = {
    token: crypto.randomBytes(24).toString('hex'),
    port: COMPANION_BRIDGE_PORT,
    bindAddress: COMPANION_BRIDGE_BIND_ADDRESS,
    enabled: true,
  }
  try {
    const raw = fs.readFileSync(companionBridgeConfigPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<CompanionBridgeConfig>
    const config: CompanionBridgeConfig = {
      token: typeof parsed.token === 'string' && parsed.token.trim() ? parsed.token.trim() : fallback.token,
      port: Number.isFinite(parsed.port) && (parsed.port ?? 0) > 0 ? Math.floor(parsed.port as number) : fallback.port,
      bindAddress: typeof parsed.bindAddress === 'string' && parsed.bindAddress.trim() ? parsed.bindAddress.trim() : fallback.bindAddress,
      // Toggleable kill switch: set "enabled": false in companion-bridge.json to keep the LAN
      // server off entirely. Defaults on so the companion app works out of the box.
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : fallback.enabled,
    }
    fs.writeFileSync(companionBridgeConfigPath(), JSON.stringify(config, null, 2), 'utf-8')
    return config
  } catch {
    fs.writeFileSync(companionBridgeConfigPath(), JSON.stringify(fallback, null, 2), 'utf-8')
    return fallback
  }
}

function loadCompanionInbox(): CompanionInboxItem[] {
  try {
    const raw = fs.readFileSync(companionInboxPath(), 'utf-8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry): CompanionInboxItem[] => {
      if (!entry || typeof entry !== 'object') return []
      const item = entry as Partial<CompanionInboxItem>
      if (typeof item.id !== 'string' || !item.id) return []
      return [{
        id: item.id,
        kind: item.kind === 'photo' || item.kind === 'cover' ? item.kind : 'note',
        title: typeof item.title === 'string' ? item.title : '',
        detail: typeof item.detail === 'string' ? item.detail : '',
        createdAt: typeof item.createdAt === 'string' && item.createdAt ? item.createdAt : new Date().toISOString(),
        folderPath: typeof item.folderPath === 'string' ? item.folderPath : '',
        assetPath: typeof item.assetPath === 'string' && item.assetPath ? item.assetPath : null,
        status: item.status === 'reviewed' ? 'reviewed' : 'new',
      }]
    })
  } catch {
    return []
  }
}

function saveCompanionInbox(): void {
  try {
    fs.writeFileSync(companionInboxPath(), JSON.stringify(companionInbox, null, 2), 'utf-8')
  } catch (error) {
    log(`companion inbox save failed: ${String(error)}`)
  }
}

function invalidateCompanionPackCache(): void {
  companionPackCache = null
}

// Defense-in-depth: confirm a target path actually sits inside an allowed parent
// directory, resolving "." / ".." first. Prevents path traversal on disk.
function isPathWithin(parentDir: string, target: string): boolean {
  if (!parentDir || !target) return false
  try {
    const parentResolved = resolve(normalizeSlashPath(parentDir))
    const targetResolved = resolve(normalizeSlashPath(target))
    const a = process.platform === 'win32' ? parentResolved.toLowerCase() : parentResolved
    const b = process.platform === 'win32' ? targetResolved.toLowerCase() : targetResolved
    return b === a || b.startsWith(a + sep)
  } catch {
    return false
  }
}

// Confirm a client-supplied folder path sits inside the library root the renderer told
// us about. Stops a token-holder from reading/writing pack JSON anywhere on disk.
function companionPathWithinRoot(target: string): boolean {
  return isPathWithin(companionContext.rootFolder, target)
}

function getCompanionHostHints(): string[] {
  const hints = new Set<string>(['127.0.0.1', 'localhost'])
  try {
    const interfaces = os.networkInterfaces()
    Object.values(interfaces).forEach((entries) => {
      entries?.forEach((entry) => {
        if (entry.family === 'IPv4' && !entry.internal && entry.address) {
          hints.add(entry.address)
        }
      })
    })
  } catch { /* ignore */ }
  return [...hints]
}

function summarizeCompanionChecklist(items: unknown): { percent: number; completedCount: number; totalCount: number } {
  const list = Array.isArray(items) ? items : []
  const normalized = list.filter((item): item is { completed?: boolean } => !!item && typeof item === 'object')
  const totalCount = normalized.length
  const completedCount = normalized.filter((item) => item.completed === true).length
  return {
    percent: totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0,
    completedCount,
    totalCount,
  }
}

async function countNamFilesInTree(rootPath: string, depth = 4): Promise<number> {
  if (!rootPath) return 0
  let count = 0
  const walk = async (dir: string, currentDepth: number) => {
    if (currentDepth > depth) return
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    await Promise.all(entries.map(async (entry) => {
      if (entry.isFile() && /\.nam$/i.test(entry.name)) {
        count += 1
        return
      }
      if (entry.isDirectory() && entry.name !== '_Duplicates') {
        await walk(join(dir, entry.name), currentDepth + 1)
      }
    }))
  }
  await walk(rootPath, 0)
  return count
}

async function scanCompanionPacks(rootPath: string, activeFolder: string): Promise<{ packs: CompanionPackSummary[]; library: CompanionLibrarySummary }> {
  const normalizedRoot = normalizeSlashPath(rootPath)
  const normalizedActive = normalizeSlashPath(activeFolder)
  const now = Date.now()
  if (
    companionPackCache &&
    companionPackCache.rootFolder === normalizedRoot &&
    companionPackCache.activeFolder === normalizedActive &&
    companionPackCache.expiresAt > now
  ) {
    return { packs: companionPackCache.packs, library: companionPackCache.library }
  }

  if (!normalizedRoot || !fs.existsSync(normalizedRoot)) {
    const emptyLibrary: CompanionLibrarySummary = {
      rootFolder: normalizedRoot,
      activeFolder: normalizedActive,
      packCount: 0,
      captureCount: 0,
      completedPackCount: 0,
      averageChecklistPercent: 0,
      upcomingPackCount: 0,
      livePackCount: 0,
    }
    companionPackCache = {
      rootFolder: normalizedRoot,
      activeFolder: normalizedActive,
      expiresAt: now + COMPANION_CACHE_TTL_MS,
      packs: [],
      library: emptyLibrary,
    }
    return { packs: [], library: emptyLibrary }
  }

  const packs: CompanionPackSummary[] = []
  const walk = async (dir: string, currentDepth: number) => {
    if (currentDepth > 8) return
    try {
      const raw = await fs.promises.readFile(join(dir, 'nam-pack.json'), 'utf-8')
      const data = JSON.parse(raw) as {
        title?: string
        subtitle?: string
        checklistItems?: unknown
        targetDate?: string
        liveDate?: string
      }
      const title = typeof data.title === 'string' ? data.title.trim() : ''
      if (title) {
        const checklist = summarizeCompanionChecklist(data.checklistItems)
        packs.push({
          id: normalizeSlashPath(dir),
          folderPath: normalizeSlashPath(dir),
          title,
          subtitle: typeof data.subtitle === 'string' ? data.subtitle.trim() : '',
          checklistPercent: checklist.percent,
          checklistCompletedCount: checklist.completedCount,
          checklistTotalCount: checklist.totalCount,
          targetDate: typeof data.targetDate === 'string' ? data.targetDate : '',
          liveDate: typeof data.liveDate === 'string' ? data.liveDate : '',
          captureCount: await countNamFilesInTree(dir, 3),
        })
      }
    } catch { /* no pack here */ }

    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true })
      await Promise.all(entries.map(async (entry) => {
        if (!entry.isDirectory() || entry.name === '_Duplicates') return
        await walk(join(dir, entry.name), currentDepth + 1)
      }))
    } catch { /* skip */ }
  }

  await walk(normalizedRoot, 0)
  packs.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))

  const captureCount = packs.reduce((sum, pack) => sum + pack.captureCount, 0)
  const completedPackCount = packs.filter((pack) => pack.checklistTotalCount > 0 && pack.checklistCompletedCount === pack.checklistTotalCount).length
  const averageChecklistPercent = packs.length > 0 ? Math.round(packs.reduce((sum, pack) => sum + pack.checklistPercent, 0) / packs.length) : 0
  const upcomingPackCount = packs.filter((pack) => !!pack.targetDate && !pack.liveDate).length
  const livePackCount = packs.filter((pack) => !!pack.liveDate).length
  const library: CompanionLibrarySummary = {
    rootFolder: normalizedRoot,
    activeFolder: normalizedActive,
    packCount: packs.length,
    captureCount,
    completedPackCount,
    averageChecklistPercent,
    upcomingPackCount,
    livePackCount,
  }

  companionPackCache = {
    rootFolder: normalizedRoot,
    activeFolder: normalizedActive,
    expiresAt: now + COMPANION_CACHE_TTL_MS,
    packs,
    library,
  }
  return { packs, library }
}

async function readCompanionPackDetail(folderPath: string): Promise<CompanionPackDetail | null> {
  const normalized = normalizeSlashPath(folderPath)
  if (!normalized || !companionPathWithinRoot(normalized)) return null
  try {
    const raw = await fs.promises.readFile(join(normalized, 'nam-pack.json'), 'utf-8')
    const data = JSON.parse(raw) as {
      title?: string
      subtitle?: string
      description?: string
      about?: string
      capturedBy?: string
      checklistNotes?: string
      checklistItems?: Partial<CompanionPackChecklistItemSnapshot>[]
      targetDate?: string
      liveDate?: string
    }
    const title = typeof data.title === 'string' ? data.title.trim() : ''
    if (!title) return null
    const checklistItems = Array.isArray(data.checklistItems)
      ? data.checklistItems.map((item, index) => ({
          id: typeof item?.id === 'string' && item.id ? item.id : `checklist-${index}`,
          label: typeof item?.label === 'string' ? item.label : '',
          completed: item?.completed === true,
          completedDate: typeof item?.completedDate === 'string' ? item.completedDate : '',
          notes: typeof item?.notes === 'string' ? item.notes : '',
        }))
      : []
    const checklist = summarizeCompanionChecklist(checklistItems)
    return {
      id: normalized,
      folderPath: normalized,
      title,
      subtitle: typeof data.subtitle === 'string' ? data.subtitle.trim() : '',
      checklistPercent: checklist.percent,
      checklistCompletedCount: checklist.completedCount,
      checklistTotalCount: checklist.totalCount,
      targetDate: typeof data.targetDate === 'string' ? data.targetDate : '',
      liveDate: typeof data.liveDate === 'string' ? data.liveDate : '',
      captureCount: await countNamFilesInTree(normalized, 3),
      description: typeof data.description === 'string' ? data.description : '',
      about: typeof data.about === 'string' ? data.about : '',
      capturedBy: typeof data.capturedBy === 'string' ? data.capturedBy : '',
      checklistNotes: typeof data.checklistNotes === 'string' ? data.checklistNotes : '',
      checklistItems,
    }
  } catch {
    return null
  }
}

async function updateCompanionPackChecklistItem(folderPath: string, itemId: string, updates: { completed?: boolean; notes?: string; completedDate?: string }): Promise<CompanionPackDetail | null> {
  const normalized = normalizeSlashPath(folderPath)
  if (!normalized || !itemId || !companionPathWithinRoot(normalized)) return null
  try {
    const packPath = join(normalized, 'nam-pack.json')
    const raw = await fs.promises.readFile(packPath, 'utf-8')
    const data = JSON.parse(raw) as { checklistItems?: Partial<CompanionPackChecklistItemSnapshot>[] }
    const items = Array.isArray(data.checklistItems) ? data.checklistItems : []
    let found = false
    data.checklistItems = items.map((item) => {
      const currentId = typeof item?.id === 'string' ? item.id : ''
      if (currentId !== itemId) return item
      found = true
      return {
        ...item,
        ...(updates.completed !== undefined ? { completed: updates.completed } : {}),
        ...(updates.notes !== undefined ? { notes: updates.notes } : {}),
        ...(updates.completedDate !== undefined ? { completedDate: updates.completedDate } : {}),
      }
    })
    if (!found) return null
    suppressWatcher()
    await fs.promises.writeFile(packPath, JSON.stringify(data, null, 2), 'utf-8')
    invalidateCompanionPackCache()
    return await readCompanionPackDetail(normalized)
  } catch {
    return null
  }
}

async function createCompanionInboxItem(payload: {
  kind?: string
  title?: string
  detail?: string
  folderPath?: string
  assetDataBase64?: string
  assetExtension?: string
}): Promise<CompanionInboxItem> {
  const kind: CompanionInboxKind = payload.kind === 'photo' || payload.kind === 'cover' ? payload.kind : 'note'
  let assetPath: string | null = null
  if (typeof payload.assetDataBase64 === 'string' && payload.assetDataBase64.trim()) {
    const sanitizedExt = (payload.assetExtension ?? 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase()
    // Only accept known image extensions; fall back to jpg for anything else.
    const ext = COMPANION_ASSET_EXTENSIONS.has(sanitizedExt) ? sanitizedExt : 'jpg'
    const buffer = Buffer.from(payload.assetDataBase64, 'base64')
    if (buffer.length === 0 || buffer.length > COMPANION_MAX_BODY_BYTES) {
      throw new Error('Companion asset is empty or too large.')
    }
    const dir = companionInboxAssetsDir()
    await fs.promises.mkdir(dir, { recursive: true })
    const filePath = join(dir, `${Date.now()}-${crypto.randomUUID()}.${ext}`)
    await fs.promises.writeFile(filePath, buffer)
    assetPath = normalizeSlashPath(filePath)
  }
  const item: CompanionInboxItem = {
    id: crypto.randomUUID(),
    kind,
    title: typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : (kind === 'cover' ? 'Cover image candidate' : kind === 'photo' ? 'Companion photo' : 'Companion note'),
    detail: typeof payload.detail === 'string' ? payload.detail.trim() : '',
    createdAt: new Date().toISOString(),
    folderPath: normalizeSlashPath(payload.folderPath),
    assetPath,
    status: 'new',
  }
  companionInbox = [item, ...companionInbox].slice(0, 200)
  saveCompanionInbox()
  return item
}

function markCompanionInboxItemReviewed(itemId: string): CompanionInboxItem | null {
  let updated: CompanionInboxItem | null = null
  companionInbox = companionInbox.map((item) => {
    if (item.id !== itemId) return item
    updated = { ...item, status: 'reviewed' }
    return updated
  })
  if (updated) saveCompanionInbox()
  return updated
}

async function getCompanionTone3000Status(): Promise<{ connected: boolean; username: string | null }> {
  if (!tone3kTokens) return { connected: false, username: null }
  const valid = await ensureValidToken()
  if (!valid || !tone3kTokens) return { connected: false, username: null }
  try {
    const res = await fetch(`${T3K_BASE}/api/v1/user`, {
      headers: { Authorization: `Bearer ${tone3kTokens.accessToken}`, 'User-Agent': 'NAM-Lab' }
    })
    if (!res.ok) return { connected: true, username: null }
    const user = await res.json() as { username?: string }
    return { connected: true, username: user.username ?? null }
  } catch {
    return { connected: true, username: null }
  }
}

async function buildCompanionSnapshot(): Promise<CompanionSnapshot> {
  const { packs, library } = await scanCompanionPacks(companionContext.rootFolder, companionContext.activeFolder)
  return {
    app: {
      name: app.getName(),
      version: app.getVersion(),
      bridgePort: companionBridgeConfig?.port ?? COMPANION_BRIDGE_PORT,
      hostHints: getCompanionHostHints(),
      rootFolder: companionContext.rootFolder,
      activeFolder: companionContext.activeFolder,
    },
    trainer: { ...trainerState, history: trainerHistory },
    history: trainerHistory.slice(0, 200),
    watchers: trainerState.watcherState.watchers,
    library,
    packs,
    inbox: companionInbox,
    tone3000: await getCompanionTone3000Status(),
  }
}

function writeCompanionJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  })
  res.end(JSON.stringify(payload))
}

function stopCompanionBridgeServer(): void {
  if (!companionBridgeServer) return
  try { companionBridgeServer.close() } catch { /* ignore */ }
  companionBridgeServer = null
}

async function readCompanionRequestBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.length
    if (total > COMPANION_MAX_BODY_BYTES) {
      throw new Error('Request body too large')
    }
    chunks.push(buf)
  }
  if (chunks.length === 0) return {}
  const raw = Buffer.concat(chunks).toString('utf-8')
  if (!raw.trim()) return {}
  return JSON.parse(raw)
}

function companionTokenMatches(provided: string | null | undefined, expected: string): boolean {
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  // Length check first (leaks only length); timingSafeEqual requires equal-length buffers.
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

function companionRequestAuthorized(req: http.IncomingMessage, url: URL): boolean {
  const expected = companionBridgeConfig?.token
  if (!expected) return false
  const auth = req.headers.authorization
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return companionTokenMatches(auth.slice('Bearer '.length).trim(), expected)
  }
  return companionTokenMatches(url.searchParams.get('token'), expected)
}

async function handleCompanionAction(action: string, body: unknown): Promise<{ ok: boolean; error?: string; data?: unknown }> {
  if (action === 'pause-after-current') {
    trainerPauseAfterCurrent = true
    emitTrainerState()
    return { ok: true }
  }
  if (action === 'resume-queue') {
    trainerPauseAfterCurrent = false
    emitTrainerState()
    await pumpTrainerQueue()
    return { ok: true }
  }
  if (action === 'emergency-stop') {
    if (!trainerChild || (trainerState.status !== 'running' && trainerState.status !== 'starting')) {
      return { ok: false, error: 'No training run is currently active.' }
    }
    const canceledAt = new Date().toISOString()
    requestEmergencyRequeueCurrentJob(true)
    trainerChild.kill()
    trainerState = {
      ...trainerState,
      status: 'canceled',
      finishedAt: canceledAt,
      error: '',
    }
    emitTrainerState()
    return { ok: true }
  }
  if (action === 'retry-job') {
    const jobId = typeof (body as { jobId?: unknown })?.jobId === 'string' ? (body as { jobId: string }).jobId : ''
    const index = findTrainerJobIndex(jobId)
    if (index === -1) return { ok: false, error: 'Training queue item not found.' }
    const job = trainerQueue[index]
    if (job.status !== 'error' && job.status !== 'canceled') {
      return { ok: false, error: 'Only failed or canceled training items can be retried.' }
    }
    trainerQueue[index] = resetTrainerJobForQueue(job)
    emitTrainerState()
    await pumpTrainerQueue()
    return { ok: true }
  }
  if (action === 'retry-history-entry') {
    const historyId = typeof (body as { historyId?: unknown })?.historyId === 'string' ? (body as { historyId: string }).historyId : ''
    const entry = trainerHistory.find((item) => item.historyId === historyId)
    if (!entry) return { ok: false, error: 'Training history entry not found.' }
    if (!entry.profileId) return { ok: false, error: 'Only profile-backed runs can be retried from mobile right now.' }
    const profile = trainingProfiles.find((item) => item.id === entry.profileId)
    if (!profile) return { ok: false, error: 'The training profile used by that history entry no longer exists.' }
    if (!trainerConfiguredPythonPath || !trainerConfiguredInputPath) {
      return { ok: false, error: 'Configure the trainer paths on desktop before retrying from mobile.' }
    }
    const sourcePath = [entry.processedWavPath, entry.sourcePath].find((candidate) => candidate && fs.existsSync(candidate))
    if (!sourcePath) return { ok: false, error: 'The source WAV for that history entry could not be found.' }
    clearTrainerSkipped(entry.profileId, entry.sourcePath, entry.architecture)
    clearTrainerSkipped(entry.profileId, sourcePath, entry.architecture)
    const payloads = (await buildTrainerPayloadsForProfile(
      profile,
      trainerConfiguredPythonPath,
      trainerConfiguredInputPath,
      [sourcePath],
      entry.sourceMode,
      {
        id: crypto.randomUUID(),
        label: `Retry - ${entry.profileName ?? profile.name}`,
        createdAt: new Date().toISOString(),
      }
    )).filter((payload) => payload.architecture === entry.architecture)
    if (payloads.length === 0) return { ok: false, error: 'That history entry could not be re-queued.' }
    const queued = await enqueueTrainingPayloads(payloads)
    return queued > 0
      ? { ok: true, data: { queued } }
      : { ok: false, error: 'That retry did not add a new queue item.' }
  }
  if (action === 'dismiss-batch') {
    const submissionId = typeof (body as { submissionId?: unknown })?.submissionId === 'string' ? (body as { submissionId: string }).submissionId : ''
    if (!submissionId) return { ok: false, error: 'No submission ID.' }
    const activeId = trainerState.activeJobId
    const before = trainerQueue.length
    trainerQueue = trainerQueue.filter((job) => job.submissionId !== submissionId || job.jobId === activeId)
    emitTrainerState()
    return { ok: true, data: { removed: before - trainerQueue.length } }
  }
  if (action === 'set-watcher-running') {
    const profileId = typeof (body as { profileId?: unknown })?.profileId === 'string' ? (body as { profileId: string }).profileId : ''
    const running = (body as { running?: unknown })?.running === true
    const target = trainingProfiles.find((profile) => profile.id === profileId && profile.sourceMode === 'watcher')
    if (!target) return { ok: false, error: 'Training watcher profile not found.' }
    if (!target.enabled && running) return { ok: false, error: 'Enable the watcher profile on desktop before starting it.' }
    if (running) trainingWatcherRunning.add(profileId)
    else trainingWatcherRunning.delete(profileId)
    resetTrainingWatchProfiles(trainingProfiles, trainingRetainGraphs)
    return { ok: true }
  }
  if (action === 'watcher-retry-now') {
    const jobId = typeof (body as { jobId?: unknown })?.jobId === 'string' ? (body as { jobId: string }).jobId : ''
    clearTrainerSkipped(
      trainerQueue.find((job) => job.jobId === jobId)?.profileId ?? null,
      trainerQueue.find((job) => job.jobId === jobId)?.outputPath ?? '',
      trainerQueue.find((job) => job.jobId === jobId)?.architecture ?? ''
    )
    const moved = makeQueuedTrainerJobNext(jobId)
    trainerPauseAfterCurrent = false
    emitTrainerState()
    await pumpTrainerQueue()
    return moved ? { ok: true } : { ok: false, error: 'Could not make that watcher item next.' }
  }
  if (action === 'update-checklist-item') {
    const payload = body as { folderPath?: unknown; itemId?: unknown; completed?: unknown; notes?: unknown; completedDate?: unknown }
    if (typeof payload.folderPath !== 'string' || typeof payload.itemId !== 'string') {
      return { ok: false, error: 'Checklist update requires a folderPath and itemId.' }
    }
    const detail = await updateCompanionPackChecklistItem(payload.folderPath, payload.itemId, {
      completed: typeof payload.completed === 'boolean' ? payload.completed : undefined,
      notes: typeof payload.notes === 'string' ? payload.notes : undefined,
      completedDate: typeof payload.completedDate === 'string' ? payload.completedDate : undefined,
    })
    return detail ? { ok: true, data: detail } : { ok: false, error: 'Could not update that checklist item.' }
  }
  if (action === 'create-inbox-item') {
    const payload = body as {
      kind?: unknown
      title?: unknown
      detail?: unknown
      folderPath?: unknown
      assetDataBase64?: unknown
      assetExtension?: unknown
    }
    const item = await createCompanionInboxItem({
      kind: typeof payload.kind === 'string' ? payload.kind : undefined,
      title: typeof payload.title === 'string' ? payload.title : undefined,
      detail: typeof payload.detail === 'string' ? payload.detail : undefined,
      folderPath: typeof payload.folderPath === 'string' ? payload.folderPath : undefined,
      assetDataBase64: typeof payload.assetDataBase64 === 'string' ? payload.assetDataBase64 : undefined,
      assetExtension: typeof payload.assetExtension === 'string' ? payload.assetExtension : undefined,
    })
    return { ok: true, data: item }
  }
  if (action === 'mark-inbox-reviewed') {
    const itemId = typeof (body as { itemId?: unknown })?.itemId === 'string' ? (body as { itemId: string }).itemId : ''
    const item = markCompanionInboxItemReviewed(itemId)
    return item ? { ok: true, data: item } : { ok: false, error: 'Inbox item not found.' }
  }
  return { ok: false, error: `Unknown companion action: ${action}` }
}

async function handleCompanionBridgeRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  if (req.method === 'OPTIONS') {
    writeCompanionJson(res, 200, { ok: true })
    return
  }
  if (!companionRequestAuthorized(req, url)) {
    writeCompanionJson(res, 401, { ok: false, error: 'Unauthorized' })
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/v1/health') {
    writeCompanionJson(res, 200, { ok: true, app: app.getName(), version: app.getVersion() })
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/snapshot') {
    writeCompanionJson(res, 200, { ok: true, snapshot: await buildCompanionSnapshot() })
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/history') {
    writeCompanionJson(res, 200, { ok: true, history: trainerHistory.slice(0, 200) })
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/packs') {
    const { packs } = await scanCompanionPacks(companionContext.rootFolder, companionContext.activeFolder)
    writeCompanionJson(res, 200, { ok: true, packs })
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/library') {
    const { library } = await scanCompanionPacks(companionContext.rootFolder, companionContext.activeFolder)
    writeCompanionJson(res, 200, { ok: true, library })
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/inbox') {
    writeCompanionJson(res, 200, { ok: true, inbox: companionInbox })
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/watchers') {
    writeCompanionJson(res, 200, { ok: true, watchers: trainerState.watcherState.watchers })
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/watchers/files') {
    const profileId = url.searchParams.get('profileId') ?? ''
    const profile = trainingProfiles.find((item) => item.id === profileId && item.sourceMode === 'watcher')
    if (!profile) {
      writeCompanionJson(res, 404, { ok: false, error: 'Training watcher profile not found.' })
      return
    }
    const sourceFolder = profile.watchFolder.trim()
    if (!sourceFolder) {
      writeCompanionJson(res, 200, { ok: true, files: [] })
      return
    }
    let wavFiles: string[] = []
    try {
      wavFiles = await scanWavFilesInFolder(sourceFolder)
    } catch (error) {
      writeCompanionJson(res, 500, { ok: false, error: `Could not scan folder: ${String(error)}` })
      return
    }
    const activeJobId = trainerState.activeJobId
    const files = await Promise.all(wavFiles.map(async (filePath) => {
      let sizeBytes = 0
      let mtimeMs = 0
      try {
        const stat = await fs.promises.stat(filePath)
        sizeBytes = stat.size
        mtimeMs = stat.mtimeMs
      } catch { /* ignore */ }
      const statuses = profile.architectures.map((arch) => {
        const normalizedFile = normalizePath(filePath)
        const activeJob = activeJobId ? trainerQueue.find((job) => job.jobId === activeJobId) : null
        if (activeJob && normalizePath(activeJob.outputPath) === normalizedFile && activeJob.profileId === profileId && activeJob.architecture === arch) {
          return { architecture: arch, status: 'running' }
        }
        if (trainerQueue.some((job) => normalizePath(job.outputPath) === normalizedFile && job.profileId === profileId && job.architecture === arch && job.status === 'queued')) {
          return { architecture: arch, status: 'queued' }
        }
        if (trainerSkipped.some((entry) => normalizePath(entry.sourcePath) === normalizedFile && entry.profileId === profileId && entry.architecture === arch)) {
          return { architecture: arch, status: 'skipped' }
        }
        const history = trainerHistory.find((entry) => normalizePath(entry.sourcePath) === normalizedFile && entry.profileId === profileId && entry.architecture === arch)
        if (history) {
          return { architecture: arch, status: history.status === 'success' ? 'done' : history.status }
        }
        return { architecture: arch, status: 'pending' }
      })
      return { filePath, fileName: basename(filePath), sizeBytes, mtimeMs, statuses }
    }))
    writeCompanionJson(res, 200, { ok: true, files })
    return
  }
  if (req.method === 'GET' && url.pathname === '/api/v1/pack-detail') {
    const folderPath = url.searchParams.get('folderPath') ?? ''
    const detail = await readCompanionPackDetail(folderPath)
    if (!detail) {
      writeCompanionJson(res, 404, { ok: false, error: 'Pack not found.' })
      return
    }
    writeCompanionJson(res, 200, { ok: true, pack: detail })
    return
  }
  if (req.method === 'POST' && url.pathname.startsWith('/api/v1/actions/')) {
    let body: unknown = {}
    try {
      body = await readCompanionRequestBody(req)
    } catch (error) {
      writeCompanionJson(res, 400, { ok: false, error: `Invalid JSON body: ${String(error)}` })
      return
    }
    const action = url.pathname.slice('/api/v1/actions/'.length)
    const result = await handleCompanionAction(action, body)
    writeCompanionJson(res, result.ok ? 200 : 400, result.ok ? { ok: true, data: result.data ?? null } : result)
    return
  }

  writeCompanionJson(res, 404, { ok: false, error: 'Not found' })
}

function startCompanionBridgeServer(): void {
  if (companionBridgeServer || !companionBridgeConfig) return
  if (!companionBridgeConfig.enabled) {
    log('companion bridge disabled via config (enabled: false) — not starting')
    return
  }
  const server = http.createServer((req, res) => {
    void handleCompanionBridgeRequest(req, res).catch((error) => {
      writeCompanionJson(res, 500, { ok: false, error: String(error) })
    })
  })
  server.on('error', (error) => {
    log(`companion bridge server error: ${String(error)}`)
  })
  server.listen(companionBridgeConfig.port, companionBridgeConfig.bindAddress, () => {
    log(`companion bridge listening on ${companionBridgeConfig?.bindAddress}:${companionBridgeConfig?.port}`)
  })
  companionBridgeServer = server
}

type TrainerArchitecture = string
type TrainerQueueJobStatus = 'queued' | 'starting' | 'running' | 'success' | 'error' | 'canceled'

interface WaveNetLayerConfig {
  input_size: number
  condition_size: number
  channels: number
  head_size: number
  kernel_size: number
  dilations: number[]
  activation: string
  gated: boolean
  head_bias: boolean
}

interface WaveNetConfig {
  layers_configs: WaveNetLayerConfig[]
  head_scale: number
}

interface TrainerStartPayload {
  pythonPath: string
  inputPath: string
  outputPath: string
  trainPath: string
  architecture: string
  epochs: number
  latency: number | null
  thresholdEsr: number | null
  savePlot: boolean
  silent: boolean
  ignoreChecks: boolean
  waveNetConfig?: WaveNetConfig | null
  lr?: number | null
  lrDecay?: number | null
  batchSize?: number | null
  ny?: number | null
  fitMrstft?: boolean | null
  captureProfileId?: string | null
  profileId?: string | null
  profileName?: string | null
  modeledBy?: string | null
  inputLevelDbu?: number | null
  outputLevelDbu?: number | null
  sourceMode?: TrainingSourceMode
  finalModelRoot?: string | null
  processedWavRoot?: string | null
  graphRoot?: string | null
  graphRootResolved?: boolean
  sourcePostProcess?: TrainingSourcePostProcessMode
  namingTemplate?: string | null
  submissionId?: string | null
  submissionLabel?: string | null
  submissionCreatedAt?: string | null
  appendModelArchitectureFolder?: boolean
  appendGraphArchitectureFolder?: boolean
  appendProcessedArchitectureFolder?: boolean
  // When true, Python backs up an existing target .nam to {name}.bak.nam before overwriting.
  // Set by the History "Retry failed" / "Retry batch" flow to protect previously-successful models.
  backupExisting?: boolean
}

interface TrainerQueueJob {
  jobId: string
  status: TrainerQueueJobStatus
  pythonPath: string
  inputPath: string
  outputPath: string
  trainPath: string
  architecture: string
  waveNetConfig: WaveNetConfig | null
  lr: number
  lrDecay: number
  batchSize: number
  ny: number
  fitMrstft: boolean
  captureProfileId: string | null
  epochs: number
  latency: number | null
  thresholdEsr: number | null
  savePlot: boolean
  silent: boolean
  ignoreChecks: boolean
  modelName: string
  outputModelPath: string
  checkpointModelPath: string
  attempts: number
  startedAt: string | null
  finishedAt: string | null
  error: string
  validationEsr: number | null
  progressPercent: number | null
  progressEpochCurrent: number | null
  progressEpochTotal: number | null
  progressBatchCurrent: number | null
  progressBatchTotal: number | null
  progressRate: number | null
  progressLatestLine: string
  profileId: string | null
  profileName: string | null
  modeledBy: string | null
  inputLevelDbu: number | null
  outputLevelDbu: number | null
  sourceMode: TrainingSourceMode
  finalModelRoot: string
  processedWavRoot: string
  graphRoot: string
  graphRootResolved: boolean
  sourcePostProcess: TrainingSourcePostProcessMode
  workspacePath: string
  graphPath: string
  sourceSizeBytes: number | null
  sourceMtimeMs: number | null
  submissionId: string | null
  submissionLabel: string | null
  submissionCreatedAt: string | null
  backupExisting?: boolean
  appendModelArchitectureFolder?: boolean
  appendGraphArchitectureFolder?: boolean
  appendProcessedArchitectureFolder?: boolean
  editedAt?: string | null
  namingTemplate?: string | null
}

interface TrainerHistoryEntry {
  historyId: string
  timestamp: string
  profileId: string | null
  profileName: string | null
  sourceMode: TrainingSourceMode
  sourcePath: string
  sourceSizeBytes: number | null
  sourceMtimeMs: number | null
  architecture: TrainerArchitecture
  finalModelPath: string
  processedWavPath: string
  graphPath: string
  status: 'success' | 'error' | 'canceled' | 'skipped'
  attempts: number
  validationEsr: number | null
  thresholdEsr: number | null
  epochs: number
  latencyMode: TrainingLatencyMode
  latencyValue: number | null
  finalModelName: string
  failureReason: string
  submissionId: string | null
  submissionLabel: string | null
  submissionCreatedAt: string | null
  durationSec?: number | null
  // A2-only sub-model breakdown:
  // - validationEsr (above) is the aggregate (sum of both sub-models), matching the official
  //   trainer's convention for the .nam metadata field.
  // - validationEsrFull is the Full sub-model (channels_8) — the one the plugin loads by default.
  // - validationEsrLite is the Lite sub-model (channels_3).
  validationEsrFull?: number | null
  validationEsrLite?: number | null
}

interface TrainerSkippedEntry {
  skipId: string
  profileId: string | null
  profileName: string | null
  sourcePath: string
  architecture: TrainerArchitecture
  sourceSizeBytes: number | null
  sourceMtimeMs: number | null
  skippedAt: string
  reason: string
}

interface TrainerWatcherRuntime {
  profileId: string
  profileName: string
  enabled: boolean
  autoRun: boolean
  running: boolean
  sourceMode: 'watcher' | 'manual-folder-run'
  watchFolder: string
  pendingCount: number
  skippedCount: number
}

interface TrainerProfilesStateSnapshot {
  watchers: TrainerWatcherRuntime[]
  graphRetentionEnabled: boolean
}

interface TrainerStateSnapshot {
  status: 'idle' | 'starting' | 'running' | 'success' | 'error' | 'canceled'
  runId: string | null
  pythonPath: string
  inputPath: string
  outputPath: string
  trainPath: string
  architecture: TrainerArchitecture | ''
  epochs: number | null
  latency: number | null
  thresholdEsr: number | null
  modelName: string
  outputModelPath: string
  checkpointModelPath: string
  savePlot: boolean
  silent: boolean
  ignoreChecks: boolean
  startedAt: string | null
  finishedAt: string | null
  logs: string[]
  error: string
  validationEsr: number | null
  replicateEsr: number | null
  epochValidationEsr: number | null
  // A2 packed-model breakdown — populated only for A2 runs.
  // epochValidationEsrFull = channels_8 sub-model (the one the plugin loads by default).
  // epochValidationEsrLite = channels_3 sub-model.
  // epochValidationEsrAggregate = NAM's reported val_loss for A2, which is the SUM of both
  //   (this is the number people were confused by — it makes A2 look ~2x worse than it is).
  epochValidationEsrFull?: number | null
  epochValidationEsrLite?: number | null
  epochValidationEsrAggregate?: number | null
  // MRSTFT = Multi-Resolution STFT loss (frequency-domain perceptual). MSE = time-domain mean-squared error.
  // For A1: epochMrstft / epochMse are the single per-epoch values.
  // For A2: epochMrstft / epochMse mirror the Full (channels_8) sub-model;
  //         epochMrstftLite / epochMseLite hold the Lite (channels_3) sub-model.
  epochMrstft?: number | null
  epochMrstftLite?: number | null
  epochMse?: number | null
  epochMseLite?: number | null
  progressPhase: string
  progressPercent: number | null
  progressEpochCurrent: number | null
  progressEpochTotal: number | null
  progressBatchCurrent: number | null
  progressBatchTotal: number | null
  progressRate: number | null
  progressLatestLine: string
  activeJobId: string | null
  pauseAfterCurrent: boolean
  queue: TrainerQueueJob[]
  history: TrainerHistoryEntry[]
  watcherState: TrainerProfilesStateSnapshot
}

const TRAINER_IDLE_STATE: TrainerStateSnapshot = {
  status: 'idle',
  runId: null,
  pythonPath: '',
  inputPath: '',
  outputPath: '',
  trainPath: '',
  architecture: '',
  epochs: null,
  latency: null,
  thresholdEsr: null,
  modelName: '',
  outputModelPath: '',
  checkpointModelPath: '',
  savePlot: true,
  silent: false,
  ignoreChecks: false,
  startedAt: null,
  finishedAt: null,
  logs: [],
  error: '',
  validationEsr: null,
  replicateEsr: null,
  epochValidationEsr: null,
  progressPhase: '',
  progressPercent: null,
  progressEpochCurrent: null,
  progressEpochTotal: null,
  progressBatchCurrent: null,
  progressBatchTotal: null,
  progressRate: null,
  progressLatestLine: '',
  activeJobId: null,
  pauseAfterCurrent: false,
  queue: [],
  history: [],
  watcherState: {
    watchers: [],
    graphRetentionEnabled: true,
  },
}

interface UserCaptureProfile {
  id: string
  name: string
  description: string
  waveNetConfig: WaveNetConfig
  lr: number
  lrDecay: number
  defaultEpochs: number
  batchSize: number
  ny: number
  fitMrstft: boolean
}

const BUILT_IN_WAVENET_CONFIGS: Record<string, { waveNetConfig: WaveNetConfig; lr: number; lrDecay: number; batchSize: number; ny: number; fitMrstft: boolean }> = {
  standard: { lr: 0.004, lrDecay: 0.002, batchSize: 16, ny: 8192, fitMrstft: true, waveNetConfig: { head_scale: 0.02, layers_configs: [
    { input_size: 1, condition_size: 1, channels: 16, head_size: 8, kernel_size: 3, dilations: [1,2,4,8,16,32,64,128,256,512], activation: 'Tanh', gated: false, head_bias: false },
    { input_size: 16, condition_size: 1, channels: 8, head_size: 1, kernel_size: 3, dilations: [1,2,4,8,16,32,64,128,256,512], activation: 'Tanh', gated: false, head_bias: true },
  ] } },
  lite: { lr: 0.004, lrDecay: 0.002, batchSize: 16, ny: 8192, fitMrstft: true, waveNetConfig: { head_scale: 0.02, layers_configs: [
    { input_size: 1, condition_size: 1, channels: 12, head_size: 6, kernel_size: 3, dilations: [1,2,4,8,16,32,64], activation: 'Tanh', gated: false, head_bias: false },
    { input_size: 12, condition_size: 1, channels: 6, head_size: 1, kernel_size: 3, dilations: [128,256,512,1,2,4,8,16,32,64,128,256,512], activation: 'Tanh', gated: false, head_bias: true },
  ] } },
  feather: { lr: 0.004, lrDecay: 0.002, batchSize: 16, ny: 8192, fitMrstft: true, waveNetConfig: { head_scale: 0.02, layers_configs: [
    { input_size: 1, condition_size: 1, channels: 8, head_size: 4, kernel_size: 3, dilations: [1,2,4,8,16,32,64], activation: 'Tanh', gated: false, head_bias: false },
    { input_size: 8, condition_size: 1, channels: 4, head_size: 1, kernel_size: 3, dilations: [128,256,512,1,2,4,8,16,32,64,128,256,512], activation: 'Tanh', gated: false, head_bias: true },
  ] } },
  nano: { lr: 0.004, lrDecay: 0.002, batchSize: 16, ny: 8192, fitMrstft: true, waveNetConfig: { head_scale: 0.02, layers_configs: [
    { input_size: 1, condition_size: 1, channels: 4, head_size: 2, kernel_size: 3, dilations: [1,2,4,8,16,32,64], activation: 'Tanh', gated: false, head_bias: false },
    { input_size: 4, condition_size: 1, channels: 2, head_size: 1, kernel_size: 3, dilations: [128,256,512,1,2,4,8,16,32,64,128,256,512], activation: 'Tanh', gated: false, head_bias: true },
  ] } },
  complex: { lr: 0.001, lrDecay: 0.001, batchSize: 16, ny: 8192, fitMrstft: true, waveNetConfig: { head_scale: 0.02, layers_configs: [
    { input_size: 1, condition_size: 1, channels: 32, head_size: 8, kernel_size: 3, dilations: [1,2,4,8,16,32,64,128,256,512,1,2,4,8,16,32,64,128,256,512], activation: 'Tanh', gated: false, head_bias: false },
    { input_size: 32, condition_size: 1, channels: 8, head_size: 1, kernel_size: 3, dilations: [1,2,4,8,16,32,64,128,256,512,1,2,4,8,16,32,64,128,256,512], activation: 'Tanh', gated: false, head_bias: true },
  ] } },
  revystd: { lr: 0.002, lrDecay: 0.0015, batchSize: 16, ny: 8192, fitMrstft: true, waveNetConfig: { head_scale: 0.99, layers_configs: [
    { input_size: 1, condition_size: 1, channels: 8, head_size: 8, kernel_size: 5, dilations: [1024,256,64,16,4,1], activation: 'Tanh', gated: false, head_bias: false },
    { input_size: 8, condition_size: 1, channels: 8, head_size: 8, kernel_size: 5, dilations: [1024,256,64,16,4,1], activation: 'Tanh', gated: false, head_bias: false },
    { input_size: 8, condition_size: 1, channels: 8, head_size: 8, kernel_size: 5, dilations: [1024,256,64,16,4,1], activation: 'Tanh', gated: false, head_bias: false },
    { input_size: 8, condition_size: 1, channels: 8, head_size: 8, kernel_size: 5, dilations: [1024,256,64,16,4,1], activation: 'Tanh', gated: false, head_bias: false },
    { input_size: 8, condition_size: 1, channels: 8, head_size: 1, kernel_size: 5, dilations: [1024,256,64,16,4,1], activation: 'Tanh', gated: false, head_bias: true },
  ] } },
  revyhi: { lr: 0.002, lrDecay: 0.0015, batchSize: 16, ny: 8192, fitMrstft: true, waveNetConfig: { head_scale: 0.99, layers_configs: [
    { input_size: 1, condition_size: 1, channels: 10, head_size: 10, kernel_size: 6, dilations: [1024,256,64,16,4,1], activation: 'Tanh', gated: false, head_bias: false },
    { input_size: 10, condition_size: 1, channels: 10, head_size: 10, kernel_size: 6, dilations: [1024,256,64,16,4,1], activation: 'Tanh', gated: false, head_bias: false },
    { input_size: 10, condition_size: 1, channels: 10, head_size: 10, kernel_size: 6, dilations: [1024,256,64,16,4,1], activation: 'Tanh', gated: false, head_bias: false },
    { input_size: 10, condition_size: 1, channels: 10, head_size: 10, kernel_size: 6, dilations: [1024,256,64,16,4,1], activation: 'Tanh', gated: false, head_bias: false },
    { input_size: 10, condition_size: 1, channels: 10, head_size: 1, kernel_size: 6, dilations: [1024,256,64,16,4,1], activation: 'Tanh', gated: false, head_bias: true },
  ] } },
  revxstd: { lr: 0.004, lrDecay: 0.002, batchSize: 16, ny: 8192, fitMrstft: true, waveNetConfig: { head_scale: 0.99, layers_configs: [
    { input_size: 1, condition_size: 1, channels: 8, head_size: 8, kernel_size: 6, dilations: [729,243,81,27,9,3,1], activation: 'Tanh', gated: false, head_bias: false },
    { input_size: 8, condition_size: 1, channels: 8, head_size: 8, kernel_size: 6, dilations: [729,243,81,27,9,3,1], activation: 'Tanh', gated: false, head_bias: false },
    { input_size: 8, condition_size: 1, channels: 8, head_size: 8, kernel_size: 6, dilations: [729,243,81,27,9,3,1], activation: 'Tanh', gated: false, head_bias: false },
    { input_size: 8, condition_size: 1, channels: 8, head_size: 1, kernel_size: 6, dilations: [729,243,81,27,9,3,1], activation: 'Tanh', gated: false, head_bias: true },
  ] } },
}

function lookupCaptureProfileConfig(architectureId: string, userProfiles: UserCaptureProfile[]): { waveNetConfig: WaveNetConfig; lr: number; lrDecay: number; batchSize: number; ny: number; fitMrstft: boolean } | null {
  const builtIn = BUILT_IN_WAVENET_CONFIGS[architectureId]
  if (builtIn) return builtIn
  const user = userProfiles.find((p) => p.id === architectureId)
  if (user) return { waveNetConfig: user.waveNetConfig, lr: user.lr, lrDecay: user.lrDecay, batchSize: user.batchSize, ny: user.ny, fitMrstft: user.fitMrstft }
  return null
}

let trainerState: TrainerStateSnapshot = { ...TRAINER_IDLE_STATE }
let trainerChild: import('child_process').ChildProcessWithoutNullStreams | null = null
let trainerCheckpointPollTimer: ReturnType<typeof setInterval> | null = null
let trainerQueue: TrainerQueueJob[] = []
let trainerPauseAfterCurrent = false
// Set by trainer:cancel (Emergency stop). The close handler reads this to:
//   - skip history append (the job didn't really finish)
//   - skip post-processing (graph promote, source WAV move, metadata patch)
//   - reset the active job back to status='queued' with progress cleared
//   - leave other queued jobs alone (no mass-cancel)
//   - pause the queue so it doesn't auto-advance to the next job
let trainerEmergencyRequeue = false
let trainerEmergencyRequeueJobId: string | null = null
// Set when an explicit user reorder (batch drag, Run next, per-job Next, watcher retry-now)
// leaves a DIFFERENT batch's job first in the queue while another batch is active. The
// scheduler's sticky-batch preference would otherwise silently ignore the promotion and keep
// draining the active batch — the "Run next doesn't actually run next" bug. When true, the
// next pump after the active job finishes uses pure queue order instead of the sticky
// preference (the running job is never interrupted). Recomputed on every reorder, so moving
// the active batch back to the front clears it again.
let trainerStickyPreferenceCleared = false
// True while the close handler is running post-processing (between trainerChild = null and the
// final pumpTrainerQueue call). Prevents a watcher-triggered pump from starting the next job
// during model promotion / graph copy, which would race the pause-after-current check.
let trainerPostProcessing = false
// Track the highest epoch the embedded Python callback has already reported a sub-model-aware
// ESR for. tqdm bar parsing skips overwriting epochValidationEsr for epochs <= this number,
// because the tqdm postfix carries NAM's aggregate val_loss (sum of packed sub-models) which
// makes A2 look ~2x worse than the Full sub-model the plugin actually loads.
let trainerLastCallbackEsrEpoch = 0
let trainingProfiles: TrainingProfile[] = []
let trainerUserCaptureProfiles: UserCaptureProfile[] = []
let trainingRetainGraphs = true
let trainerHistory: TrainerHistoryEntry[] = []
let trainerSkipped: TrainerSkippedEntry[] = []
const trainingWatchers = new Map<string, import('fs').FSWatcher>()
const trainingWatcherPendingTimers = new Map<string, ReturnType<typeof setTimeout>>()
const trainingWatcherPendingCounts = new Map<string, number>()
const trainingWatcherRunning = new Set<string>()
const TRAINER_HISTORY_FILENAME = 'trainer-history.json'
const TRAINER_SKIPPED_FILENAME = 'trainer-skipped.json'
const TRAINER_QUEUE_FILENAME = 'trainer-queue.json'

const TRAINER_RUNNER_SOURCE = String.raw`import json
import os
import shutil
import sys
import traceback
import faulthandler
from pathlib import Path

# Enable fault handler immediately — writes native crash info to stderr before the process dies.
# This gives us a Python-level traceback even when CUDA/PyTorch native code triggers a hard crash
# (STATUS_ACCESS_VIOLATION, STATUS_STACK_BUFFER_OVERRUN, etc.) that would otherwise be silent.
faulthandler.enable(file=sys.stderr, all_threads=True)

import numpy as np
import soundfile as sf

from nam.train.core import train

import pytorch_lightning as pl


def _coerce_float(v):
    if v is None:
        return None
    try:
        return float(v.item() if hasattr(v, "item") else v)
    except Exception:
        return None


class _NamLabEsrReporter(pl.Callback):
    """Emit one line per validation epoch with the ESR.

    A1: val_loss is configured as 'esr' so we plot that directly.
    A2: NAM's PackedLightningModule logs val_loss as the SUM of both packed sub-models' ESRs
        (channels_3 = Lite + channels_8 = Full). That sum makes A2 look ~2x worse than it
        actually is when compared to a single A1 model. So when we detect the packed metrics
        (ESR_packed_0 / ESR_packed_1), we report the BETTER sub-model's ESR (typically the
        Full one — channels_8 — which is what the plugin loads by default) and also send the
        other sub-model + the aggregate so the renderer can show all three on the chart.

    Renderer parses NAM_LAB_EPOCH_ESR:{json} lines to build the live curve.
    """

    def on_validation_epoch_end(self, trainer, pl_module):
        metrics = trainer.callback_metrics or {}

        def _collect_packed(prefix):
            # Keys look like ESR_packed_0, MRSTFT_packed_1, MSE_packed_0 etc.
            out = {}
            for key, v in metrics.items():
                if isinstance(key, str) and key.startswith(prefix):
                    try:
                        idx = int(key.rsplit("_", 1)[1])
                    except Exception:
                        continue
                    fv = _coerce_float(v)
                    if fv is not None:
                        out[idx] = fv
            return out

        packed_esr = _collect_packed("ESR_packed_")
        packed_mrstft = _collect_packed("MRSTFT_packed_")
        packed_mse = _collect_packed("MSE_packed_")

        payload = {"epoch": int(trainer.current_epoch) + 1}

        if packed_esr:
            # NAM SlimmableContainer convention: 0 = channels_3 (Lite), 1 = channels_8 (Full)
            esr_lite = packed_esr.get(0)
            esr_full = packed_esr.get(1)
            best = min(v for v in packed_esr.values())  # lowest ESR across sub-models
            payload["esr"] = best  # primary value plotted on the live chart
            if esr_lite is not None: payload["esr_lite"] = esr_lite
            if esr_full is not None: payload["esr_full"] = esr_full
            # Aggregate (NAM's reported val_loss for A2 = sum of both sub-models)
            agg = _coerce_float(metrics.get("val_loss", metrics.get("ESR")))
            if agg is not None: payload["esr_aggregate"] = agg
            # MRSTFT (multi-resolution STFT loss) — frequency-domain perceptual loss.
            if packed_mrstft:
                if packed_mrstft.get(0) is not None: payload["mrstft_lite"] = packed_mrstft.get(0)
                if packed_mrstft.get(1) is not None: payload["mrstft_full"] = packed_mrstft.get(1)
                if 1 in packed_mrstft: payload["mrstft"] = packed_mrstft[1]  # main = Full
                elif packed_mrstft: payload["mrstft"] = min(packed_mrstft.values())
            # MSE (time-domain mean-squared error) — diagnostic.
            if packed_mse:
                if packed_mse.get(0) is not None: payload["mse_lite"] = packed_mse.get(0)
                if packed_mse.get(1) is not None: payload["mse_full"] = packed_mse.get(1)
                if 1 in packed_mse: payload["mse"] = packed_mse[1]
                elif packed_mse: payload["mse"] = min(packed_mse.values())
        else:
            # A1 path — val_loss is pure ESR per the loss config
            val = _coerce_float(metrics.get("val_loss", metrics.get("ESR", metrics.get("val_esr"))))
            if val is None:
                return
            payload["esr"] = val
            mrstft = _coerce_float(metrics.get("MRSTFT"))
            if mrstft is not None: payload["mrstft"] = mrstft
            mse = _coerce_float(metrics.get("MSE"))
            if mse is not None: payload["mse"] = mse

        print("NAM_LAB_EPOCH_ESR:" + json.dumps(payload), flush=True)


def _install_esr_reporter():
    """Patch pl.Trainer.__init__ to append _NamLabEsrReporter to callbacks.

    Returns the original Trainer class so callers can restore it.
    """
    _Orig = pl.Trainer

    class _Patched(_Orig):
        def __init__(self, *a, **kw):
            cbs = list(kw.get("callbacks") or [])
            cbs.append(_NamLabEsrReporter())
            kw["callbacks"] = cbs
            super().__init__(*a, **kw)

    pl.Trainer = _Patched
    return _Orig


def _extract_validation_esr(result):
    try:
        metadata = getattr(result, "metadata", None)
        if metadata is None:
            return None
        value = getattr(metadata, "validation_esr", None)
        if value is None:
            return None
        return float(value)
    except Exception:
        return None


def _find_output_model_path(train_path, model_name):
    root = Path(train_path)

    direct = root / f"{model_name}.nam"
    if direct.exists():
        return str(direct)

    # Scan workspace recursively for any .nam file NAM may have put in a subdirectory.
    candidates = []
    if root.exists():
        candidates = list(root.rglob("*.nam"))

    # Also check CWD — some NAM versions write to the current working directory.
    if not candidates:
        cwd = Path.cwd()
        if cwd.resolve() != root.resolve():
            cwd_direct = cwd / f"{model_name}.nam"
            if cwd_direct.exists():
                return str(cwd_direct)
            candidates = list(cwd.glob("*.nam"))

    if not candidates:
        return str(direct)  # Caller (_promote_output_model_path) will raise if this doesn't exist.

    best = [path for path in candidates if "checkpoint_best" in path.stem.lower()]
    matching = [path for path in candidates if model_name.lower() in path.stem.lower()]
    pool = best if best else matching if matching else candidates
    newest = max(pool, key=lambda path: path.stat().st_mtime)
    return str(newest)


def _promote_output_model_path(train_path, model_name, discovered_path, backup_existing=False):
    target = Path(train_path) / f"{model_name}.nam"
    source = Path(discovered_path)
    if not source.exists():
        raise FileNotFoundError(
            f"NAM did not produce a .nam file at the expected location.\n"
            f"  Searched: {train_path}\n"
            f"  Expected: {discovered_path}\n"
            f"  Check that NAM training completed and that the train_path is writable."
        )
    if source.resolve() == target.resolve():
        return str(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    # When invoked by a Retry, preserve the previous .nam by renaming it to <name>.bak.nam
    # before the new model overwrites it. One backup max — repeated retries replace the .bak.
    if backup_existing and target.exists():
        backup = target.with_suffix(".bak.nam")
        try:
            if backup.exists():
                backup.unlink()
            target.replace(backup)
            print(f"NAM_LAB_BACKUP: {target.name} -> {backup.name}", flush=True)
        except Exception as exc:
            print(f"NAM_LAB_BACKUP_WARN: could not back up existing model ({exc}); proceeding with overwrite", flush=True)
    shutil.copy2(source, target)
    return str(target)


def _normalize_capture_wav(input_path, output_path, target_db, workspace):
    in_info = sf.info(input_path)
    out_data, out_sr = sf.read(output_path, dtype="float32")
    if in_info.samplerate != out_sr:
        raise ValueError(f"Sample rate mismatch: input {in_info.samplerate} Hz vs output {out_sr} Hz")
    out_peak = float(np.max(np.abs(out_data)))
    if out_peak == 0:
        raise ValueError("Cannot normalize: output WAV is silent")
    target_amplitude = 10 ** (target_db / 20.0)
    out_gain = target_amplitude / out_peak
    print(f"NAM_LAB_NORMALIZE: input_preserved={input_path} | out_peak={out_peak:.6f} ({20*np.log10(out_peak):.2f} dBFS) gain={20*np.log10(out_gain):+.2f} dB | target={target_db} dBFS", flush=True)
    ws = Path(workspace)
    norm_output = str(ws / "output_norm.wav")
    sf.write(norm_output, out_data * out_gain, out_sr, subtype="PCM_24")
    return input_path, norm_output


def _detect_nam_version():
    import nam.train.core as _core
    # v0.13.0+ removed the Architecture enum — its absence means PackedWaveNet (A2) support
    return "a1" if hasattr(_core, "Architecture") else "a2"


def _build_user_metadata(payload):
    """Build a UserMetadata object from payload fields, or return None if nothing is set."""
    try:
        from nam.models.metadata import UserMetadata
    except ImportError:
        return None
    fields = {
        "name": payload.get("modelName") or None,
        "modeled_by": payload.get("modeledBy") or None,
        "gear_type": payload.get("gearType") or None,
        "gear_make": payload.get("gearMake") or None,
        "gear_model": payload.get("gearModel") or None,
        "tone_type": payload.get("toneType") or None,
        "input_level_dbu": payload.get("inputLevelDbu"),
        "output_level_dbu": payload.get("outputLevelDbu"),
    }
    # Only construct if at least one field has a value
    if not any(v is not None for v in fields.values()):
        return None
    try:
        return UserMetadata(**{k: v for k, v in fields.items() if v is not None})
    except Exception:
        return None


def _run_a1(payload):
    """A1 WaveNet training for NAM < 0.13.0 (Architecture enum present).
    Injects custom WaveNet config via Architecture enum + get_wavenet_config monkey-patch."""
    import nam.train.core as _core

    _cid = "__namlab__"
    _inst = object.__new__(_core.Architecture)
    _inst._value_ = _cid
    _inst._name_ = "NAMLAB"
    _core.Architecture._value2member_map_[_cid] = _inst
    _core.Architecture._member_map_["NAMLAB"] = _inst

    _wncfg = payload["waveNetConfig"]
    _orig_get_wavenet_config = _core.get_wavenet_config
    def _patched(arch):
        if getattr(arch, "_value_", arch) == _cid:
            return _wncfg
        return _orig_get_wavenet_config(arch)
    _core.get_wavenet_config = _patched

    return train(
        input_path=payload["inputPath"],
        output_path=payload["outputPath"],
        train_path=payload["trainPath"],
        epochs=payload["epochs"],
        latency=payload.get("latency"),
        threshold_esr=payload.get("thresholdEsr"),
        model_type="WaveNet",
        architecture=_core.Architecture(_cid),
        batch_size=payload.get("batchSize", 16),
        ny=payload.get("ny", 8192),
        lr=payload.get("lr", 0.004),
        lr_decay=payload.get("lrDecay", 0.002),
        save_plot=payload.get("savePlot", True),
        silent=payload.get("silent", False),
        modelname=payload["modelName"],
        ignore_checks=payload.get("ignoreChecks", False),
        fit_mrstft=payload.get("fitMrstft", True),
        user_metadata=_build_user_metadata(payload),
    )


def _run_a1_v13(payload):
    """A1 WaveNet training for NAM >= 0.13.0 (no Architecture enum).
    Injects custom WaveNet config by monkey-patching _get_packed_model_config so
    core.train() picks up LightningModule (not PackedLightningModule) with our layers."""
    import nam.train.core as _core

    wncfg = payload["waveNetConfig"]
    lr = payload.get("lr", 0.004)
    # lrDecay in NAM Lab is absolute decay (e.g. 0.002); ExponentialLR uses gamma = 1 - decay
    gamma = max(0.001, 1.0 - payload.get("lrDecay", 0.002))
    mrstft = 0.0005 if payload.get("fitMrstft", True) else 0.0

    # NAM >= 0.13 changed each WaveNet layer's head config from flat (head_size/head_bias) to a nested
    # 'head' object with out_channels/kernel_size/bias. Migrate the stored capture profile shape on the fly
    # so existing presets continue to work without a separate data-migration pass.
    def _migrate_layer_array(lc):
        lc = dict(lc)
        if "head" not in lc:
            lc["head"] = {
                "out_channels": int(lc.pop("head_size", 1)),
                "kernel_size": 1,
                "bias": bool(lc.pop("head_bias", False)),
            }
        else:
            # If a profile already has 'head', drop the flat duplicates just in case.
            lc.pop("head_size", None)
            lc.pop("head_bias", None)
        return lc

    wncfg = dict(wncfg)
    if "layers_configs" in wncfg and isinstance(wncfg["layers_configs"], list):
        wncfg["layers_configs"] = [_migrate_layer_array(lc) for lc in wncfg["layers_configs"]]
    elif "layers" in wncfg and isinstance(wncfg["layers"], list):
        wncfg["layers"] = [_migrate_layer_array(lc) for lc in wncfg["layers"]]

    custom_model_config = {
        "net": {
            "name": "WaveNet",
            "config": wncfg,
        },
        "optimizer": {"lr": lr, "weight_decay": 3.17e-7},
        "lr_scheduler": {"class": "ExponentialLR", "kwargs": {"gamma": gamma}},
        "loss": {"val_loss": "esr", "mrstft_weight": mrstft},
    }

    _orig = _core._get_packed_model_config
    _core._get_packed_model_config = lambda: custom_model_config
    try:
        return train(
            input_path=payload["inputPath"],
            output_path=payload["outputPath"],
            train_path=payload["trainPath"],
            epochs=payload["epochs"],
            latency=payload.get("latency"),
            threshold_esr=payload.get("thresholdEsr"),
            batch_size=payload.get("batchSize", 16),
            ny=payload.get("ny", 8192),
            save_plot=payload.get("savePlot", True),
            silent=payload.get("silent", False),
            modelname=payload["modelName"],
            ignore_checks=payload.get("ignoreChecks", False),
            user_metadata=_build_user_metadata(payload),
        )
    finally:
        _core._get_packed_model_config = _orig


def _run_a2(payload):
    """A2 PackedWaveNet training for NAM >= 0.13.0.
    core.train() loads config_model_packed.json internally — no config injection needed.
    Produces a SlimmableContainer .nam with channels_3 (lite) + channels_8 (standard)."""
    return train(
        input_path=payload["inputPath"],
        output_path=payload["outputPath"],
        train_path=payload["trainPath"],
        epochs=payload["epochs"],
        latency=payload.get("latency"),
        threshold_esr=payload.get("thresholdEsr"),
        batch_size=payload.get("batchSize", 16),
        ny=payload.get("ny", 8192),
        save_plot=payload.get("savePlot", True),
        silent=payload.get("silent", False),
        modelname=payload["modelName"],
        ignore_checks=payload.get("ignoreChecks", False),
        user_metadata=_build_user_metadata(payload),
    )


def main():
    if len(sys.argv) < 2:
        raise RuntimeError("Expected payload JSON path")

    payload_path = sys.argv[1]
    with open(payload_path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)

    detected = _detect_nam_version()
    requested = payload.get("namMode", "a1")
    print(f"NAM_LAB_NAM_VERSION:{detected}", flush=True)

    # Modern NAM (>= 0.13.0) can run BOTH A1 (via _run_a1_v13) and A2 (via _run_a2),
    # so only block when the user asked for A2 on an install that doesn't support it.
    if requested == "a2" and detected != "a2":
        raise RuntimeError(
            "A2 (PackedWaveNet) training requires a NAM install that supports A2. "
            "Your current NAM install uses A1 WaveNet. "
            "Update your Python environment to a NAM version that includes PackedWaveNet support."
        )

    active_input = payload["inputPath"]
    active_output = payload["outputPath"]
    if payload.get("normalizeWav", False):
        target_db = payload.get("normalizeWavTargetDb", -5.0)
        active_input, active_output = _normalize_capture_wav(
            active_input, active_output, target_db, payload["trainPath"]
        )

    norm_payload = {**payload, "inputPath": active_input, "outputPath": active_output}
    _orig_trainer = _install_esr_reporter()
    try:
        if requested == "a2":
            result = _run_a2(norm_payload)
        elif detected == "a2":
            # NAM >= 0.13.0 install but A1 (WaveNet) job — use v13 path
            result = _run_a1_v13(norm_payload)
        else:
            # NAM < 0.13.0 install — classic Architecture enum path
            result = _run_a1(norm_payload)
    finally:
        pl.Trainer = _orig_trainer

    discovered_output = _find_output_model_path(payload["trainPath"], payload["modelName"])
    promoted_output = _promote_output_model_path(payload["trainPath"], payload["modelName"], discovered_output, backup_existing=payload.get("backupExisting", False))

    summary = {
        "modelName": payload["modelName"],
        "outputModelPath": promoted_output,
        "checkpointModelPath": discovered_output,
        "validationEsr": _extract_validation_esr(result),
    }
    print("NAM_LAB_RESULT:" + json.dumps(summary), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        traceback.print_exc()
        print("NAM_LAB_ERROR:" + str(exc), flush=True)
        sys.exit(1)
`

function getTrainerHistoryPath(): string {
  return join(app.getPath('userData'), TRAINER_HISTORY_FILENAME)
}

function getTrainerSkippedPath(): string {
  return join(app.getPath('userData'), TRAINER_SKIPPED_FILENAME)
}

function loadTrainerHistory(): TrainerHistoryEntry[] {
  try {
    const filePath = getTrainerHistoryPath()
    if (!fs.existsSync(filePath)) return []
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    return Array.isArray(parsed) ? parsed as TrainerHistoryEntry[] : []
  } catch {
    return []
  }
}

function loadTrainerSkipped(): TrainerSkippedEntry[] {
  try {
    const filePath = getTrainerSkippedPath()
    if (!fs.existsSync(filePath)) return []
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    return Array.isArray(parsed) ? parsed as TrainerSkippedEntry[] : []
  } catch {
    return []
  }
}

function getTrainerQueuePath(): string {
  return join(app.getPath('userData'), TRAINER_QUEUE_FILENAME)
}

const TRAINER_QUEUE_PERSIST_CAP = 2000
const TRAINER_HISTORY_CAP = 10000

function loadTrainerQueue(): TrainerQueueJob[] {
  try {
    const filePath = getTrainerQueuePath()
    if (!fs.existsSync(filePath)) return []
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    // Support two formats:
    //   old: bare array  (paused flag unknown — treated as false)
    //   new: { paused: boolean, jobs: [...] }
    let jobs: TrainerQueueJob[]
    if (Array.isArray(raw)) {
      jobs = raw as TrainerQueueJob[]
    } else if (raw && typeof raw === 'object' && Array.isArray(raw.jobs)) {
      trainerPauseAfterCurrent = !!raw.paused
      jobs = raw.jobs as TrainerQueueJob[]
    } else {
      return []
    }
    // Demote anything that was mid-flight when the app was killed — its Python child is gone.
    // A hard shutdown mid-run must behave like Emergency Stop: requeue the current job AND pause the
    // queue, so nothing (manual OR autoRun watcher) auto-starts on next launch until the user resumes.
    // Otherwise preserve status exactly so finished/failed rows from previous sessions stay
    // visible above any newly-queued work, exactly as they were before the restart.
    const hadMidFlight = jobs.some((job) => job.status === 'starting' || job.status === 'running')
    if (hadMidFlight) trainerPauseAfterCurrent = true
    return jobs.map((job) => job.status === 'starting' || job.status === 'running'
      ? { ...job, status: 'queued' as const, startedAt: null, finishedAt: null, progressPercent: null, progressEpochCurrent: null, progressBatchCurrent: null, progressBatchTotal: null, progressRate: null, progressLatestLine: '' }
      : job)
  } catch {
    return []
  }
}

function saveTrainerQueue(): void {
  try {
    fs.mkdirSync(dirname(getTrainerQueuePath()), { recursive: true })
    // Mirror the live queue 1:1 — staged, queued, running, AND finished/failed/canceled rows.
    // Finished rows are what the user sees as "what already ran in this session/batch"; dropping
    // them at save time silently wipes that context on every restart, which is the bug.
    // Cap at TRAINER_QUEUE_PERSIST_CAP (most recent end of the array) so the file can't grow
    // unbounded — older entries are in trainer-history.json regardless.
    // Persist the pause flag so auto-start-on-launch can respect it.
    const payload = { paused: trainerPauseAfterCurrent, jobs: getPersistableTrainerQueueJobs() }
    fs.writeFileSync(getTrainerQueuePath(), JSON.stringify(payload, null, 2), 'utf-8')
  } catch (error) {
    log(`trainer queue save failed: ${String(error)}`)
  }
}

function isTrainerQueueTerminalStatus(status: TrainerQueueJobStatus): boolean {
  return status === 'success' || status === 'error' || status === 'canceled'
}

function getPersistableTrainerQueueJobs(): TrainerQueueJob[] {
  return trainerQueue.slice(-TRAINER_QUEUE_PERSIST_CAP)
}

// A batch (submission) leaves the active queue once every one of its non-staged jobs is terminal.
// Its permanent record already lives in trainer-history.json, so keeping duplicate terminal rows in
// the queue is what made the same finished item show up in BOTH the queue and history. Parked
// (staged) jobs are never pruned, and partially-finished batches keep their terminal rows so the
// batch card stays accurate and the rows survive a restart. Returns true if anything was removed.
function pruneFinishedBatchesFromQueue(): boolean {
  // Track whether ALL jobs in a submission are success.
  // Any error or canceled job means the batch stays — the user must dismiss it,
  // and keeping it in the queue prevents the watcher from re-enqueuing the same files.
  // Staged rows also keep the batch: a parked batch's finished rows stay visible in the
  // queue card as its progress record until the parked remainder is unstaged and finishes
  // (previously staged rows were skipped here, so parking a half-done batch silently
  // dropped its finished rows from the queue).
  const submissionAllSuccess = new Map<string, boolean>()
  for (const job of trainerQueue) {
    if (!job.submissionId) continue
    const soFar = submissionAllSuccess.get(job.submissionId) ?? true
    submissionAllSuccess.set(job.submissionId, soFar && job.status === 'success')
  }
  const fullySucceeded = new Set(
    [...submissionAllSuccess.entries()].filter(([, all]) => all).map(([id]) => id)
  )
  const before = trainerQueue.length
  trainerQueue = trainerQueue.filter((job) => {
    if (!isTrainerQueueTerminalStatus(job.status)) return true // keep staged/queued/running/starting
    if (!job.submissionId) return false                         // drop ungrouped terminal solo jobs
    return !fullySucceeded.has(job.submissionId)                // only drop all-success batches
  })
  return trainerQueue.length !== before
}

function saveTrainerHistory(): void {
  try {
    fs.mkdirSync(dirname(getTrainerHistoryPath()), { recursive: true })
    fs.writeFileSync(getTrainerHistoryPath(), JSON.stringify(trainerHistory.slice(0, TRAINER_HISTORY_CAP), null, 2), 'utf-8')
  } catch (error) {
    log(`trainer history save failed: ${String(error)}`)
  }
}

function saveTrainerSkipped(): void {
  try {
    fs.mkdirSync(dirname(getTrainerSkippedPath()), { recursive: true })
    fs.writeFileSync(getTrainerSkippedPath(), JSON.stringify(trainerSkipped.slice(0, 2000), null, 2), 'utf-8')
  } catch (error) {
    log(`trainer skipped save failed: ${String(error)}`)
  }
}

function makeTrainerWatcherSnapshot(): TrainerProfilesStateSnapshot {
  return {
    watchers: trainingProfiles
      .filter((profile) => profile.sourceMode === 'watcher')
      .map((profile) => ({
        profileId: profile.id,
        profileName: profile.name,
        enabled: profile.enabled,
        autoRun: profile.autoRun,
        running: trainingWatcherRunning.has(profile.id),
        sourceMode: profile.sourceMode,
        watchFolder: profile.watchFolder,
        pendingCount: trainingWatcherPendingCounts.get(profile.id) ?? 0,
        skippedCount: trainerSkipped.filter((e) => e.profileId === profile.id).length,
      })),
    graphRetentionEnabled: trainingRetainGraphs,
  }
}

function sanitizeTrainerPathPart(value: string): string {
  return value
    .replace(/[\\/]+/g, ' - ')
    .replace(/[:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
}

function fillTrainerNamingTemplate(
  template: string,
  outputPath: string,
  architecture: TrainerArchitecture,
  profileName: string | null,
  thresholdEsr: number | null
): string {
  const basenameValue = basename(outputPath, extname(outputPath)).trim() || 'model'
  const architectureLabel = getTrainerArchitectureFolderName(architecture)
  const profileLabel = (profileName ?? '').trim()
  const esrLabel = typeof thresholdEsr === 'number' && Number.isFinite(thresholdEsr)
    ? String(thresholdEsr).trim()
    : ''
  const raw = (template || '{basename}')
    .replace(/\{basename\}/gi, basenameValue)
    .replace(/\{architecture\}/gi, architectureLabel)
    .replace(/\{profile\}/gi, profileLabel)
    .replace(/\{esr\}/gi, esrLabel)
  const sanitized = sanitizeTrainerPathPart(raw)
  return sanitized || basenameValue
}

function getTrainerRunWorkspaceRoot(): string {
  return join(app.getPath('userData'), 'trainer-runs')
}

function getTrainerRunWorkspacePath(jobId: string, modelName: string, architecture: TrainerArchitecture): string {
  return join(
    getTrainerRunWorkspaceRoot(),
    `${jobId}-${sanitizeTrainerPathPart(modelName)}-${sanitizeTrainerPathPart(getTrainerArchitectureFolderName(architecture))}`
  )
}

function appendTrainerHistory(entry: TrainerHistoryEntry): void {
  trainerHistory = [entry, ...trainerHistory].slice(0, TRAINER_HISTORY_CAP)
  saveTrainerHistory()
  emitTrainerHistory()
}

function makeTrainerSkippedKey(
  profileId: string | null,
  sourcePath: string,
  architecture: TrainerArchitecture,
  sourceMtimeMs: number | null,
  sourceSizeBytes: number | null
): string {
  return [
    profileId ?? '',
    normalizePath(sourcePath),
    architecture,
    sourceMtimeMs ?? '',
    sourceSizeBytes ?? '',
  ].join('::')
}

function appendTrainerSkipped(entry: TrainerSkippedEntry): void {
  const key = makeTrainerSkippedKey(entry.profileId, entry.sourcePath, entry.architecture, entry.sourceMtimeMs, entry.sourceSizeBytes)
  trainerSkipped = [
    entry,
    ...trainerSkipped.filter((item) =>
      makeTrainerSkippedKey(item.profileId, item.sourcePath, item.architecture, item.sourceMtimeMs, item.sourceSizeBytes) !== key
    ),
  ].slice(0, 2000)
  saveTrainerSkipped()
}

function clearTrainerSkipped(profileId: string | null, sourcePath: string, architecture: TrainerArchitecture): void {
  const normalized = normalizePath(sourcePath)
  trainerSkipped = trainerSkipped.filter((entry) =>
    !(
      entry.profileId === profileId &&
      normalizePath(entry.sourcePath) === normalized &&
      entry.architecture === architecture
    )
  )
  saveTrainerSkipped()
}

function appendTrainerCanceledHistory(
  job: TrainerQueueJob,
  reason: string,
  processedWavPath = '',
  status: TrainerHistoryEntry['status'] = 'canceled'
): void {
  appendTrainerHistory({
    historyId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    profileId: job.profileId,
    profileName: job.profileName,
    sourceMode: job.sourceMode,
    sourcePath: job.outputPath,
    sourceSizeBytes: job.sourceSizeBytes,
    sourceMtimeMs: job.sourceMtimeMs,
    architecture: job.architecture,
    finalModelPath: '',
    processedWavPath,
    graphPath: '',
    status,
    attempts: job.attempts,
    validationEsr: null,
    thresholdEsr: job.thresholdEsr,
    epochs: job.epochs,
    latencyMode: job.latency == null ? 'auto' : 'manual',
    latencyValue: job.latency,
    finalModelName: job.modelName,
    failureReason: reason,
    submissionId: job.submissionId,
    submissionLabel: job.submissionLabel,
    submissionCreatedAt: job.submissionCreatedAt,
  })
}

function makeTrainingWatcherTimerKey(profileId: string, filePath: string): string {
  return `${profileId}::${normalizePath(filePath)}`
}

function clearTrainingWatcherTimer(timerKey: string): void {
  const timer = trainingWatcherPendingTimers.get(timerKey)
  if (timer) {
    clearTimeout(timer)
    trainingWatcherPendingTimers.delete(timerKey)
  }
}

async function findFilesRecursive(root: string, matcher: (filePath: string) => boolean): Promise<string[]> {
  const results: string[] = []
  const visit = async (folderPath: string) => {
    const entries = await fs.promises.readdir(folderPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(folderPath, entry.name)
      if (entry.isDirectory()) {
        await visit(fullPath)
      } else if (matcher(fullPath)) {
        results.push(fullPath)
      }
    }
  }
  if (fs.existsSync(root)) {
    await visit(root)
  }
  return results
}

async function ensureUniqueFilePath(targetPath: string): Promise<string> {
  if (!fs.existsSync(targetPath)) return targetPath
  const dirPath = dirname(targetPath)
  const ext = extname(targetPath)
  const stem = basename(targetPath, ext)
  for (let index = 1; index < 1000; index += 1) {
    const candidate = join(dirPath, `${stem} (${index})${ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }
  return join(dirPath, `${stem}-${Date.now()}${ext}`)
}

function resolveGraphFormula(formula: string, watchFolder: string, architecture: string): string | null {
  if (!formula.trim() || !watchFolder.trim()) return null
  const usesBackslash = watchFolder.includes('\\')
  const toNative = (p: string) => usesBackslash ? p.replace(/\//g, '\\') : p
  const normalized = watchFolder.replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = normalized.split('/')
  const folder = parts[parts.length - 1] ?? ''
  const parent = parts[parts.length - 2] ?? ''
  const base = [...parts]
  for (const raw of formula.replace(/\\/g, '/').split('/').filter((s) => s !== '')) {
    const seg = raw
      .replace(/\{folder\}/g, folder)
      .replace(/\{parent\}/g, parent)
      .replace(/\{architecture\}/g, architecture)
    if (seg === '..') { if (base.length > 1) base.pop() }
    else if (seg && seg !== '.') base.push(seg)
  }
  return toNative(base.join('/'))
}

async function promoteTrainerGraph(job: TrainerQueueJob): Promise<string> {
  if (!job.savePlot || !trainingRetainGraphs) return ''
  const graphFiles = await findFilesRecursive(job.workspacePath, (filePath) => /\.png$/i.test(filePath))
  if (graphFiles.length === 0) return ''
  const preferred = graphFiles.find((filePath) => basename(filePath, extname(filePath)) === job.modelName) ?? graphFiles[0]
  const graphRoot = job.graphRoot.trim() || join(job.finalModelRoot, '_graphs')
  const destinationDir = job.graphRootResolved
    ? graphRoot
    : job.appendGraphArchitectureFolder
      ? join(graphRoot, getTrainerArchitectureFolderName(job.architecture))
      : graphRoot
  await fs.promises.mkdir(destinationDir, { recursive: true })
  const destinationPath = await ensureUniqueFilePath(join(destinationDir, `${job.modelName}${extname(preferred) || '.png'}`))
  suppressWatcher()
  await fs.promises.copyFile(preferred, destinationPath)
  return destinationPath
}

async function postProcessTrainerSourceWav(job: TrainerQueueJob): Promise<string> {
  if (job.sourcePostProcess === 'keep' || !job.processedWavRoot.trim()) return ''
  const destinationDir = job.appendProcessedArchitectureFolder
    ? join(job.processedWavRoot.trim(), getTrainerArchitectureFolderName(job.architecture))
    : job.processedWavRoot.trim()
  await fs.promises.mkdir(destinationDir, { recursive: true })
  const destinationPath = await ensureUniqueFilePath(join(destinationDir, basename(job.outputPath)))
  suppressWatcher()
  if (job.sourcePostProcess === 'move') {
    await fs.promises.rename(job.outputPath, destinationPath)
  } else {
    await fs.promises.copyFile(job.outputPath, destinationPath)
  }
  return destinationPath
}

let trainerQueueSaveTimer: NodeJS.Timeout | null = null
let trainerQueueLastSignature = ''
let trainerLastEmitSignature = ''

// Coalesce high-frequency trainer:update pushes. The trainer spews tqdm/log lines many
// times per second, and each emit structured-clones the full state (up to 600 log lines +
// the whole queue) across the IPC boundary. Sending all of them floods the renderer's
// message queue — especially when the window is backgrounded and Chromium throttles its
// main thread — which is the actual trigger for the renderer choking and going blank.
// Instead we mark the state dirty and flush the LATEST snapshot at most every ~120ms.
const TRAINER_EMIT_FLUSH_MS = 120
let trainerEmitFlushTimer: NodeJS.Timeout | null = null
let trainerEmitDirty = false

// Cheap composition signature — captures which jobs exist and what their statuses are. Excludes
// progress fields that change every tick so we don't churn the signature unnecessarily.
function computeTrainerQueueSignature(): string {
  return `${trainerPauseAfterCurrent ? 'paused' : 'live'}|${trainerQueue.map((j) => `${j.jobId}:${j.status}`).join('|')}`
}

function computeTrainerEmitSignature(): string {
  const queueSig = trainerQueue.map((job) => (
    `${job.jobId}:${job.status}:${job.progressEpochCurrent ?? ''}:${job.progressBatchCurrent ?? ''}:${job.validationEsr ?? ''}:${job.validationEsrFull ?? ''}:${job.submissionLabel ?? ''}:${job.editedAt ?? ''}`
  )).join('|')
  const historySig = trainerHistory.slice(-3).map((entry) => (
    `${entry.jobId}:${entry.status}:${entry.finishedAt ?? ''}:${entry.validationEsr ?? ''}:${entry.validationEsrFull ?? ''}`
  )).join('|')
  return [
    trainerState.status,
    trainerState.activeJobId ?? '',
    trainerState.startedAt ?? '',
    trainerState.finishedAt ?? '',
    trainerState.modelName ?? '',
    trainerState.outputModelPath ?? '',
    trainerState.progressPercent ?? '',
    trainerState.progressEpochCurrent ?? '',
    trainerState.progressEpochTotal ?? '',
    trainerState.progressBatchCurrent ?? '',
    trainerState.progressBatchTotal ?? '',
    trainerState.progressRate ?? '',
    trainerState.validationEsr ?? '',
    trainerState.epochValidationEsr ?? '',
    trainerState.epochValidationEsrFull ?? '',
    trainerState.epochValidationEsrLite ?? '',
    trainerState.epochValidationEsrAggregate ?? '',
    trainerState.logs.length,
    trainerPauseAfterCurrent ? 'paused' : 'live',
    trainerQueue.length,
    queueSig,
    trainerHistory.length,
    historySig,
    JSON.stringify(makeTrainerWatcherSnapshot()),
  ].join('~')
}

function requestEmergencyRequeueCurrentJob(pauseQueue: boolean): boolean {
  const activeJobId = trainerState.activeJobId
  if (!activeJobId) return false
  trainerEmergencyRequeue = true
  trainerEmergencyRequeueJobId = activeJobId
  if (pauseQueue) trainerPauseAfterCurrent = true
  trainerQueue = trainerQueue.map((job) => (
    job.jobId === activeJobId ? resetTrainerJobForQueue(job) : job
  ))
  return true
}

function persistTrainerQueueThrottled(): void {
  // Two-tier save:
  // (1) If the queue's COMPOSITION changed (job added / removed / status transition), write immediately
  //     and synchronously. This is what survives a crash or hard quit — losing a few seconds of progress
  //     updates is fine, losing a queued job is not.
  // (2) Otherwise debounce to 2s so per-tick progress updates don't hammer the disk.
  const sig = computeTrainerQueueSignature()
  if (sig !== trainerQueueLastSignature) {
    trainerQueueLastSignature = sig
    if (trainerQueueSaveTimer) { clearTimeout(trainerQueueSaveTimer); trainerQueueSaveTimer = null }
    saveTrainerQueue()
    return
  }
  if (trainerQueueSaveTimer) return
  trainerQueueSaveTimer = setTimeout(() => {
    trainerQueueSaveTimer = null
    saveTrainerQueue()
  }, 2000)
}

function emitTrainerState(): void {
  const suppressActiveJobSync =
    trainerEmergencyRequeueJobId != null &&
    trainerState.activeJobId === trainerEmergencyRequeueJobId
  if (trainerState.activeJobId && !suppressActiveJobSync) {
    updateTrainerJob(trainerState.activeJobId, {
      status: trainerState.status === 'starting' ? 'starting' : trainerState.status === 'running' ? 'running' : trainerState.status === 'success' ? 'success' : trainerState.status === 'error' ? 'error' : trainerState.status === 'canceled' ? 'canceled' : 'queued',
      startedAt: trainerState.startedAt,
      finishedAt: trainerState.finishedAt,
      outputModelPath: trainerState.outputModelPath,
      checkpointModelPath: trainerState.checkpointModelPath,
      error: trainerState.error,
      validationEsr: trainerState.validationEsr,
      validationEsrFull: trainerState.epochValidationEsrFull ?? null,
      progressPercent: trainerState.progressPercent,
      progressEpochCurrent: trainerState.progressEpochCurrent,
      progressEpochTotal: trainerState.progressEpochTotal,
      progressBatchCurrent: trainerState.progressBatchCurrent,
      progressBatchTotal: trainerState.progressBatchTotal,
      progressRate: trainerState.progressRate,
      progressLatestLine: trainerState.progressLatestLine,
      thresholdEsr: trainerState.thresholdEsr,
    })
  }
  trainerState = {
    ...trainerState,
    queue: trainerQueue,
    pauseAfterCurrent: trainerPauseAfterCurrent,
    history: trainerHistory,
    watcherState: makeTrainerWatcherSnapshot(),
  }
  trainerEmitDirty = true
  // Non-running transitions (start/finish/error/idle/cancel) are rare and user-visible — push them
  // out immediately. The high-frequency 'running' progress ticks get coalesced behind the timer.
  if (trainerState.status !== 'running') {
    flushTrainerState()
  } else {
    scheduleTrainerFlush()
  }
  persistTrainerQueueThrottled()
}

function scheduleTrainerFlush(): void {
  if (trainerEmitFlushTimer || !trainerEmitDirty) return
  trainerEmitFlushTimer = setTimeout(() => {
    trainerEmitFlushTimer = null
    flushTrainerState()
  }, TRAINER_EMIT_FLUSH_MS)
}

function flushTrainerState(): void {
  if (trainerEmitFlushTimer) {
    clearTimeout(trainerEmitFlushTimer)
    trainerEmitFlushTimer = null
  }
  if (!trainerEmitDirty) return
  trainerEmitDirty = false
  const emitSig = computeTrainerEmitSignature()
  if (emitSig === trainerLastEmitSignature) return
  trainerLastEmitSignature = emitSig
  // History is delivered on its own low-frequency channel (emitTrainerHistory), NOT bundled into
  // this high-frequency progress push — otherwise the full history array is structured-cloned over
  // IPC on every epoch/ESR tick. Strip it here; the renderer merges history from 'trainer:history'.
  safeSend('trainer:update', { ...trainerState, history: EMPTY_TRAINER_HISTORY })
}

const EMPTY_TRAINER_HISTORY: TrainerHistoryEntry[] = []

// Push the full history on its own channel. Called only when history actually changes (job finishes,
// entries forgotten/purged) — not on every progress tick — so cap size no longer affects run-time cost.
function emitTrainerHistory(): void {
  safeSend('trainer:history', trainerHistory)
}

const TRAINER_LOG_NOISE_RE = /^\s*(Validation(?:\s+DataLoader\s+\d+)?|Sanity Checking(?:\s+DataLoader\s+\d+)?|Training):\s*0%\|.*0\/\d+\s*\[00:00<\?,?\s*\?it\/s\]/i
const TRAINER_LOG_EMPTY_TQDM_RE = /^\s*(Validation|Sanity Checking|Training):\s*0it\s*\[00:00,?\s*\?it\/s\]/i
const TRAINER_TQDM_BAR_RE = /^\s*(Epoch\s+\d+|Validation(?:\s+DataLoader\s+\d+)?|Sanity Checking(?:\s+DataLoader\s+\d+)?|Training|Testing):\s+\d+%/i

function tqdmBarKey(line: string): string | null {
  const m = line.match(/^\s*(Epoch\s+\d+|Validation(?:\s+DataLoader\s+\d+)?|Sanity Checking(?:\s+DataLoader\s+\d+)?|Training|Testing):/i)
  return m ? m[1].replace(/\s+/g, ' ').toLowerCase() : null
}

function appendTrainerLog(line: string): void {
  const trimmed = line.replace(/\r/g, '').trimEnd()
  if (!trimmed) return
  if (TRAINER_LOG_NOISE_RE.test(trimmed) || TRAINER_LOG_EMPTY_TQDM_RE.test(trimmed)) return
  const logs = trainerState.logs
  const lastLine = logs[logs.length - 1]
  if (lastLine === trimmed) return
  // Collapse consecutive tqdm refreshes of the SAME bar (same "Epoch N:" or "Validation:" prefix) into one rolling line — same effect as a TTY rewriting in place.
  if (TRAINER_TQDM_BAR_RE.test(trimmed)) {
    const newKey = tqdmBarKey(trimmed)
    const lastKey = lastLine ? tqdmBarKey(lastLine) : null
    if (newKey && lastKey && newKey === lastKey) {
      const next = logs.slice(0, -1)
      next.push(trimmed)
      trainerState = { ...trainerState, logs: next.slice(-600) }
      emitTrainerState()
      return
    }
  }
  trainerState = {
    ...trainerState,
    logs: [...logs, trimmed].slice(-600),
  }
  emitTrainerState()
}

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
}

function updateTrainerPhase(phase: string, latestLine?: string): void {
  trainerState = {
    ...trainerState,
    progressPhase: phase,
    progressLatestLine: latestLine ?? trainerState.progressLatestLine,
  }
  emitTrainerState()
}

function parseTrainerProgressLine(line: string): boolean {
  const clean = stripAnsi(line).trim()
  if (!clean) return false

  if (/^Sanity Checking\b/i.test(clean)) {
    trainerState = {
      ...trainerState,
      progressPhase: 'Sanity checking',
      progressLatestLine: clean,
    }
    emitTrainerState()
    // Don't consume — let the log show "Sanity Checking..." too.
    return false
  }

  const esrReport = clean.match(/NAM_LAB_EPOCH_ESR:(\{.*\})\s*$/)
  if (esrReport) {
    try {
      const parsed = JSON.parse(esrReport[1]) as {
        epoch?: number
        esr?: number
        esr_full?: number
        esr_lite?: number
        esr_aggregate?: number
        mrstft?: number
        mrstft_full?: number
        mrstft_lite?: number
        mse?: number
        mse_full?: number
        mse_lite?: number
      }
      if (typeof parsed.epoch === 'number' && typeof parsed.esr === 'number') {
        trainerLastCallbackEsrEpoch = Math.max(trainerLastCallbackEsrEpoch, parsed.epoch)
        const pick = (n: unknown): number | null => typeof n === 'number' ? n : null
        trainerState = {
          ...trainerState,
          progressEpochCurrent: parsed.epoch,
          epochValidationEsr: parsed.esr,
          epochValidationEsrFull: pick(parsed.esr_full),
          epochValidationEsrLite: pick(parsed.esr_lite),
          epochValidationEsrAggregate: pick(parsed.esr_aggregate),
          epochMrstft: pick(parsed.mrstft) ?? pick(parsed.mrstft_full),
          epochMrstftLite: pick(parsed.mrstft_lite),
          epochMse: pick(parsed.mse) ?? pick(parsed.mse_full),
          epochMseLite: pick(parsed.mse_lite),
        }
        emitTrainerState()
      }
    } catch {}
    return true
  }

  const epochMatch = clean.match(/^Epoch\s+(\d+):\s+(\d+)%.*?\|\s*(\d+)\/(\d+)\s+\[[^\]]*?([0-9.]+)it\/s/i)
    ?? clean.match(/^Epoch\s+(\d+):\s+(\d+)%.*?\|\s*(\d+)\/(\d+)\s+\[/i)
  if (epochMatch) {
    const epochIndex = Number.parseInt(epochMatch[1], 10)
    const epochPercent = Number.parseInt(epochMatch[2], 10)
    const batchCurrent = Number.parseInt(epochMatch[3], 10)
    const batchTotal = Number.parseInt(epochMatch[4], 10)
    const rate = epochMatch[5] ? Number.parseFloat(epochMatch[5]) : null
    const epochTotal = trainerState.epochs
    const overallPercent = epochTotal && epochTotal > 0
      ? Math.max(0, Math.min(100, (((epochIndex) + (batchTotal > 0 ? batchCurrent / batchTotal : epochPercent / 100)) / epochTotal) * 100))
      : epochPercent
    // tqdm bar fallback: extract val_loss/ESR only when the embedded Python callback HASN'T
    // already reported for this epoch. For A2 the postfix carries the AGGREGATE (sum of both
    // packed sub-models' ESRs) which would clobber the callback's Full-sub-model value and
    // make the live tile bounce between aggregate and best every epoch.
    const callbackEpochNumber = epochIndex + 1
    const callbackOwnsThisEpoch = callbackEpochNumber <= trainerLastCallbackEsrEpoch
    const esrInBar = !callbackOwnsThisEpoch ? clean.match(/\b(?:val_loss|val_esr|ESR|esr)\s*=\s*([0-9.]+(?:e[+-]?\d+)?)/i) : null
    const epochEsr = esrInBar ? Number.parseFloat(esrInBar[1]) : null
    trainerState = {
      ...trainerState,
      progressPhase: 'Training',
      progressPercent: overallPercent,
      progressEpochCurrent: epochIndex + 1,
      progressEpochTotal: epochTotal,
      progressBatchCurrent: batchCurrent,
      progressBatchTotal: batchTotal,
      progressRate: rate ?? trainerState.progressRate,
      progressLatestLine: clean,
      ...(epochEsr !== null ? { epochValidationEsr: epochEsr } : {}),
    }
    emitTrainerState()
    // Don't consume — let the log show the rolling Epoch progress. appendTrainerLog dedupes consecutive refreshes of the same bar so the log stays readable.
    return false
  }

  if (/^Starting training\./i.test(clean)) {
    trainerState = {
      ...trainerState,
      progressPhase: 'Training',
      progressLatestLine: clean,
    }
    emitTrainerState()
    return false
  }

  const replicateEsrMatch = clean.match(/^Replicate ESR is ([0-9.]+)/i)
  if (replicateEsrMatch) {
    trainerState = {
      ...trainerState,
      replicateEsr: Number.parseFloat(replicateEsrMatch[1]),
      progressPhase: 'Validation / checks',
      progressLatestLine: clean,
    }
    emitTrainerState()
    return false
  }

  // A2 prints "Error-signal ratio (channels_8) = 0.0054" per sub-model after training.
  // Capture each and keep the best (lowest) — used to override NAM's aggregate validation_esr
  // before it lands in history. Otherwise A2 history rows show 2x the real best ESR.
  const a2SubEsrMatch = clean.match(/^Error-signal ratio \(([^)]+)\)\s*=\s*([0-9.eE+\-]+)/i)
  if (a2SubEsrMatch) {
    const subName = a2SubEsrMatch[1].trim()
    const subEsr = Number.parseFloat(a2SubEsrMatch[2])
    if (Number.isFinite(subEsr)) {
      const prevBest = trainerState.epochValidationEsrFull ?? Number.POSITIVE_INFINITY
      const prevLite = trainerState.epochValidationEsrLite ?? null
      // channels_8 / Full is the larger sub-model the plugin loads by default; channels_3 / Lite is the smaller.
      const isLite = /channels_3|lite/i.test(subName)
      const isFull = /channels_8|full|standard/i.test(subName)
      trainerState = {
        ...trainerState,
        epochValidationEsrFull: isFull ? subEsr : (isLite ? trainerState.epochValidationEsrFull ?? null : Math.min(prevBest, subEsr)),
        epochValidationEsrLite: isLite ? subEsr : prevLite,
      }
      emitTrainerState()
    }
    return false
  }

  const aggregateEsrMatch = clean.match(/^Aggregate error-signal ratio\s*=\s*([0-9.eE+\-]+)/i)
  if (aggregateEsrMatch) {
    const agg = Number.parseFloat(aggregateEsrMatch[1])
    if (Number.isFinite(agg)) {
      trainerState = { ...trainerState, epochValidationEsrAggregate: agg }
      emitTrainerState()
    }
    return false
  }

  if (/^Validating data/i.test(clean) || /^V[23] checks/i.test(clean) || /^Checking blips/i.test(clean) || /^-Checks passed/i.test(clean) || /^Failed checks!/i.test(clean)) {
    trainerState = {
      ...trainerState,
      progressPhase: 'Validation / checks',
      progressLatestLine: clean,
    }
    emitTrainerState()
    return false
  }

  if (/^Delay /i.test(clean) || /^After aplying safety factor/i.test(clean) || /^Plotting the latency/i.test(clean) || /^Cannot automatically analyze the latency/i.test(clean) || /^Cannot use the user latency/i.test(clean)) {
    trainerState = {
      ...trainerState,
      progressPhase: 'Analyzing latency',
      progressLatestLine: clean,
    }
    emitTrainerState()
    return false
  }

  if (/^Plotting a comparison/i.test(clean) || /^Error-signal ratio/i.test(clean) || /^Run \(t=/i.test(clean)) {
    trainerState = {
      ...trainerState,
      progressPhase: 'Exporting / plotting',
      progressLatestLine: clean,
    }
    emitTrainerState()
    return false
  }

  return false
}

function processTrainerOutputLine(line: string): void {
  if (!line) return
  if (line.startsWith('NAM_LAB_RESULT:')) {
    try {
      const parsed = JSON.parse(line.slice('NAM_LAB_RESULT:'.length)) as { validationEsr?: number | null; outputModelPath?: string; checkpointModelPath?: string; modelName?: string }
      // For A2 we now match the official NAM trainer's convention: write the AGGREGATE
      // (sum of both packed sub-models) to metadata.training.validation_esr. The per-sub-model
      // breakdown (Full + Lite) lives separately in metadata.nam_lab.* so NAM Lab and any
      // sub-model-aware UI can still color-code and display the Full sub-model's ESR which is
      // what the plugin actually loads.
      // For A1, validationEsr is the single scalar ESR (no change).
      const subFull = trainerState.epochValidationEsrFull
      const subLite = trainerState.epochValidationEsrLite
      const aggCallback = trainerState.epochValidationEsrAggregate
      const aggFromSum = (typeof subFull === 'number' && typeof subLite === 'number')
        ? subFull + subLite
        : null
      const isPackedRun = typeof subFull === 'number' || typeof subLite === 'number' || typeof aggCallback === 'number'
      const finalEsr = isPackedRun
        ? (typeof aggCallback === 'number' ? aggCallback : (aggFromSum ?? parsed.validationEsr ?? trainerState.validationEsr))
        : (typeof parsed.validationEsr === 'number' ? parsed.validationEsr : trainerState.validationEsr)
      trainerState = {
        ...trainerState,
        validationEsr: finalEsr,
        outputModelPath: parsed.outputModelPath || trainerState.outputModelPath,
        checkpointModelPath: parsed.checkpointModelPath || trainerState.checkpointModelPath,
        modelName: parsed.modelName || trainerState.modelName,
        progressPhase: trainerState.progressPhase || 'Completed',
      }
      emitTrainerState()
      return
    } catch {
      appendTrainerLog(line)
      return
    }
  }
  if (line.startsWith('NAM_LAB_ERROR:')) {
    trainerState = {
      ...trainerState,
      error: line.slice('NAM_LAB_ERROR:'.length).trim(),
    }
    emitTrainerState()
    return
  }
  if (parseTrainerProgressLine(line)) return
  appendTrainerLog(stripAnsi(line))
}

function consumeTrainerChunk(remainder: string, chunk: Buffer): string {
  const combined = remainder + chunk.toString('utf-8')
  const parts = combined.split(/\r|\n/)
  const nextRemainder = parts.pop() ?? ''
  for (const part of parts) {
    const normalized = part.trim()
    if (normalized) processTrainerOutputLine(normalized)
  }
  return nextRemainder
}

async function ensureTrainerRunnerScript(): Promise<string> {
  const dir = join(app.getPath('userData'), 'trainer')
  await fs.promises.mkdir(dir, { recursive: true })
  const runnerPath = join(dir, 'nam-lab-trainer-runner.py')
  try {
    const existing = await fs.promises.readFile(runnerPath, 'utf-8')
    if (existing === TRAINER_RUNNER_SOURCE) return runnerPath
  } catch {
    // write below
  }
  await fs.promises.writeFile(runnerPath, TRAINER_RUNNER_SOURCE, 'utf-8')
  return runnerPath
}

function deriveTrainerModelName(
  outputPath: string,
  architecture: TrainerArchitecture,
  namingTemplate: string | null | undefined,
  profileName: string | null | undefined,
  thresholdEsr: number | null | undefined
): string {
  return fillTrainerNamingTemplate(namingTemplate || '{basename}', outputPath, architecture, profileName ?? null, thresholdEsr ?? null)
}

function getTrainerArchitectureFolderName(architecture: TrainerArchitecture): string {
  switch (architecture) {
    case 'standard':
      return 'Standard'
    case 'complex':
      return 'Complex'
    case 'lite':
      return 'Lite'
    case 'feather':
      return 'Feather'
    case 'nano':
      return 'Nano'
    case 'revystd':
      return 'REVySTD'
    case 'revyhi':
      return 'REVyHI'
    case 'revxstd':
      return 'REVxSTD'
    case 'a2':
      return 'A2'
    default:
      return architecture
  }
}

function createTrainerJob(payload: TrainerStartPayload, staged = false): TrainerQueueJob {
  const jobId = crypto.randomUUID()
  const baseName = deriveTrainerModelName(payload.outputPath, payload.architecture, payload.namingTemplate, payload.profileName, payload.thresholdEsr)
  const modelName = payload.modelNameSuffix ? `${baseName}${payload.modelNameSuffix}` : baseName
  const architectureFolder = getTrainerArchitectureFolderName(payload.architecture)
  const finalModelRoot = (payload.finalModelRoot ?? payload.trainPath).trim()
  const appendModelArchitectureFolder = payload.appendModelArchitectureFolder ?? true
  const appendGraphArchitectureFolder = payload.appendGraphArchitectureFolder ?? appendModelArchitectureFolder
  const appendProcessedArchitectureFolder = payload.appendProcessedArchitectureFolder ?? appendModelArchitectureFolder
  const architectureFinalRoot = appendModelArchitectureFolder ? join(finalModelRoot, architectureFolder) : finalModelRoot
  const workspacePath = getTrainerRunWorkspacePath(jobId, modelName, payload.architecture)
  return {
    jobId,
    status: staged ? 'staged' : 'queued',
    pythonPath: payload.pythonPath.trim(),
    inputPath: payload.inputPath.trim(),
    outputPath: payload.outputPath.trim(),
    trainPath: workspacePath,
    namMode: payload.namMode === 'a2' ? 'a2' : 'a1',
    architecture: payload.architecture,
    waveNetConfig: payload.waveNetConfig ?? null,
    lr: payload.lr ?? 0.004,
    lrDecay: payload.lrDecay ?? 0.002,
    batchSize: payload.batchSize ?? 16,
    ny: payload.ny ?? 8192,
    fitMrstft: payload.fitMrstft ?? true,
    normalizeWav: payload.normalizeWav ?? false,
    normalizeWavTargetDb: payload.normalizeWavTargetDb ?? -5.0,
    captureProfileId: payload.captureProfileId ?? null,
    epochs: payload.epochs,
    latency: payload.latency,
    thresholdEsr: payload.thresholdEsr,
    savePlot: payload.savePlot,
    silent: payload.silent,
    ignoreChecks: payload.ignoreChecks,
    modelName,
    outputModelPath: join(architectureFinalRoot, `${modelName}.nam`),
    checkpointModelPath: '',
    attempts: 0,
    startedAt: null,
    finishedAt: null,
    error: '',
    validationEsr: null,
    progressPercent: null,
    progressEpochCurrent: null,
    progressEpochTotal: payload.epochs,
    progressBatchCurrent: null,
    progressBatchTotal: null,
    progressRate: null,
    progressLatestLine: '',
    profileId: payload.profileId ?? null,
    profileName: payload.profileName ?? null,
    modeledBy: payload.modeledBy?.trim() || null,
    inputLevelDbu: Number.isFinite(payload.inputLevelDbu) ? payload.inputLevelDbu ?? null : null,
    outputLevelDbu: Number.isFinite(payload.outputLevelDbu) ? payload.outputLevelDbu ?? null : null,
    sourceMode: payload.sourceMode ?? 'manual-direct',
    finalModelRoot,
    processedWavRoot: (payload.processedWavRoot ?? '').trim(),
    graphRoot: (payload.graphRoot ?? '').trim(),
    graphRootResolved: payload.graphRootResolved ?? false,
    sourcePostProcess: payload.sourcePostProcess ?? 'keep',
    workspacePath,
    graphPath: '',
    sourceSizeBytes: null,
    sourceMtimeMs: null,
    submissionId: payload.submissionId ?? null,
    submissionLabel: payload.submissionLabel ?? null,
    submissionCreatedAt: payload.submissionCreatedAt ?? null,
    backupExisting: !!payload.backupExisting,
    appendModelArchitectureFolder,
    appendGraphArchitectureFolder,
    appendProcessedArchitectureFolder,
    editedAt: null,
    namingTemplate: payload.namingTemplate ?? null,
  }
}

function findNextModelNameSuffix(baseModelName: string, architectureFinalRoot: string): string {
  const candidate = join(architectureFinalRoot, `${baseModelName}.nam`)
  if (!fs.existsSync(candidate)) return ''
  for (let i = 2; i <= 99; i++) {
    const suffix = ` (${i})`
    if (!fs.existsSync(join(architectureFinalRoot, `${baseModelName}${suffix}.nam`))) return suffix
  }
  return ` (${Date.now()})`
}

function getActiveTrainerJob(): TrainerQueueJob | null {
  return trainerState.activeJobId ? (trainerQueue.find((job) => job.jobId === trainerState.activeJobId) ?? null) : null
}

function updateTrainerJob(jobId: string, patch: Partial<TrainerQueueJob>): void {
  trainerQueue = trainerQueue.map((job) => (job.jobId === jobId ? { ...job, ...patch } : job))
}

function findTrainerJobIndex(jobId: string): number {
  return trainerQueue.findIndex((job) => job.jobId === jobId)
}

function resetTrainerJobForQueue(job: TrainerQueueJob): TrainerQueueJob {
  return {
    ...job,
    status: 'queued',
    startedAt: null,
    finishedAt: null,
    outputModelPath: '',
    checkpointModelPath: '',
    error: '',
    validationEsr: null,
    validationEsrFull: null,
    progressPercent: null,
    progressEpochCurrent: null,
    progressEpochTotal: job.epochs,
    progressBatchCurrent: null,
    progressBatchTotal: null,
    progressRate: null,
    progressLatestLine: '',
  }
}

function nextQueuedTrainerJob(preferSubmissionId?: string | null): TrainerQueueJob | null {
  // Sticky-batch: prefer the next queued job in the same submission so an entire batch
  // runs to completion before the queue advances to the next batch. Falls back to the
  // globally first queued job when the preferred submission has nothing left.
  if (preferSubmissionId) {
    const sameSubmission = trainerQueue.find(j => j.status === 'queued' && j.submissionId === preferSubmissionId)
    if (sameSubmission) return sameSubmission
  }
  return trainerQueue.find((job) => job.status === 'queued') ?? null
}

function moveQueuedTrainerJob(jobId: string, direction: 'up' | 'down'): boolean {
  const queuedIndexes = trainerQueue
    .map((job, index) => ({ job, index }))
    .filter(({ job }) => job.status === 'queued')

  const currentQueuedIndex = queuedIndexes.findIndex(({ job }) => job.jobId === jobId)
  if (currentQueuedIndex === -1) return false
  const swapOffset = direction === 'up' ? -1 : 1
  const targetQueuedIndex = currentQueuedIndex + swapOffset
  if (targetQueuedIndex < 0 || targetQueuedIndex >= queuedIndexes.length) return false

  const currentIndex = queuedIndexes[currentQueuedIndex].index
  const targetIndex = queuedIndexes[targetQueuedIndex].index
  const nextQueue = [...trainerQueue]
  ;[nextQueue[currentIndex], nextQueue[targetIndex]] = [nextQueue[targetIndex], nextQueue[currentIndex]]
  trainerQueue = nextQueue
  maybeClearStickyPreference()
  return true
}

function makeQueuedTrainerJobNext(jobId: string): boolean {
  const queuedIndexes = trainerQueue
    .map((job, index) => ({ job, index }))
    .filter(({ job }) => job.status === 'queued')
  const currentQueuedIndex = queuedIndexes.findIndex(({ job }) => job.jobId === jobId)
  if (currentQueuedIndex <= 0) return currentQueuedIndex === 0

  const currentIndex = queuedIndexes[currentQueuedIndex].index
  const [job] = trainerQueue.splice(currentIndex, 1)
  const firstQueuedIndex = trainerQueue.findIndex((item) => item.status === 'queued')
  trainerQueue.splice(firstQueuedIndex === -1 ? trainerQueue.length : firstQueuedIndex, 0, job)
  maybeClearStickyPreference()
  return true
}

function reorderQueuedTrainerJob(jobId: string, beforeJobId: string): boolean {
  const queuedJobs = trainerQueue.filter((j) => j.status === 'queued')
  const fromIdx = trainerQueue.findIndex((j) => j.jobId === jobId)
  const toIdx = trainerQueue.findIndex((j) => j.jobId === beforeJobId)
  if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return false
  if (trainerQueue[fromIdx].status !== 'queued') return false
  const next = [...trainerQueue]
  const [moved] = next.splice(fromIdx, 1)
  const insertAt = next.findIndex((j) => j.jobId === beforeJobId)
  next.splice(insertAt === -1 ? next.length : insertAt, 0, moved)
  trainerQueue = next
  void queuedJobs // suppress lint
  maybeClearStickyPreference()
  return true
}

// Batch reorders move QUEUED rows only. The active/running job stays pinned where it is,
// staged rows stay parked in Staged Batches, and terminal (success/error/canceled) rows do
// not participate in queue ordering — they used to ride along with the block, which made
// reorders drag a batch's finished/failed rows around and produced odd split-batch visuals.
// The queue UI groups rows by submissionId regardless of array position and anchors each
// card on its first queued/running row, so rows left behind never split a card.
function moveSubmissionToEndOfQueue(submissionId: string): boolean {
  // Must have at least one queued job to be draggable
  const hasQueued = trainerQueue.some((j) => j.status === 'queued' && j.submissionId === submissionId)
  if (!hasQueued) return false
  const block = trainerQueue.filter((j) => j.submissionId === submissionId && j.status === 'queued')
  const rest = trainerQueue.filter((j) => !(j.submissionId === submissionId && j.status === 'queued'))
  trainerQueue = [...rest, ...block]
  maybeClearStickyPreference()
  return true
}

function moveSubmissionBeforeSubmission(submissionId: string, beforeSubmissionId: string): boolean {
  if (submissionId === beforeSubmissionId) return false
  // Must have at least one queued job to be draggable
  const hasQueued = trainerQueue.some((j) => j.status === 'queued' && j.submissionId === submissionId)
  if (!hasQueued) return false
  const block = trainerQueue.filter((j) => j.submissionId === submissionId && j.status === 'queued')
  const next = trainerQueue.filter((j) => !(j.submissionId === submissionId && j.status === 'queued'))
  // Insert before the target batch's first queued row; if the target has no queued rows
  // left (e.g. dragging above the running batch on its last capture, or above a batch
  // that's all terminal), fall back to its first row of any status. Requiring a queued
  // target row made dragging above the active batch fail outright.
  let insertAt = next.findIndex((j) => j.status === 'queued' && j.submissionId === beforeSubmissionId)
  if (insertAt === -1) insertAt = next.findIndex((j) => j.submissionId === beforeSubmissionId)
  if (insertAt === -1) return false
  next.splice(insertAt, 0, ...block)
  trainerQueue = next
  maybeClearStickyPreference()
  return true
}

// Re-derive the sticky-override flag after any explicit reorder: if the first queued job now
// belongs to a different submission than the active job, the user has said "run that next" —
// drop the sticky preference for the next pump. Recomputing (rather than latching) means
// reordering the active batch back to the front restores normal batch-continuation.
function maybeClearStickyPreference(): void {
  const activeId = trainerState.activeJobId
  if (!activeId) { trainerStickyPreferenceCleared = false; return }
  const activeJob = trainerQueue.find((j) => j.jobId === activeId)
  const firstQueued = trainerQueue.find((j) => j.status === 'queued')
  trainerStickyPreferenceCleared = Boolean(
    activeJob && firstQueued && firstQueued.submissionId !== activeJob.submissionId
  )
}

function isTrainingProfileActive(profile: TrainingProfile): boolean {
  return profile.enabled && profile.sourceMode === 'watcher' && (profile.autoRun || trainingWatcherRunning.has(profile.id))
}

function closeTrainingWatchers(): void {
  for (const watcher of trainingWatchers.values()) {
    try { watcher.close() } catch { /* ignore */ }
  }
  trainingWatchers.clear()
  for (const timer of trainingWatcherPendingTimers.values()) {
    clearTimeout(timer)
  }
  trainingWatcherPendingTimers.clear()
  trainingWatcherPendingCounts.clear()
}

async function statTrainingSource(filePath: string): Promise<{ sizeBytes: number; mtimeMs: number }> {
  const stat = await fs.promises.stat(filePath)
  return {
    sizeBytes: stat.size,
    mtimeMs: stat.mtimeMs,
  }
}

function trainerQueueAlreadyHasSource(profileId: string | null, sourcePath: string, architecture: TrainerArchitecture): boolean {
  const normalized = normalizePath(sourcePath)
  return trainerQueue.some((job) =>
    normalizePath(job.outputPath) === normalized &&
    job.architecture === architecture &&
    job.profileId === profileId &&
    job.status !== 'canceled'
  )
}

function makeTrainerQueueDuplicateKey(payload: TrainerStartPayload): string {
  return [
    normalizePath(payload.outputPath.trim()),
    payload.architecture,
    payload.sourceMode ?? 'manual-direct',
    normalizePath((payload.finalModelRoot ?? payload.trainPath).trim()),
    payload.profileId ?? '',
  ].join('::')
}

function trainerHistoryAlreadyHasSource(profileId: string | null, sourcePath: string, architecture: TrainerArchitecture, mtimeMs: number | null, sizeBytes: number | null): boolean {
  const normalized = normalizePath(sourcePath)
  return trainerHistory.some((entry) =>
    normalizePath(entry.sourcePath) === normalized &&
    entry.profileId === profileId &&
    entry.architecture === architecture &&
    entry.sourceMtimeMs === mtimeMs &&
    entry.sourceSizeBytes === sizeBytes &&
    entry.status === 'success'
  ) || trainerSkipped.some((entry) =>
    normalizePath(entry.sourcePath) === normalized &&
    entry.profileId === profileId &&
    entry.architecture === architecture &&
    entry.sourceMtimeMs === mtimeMs &&
    entry.sourceSizeBytes === sizeBytes
  )
}

function hasPendingSiblingTrainerJobs(job: TrainerQueueJob): boolean {
  const normalized = normalizePath(job.outputPath)
  return trainerQueue.some((item) =>
    item.jobId !== job.jobId &&
    normalizePath(item.outputPath) === normalized &&
    item.profileId === job.profileId &&
    ['queued', 'starting', 'running'].includes(item.status)
  )
}

async function buildTrainerPayloadsForProfile(
  profile: TrainingProfile,
  pythonPath: string,
  inputPath: string,
  sourceWavPaths: string[],
  sourceModeOverride?: TrainingSourceMode,
  submissionMeta?: { id: string; label: string; createdAt: string },
  normalizeOverride?: { normalizeWav: boolean; normalizeWavTargetDb: number }
): Promise<TrainerStartPayload[]> {
  const payloads: TrainerStartPayload[] = []
  if (!pythonPath.trim()) { log(`[payload builder "${profile.name}"] skipped: python path empty`); return payloads }
  if (!inputPath.trim()) { log(`[payload builder "${profile.name}"] skipped: input WAV path empty`); return payloads }
  if (!profile.finalModelRoot.trim() && !profile.effectiveOutputFormula?.trim()) { log(`[payload builder "${profile.name}"] skipped: no output root and no output formula`); return payloads }
  if (profile.architectures.length === 0) { log(`[payload builder "${profile.name}"] skipped: no architectures selected in preset`); return payloads }
  for (const outputPath of sourceWavPaths) {
    const normalizedOutputPath = outputPath.trim()
    if (!normalizedOutputPath) continue
    let sourceStats: { sizeBytes: number; mtimeMs: number } | null = null
    try {
      sourceStats = await statTrainingSource(normalizedOutputPath)
    } catch {
      log(`[payload builder "${profile.name}"] could not stat "${outputPath}" — skipping`)
      continue
    }
    for (const architecture of profile.architectures) {
      if (trainerQueueAlreadyHasSource(profile.id, normalizedOutputPath, architecture)) { log(`[payload builder "${profile.name}"] already in queue: "${outputPath}" / ${architecture}`); continue }
      if (trainerHistoryAlreadyHasSource(profile.id, normalizedOutputPath, architecture, sourceStats.mtimeMs, sourceStats.sizeBytes)) { log(`[payload builder "${profile.name}"] already in history/skipped: "${outputPath}" / ${architecture}`); continue }
      const isA2 = architecture === 'a2'
      const profileCfg = isA2 ? null : lookupCaptureProfileConfig(architecture, trainerUserCaptureProfiles)
      const graphFormula = profile.effectiveGraphFormula?.trim() ?? ''
      const resolvedGraphRoot = graphFormula ? resolveGraphFormula(graphFormula, profile.watchFolder, architecture) : null
      const outputFormula = profile.effectiveOutputFormula?.trim() ?? ''
      const resolvedOutputRoot = outputFormula ? resolveGraphFormula(outputFormula, profile.watchFolder, architecture) : null
      const finalModelRoot = resolvedOutputRoot ?? profile.finalModelRoot
      payloads.push({
        pythonPath,
        inputPath,
        outputPath: normalizedOutputPath,
        trainPath: finalModelRoot,
        namMode: isA2 ? 'a2' : 'a1',
        normalizeWav: normalizeOverride?.normalizeWav ?? trainerConfiguredNormalizeWav,
        normalizeWavTargetDb: normalizeOverride?.normalizeWavTargetDb ?? trainerConfiguredNormalizeWavTargetDb,
        architecture,
        waveNetConfig: profileCfg?.waveNetConfig ?? null,
        lr: profileCfg?.lr ?? 0.004,
        lrDecay: profileCfg?.lrDecay ?? 0.002,
        batchSize: profileCfg?.batchSize ?? 16,
        ny: profileCfg?.ny ?? 8192,
        fitMrstft: profileCfg?.fitMrstft ?? true,
        captureProfileId: isA2 ? null : architecture,
        epochs: profile.epochs,
        latency: profile.latencyMode === 'manual' ? profile.latencyValue : null,
        thresholdEsr: profile.thresholdEsr,
        savePlot: profile.savePlot,
        silent: true,
        ignoreChecks: profile.ignoreChecks,
        modeledBy: trainerConfiguredModeledBy || null,
        inputLevelDbu: trainerConfiguredInputLevelDbu,
        outputLevelDbu: trainerConfiguredOutputLevelDbu,
        profileId: profile.id,
        profileName: profile.name,
        sourceMode: sourceModeOverride ?? profile.sourceMode,
        finalModelRoot,
        processedWavRoot: profile.processedWavRoot,
        graphRoot: resolvedGraphRoot ?? profile.graphRoot,
        graphRootResolved: !!resolvedGraphRoot,
        sourcePostProcess: 'keep',
        namingTemplate: profile.namingTemplate,
        submissionId: submissionMeta?.id ?? null,
        submissionLabel: submissionMeta?.label ?? null,
        submissionCreatedAt: submissionMeta?.createdAt ?? null,
        appendModelArchitectureFolder: profile.architectures.length > 1 && !/\{architecture\}/i.test(outputFormula),
        appendGraphArchitectureFolder: profile.architectures.length > 1 && !/\{architecture\}/i.test(graphFormula),
        appendProcessedArchitectureFolder: profile.architectures.length > 1,
      })
    }
  }
  return payloads
}

async function enqueueTrainingPayloads(payloads: TrainerStartPayload[], staged = false): Promise<number> {
  if (payloads.length === 0) return 0
  const existingKeys = new Set(
    trainerQueue
      .filter((job) => ['queued', 'starting', 'running'].includes(job.status))
      .map((job) => [
        normalizePath(job.outputPath.trim()),
        job.architecture,
        job.sourceMode,
        normalizePath(job.finalModelRoot.trim()),
        job.profileId ?? '',
      ].join('::'))
  )
  const seenPayloadKeys = new Set<string>()
  const uniquePayloads = payloads.filter((payload) => {
    const key = makeTrainerQueueDuplicateKey(payload)
    if (existingKeys.has(key) || seenPayloadKeys.has(key)) return false
    seenPayloadKeys.add(key)
    return true
  })
  if (uniquePayloads.length === 0) {
    emitTrainerState()
    return 0
  }
  const jobs = uniquePayloads.map((payload) => createTrainerJob(payload, staged))
  // Finished/failed/canceled rows stay in the Queue until the user clicks Clear finished (or removes them
  // individually). This keeps long-running batches readable when a follow-up batch is added mid-run.
  trainerQueue.push(...jobs)
  emitTrainerState()
  for (const job of jobs) {
    try {
      const stats = await statTrainingSource(job.outputPath)
      job.sourceSizeBytes = stats.sizeBytes
      job.sourceMtimeMs = stats.mtimeMs
    } catch {
      // leave null
    }
  }
  emitTrainerState()
  if (!staged) await pumpTrainerQueue()
  return jobs.length
}

async function pollTrainerCheckpoint(trainPath: string): Promise<void> {
  try {
    const ckpts = await findFilesRecursive(trainPath, (p) => /\.ckpt$/i.test(p))
    if (ckpts.length === 0) return
    // Pick the most recently modified checkpoint.
    const withMtime = await Promise.all(ckpts.map(async (p) => {
      const st = await fs.promises.stat(p).catch(() => null)
      return { p, mtime: st?.mtimeMs ?? 0 }
    }))
    const newest = withMtime.reduce((a, b) => (b.mtime > a.mtime ? b : a)).p
    if (newest && newest !== trainerState.checkpointModelPath) {
      trainerState = { ...trainerState, checkpointModelPath: newest }
      emitTrainerState()
    }
  } catch {
    /* best effort */
  }
}

function stopCheckpointPoll(): void {
  if (trainerCheckpointPollTimer !== null) {
    clearInterval(trainerCheckpointPollTimer)
    trainerCheckpointPollTimer = null
  }
}

async function startTrainerJob(job: TrainerQueueJob): Promise<void> {
  const pythonPath = job.pythonPath
  const inputPath = job.inputPath
  const outputPath = job.outputPath
  const trainPath = job.trainPath
  const runId = job.jobId
  const finalOutputModelPath = job.appendModelArchitectureFolder
    ? join(job.finalModelRoot, getTrainerArchitectureFolderName(job.architecture), `${job.modelName}.nam`)
    : join(job.finalModelRoot, `${job.modelName}.nam`)

  updateTrainerJob(job.jobId, {
    status: 'starting',
    attempts: job.attempts + 1,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: '',
    validationEsr: null,
    outputModelPath: finalOutputModelPath,
    checkpointModelPath: '',
    progressPercent: null,
    progressEpochCurrent: null,
    progressEpochTotal: job.epochs,
    progressBatchCurrent: null,
    progressBatchTotal: null,
    progressRate: null,
    progressLatestLine: '',
    thresholdEsr: job.thresholdEsr,
  })

  trainerState = {
    status: 'starting',
    runId,
    pythonPath,
    inputPath,
    outputPath,
    trainPath,
    architecture: job.architecture,
    epochs: job.epochs,
    latency: job.latency,
    thresholdEsr: job.thresholdEsr,
    modelName: job.modelName,
    outputModelPath: finalOutputModelPath,
    checkpointModelPath: '',
    savePlot: job.savePlot,
    silent: job.silent,
    ignoreChecks: job.ignoreChecks,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    logs: [],
    error: '',
    validationEsr: null,
    replicateEsr: null,
    epochValidationEsr: null,
    progressPhase: 'Preparing',
    progressPercent: null,
    progressEpochCurrent: null,
    progressEpochTotal: job.epochs,
    progressBatchCurrent: null,
    progressBatchTotal: null,
    progressRate: null,
    progressLatestLine: '',
    activeJobId: job.jobId,
    pauseAfterCurrent: trainerPauseAfterCurrent,
    queue: trainerQueue,
  }
  emitTrainerState()

  await fs.promises.access(pythonPath)
  await fs.promises.access(inputPath)
  await fs.promises.access(outputPath)
  try {
    const outputStat = await fs.promises.stat(outputPath)
    updateTrainerJob(job.jobId, {
      sourceSizeBytes: outputStat.size,
      sourceMtimeMs: outputStat.mtimeMs,
    })
  } catch {
    /* best effort */
  }
  await fs.promises.mkdir(trainPath, { recursive: true })

  const runnerPath = await ensureTrainerRunnerScript()
  const payloadDir = join(app.getPath('userData'), 'trainer')
  await fs.promises.mkdir(payloadDir, { recursive: true })
  const payloadPath = join(payloadDir, `run-${runId}.json`)
  const runnerPayload = {
    inputPath,
    outputPath,
    trainPath,
    namMode: job.namMode ?? 'a1',
    normalizeWav: job.normalizeWav,
    normalizeWavTargetDb: job.normalizeWavTargetDb,
    architecture: job.architecture,
    waveNetConfig: job.waveNetConfig,
    lr: job.lr,
    lrDecay: job.lrDecay,
    batchSize: job.batchSize,
    ny: job.ny,
    fitMrstft: job.fitMrstft,
    epochs: job.epochs,
    latency: job.latency,
    thresholdEsr: job.thresholdEsr,
    savePlot: job.savePlot,
    silent: job.silent,
    ignoreChecks: job.ignoreChecks,
    modelName: job.modelName,
    backupExisting: !!job.backupExisting,
    // user_metadata fields — embedded into the .nam by the trainer
    modeledBy: job.modeledBy ?? null,
    inputLevelDbu: job.inputLevelDbu ?? null,
    outputLevelDbu: job.outputLevelDbu ?? null,
  }
  await fs.promises.writeFile(payloadPath, JSON.stringify(runnerPayload, null, 2), 'utf-8')

  // Build a clean environment: start from process.env but strip Electron-specific variables
  // that can confuse Python's native extensions (PyTorch, CUDA DLLs) when inherited.
  // These vars are meaningless to Python and in some cases change how native DLLs initialize.
  const ELECTRON_VARS_TO_STRIP = new Set([
    'ELECTRON_RUN_AS_NODE',
    'ELECTRON_NO_ASAR',
    'ELECTRON_DISABLE_SECURITY_WARNINGS',
    'ELECTRON_ENABLE_LOGGING',
    'ELECTRON_ENABLE_STACK_DUMPING',
    'CHROME_DESKTOP',
    'NODE_OPTIONS',
    'ORIGINAL_XDG_CURRENT_DESKTOP',
  ])
  const cleanEnv: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !ELECTRON_VARS_TO_STRIP.has(k)) cleanEnv[k] = v
  }

  const { spawn } = await import('child_process')
  trainerChild = spawn(pythonPath, ['-u', runnerPath, payloadPath], {
    cwd: trainPath,
    // On Windows, windowsHide:true gives the subprocess null console handles.
    // CUDA and PyTorch native DLLs sometimes call Windows console APIs internally;
    // with null handles this can corrupt the stack cookie and trigger STATUS_STACK_BUFFER_OVERRUN (0xC0000409).
    // We hide the window at the Windows level via windowsHide but still provide valid handles via stdio:pipe.
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...cleanEnv,
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
      // Enable Python's built-in fault handler — writes a traceback to stderr on crashes
      // that happen inside native C extensions (SIGSEGV, stack overflow, etc.).
      PYTHONFAULTHANDLER: '1',
      // Throttle tqdm to one refresh every 10s and force ASCII bars — mirrors Anaconda-shell behavior in a non-TTY pipe.
      TQDM_MININTERVAL: '10',
      TQDM_ASCII: '1',
    },
  })
  // Reset per-run callback epoch tracker so the tqdm fallback works correctly on the first
  // few epochs of the new run (before the embedded Python callback has had a chance to fire).
  trainerLastCallbackEsrEpoch = 0
  trainerState = { ...trainerState, status: 'running', progressPhase: 'Launching trainer' }
  emitTrainerState()

  stopCheckpointPoll()
  trainerCheckpointPollTimer = setInterval(() => { void pollTrainerCheckpoint(trainPath) }, 15_000)

  let stdoutRemainder = ''
  let stderrRemainder = ''

  trainerChild.stdout.on('data', (chunk: Buffer) => {
    stdoutRemainder = consumeTrainerChunk(stdoutRemainder, chunk)
  })

  trainerChild.stderr.on('data', (chunk: Buffer) => {
    stderrRemainder = consumeTrainerChunk(stderrRemainder, chunk)
  })

  trainerChild.once('error', async (error) => {
    stopCheckpointPoll()
    trainerState = {
      ...trainerState,
      status: 'error',
      finishedAt: new Date().toISOString(),
      error: String(error),
    }
    trainerChild = null
    emitTrainerState()
    if (!trainerPauseAfterCurrent) {
      // Honor an explicit user promotion: pump in pure queue order instead of sticking to
      // this job's batch (see trainerStickyPreferenceCleared).
      const preferred = trainerStickyPreferenceCleared ? null : job.submissionId
      trainerStickyPreferenceCleared = false
      await pumpTrainerQueue(preferred)
    }
  })

  trainerChild.once('close', async (code, signal) => {
    stopCheckpointPoll()
    if (stdoutRemainder.trim()) processTrainerOutputLine(stdoutRemainder.trim())
    if (stderrRemainder.trim()) processTrainerOutputLine(stderrRemainder.trim())

    // Emergency stop: send the active job back to 'queued' (front of the queue), skip history append
    // and post-processing entirely. The job hasn't really finished — it's just been requeued.
    if (trainerEmergencyRequeue) {
      trainerEmergencyRequeue = false
      const activeId = trainerEmergencyRequeueJobId
      // Keep trainerEmergencyRequeueJobId set until after the async unlink so that
      // suppressActiveJobSync stays true and emitTrainerState can't clobber the job
      // back to 'canceled' during the I/O yield.
      if (activeId) {
        trainerQueue = trainerQueue.map((job) => (
          job.jobId === activeId
            ? resetTrainerJobForQueue(job)
            : job
        ))
      }
      // Clean up the partial workspace for the killed run so the retry starts fresh.
      try { await fs.promises.unlink(payloadPath) } catch { /* ignore */ }
      trainerEmergencyRequeueJobId = null
      trainerState = {
        ...trainerState,
        status: 'idle',
        activeJobId: null,
        runId: null,
        startedAt: null,
        finishedAt: null,
        outputModelPath: '',
        checkpointModelPath: '',
        validationEsr: null,
        epochValidationEsr: null,
        progressPercent: null,
        progressEpochCurrent: null,
        progressBatchCurrent: null,
        progressBatchTotal: null,
        progressRate: null,
        progressPhase: 'Stopped — queue paused',
        error: '',
      }
      trainerChild = null
      trainerPostProcessing = false
      emitTrainerState()
      // Do NOT call pumpTrainerQueue here — pauseAfterCurrent was set by the cancel handler,
      // so the queue stays paused until the user clicks Resume.
      return
    }

    const wasCanceled = trainerState.status === 'canceled'
    const finalStatus: TrainerStateSnapshot['status'] = wasCanceled ? 'canceled' : code === 0 ? 'success' : 'error'
    let finalError = trainerState.error
    if (!wasCanceled && code !== 0 && !finalError) {
      if (signal) {
        finalError = `Training process stopped by signal ${signal}`
      } else {
        // Decode common Windows STATUS codes (shown as large decimal numbers on Windows).
        const WIN_STATUS: Record<number, string> = {
          3221225477: 'Access violation (0xC0000005) — Python or PyTorch crashed. This is usually caused by GPU/CUDA out-of-memory or a corrupt PyTorch installation. Try reducing batch size or restarting.',
          3221225725: 'Invalid image format (0xC000007B) — a required DLL was not found or has the wrong architecture. Check your Python environment.',
          3221225786: 'Process was terminated externally (0xC000013A).',
          3221226356: 'Heap corruption (0xC0000374) — Python native extension crashed due to memory corruption.',
          3221225501: 'Illegal instruction (0xC000001D) — CPU instruction not supported. Your PyTorch build may not be compatible with this CPU.',
          3221225620: 'Integer divide by zero (0xC0000094).',
          3221226505: 'Stack buffer overrun (0xC0000409) — Windows terminated the process via a security fast-fail. Usually caused by a stack overflow inside PyTorch\'s C++ runtime (e.g. extremely deep model or very large batch). Try reducing batch size or model complexity.',
        }
        finalError = WIN_STATUS[code as number] ?? `Training process exited with code ${code}`
      }
    }
    trainerState = {
      ...trainerState,
      status: finalStatus,
      finishedAt: new Date().toISOString(),
      error: finalError,
      progressPhase: wasCanceled ? 'Canceled' : code === 0 ? 'Completed' : 'Failed',
      progressPercent: code === 0 ? 100 : trainerState.progressPercent,
    }
    trainerChild = null
    trainerPostProcessing = true
    try { await fs.promises.unlink(payloadPath) } catch { /* ignore */ }

    if (finalStatus === 'success' && trainerState.outputModelPath) {
      try {
        await fs.promises.mkdir(dirname(finalOutputModelPath), { recursive: true })
        const finalModelPath = await ensureUniqueFilePath(finalOutputModelPath)

        const candidatePaths = new Set<string>()
        const pushCandidate = (value: string | null | undefined) => {
          const trimmed = typeof value === 'string' ? value.trim() : ''
          if (trimmed) candidatePaths.add(trimmed)
        }

        // Prefer the path reported by Python, then the discovered checkpoint path, then the
        // conventional workspace filename. If those fail, scan the whole workspace.
        pushCandidate(trainerState.outputModelPath)
        pushCandidate(trainerState.checkpointModelPath)
        pushCandidate(join(job.trainPath, `${job.modelName}.nam`))

        const workspaceNams = await findFilesRecursive(job.trainPath, (p) => /\.nam$/i.test(p))
        if (workspaceNams.length > 0) {
          const scored = await Promise.all(workspaceNams.map(async (p) => {
            const st = await fs.promises.stat(p).catch(() => null)
            const lower = basename(p).toLowerCase()
            const modelLower = job.modelName.toLowerCase()
            const score =
              (lower.includes('checkpoint_best') ? 100 : 0) +
              (lower.includes(modelLower) ? 20 : 0) +
              (lower.endsWith('.nam') ? 1 : 0)
            return { p, score, mtime: st?.mtimeMs ?? 0 }
          }))
          const stronglyMatching = scored.filter((item) => {
            const lower = basename(item.p).toLowerCase()
            return lower === `${job.modelName.toLowerCase()}.nam` || lower.includes(job.modelName.toLowerCase())
          })
          const fallbackPool = stronglyMatching.length > 0 ? stronglyMatching : scored.filter((item) => item.score >= 100)
          for (const item of fallbackPool.sort((a, b) => (b.score - a.score) || (b.mtime - a.mtime))) {
            pushCandidate(item.p)
          }
        }

        let copied = false
        const attempted: string[] = []
        let lastCopyError: unknown = null
        for (const sourceModelPath of candidatePaths) {
          const sourceExists = await fs.promises.access(sourceModelPath).then(() => true).catch(() => false)
          if (!sourceExists) {
            attempted.push(`${sourceModelPath} (missing)`)
            continue
          }
          try {
            suppressWatcher()
            await fs.promises.copyFile(sourceModelPath, finalModelPath)
            if (sourceModelPath !== trainerState.outputModelPath) {
              log(`[trainer] promote fallback: copied ${sourceModelPath} to ${finalModelPath}`)
            }
            copied = true
            break
          } catch (copyError) {
            lastCopyError = copyError
            attempted.push(`${sourceModelPath} (${String(copyError)})`)
          }
        }

        if (!copied) {
          throw new Error(
            `No usable final model source was available.\n` +
            `Workspace: ${job.trainPath}\n` +
            `Destination: ${finalModelPath}\n` +
            `Tried:\n- ${attempted.join('\n- ') || '(no candidates)'}\n` +
            (lastCopyError ? `Last error: ${String(lastCopyError)}` : '')
          )
        }

        trainerState = {
          ...trainerState,
          outputModelPath: finalModelPath,
        }
      } catch (promoteError) {
        trainerState = {
          ...trainerState,
          status: 'error',
          error: `Could not promote final model: ${String(promoteError)}`,
        }
      }
    }

    if (trainerState.status === 'success' && trainerState.outputModelPath) {
      try {
        const content = await fs.promises.readFile(trainerState.outputModelPath, 'utf-8')
        const patched = persistTrainerMetadata(content, {
          epochs: job.epochs,
          architecture: job.architecture,
          modelName: job.modelName,
          modeledBy: job.modeledBy,
          inputLevelDbu: job.inputLevelDbu,
          outputLevelDbu: job.outputLevelDbu,
          validationEsr: trainerState.validationEsr,
          validationEsrFull: trainerState.epochValidationEsrFull ?? null,
          validationEsrLite: trainerState.epochValidationEsrLite ?? null,
          mrstft: trainerState.epochMrstft ?? null,
          mrstftLite: trainerState.epochMrstftLite ?? null,
          mse: trainerState.epochMse ?? null,
          mseLite: trainerState.epochMseLite ?? null,
          manualLatencySamples: job.latency,
        })
        JSON.parse(patched)
        suppressWatcher()
        await fs.promises.writeFile(trainerState.outputModelPath, patched, 'utf-8')
        delete loadFileCache()[trainerState.outputModelPath]
      } catch (metadataError) {
        trainerState = {
          ...trainerState,
          logs: [...trainerState.logs, `Trainer metadata write warning: ${String(metadataError)}`].slice(-600),
        }
      }
    }

    const effectiveFinalStatus: TrainerStateSnapshot['status'] = trainerState.status
    const effectiveFinalError = trainerState.error

    let promotedGraphPath = ''
    let processedWavPath = ''
    if (effectiveFinalStatus === 'success') {
      try {
        promotedGraphPath = await promoteTrainerGraph(job)
        if (promotedGraphPath) {
          updateTrainerJob(job.jobId, { graphPath: promotedGraphPath })
          trainerState = { ...trainerState }
        }
      } catch (graphError) {
        trainerState = {
          ...trainerState,
          logs: [...trainerState.logs, `Trainer graph promote warning: ${String(graphError)}`].slice(-600),
        }
      }
      try {
        if (!hasPendingSiblingTrainerJobs(job)) {
          processedWavPath = await postProcessTrainerSourceWav(job)
        }
      } catch (sourceMoveError) {
        trainerState = {
          ...trainerState,
          logs: [...trainerState.logs, `Trainer source post-process warning: ${String(sourceMoveError)}`].slice(-600),
        }
      }
    }

    if (wasCanceled && trainerState.outputModelPath) {
      try {
        if (fs.existsSync(trainerState.outputModelPath)) {
          suppressWatcher()
          await fs.promises.unlink(trainerState.outputModelPath)
        }
      } catch {
        /* best effort; keep canceled state even if cleanup fails */
      }
    }

    const runDurationSec = trainerState.startedAt && trainerState.finishedAt
      ? Math.max(0, Math.floor((new Date(trainerState.finishedAt).getTime() - new Date(trainerState.startedAt).getTime()) / 1000))
      : null
    appendTrainerHistory({
      historyId: crypto.randomUUID(),
      timestamp: trainerState.finishedAt ?? new Date().toISOString(),
      profileId: job.profileId,
      profileName: job.profileName,
      sourceMode: job.sourceMode,
      sourcePath: job.outputPath,
      sourceSizeBytes: getActiveTrainerJob()?.sourceSizeBytes ?? job.sourceSizeBytes,
      sourceMtimeMs: getActiveTrainerJob()?.sourceMtimeMs ?? job.sourceMtimeMs,
      architecture: job.architecture,
      finalModelPath: effectiveFinalStatus === 'success' ? trainerState.outputModelPath : '',
      processedWavPath,
      graphPath: promotedGraphPath,
      status: effectiveFinalStatus === 'success' ? 'success' : effectiveFinalStatus === 'error' ? 'error' : 'canceled',
      attempts: job.attempts,
      validationEsr: trainerState.validationEsr,
      thresholdEsr: job.thresholdEsr,
      epochs: job.epochs,
      latencyMode: job.latency == null ? 'auto' : 'manual',
      latencyValue: job.latency,
      finalModelName: job.modelName,
      failureReason: effectiveFinalStatus === 'success' ? '' : (effectiveFinalError ?? finalError),
      submissionId: job.submissionId,
      submissionLabel: job.submissionLabel,
      submissionCreatedAt: job.submissionCreatedAt,
      durationSec: runDurationSec,
      // A2-only fields — null for A1 runs.
      validationEsrFull: job.architecture === 'a2' ? (trainerState.epochValidationEsrFull ?? null) : null,
      validationEsrLite: job.architecture === 'a2' ? (trainerState.epochValidationEsrLite ?? null) : null,
    })

    emitTrainerState()

    // Once every non-staged job in this batch is terminal (any outcome), move it out of the queue —
    // its full record lives in history. Failed batches are retried from History, not inline.
    if (pruneFinishedBatchesFromQueue()) emitTrainerState()

    trainerPostProcessing = false
    if (!trainerPauseAfterCurrent) {
      // Honor an explicit user promotion: pump in pure queue order instead of sticking to
      // this job's batch (see trainerStickyPreferenceCleared).
      const preferred = trainerStickyPreferenceCleared ? null : job.submissionId
      trainerStickyPreferenceCleared = false
      await pumpTrainerQueue(preferred)
    } else {
      trainerState = { ...trainerState, status: 'idle', activeJobId: null, runId: null, progressPhase: 'Paused — click Resume to continue' }
      emitTrainerState()
    }
  })
}

async function pumpTrainerQueue(preferSubmissionId?: string | null): Promise<void> {
  if (trainerChild || trainerPostProcessing || trainerState.status === 'starting' || trainerState.status === 'running') return
  // Honor Pause After Current — if the user paused, don't auto-start the next job, even when
  // a new batch is added or another handler tries to nudge the queue forward. The pause must be
  // explicitly cleared (Resume / Start queue) before pumping resumes.
  if (trainerPauseAfterCurrent) {
    trainerState = {
      ...TRAINER_IDLE_STATE,
      queue: trainerQueue,
      pauseAfterCurrent: trainerPauseAfterCurrent,
      progressPhase: 'Paused — click Resume to continue',
    }
    emitTrainerState()
    return
  }
  const nextJob = nextQueuedTrainerJob(preferSubmissionId)
  if (!nextJob) {
    trainerState = {
      ...TRAINER_IDLE_STATE,
      queue: trainerQueue,
      pauseAfterCurrent: trainerPauseAfterCurrent,
    }
    emitTrainerState()
    return
  }
  try {
    await startTrainerJob(nextJob)
  } catch (error) {
    const failureReason = String(error)
    updateTrainerJob(nextJob.jobId, {
      status: 'error',
      finishedAt: new Date().toISOString(),
      error: failureReason,
    })
    appendTrainerCanceledHistory(nextJob, failureReason, '', 'error')
    // Pause the queue after a start failure (Python path missing, WAV not found, etc.).
    // startTrainerJob only throws for pre-flight checks — these failures will repeat for every
    // subsequent job, so cascading would silently mark the entire queue as error and wipe it
    // from the persistence file. Pausing here forces the user to fix the issue first.
    trainerPauseAfterCurrent = true
    trainerState = {
      ...TRAINER_IDLE_STATE,
      status: 'error',
      error: failureReason,
      finishedAt: new Date().toISOString(),
      activeJobId: null,
      queue: trainerQueue,
      pauseAfterCurrent: trainerPauseAfterCurrent,
    }
    emitTrainerState()
    persistTrainerQueueThrottled()
  }
}

async function scanWavFilesInFolder(folderPath: string): Promise<string[]> {
  const entries = await fs.promises.readdir(folderPath, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && /\.wav$/i.test(entry.name))
    .map((entry) => join(folderPath, entry.name))
    .sort((a, b) => a.localeCompare(b))
}

async function enqueueExistingTrainingWatcherFiles(profile: TrainingProfile): Promise<void> {
  const sourceFolder = profile.watchFolder.trim()
  if (!sourceFolder) { log(`[watcher "${profile.name}"] skipping initial scan: watch folder not set`); return }
  if (!trainerConfiguredPythonPath) { log(`[watcher "${profile.name}"] skipping initial scan: Python path not configured`); return }
  if (!trainerConfiguredInputPath) { log(`[watcher "${profile.name}"] skipping initial scan: Training input WAV not configured`); return }
  try {
    const files = await scanWavFilesInFolder(sourceFolder)
    log(`[watcher "${profile.name}"] initial scan found ${files.length} WAV(s) in "${sourceFolder}"`)
    if (files.length === 0) return
    const submissionMeta = {
      id: crypto.randomUUID(),
      label: `Watcher - ${profile.name}`,
      createdAt: new Date().toISOString(),
    }
    const payloads = await buildTrainerPayloadsForProfile(
      profile,
      trainerConfiguredPythonPath,
      trainerConfiguredInputPath,
      files,
      'watcher',
      submissionMeta
    )
    log(`[watcher "${profile.name}"] built ${payloads.length} payload(s) from ${files.length} file(s)`)
    if (payloads.length === 0) return
    await enqueueTrainingPayloads(payloads)
    await ensureTrainingWatcherAutoStart(profile)
  } catch (error) {
    log(`training watcher initial scan failed for "${profile.name}": ${String(error)}`)
  }
}

async function markExistingTrainingWatcherFilesAsSeen(profile: TrainingProfile): Promise<number> {
  const sourceFolder = profile.watchFolder.trim()
  if (!sourceFolder) return 0
  try {
    const files = await scanWavFilesInFolder(sourceFolder)
    if (files.length === 0) return 0
    let marked = 0
    for (const filePath of files) {
      let sourceStats: { sizeBytes: number; mtimeMs: number } | null = null
      try {
        sourceStats = await statTrainingSource(filePath)
      } catch {
        continue
      }
      for (const architecture of profile.architectures) {
        if (trainerQueueAlreadyHasSource(profile.id, filePath, architecture)) continue
        if (trainerHistoryAlreadyHasSource(profile.id, filePath, architecture, sourceStats.mtimeMs, sourceStats.sizeBytes)) continue
        appendTrainerSkipped({
          skipId: crypto.randomUUID(),
          profileId: profile.id,
          profileName: profile.name,
          sourcePath: filePath,
          architecture,
          sourceSizeBytes: sourceStats.sizeBytes,
          sourceMtimeMs: sourceStats.mtimeMs,
          skippedAt: new Date().toISOString(),
          reason: 'baseline-seen',
        })
        marked += 1
      }
    }
    return marked
  } catch (error) {
    log(`training watcher baseline mark failed for "${profile.name}": ${String(error)}`)
    return 0
  }
}

async function ensureTrainingWatcherAutoStart(profile: TrainingProfile): Promise<void> {
  if (!profile.autoRun) return
  // Intentionally does NOT call pumpTrainerQueue here. Watcher files go through
  // enqueueTrainingPayloads which already calls pumpTrainerQueue when jobs are added.
  // Calling it here would start manually-queued jobs on every launch whenever an autoRun
  // watcher profile initializes, bypassing the user's auto-start-on-launch preference.
}

function scheduleTrainingWatcherFile(profile: TrainingProfile, filePath: string): void {
  const countKey = profile.id
  const timerKey = makeTrainingWatcherTimerKey(profile.id, filePath)
  clearTrainingWatcherTimer(timerKey)
  trainingWatcherPendingCounts.set(countKey, (trainingWatcherPendingCounts.get(countKey) ?? 0) + 1)
  emitTrainerState()
  const timer = setTimeout(async () => {
    try {
      if (!fs.existsSync(filePath)) return
      const first = await statTrainingSource(filePath)
      await wait(1200)
      const second = await statTrainingSource(filePath)
      if (first.sizeBytes !== second.sizeBytes || first.mtimeMs !== second.mtimeMs) {
        scheduleTrainingWatcherFile(profile, filePath)
        return
      }
      const payloads = await buildTrainerPayloadsForProfile(
        profile,
        trainerConfiguredPythonPath,
        trainerConfiguredInputPath,
        [filePath],
        'watcher',
        {
          id: crypto.randomUUID(),
          label: `Watcher - ${profile.name}`,
          createdAt: new Date().toISOString(),
        }
      )
      await enqueueTrainingPayloads(payloads)
      await ensureTrainingWatcherAutoStart(profile)
    } catch (error) {
      log(`training watcher enqueue failed for ${filePath}: ${String(error)}`)
    } finally {
      trainingWatcherPendingCounts.set(countKey, Math.max(0, (trainingWatcherPendingCounts.get(countKey) ?? 1) - 1))
      clearTrainingWatcherTimer(timerKey)
      emitTrainerState()
    }
  }, 1200)
  trainingWatcherPendingTimers.set(timerKey, timer)
}

let trainerConfiguredPythonPath = ''
let trainerConfiguredInputPath = ''
let trainerConfiguredModeledBy = ''
let trainerConfiguredInputLevelDbu: number | null = null
let trainerConfiguredOutputLevelDbu: number | null = null
let trainerConfiguredNormalizeWav = false
let trainerConfiguredNormalizeWavTargetDb = -5.0

function resetTrainingWatchProfiles(profiles: TrainingProfile[], retainGraphs: boolean): void {
  const manualRunning = new Set(trainingWatcherRunning)
  closeTrainingWatchers()
  trainingProfiles = profiles
  trainingRetainGraphs = retainGraphs
  trainingWatcherRunning.clear()
  for (const profile of trainingProfiles) {
    if (manualRunning.has(profile.id)) trainingWatcherRunning.add(profile.id)
    if (!isTrainingProfileActive(profile) || !profile.watchFolder.trim()) continue
    const sourceFolder = profile.watchFolder.trim()
    try {
      const watcher = fs.watch(sourceFolder, { recursive: false }, (_eventType, filename) => {
        const nextName = typeof filename === 'string' ? filename : filename?.toString() ?? ''
        if (!nextName || !/\.wav$/i.test(nextName)) return
        scheduleTrainingWatcherFile(profile, join(sourceFolder, nextName))
      })
      trainingWatchers.set(profile.id, watcher)
      trainingWatcherRunning.add(profile.id)
      if ((profile.initialScanMode ?? 'process-existing') === 'process-existing') {
        void enqueueExistingTrainingWatcherFiles(profile)
      }
      void ensureTrainingWatcherAutoStart(profile)
    } catch (error) {
      log(`training watcher error "${profile.name}": ${String(error)}`)
    }
  }
  emitTrainerState()
}

function hashFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function hashFileWithoutMetadataSha256(filePath: string): Promise<string> {
  const content = await fs.promises.readFile(filePath, 'utf-8')
  const data = JSON.parse(content) as Record<string, unknown>
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    delete data.metadata
  }
  return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex')
}

async function mergeFolderContents(sourcePath: string, destPath: string): Promise<{ skippedPaths: string[] }> {
  const skippedPaths: string[] = []
  const entries = await fs.promises.readdir(sourcePath, { withFileTypes: true })

  for (const entry of entries) {
    const sourceChild = join(sourcePath, entry.name)
    const destChild = join(destPath, entry.name)

    if (entry.isDirectory()) {
      if (fs.existsSync(destChild)) {
        const destStat = await fs.promises.stat(destChild)
        if (!destStat.isDirectory()) {
          skippedPaths.push(sourceChild.replace(/\\/g, '/'))
          continue
        }
        const nested = await mergeFolderContents(sourceChild, destChild)
        skippedPaths.push(...nested.skippedPaths)
        const remaining = await fs.promises.readdir(sourceChild)
        if (remaining.length === 0) {
          suppressWatcher()
          await fs.promises.rmdir(sourceChild)
        }
      } else {
        suppressWatcher()
        await fs.promises.rename(sourceChild, destChild)
      }
      continue
    }

    if (fs.existsSync(destChild)) {
      skippedPaths.push(sourceChild.replace(/\\/g, '/'))
      continue
    }

    suppressWatcher()
    await fs.promises.rename(sourceChild, destChild)
  }

  return { skippedPaths }
}

async function waitForStableFile(filePath: string, attempts = 10, delayMs = 700): Promise<boolean> {
  let lastSize = -1
  for (let i = 0; i < attempts; i++) {
    try {
      const stat = await fs.promises.stat(filePath)
      if (stat.size > 0 && stat.size === lastSize) return true
      lastSize = stat.size
    } catch {
      // keep waiting until file appears and settles
    }
    await wait(delayMs)
  }
  return false
}

function closeFolderWatchers(): void {
  for (const watcher of folderWatchers.values()) {
    try { watcher.close() } catch { /* ignore */ }
  }
  folderWatchers.clear()
  if (folderWatchPollInterval !== null) {
    clearInterval(folderWatchPollInterval)
    folderWatchPollInterval = null
  }
}

async function deleteEmptyFolderTree(folderPath: string): Promise<number> {
  const entries = await fs.promises.readdir(folderPath, { withFileTypes: true })
  let removedCount = 0

  for (const entry of entries) {
    const childPath = join(folderPath, entry.name)
    if (entry.isDirectory()) {
      removedCount += await deleteEmptyFolderTree(childPath)
      continue
    }
    throw new Error('Folder tree is not empty')
  }

  suppressWatcher()
  await fs.promises.rmdir(folderPath)
  return removedCount + 1
}

function makeFolderWatchKey(sourceFolder: string, destFolder: string): string {
  return `${normalizePath(sourceFolder)}=>${normalizePath(destFolder)}`
}

function folderWatchRuleSignature(rule: FolderWatchRule): string {
  return `${normalizePath(rule.sourceFolder)}=>${normalizePath(rule.destFolder)}:${rule.enabled ? '1' : '0'}`
}

function folderWatchRulesEqual(a: FolderWatchRule[], b: FolderWatchRule[]): boolean {
  if (a.length !== b.length) return false
  const aSig = a.map(folderWatchRuleSignature).sort()
  const bSig = b.map(folderWatchRuleSignature).sort()
  return aSig.every((sig, index) => sig === bSig[index])
}

function getFolderWatchImports(rule: FolderWatchRule): FolderWatchImportEntry[] {
  return folderWatchImports.get(makeFolderWatchKey(rule.sourceFolder, rule.destFolder)) ?? []
}

async function hashFile(filePath: string): Promise<string> {
  const { createHash } = await import('crypto')
  const data = await fs.promises.readFile(filePath)
  return createHash('sha256').update(data).digest('hex')
}

function hasImportedWatchedFile(rule: FolderWatchRule, sourcePath: string, sizeBytes: number, mtimeMs: number, contentHash?: string): boolean {
  const imports = getFolderWatchImports(rule)
  if (contentHash) {
    if (imports.some((entry) => entry.contentHash === contentHash)) return true
  }
  return imports.some((entry) =>
    normalizePath(entry.sourcePath) === normalizePath(sourcePath) &&
    entry.sizeBytes === sizeBytes &&
    entry.mtimeMs === mtimeMs
  )
}

function rememberImportedWatchedFile(rule: FolderWatchRule, entry: FolderWatchImportEntry): void {
  const key = makeFolderWatchKey(rule.sourceFolder, rule.destFolder)
  const next = getFolderWatchImports(rule)
    .filter((existing) => normalizePath(existing.sourcePath) !== normalizePath(entry.sourcePath))
  next.push(entry)
  folderWatchImports.set(key, next)
}

const deleteBehaviorCache = new Map<string, boolean>()

async function getDeleteBehavior(filePaths: string[]): Promise<{ permanentOnly: boolean; reason?: string }> {
  if (filePaths.length === 0) return { permanentOnly: false }

  if (process.platform !== 'win32') return { permanentOnly: false }

  const firstPath = filePaths[0]
  const normalized = firstPath.replace(/\//g, '\\')
  if (normalized.startsWith('\\\\')) {
    return { permanentOnly: true, reason: 'network-share' }
  }

  const root = normalizePath(normalized).slice(0, 3).toUpperCase()
  if (!/^[A-Z]:\\$/.test(root)) return { permanentOnly: false }
  if (deleteBehaviorCache.has(root)) {
    return deleteBehaviorCache.get(root)
      ? { permanentOnly: true, reason: 'mapped-network-drive' }
      : { permanentOnly: false }
  }

  try {
    const { execSync } = await import('child_process')
    const command = `$drive = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${root.slice(0, 2)}'"; if ($drive) { Write-Output $drive.DriveType }`
    const output = execSync(`powershell -NoProfile -Command "${command}"`, {
      encoding: 'utf8',
      timeout: 3000,
      windowsHide: true,
    }).trim()
    const driveType = parseInt(output, 10)
    const isNetwork = driveType === 4
    deleteBehaviorCache.set(root, isNetwork)
    return isNetwork
      ? { permanentOnly: true, reason: 'mapped-network-drive' }
      : { permanentOnly: false }
  } catch {
    deleteBehaviorCache.set(root, false)
    return { permanentOnly: false }
  }
}

async function trashWithRetry(filePath: string, attempts = 4, delayMs = 350): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await shell.trashItem(process.platform === 'win32' ? filePath.replace(/\//g, '\\') : filePath)
      return
    } catch (err) {
      lastError = err
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
  }
  throw lastError
}

async function deleteWithFallback(filePath: string): Promise<'trash' | 'delete'> {
  try {
    await trashWithRetry(filePath)
    return 'trash'
  } catch {
    await fs.promises.unlink(filePath)
    return 'delete'
  }
}

function isNestedPath(parentPath: string, childPath: string): boolean {
  const parent = normalizePath(parentPath).replace(/[\\/]+$/, '').toLowerCase()
  const child = normalizePath(childPath).replace(/[\\/]+$/, '').toLowerCase()
  return child === parent || child.startsWith(parent + '\\') || child.startsWith(parent + '/')
}

// Per-file watch-sync branches (in-flight/non-file/existing/already-imported) fire once per
// file on every sync — activation, every 45s poll, and every real fs event. For a source
// folder with hundreds of files that's hundreds of log lines each pass, which is what was
// flooding the dev terminal and (before log() was made non-blocking) contributing to the
// main-process stalls. Only the outcomes that actually matter (copy, error) log by default;
// flip this to true for a session if you need to debug why a specific file isn't syncing.
const WATCH_LOG_VERBOSE = false

// A watch rule's destination folder can vanish out from under us — e.g. the user deletes it in
// Explorer. copyFile then throws ENOENT for every file, every 45s poll, forever, spamming errors.
// Detect that here and tell the renderer to auto-cancel the rule instead. We do NOT recreate the
// folder: the user deleted it on purpose, so resurrecting it and copying files back would be wrong.
function watchDestMissing(rule: FolderWatchRule): boolean {
  if (fs.existsSync(rule.destFolder)) return false
  log(`folderWatch dest-missing — requesting rule cancel sourceFolder="${rule.sourceFolder}" destFolder="${rule.destFolder}"`)
  safeSend('folderWatch:destMissing', {
    sourceFolder: rule.sourceFolder.replace(/\\/g, '/'),
    destFolder: rule.destFolder.replace(/\\/g, '/'),
  })
  return true
}

async function copyWatchedFile(rule: FolderWatchRule, filePath: string): Promise<FolderWatchCopyOutcome> {
  const normalizedSource = normalizePath(filePath)
  if (watchDestMissing(rule)) return 'dest-missing'
  const key = `${rule.destFolder}::${normalizedSource}`
  if (folderWatchInFlight.has(key)) {
    if (WATCH_LOG_VERBOSE) log(`folderWatch skip in-flight source="${normalizedSource}" destFolder="${rule.destFolder}"`)
    return 'in-flight'
  }
  folderWatchInFlight.add(key)
  try {
    const stable = await waitForStableFile(normalizedSource)
    if (!stable) {
      log(`folderWatch timeout waiting for stable file source="${normalizedSource}" destFolder="${rule.destFolder}"`)
      safeSend('folderWatch:error', {
        sourceFolder: rule.sourceFolder.replace(/\\/g, '/'),
        destFolder: rule.destFolder.replace(/\\/g, '/'),
        message: `Timed out waiting for ${basename(normalizedSource)} to finish writing`
      })
      return 'timeout'
    }
    const stat = await fs.promises.stat(normalizedSource)
    if (!stat.isFile()) {
      if (WATCH_LOG_VERBOSE) log(`folderWatch skip non-file source="${normalizedSource}" destFolder="${rule.destFolder}"`)
      return 'non-file'
    }
    const fileName = basename(normalizedSource)
    const destPath = join(rule.destFolder, fileName)
    // Never overwrite a destination file that already exists — once a copy has landed here,
    // a later source edit (e.g. saving metadata, which rewrites the .nam file in place and
    // changes its hash/size/mtime) must not silently replace it. Real report: editing
    // metadata after the watcher already copied a file caused the destination copy to be
    // silently overwritten with the edited version. Checked before hashing so an
    // already-landed file is never re-hashed on every fs.watch event / 45s poll either.
    if (fs.existsSync(destPath)) {
      if (WATCH_LOG_VERBOSE) log(`folderWatch skip existing-destination source="${normalizedSource}" dest="${destPath}"`)
      return 'existing'
    }
    const contentHash = await hashFile(normalizedSource)
    if (hasImportedWatchedFile(rule, normalizedSource, stat.size, stat.mtimeMs, contentHash)) {
      if (WATCH_LOG_VERBOSE) log(`folderWatch skip already-imported source="${normalizedSource}" dest="${destPath}" size=${stat.size} mtime=${stat.mtimeMs} hash="${contentHash}"`)
      return 'already-imported'
    }
    suppressWatcher()
    log(`folderWatch copy source="${normalizedSource}" dest="${destPath}" size=${stat.size} mtime=${stat.mtimeMs} hash="${contentHash}"`)
    await fs.promises.copyFile(normalizedSource, destPath, fs.constants.COPYFILE_EXCL)
    const importEntry: FolderWatchImportEntry = {
      sourcePath: normalizedSource.replace(/\\/g, '/'),
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
      importedAt: new Date().toISOString(),
      contentHash,
    }
    rememberImportedWatchedFile(rule, importEntry)
    safeSend('folderWatch:copied', {
      sourcePath: normalizedSource.replace(/\\/g, '/'),
      destPath: destPath.replace(/\\/g, '/'),
      sourceFolder: rule.sourceFolder.replace(/\\/g, '/'),
      destFolder: rule.destFolder.replace(/\\/g, '/'),
      importEntry,
    })
    return 'copied'
  } catch (err) {
    log(`folderWatch error source="${normalizedSource}" destFolder="${rule.destFolder}" error="${String(err)}"`)
    safeSend('folderWatch:error', {
      sourceFolder: rule.sourceFolder.replace(/\\/g, '/'),
      destFolder: rule.destFolder.replace(/\\/g, '/'),
      message: String(err)
    })
    return 'error'
  } finally {
    folderWatchInFlight.delete(key)
  }
}

async function backfillImportHashes(rule: FolderWatchRule): Promise<void> {
  const key = makeFolderWatchKey(rule.sourceFolder, rule.destFolder)
  const entries = folderWatchImports.get(key)
  if (!entries) return
  let changed = false
  for (const entry of entries) {
    if (entry.contentHash) continue
    try {
      entry.contentHash = await hashFile(entry.sourcePath)
      changed = true
    } catch { /* source may no longer exist — leave entry as-is */ }
  }
  if (changed) {
    folderWatchImports.set(key, entries)
    safeSend('folderWatch:importsBackfilled', { key, entries })
  }
}

async function syncExistingWatchedFiles(rule: FolderWatchRule): Promise<void> {
  // Bail before scanning/hashing anything if the destination is gone — auto-cancels the rule.
  if (watchDestMissing(rule)) return
  await backfillImportHashes(rule)
  try {
    log(`folderWatch sync start sourceFolder="${rule.sourceFolder}" destFolder="${rule.destFolder}"`)
    const entries = await fs.promises.readdir(rule.sourceFolder, { withFileTypes: true })
    const counts: Record<FolderWatchCopyOutcome, number> = {
      copied: 0,
      existing: 0,
      'already-imported': 0,
      'in-flight': 0,
      'non-file': 0,
      timeout: 0,
      error: 0,
      'dest-missing': 0,
    }
    let scanned = 0
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.nam')) continue
      scanned += 1
      const outcome = await copyWatchedFile(rule, join(rule.sourceFolder, entry.name))
      counts[outcome] += 1
    }
    log(`folderWatch sync complete sourceFolder="${rule.sourceFolder}" destFolder="${rule.destFolder}" scanned=${scanned} copied=${counts.copied} existing=${counts.existing} alreadyImported=${counts['already-imported']} inFlight=${counts['in-flight']} timeout=${counts.timeout} error=${counts.error}`)
  } catch (err) {
    log(`folderWatch sync error sourceFolder="${rule.sourceFolder}" destFolder="${rule.destFolder}" error="${String(err)}"`)
    safeSend('folderWatch:error', {
      sourceFolder: rule.sourceFolder.replace(/\\/g, '/'),
      destFolder: rule.destFolder.replace(/\\/g, '/'),
      message: `Initial sync failed: ${String(err)}`
    })
  }
}

function resetFolderWatchRules(rules: FolderWatchRule[]): void {
  folderWatchRules = rules
  closeFolderWatchers()
  log(`folderWatch reset rules count=${rules.length}`)

  for (const rule of folderWatchRules) {
    if (!rule.enabled) continue
    const sourceFolder = normalizePath(rule.sourceFolder)
    const destFolder = normalizePath(rule.destFolder)
    if (!sourceFolder || !destFolder) continue
    if (sourceFolder.toLowerCase() === destFolder.toLowerCase()) {
      log(`folderWatch skip same-folder source="${sourceFolder}" dest="${destFolder}"`)
      continue
    }
    if (isNestedPath(sourceFolder, destFolder) || isNestedPath(destFolder, sourceFolder)) {
      log(`folderWatch skipped nested rule source="${sourceFolder}" dest="${destFolder}"`)
      continue
    }
    try {
      log(`folderWatch activate source="${sourceFolder}" dest="${destFolder}"`)
      const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>()
      const watcher = fs.watch(sourceFolder, { recursive: false }, (_eventType, filename) => {
        const nextFilename = String(filename ?? '').trim()
        const lowerName = nextFilename.toLowerCase()
        if (!lowerName.endsWith('.nam') || lowerName.endsWith('.json')) return
        const existingTimer = pendingTimers.get(lowerName)
        if (existingTimer) clearTimeout(existingTimer)
        const timer = setTimeout(() => {
          pendingTimers.delete(lowerName)
          // Skip entirely when this event landed inside our own suppress window (any local
          // write — metadata save, batch edit, Excel import — calls suppressWatcher() first).
          // The destination-exists check in copyWatchedFile already prevents an overwrite,
          // but without this the watcher still re-hashes and re-checks the file on every save,
          // and (per user report) the resulting churn made it look like something was
          // "copying it over and wiping it" even once the actual overwrite was blocked. This
          // matches the same suppress check the library folder:watch listener already uses.
          if (Date.now() < watcherSuppressUntil) {
            if (WATCH_LOG_VERBOSE) log(`folderWatch skip suppressed-event sourceFolder="${sourceFolder}" file="${nextFilename}" dest="${destFolder}"`)
            return
          }
          const fullPath = join(sourceFolder, nextFilename)
          log(`folderWatch event source="${fullPath}" destFolder="${destFolder}"`)
          void copyWatchedFile({ ...rule, sourceFolder, destFolder }, fullPath)
        }, 1200)
        pendingTimers.set(lowerName, timer)
      })
      folderWatchers.set(`${sourceFolder}=>${destFolder}`, watcher)
      void syncExistingWatchedFiles({ ...rule, sourceFolder, destFolder })
    } catch (err) {
      log(`folderWatch rule error source="${sourceFolder}" dest="${destFolder}": ${String(err)}`)
    }
  }

  // Polling fallback — fs.watch on Windows can miss events from external processes
  // (e.g. Python NAM trainer). Re-scan all active source folders every 45 seconds.
  if (folderWatchRules.some((r) => r.enabled)) {
    folderWatchPollInterval = setInterval(() => {
      for (const rule of folderWatchRules) {
        if (!rule.enabled) continue
        const sourceFolder = normalizePath(rule.sourceFolder)
        const destFolder = normalizePath(rule.destFolder)
        if (!sourceFolder || !destFolder) continue
        if (sourceFolder.toLowerCase() === destFolder.toLowerCase()) continue
        if (isNestedPath(sourceFolder, destFolder) || isNestedPath(destFolder, sourceFolder)) continue
        void syncExistingWatchedFiles({ ...rule, sourceFolder, destFolder })
      }
    }, 45_000)
  }
}

// Catch uncaught exceptions before anything else
process.on('uncaughtException', (err) => {
  log(`UNCAUGHT EXCEPTION: ${err.message}\n${err.stack ?? ''}`)
})
process.on('unhandledRejection', (reason) => {
  log(`UNHANDLED REJECTION: ${String(reason)}`)
})

log(`NAM Lab starting - platform: ${process.platform}, arch: ${process.arch}, node: ${process.version}`)
log(`Electron: ${process.versions.electron}, Chrome: ${process.versions.chrome}`)
log(`Args: ${process.argv.join(' ')}`)
log(`isDev: ${isDev}`)

// ---- File metadata cache ----
// Persists parsed .nam metadata keyed by file path so reopening the same
// folder only IPC-reads files whose mtime or size changed since last open.
interface CacheEntry { mtimeMs: number; size: number; data: unknown }
let _fileCache: Record<string, CacheEntry> | null = null

function fileCachePath(): string {
  return join(app.getPath('userData'), 'nam-file-cache.json')
}

function loadFileCache(): Record<string, CacheEntry> {
  if (_fileCache) return _fileCache
  try {
    _fileCache = JSON.parse(fs.readFileSync(fileCachePath(), 'utf-8'))
  } catch {
    _fileCache = {}
  }
  return _fileCache!
}

function saveFileCache(): void {
  if (!_fileCache) return
  try {
    fs.writeFileSync(fileCachePath(), JSON.stringify(_fileCache), 'utf-8')
  } catch { /* non-fatal */ }
}

// Persist window size and maximized state between launches
// Path is computed lazily inside each function - app.getPath() must not be
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
    log('ready-to-show fired - showing window')
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

  // Warn before closing while a training job is active.
  let closeConfirmed = false
  mainWindow.on('close', (e) => {
    saveWinState()
    if (closeConfirmed || !trainerChild) return
    e.preventDefault()
    void dialog.showMessageBox(mainWindow!, {
      type: 'question',
      buttons: ['Stop Training & Close', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Training in progress',
      message: 'A training job is currently running.',
      detail: 'Closing now will kill the trainer and the current capture will not be saved. Close anyway?',
    }).then(({ response }) => {
      if (response === 0) {
        closeConfirmed = true
        if (requestEmergencyRequeueCurrentJob(true)) {
          trainerState = {
            ...trainerState,
            status: 'canceled',
            finishedAt: new Date().toISOString(),
            error: '',
            progressPhase: 'Closing app...'
          }
          emitTrainerState()
        }
        if (trainerChild) trainerChild.kill()
        mainWindow?.destroy()
      }
    })
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      openExternalSafe(details.url, ['https:', 'mailto:'])
    } catch {
      /* ignore blocked URLs */
    }
    return { action: 'deny' }
  })

  // Prevent Electron from navigating to dropped file URLs - without this,
  // dropping a file onto the window replaces the app with the raw file contents.
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  // ── Renderer crash recovery ────────────────────────────────────────────────
  // If the renderer process dies (OOM, GPU process crash, etc.) the window goes
  // blank with no recovery. Log the reason (so we can finally diagnose the "goes
  // blank when left open / loses focus" reports) and auto-reload once.
  let reloadingAfterCrash = false
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log(`render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`)
    if (reloadingAfterCrash) return
    reloadingAfterCrash = true
    setTimeout(() => {
      reloadingAfterCrash = false
      if (mainWindow && !mainWindow.isDestroyed()) {
        log('reloading window after renderer crash')
        mainWindow.reload()
      }
    }, 300)
  })
  mainWindow.webContents.on('unresponsive', () => {
    log('renderer became unresponsive')
  })
  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDesc, validatedURL) => {
    log(`did-fail-load: code=${errorCode} desc=${errorDesc} url=${validatedURL}`)
  })
  // Surface renderer-side errors into the main log so a blank screen caused by an
  // uncaught React render exception leaves a trace. Electron changed this event's
  // signature in v36 (positional level/message → a details object), so read both forms.
  const onConsoleMessage = ((...args: unknown[]): void => {
    const second = args[1]
    let level: unknown
    let message: unknown
    if (second && typeof second === 'object') {
      level = (second as { level?: unknown }).level
      message = (second as { message?: unknown }).message
    } else {
      level = second
      message = args[2]
    }
    if (level === 'error' || level === 3) {
      log(`renderer console.error: ${String(message ?? '')}`)
    }
  }) as (...args: unknown[]) => void
  mainWindow.webContents.on('console-message', onConsoleMessage as never)

  // Enable right-click Copy/Paste context menu for text selection in the app
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const menuItems: Electron.MenuItemConstructorOptions[] = []
    if (params.selectionText) {
      menuItems.push({ label: 'Copy', role: 'copy' })
    }
    if (params.isEditable) {
      if (params.selectionText) menuItems.push({ type: 'separator' })
      menuItems.push({ label: 'Cut', role: 'cut' })
      menuItems.push({ label: 'Paste', role: 'paste' })
      menuItems.push({ label: 'Select All', role: 'selectAll' })
    }
    if (menuItems.length > 0) {
      Menu.buildFromTemplate(menuItems).popup({ window: mainWindow! })
    }
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function getDialogParentWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined
}

async function showOpenDialogSafely(
  options: Electron.OpenDialogOptions,
  parentWindow: BrowserWindow | undefined = getDialogParentWindow()
): Promise<Electron.OpenDialogReturnValue> {
  if (
    process.platform !== 'win32' ||
    !parentWindow ||
    parentWindow.isDestroyed() ||
    !parentWindow.isMaximized()
  ) {
    return dialog.showOpenDialog(parentWindow, options)
  }

  parentWindow.unmaximize()
  parentWindow.focus()
  await new Promise((resolve) => setTimeout(resolve, 75))

  try {
    return await dialog.showOpenDialog(parentWindow, options)
  } finally {
    if (!parentWindow.isDestroyed()) {
      parentWindow.maximize()
      parentWindow.focus()
    }
  }
}

// Returns the root-level /"metadata"\s*:\s*\{/ match.
// A2 (SlimmableContainer) files also embed "metadata" inside each submodel under config.
// Patchers must target the top-level metadata object because that is what the UI reads.
function findOuterMetadataMatch(content: string): RegExpExecArray | null {
  let inString = false
  let escaped = false
  let objectDepth = 0
  let arrayDepth = 0
  const metadataRe = /^"metadata"\s*:\s*\{/

  for (let i = 0; i < content.length; i++) {
    const ch = content[i]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }

    if (objectDepth === 1 && arrayDepth === 0 && ch === '"') {
      const token = metadataRe.exec(content.slice(i))
      if (token) {
        const match = [token[0]] as unknown as RegExpExecArray
        match.index = i
        match.input = content
        return match
      }
    }

    if (ch === '"') {
      inString = true
    } else if (ch === '{') {
      objectDepth++
    } else if (ch === '}') {
      objectDepth = Math.max(0, objectDepth - 1)
    } else if (ch === '[') {
      arrayDepth++
    } else if (ch === ']') {
      arrayDepth = Math.max(0, arrayDepth - 1)
    }
  }

  return null
}

// Surgically patch only the changed metadata fields in the raw file text.
// All original formatting, whitespace, field order, and non-metadata content
// (weights, config, etc.) are preserved byte-for-byte.
function patchMetadataFields(content: string, patches: Record<string, unknown>): string {
  // Find the "metadata": { block (use last match for A2 compatibility)
  const metaKeyMatch = findOuterMetadataMatch(content)
  if (!metaKeyMatch) throw new Error('No "metadata" block found in file')

  const openBrace = metaKeyMatch.index + metaKeyMatch[0].length - 1
  const closeBrace = findMatchingBrace(content, openBrace)
  if (closeBrace === -1) throw new Error('Malformed metadata block')

  const prefix = content.slice(0, openBrace + 1) // up to and including {
  let inner = content.slice(openBrace + 1, closeBrace)
  const tail = content.slice(closeBrace)           // } onwards

  for (const [key, value] of Object.entries(patches)) {
    const newVal = serializeJsonValue(value)
    // Match "key"\s*:\s*<JSON-value> â€” handles null, strings, and numbers
    const re = new RegExp(
      `("${escapeRe(key)}")(\\s*:\\s*)(null|"(?:[^"\\\\]|\\\\.)*"|-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)`
    )
    if (re.test(inner)) {
      // Replace only the value; keep the key token and spacing intact
      inner = inner.replace(re, (_m, k, sep) => k + sep + newVal)
    } else if (value !== null && value !== undefined) {
      // Field doesn't exist yet â€” insert it, matching the file's indentation style
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

function applyTrainerMetadataConventions(
  content: string,
  options: {
    architecture: TrainerArchitecture
  }
): string {
  try {
    const data = JSON.parse(content) as Record<string, unknown>
    const metadata = (data.metadata && typeof data.metadata === 'object' && !Array.isArray(data.metadata))
      ? (data.metadata as Record<string, unknown>)
      : null

    if (!metadata) return content

    // Mark NAM Lab-trained files explicitly without removing any upstream-compatible fields.
    metadata.trainer = 'NAM Lab'

    if (options.architecture === 'a2') {
      const config = (data.config && typeof data.config === 'object' && !Array.isArray(data.config))
        ? (data.config as Record<string, unknown>)
        : null
      const submodels = Array.isArray(config?.submodels) ? config?.submodels as unknown[] : null
      const loudness = metadata.loudness
      const gain = metadata.gain
      const topLevelNamLab = (metadata.nam_lab && typeof metadata.nam_lab === 'object' && !Array.isArray(metadata.nam_lab))
        ? (metadata.nam_lab as Record<string, unknown>)
        : null
      const mirroredNamLabKeys = [
        'trained_epochs',
        'preset_name',
        'validation_esr',
        'manual_latency_samples',
        'a2_full_validation_esr',
        'a2_lite_validation_esr',
        'mrstft',
        'mse',
        'a2_lite_mrstft',
        'a2_lite_mse',
      ] as const

      if (submodels) {
        for (const [index, submodel] of submodels.entries()) {
          if (!submodel || typeof submodel !== 'object' || Array.isArray(submodel)) continue
          const submodelRecord = submodel as Record<string, unknown>
          const model = (submodelRecord.model && typeof submodelRecord.model === 'object' && !Array.isArray(submodelRecord.model))
            ? (submodelRecord.model as Record<string, unknown>)
            : null
          if (!model) continue
          const submodelMetadata = (model.metadata && typeof model.metadata === 'object' && !Array.isArray(model.metadata))
            ? (model.metadata as Record<string, unknown>)
            : {}

          if (loudness != null) submodelMetadata.loudness = loudness
          if (gain != null) submodelMetadata.gain = gain
          if (topLevelNamLab && index === (submodels.length > 1 ? 1 : 0)) {
            const submodelNamLab = (submodelMetadata.nam_lab && typeof submodelMetadata.nam_lab === 'object' && !Array.isArray(submodelMetadata.nam_lab))
              ? (submodelMetadata.nam_lab as Record<string, unknown>)
              : {}
            for (const key of mirroredNamLabKeys) {
              if (topLevelNamLab[key] != null) submodelNamLab[key] = topLevelNamLab[key]
            }
            if (Object.keys(submodelNamLab).length > 0) submodelMetadata.nam_lab = submodelNamLab
          }
          model.metadata = submodelMetadata
        }
      }
    }

    return `${JSON.stringify(data, null, 2)}\n`
  } catch {
    return content
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getPreferredNamBot(meta: Record<string, unknown>): Record<string, unknown> | undefined {
  const topLevel = meta.nam_bot
  if (topLevel && typeof topLevel === 'object' && !Array.isArray(topLevel)) {
    return topLevel as Record<string, unknown>
  }
  const training = meta.training
  if (training && typeof training === 'object' && !Array.isArray(training)) {
    const legacy = (training as Record<string, unknown>).nam_bot
    if (legacy && typeof legacy === 'object' && !Array.isArray(legacy)) {
      return legacy as Record<string, unknown>
    }
  }
  return undefined
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function getA2SubmodelMetadata(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const config = objectRecord(data?.config)
  const submodels = config?.submodels
  if (!Array.isArray(submodels)) return undefined

  const candidates = submodels
    .map((submodel) => objectRecord(objectRecord(submodel)?.model)?.metadata)
    .filter((metadata): metadata is Record<string, unknown> => !!objectRecord(metadata))

  if (candidates.length === 0) return undefined

  const score = (metadata: Record<string, unknown>): number => {
    const coreFields = ['gear_type', 'gear_make', 'gear_model', 'tone_type', 'input_level_dbu', 'output_level_dbu']
    const namLab = objectRecord(metadata.nam_lab)
    const namLabFields = ['mics', 'cabinet', 'cabinet_config', 'amp_channel', 'boost_pedal', 'amp_settings', 'pedal_settings', 'amp_switches', 'comments', 'about', 'rating']
    return coreFields.filter((field) => metadata[field] != null && metadata[field] !== '').length
      + namLabFields.filter((field) => namLab?.[field] != null && namLab?.[field] !== '').length
  }

  return candidates.sort((a, b) => score(b) - score(a))[0]
}

function fillMissingMetadataFromA2Submodel(meta: Record<string, unknown>, data: Record<string, unknown> | undefined): void {
  const subMeta = getA2SubmodelMetadata(data)
  if (!subMeta) return

  const fillIfBlank = (target: Record<string, unknown>, key: string, source: Record<string, unknown>): void => {
    if ((target[key] == null || target[key] === '') && source[key] != null && source[key] !== '') {
      target[key] = source[key]
    }
  }

  for (const key of ['name', 'modeled_by', 'gear_type', 'gear_make', 'gear_model', 'tone_type', 'input_level_dbu', 'output_level_dbu']) {
    fillIfBlank(meta, key, subMeta)
  }

  const subNamBot = getPreferredNamBot(subMeta)
  if (subNamBot) {
    const topNamBot = objectRecord(meta.nam_bot)
    if (!topNamBot) meta.nam_bot = { ...subNamBot }
    else {
      for (const key of ['trained_epochs', 'preset_name', 'validation_esr', 'manual_latency_samples']) {
        fillIfBlank(topNamBot, key, subNamBot)
      }
    }
  }

  const subNamLab = objectRecord(subMeta.nam_lab)
  if (subNamLab) {
    const topNamLab = objectRecord(meta.nam_lab)
    if (!topNamLab) meta.nam_lab = { ...subNamLab }
    else {
      for (const key of ['mics', 'cabinet', 'cabinet_config', 'amp_channel', 'boost_pedal', 'amp_settings', 'pedal_settings', 'amp_switches', 'comments', 'about', 'rating']) {
        fillIfBlank(topNamLab, key, subNamLab)
      }
    }
  }
}

function liftUiMetadata(meta: Record<string, unknown>, data?: Record<string, unknown>): Record<string, unknown> {
  fillMissingMetadataFromA2Submodel(meta, data)
  const nb = getPreferredNamBot(meta)
  if (nb?.trained_epochs != null) meta.nb_trained_epochs = nb.trained_epochs
  if (nb?.preset_name != null) meta.nb_preset_name = nb.preset_name
  // Lift latency calibration value to flat key for the editor
  const trainingData = (meta.training as Record<string, unknown> | undefined)?.data as Record<string, unknown> | undefined
  const latencyCal = (trainingData?.latency as Record<string, unknown> | undefined)?.calibration as Record<string, unknown> | undefined
  if (latencyCal?.recommended != null) meta.latency_recommended = latencyCal.recommended
  const nl = meta.nam_lab as Record<string, unknown> | undefined
  if (nl) {
    if (meta.nb_trained_epochs == null && nl.trained_epochs != null) meta.nb_trained_epochs = nl.trained_epochs
    if (meta.nb_preset_name == null && nl.preset_name != null) meta.nb_preset_name = nl.preset_name
    const nlKeys = ['mics','cabinet','cabinet_config','amp_channel','boost_pedal','amp_settings','pedal_settings','amp_switches','comments','about','rating'] as const
    for (const k of nlKeys) {
      if (nl[k] != null) meta[`nl_${k}`] = nl[k]
    }
  }
  return meta
}

function patchMetadataField(content: string, field: string, value: unknown): string {
  const newVal = serializeJsonValue(value)
  const fieldRe = new RegExp(
    `("${escapeRe(field)}")(\\s*:\\s*)(null|true|false|"(?:[^"\\\\]|\\\\.)*"|-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)`
  )
  const metaKeyMatch = findOuterMetadataMatch(content)
  if (!metaKeyMatch) return content
  const openBrace = metaKeyMatch.index + metaKeyMatch[0].length - 1
  const closeBrace = findMatchingBrace(content, openBrace)
  if (closeBrace === -1) return content
  let inner = content.slice(openBrace + 1, closeBrace)
  if (fieldRe.test(inner)) {
    inner = inner.replace(fieldRe, (_m, k, sep) => k + sep + newVal)
    return content.slice(0, openBrace + 1) + inner + content.slice(closeBrace)
  }
  if (value === null || value === undefined) return content
  const indentMatch = /\n([ \t]+)"/.exec(inner)
  const indent = indentMatch ? indentMatch[1] : '    '
  const trimmed = inner.trimEnd()
  const needsComma = trimmed.length > 0 && !trimmed.endsWith(',')
  const trailing = inner.slice(trimmed.length)
  inner = trimmed + (needsComma ? ',' : '') + `\n${indent}"${field}": ${newVal}` + trailing
  return content.slice(0, openBrace + 1) + inner + content.slice(closeBrace)
}

function patchTrainingField(content: string, field: string, value: unknown): string {
  const newVal = serializeJsonValue(value)
  const fieldRe = new RegExp(
    `("${escapeRe(field)}")(\\s*:\\s*)(null|true|false|"(?:[^"\\\\]|\\\\.)*"|-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)`
  )
  const trainingRe = /"training"\s*:\s*\{/
  const trainingMatch = trainingRe.exec(content)
  if (trainingMatch) {
    const openBrace = trainingMatch.index + trainingMatch[0].length - 1
    const closeBrace = findMatchingBrace(content, openBrace)
    if (closeBrace !== -1) {
      let inner = content.slice(openBrace + 1, closeBrace)
      if (fieldRe.test(inner)) {
        inner = inner.replace(fieldRe, (_m, k, sep) => k + sep + newVal)
        return content.slice(0, openBrace + 1) + inner + content.slice(closeBrace)
      }
      if (value !== null && value !== undefined) {
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

  if (value === null || value === undefined) return content
  const metaKeyMatch = findOuterMetadataMatch(content)
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
  const trainingBlock = `\n${indent}"training": {\n${indent}  "${field}": ${newVal}\n${indent}}`
  inner = trimmed + (needsComma ? ',' : '') + trainingBlock + trailing
  return content.slice(0, openBrace + 1) + inner + content.slice(closeBrace)
}

function persistTrainerMetadata(
  content: string,
  options: {
    epochs: number
    architecture: TrainerArchitecture
    modelName: string
    modeledBy: string | null
    inputLevelDbu: number | null
    outputLevelDbu: number | null
    validationEsr: number | null
    // For A2 only: store the official aggregate in validationEsr, plus explicit Full/Lite
    // sub-model ESRs in metadata.nam_lab.* so NAM Lab can show the plugin-loaded Full value.
    validationEsrFull: number | null
    validationEsrLite: number | null
    // MRSTFT / MSE — NAM logs these per validation epoch but never writes them to the .nam file.
    // NAM Lab stores them in metadata.nam_lab.* so we can show them in the metadata panel later.
    // For A2, the *_lite values are channels_3; the non-suffixed values are the Full sub-model.
    mrstft: number | null
    mrstftLite: number | null
    mse: number | null
    mseLite: number | null
    manualLatencySamples: number | null
  }
): string {
  let patched = content
  const architectureLabel = getTrainerArchitectureFolderName(options.architecture)
  patched = patchMetadataField(patched, 'name', options.modelName)
  if (options.modeledBy?.trim()) {
    patched = patchMetadataField(patched, 'modeled_by', options.modeledBy.trim())
  }
  if (options.inputLevelDbu != null) {
    patched = patchMetadataField(patched, 'input_level_dbu', options.inputLevelDbu)
  }
  if (options.outputLevelDbu != null) {
    patched = patchMetadataField(patched, 'output_level_dbu', options.outputLevelDbu)
  }
  patched = patchTrainingField(patched, 'validation_esr', options.validationEsr)
  patched = patchTopLevelNamBotField(patched, 'trained_epochs', options.epochs)
  patched = patchTopLevelNamBotField(patched, 'preset_name', architectureLabel)
  patched = patchTopLevelNamBotField(patched, 'validation_esr', options.validationEsr)
  patched = patchTopLevelNamBotField(patched, 'manual_latency_samples', options.manualLatencySamples ?? 0)
  patched = patchNamLabField(patched, 'trained_epochs', options.epochs)
  patched = patchNamLabField(patched, 'preset_name', architectureLabel)
  patched = patchNamLabField(patched, 'validation_esr', options.validationEsr)
  patched = patchNamLabField(patched, 'manual_latency_samples', options.manualLatencySamples ?? 0)
  // A2 sub-model ESRs. Gated on architecture so A1 runs never get these fields.
  // Stored in metadata.nam_lab.* — NAM ignores them, only NAM Lab reads them back.
  if (options.architecture === 'a2' && options.validationEsrFull != null) {
    patched = patchNamLabField(patched, 'a2_full_validation_esr', options.validationEsrFull)
  }
  if (options.architecture === 'a2' && options.validationEsrLite != null) {
    patched = patchNamLabField(patched, 'a2_lite_validation_esr', options.validationEsrLite)
  }
  // MRSTFT / MSE — frequency-domain (MRSTFT) and time-domain (MSE) validation metrics that NAM
  // logs but doesn't save. For A1 these are single values. For A2, mrstft / mse are the Full
  // sub-model's; a2_lite_mrstft / a2_lite_mse are the Lite sub-model's.
  if (options.mrstft != null) {
    patched = patchNamLabField(patched, 'mrstft', options.mrstft)
  }
  if (options.mse != null) {
    patched = patchNamLabField(patched, 'mse', options.mse)
  }
  if (options.architecture === 'a2' && options.mrstftLite != null) {
    patched = patchNamLabField(patched, 'a2_lite_mrstft', options.mrstftLite)
  }
  if (options.architecture === 'a2' && options.mseLite != null) {
    patched = patchNamLabField(patched, 'a2_lite_mse', options.mseLite)
  }
  return applyTrainerMetadataConventions(patched, { architecture: options.architecture })
}

// Surgically remove the entire "nam_lab": {...} block from metadata.
// Handles leading comma (block in middle/end) and trailing comma (block at start).
function removeNamLabBlock(content: string): string {
  const metaKeyMatch = findOuterMetadataMatch(content)
  if (!metaKeyMatch) return content
  const metaOpenBrace = metaKeyMatch.index + metaKeyMatch[0].length - 1
  const metaCloseBrace = findMatchingBrace(content, metaOpenBrace)
  if (metaCloseBrace === -1) return content
  const metaSection = content.slice(metaOpenBrace, metaCloseBrace + 1)
  const namLabRe = /"nam_lab"\s*:\s*\{/
  const match = namLabRe.exec(metaSection)
  if (!match) return content
  const openBrace = metaOpenBrace + match.index + match[0].length - 1
  const closeBrace = findMatchingBrace(content, openBrace)
  if (closeBrace === -1) return content
  // The full block span: from `"nam_lab"` key to closing `}`
  const blockStart = metaOpenBrace + match.index
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
  const metaKeyMatch = findOuterMetadataMatch(content)
  if (!metaKeyMatch) return content
  const metaOpenBrace = metaKeyMatch.index + metaKeyMatch[0].length - 1
  const metaCloseBrace = findMatchingBrace(content, metaOpenBrace)
  if (metaCloseBrace === -1) return content
  const metaSection = content.slice(metaOpenBrace, metaCloseBrace + 1)

  // Try to find existing nam_lab block inside metadata and update/insert the field
  const namLabRe = /"nam_lab"\s*:\s*\{/
  const namLabMatch = namLabRe.exec(metaSection)
  if (namLabMatch) {
    const openBrace = metaOpenBrace + namLabMatch.index + namLabMatch[0].length - 1
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
  let inner = content.slice(metaOpenBrace + 1, metaCloseBrace)
  const indentMatch = /\n([ \t]+)"/.exec(inner)
  const indent = indentMatch ? indentMatch[1] : '    '
  const trimmed = inner.trimEnd()
  const needsComma = trimmed.length > 0 && !trimmed.endsWith(',')
  const trailing = inner.slice(trimmed.length)
  const namLabBlock = `\n${indent}"nam_lab": {\n${indent}  "${field}": ${newVal}\n${indent}}`
  inner = trimmed + (needsComma ? ',' : '') + namLabBlock + trailing
  return content.slice(0, metaOpenBrace + 1) + inner + content.slice(metaCloseBrace)
}

// Patch a field inside metadata.training.nam_bot, creating the legacy structure if needed.
function patchLegacyNamBotField(content: string, field: string, value: unknown): string {
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

  // No nam_bot block â€” find training block and inject nam_bot into it
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
  const metaKeyMatch = findOuterMetadataMatch(content)
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

// Patch a field inside metadata.nam_bot, creating the structure if needed.
function patchTopLevelNamBotField(content: string, field: string, value: unknown): string {
  const newVal = serializeJsonValue(value)
  const fieldRe = new RegExp(
    `("${escapeRe(field)}")(\\s*:\\s*)(null|"(?:[^"\\\\]|\\\\.)*"|-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)`
  )

  const namBotRe = /"nam_bot"\s*:\s*\{/
  const metaKeyMatch = findOuterMetadataMatch(content)
  if (!metaKeyMatch) return content
  const metaOpenBrace = metaKeyMatch.index + metaKeyMatch[0].length - 1
  const metaCloseBrace = findMatchingBrace(content, metaOpenBrace)
  if (metaCloseBrace === -1) return content

  const metaSection = content.slice(metaOpenBrace, metaCloseBrace + 1)
  const namBotMatch = namBotRe.exec(metaSection)
  if (namBotMatch) {
    const openBrace = metaOpenBrace + namBotMatch.index + namBotMatch[0].length - 1
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

  if (value === null || value === undefined) return content
  let inner = content.slice(metaOpenBrace + 1, metaCloseBrace)
  const indentMatch = /\n([ \t]+)"/.exec(inner)
  const indent = indentMatch ? indentMatch[1] : '    '
  const trimmed = inner.trimEnd()
  const needsComma = trimmed.length > 0 && !trimmed.endsWith(',')
  const trailing = inner.slice(trimmed.length)
  const namBotBlock = `\n${indent}"nam_bot": {\n${indent}  "${field}": ${newVal}\n${indent}}`
  inner = trimmed + (needsComma ? ',' : '') + namBotBlock + trailing
  return content.slice(0, metaOpenBrace + 1) + inner + content.slice(metaCloseBrace)
}

// Patch metadata.training.data.latency.calibration.recommended.
// Only updates an existing calibration block — does not synthesise the whole
// training.data.latency hierarchy from scratch (that would risk corrupting
// files that were never trained through NAM Lab).
function patchLatencyRecommended(content: string, value: unknown): string {
  if (value === null || value === undefined) return content
  const newVal = serializeJsonValue(value)
  const fieldRe = /("recommended")(\s*:\s*)(null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/

  const navigate = (src: string, re: RegExp, fromPos: number): { open: number; close: number } | null => {
    const slice = src.slice(fromPos)
    const m = re.exec(slice)
    if (!m) return null
    const open = fromPos + m.index + m[0].length - 1
    const close = findMatchingBrace(src, open)
    return close === -1 ? null : { open, close }
  }

  const metaMatch = findOuterMetadataMatch(content)
  if (!metaMatch) return content
  const metaOpen = metaMatch.index + metaMatch[0].length - 1
  const training = navigate(content, /"training"\s*:\s*\{/, metaOpen)
  if (!training) return content
  const data = navigate(content, /"data"\s*:\s*\{/, training.open)
  if (!data) return content
  const latency = navigate(content, /"latency"\s*:\s*\{/, data.open)
  if (!latency) return content
  const cal = navigate(content, /"calibration"\s*:\s*\{/, latency.open)
  if (!cal) return content

  let calInner = content.slice(cal.open + 1, cal.close)
  if (fieldRe.test(calInner)) {
    calInner = calInner.replace(fieldRe, (_m, k, sep) => k + sep + newVal)
  } else {
    const indentMatch = /\n([ \t]+)"/.exec(calInner)
    const indent = indentMatch ? indentMatch[1] : '        '
    const trimmed = calInner.trimEnd()
    const needsComma = trimmed.length > 0 && !trimmed.endsWith(',')
    const trailing = calInner.slice(trimmed.length)
    calInner = trimmed + (needsComma ? ',' : '') + `\n${indent}"recommended": ${newVal}` + trailing
  }
  return content.slice(0, cal.open + 1) + calInner + content.slice(cal.close)
}

function migrateLegacyNamBotMetadata(content: string): { content: string; changed: boolean } {
  const data = JSON.parse(content) as Record<string, unknown>
  const metaRaw = data.metadata
  if (!metaRaw || typeof metaRaw !== 'object' || Array.isArray(metaRaw)) return { content, changed: false }
  const meta = metaRaw as Record<string, unknown>
  const trainingRaw = meta.training
  if (!trainingRaw || typeof trainingRaw !== 'object' || Array.isArray(trainingRaw)) return { content, changed: false }
  const training = trainingRaw as Record<string, unknown>
  const legacyRaw = training.nam_bot
  if (!legacyRaw || typeof legacyRaw !== 'object' || Array.isArray(legacyRaw)) return { content, changed: false }
  const legacy = legacyRaw as Record<string, unknown>
  const topLevelRaw = meta.nam_bot
  const topLevel = topLevelRaw && typeof topLevelRaw === 'object' && !Array.isArray(topLevelRaw)
    ? topLevelRaw as Record<string, unknown>
    : {}

  meta.nam_bot = { ...legacy, ...topLevel }
  delete training.nam_bot
  if (Object.keys(training).length === 0) {
    delete meta.training
  }

  return { content: JSON.stringify(data), changed: true }
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

// Allow local-file:// to bypass CSP so image src="local-file:///..." works
// in both dev (localhost) and production (file://) renderer contexts.
protocol.registerSchemesAsPrivileged([
  { scheme: 'local-file', privileges: { secure: true, bypassCSP: true, stream: true } }
])

// â”€â”€ tone3000 OAuth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const T3K_BASE = 'https://www.tone3000.com'
const T3K_CLIENT_ID = 't3k_pub_wcNVWGoy2Ry01i50EpXSNo9Jjr8oQr-c'

interface Tone3kTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  clientId: string
}

let tone3kTokens: Tone3kTokens | null = null

function tone3kSecureTokensPath(): string {
  return join(app.getPath('userData'), 'tone3000-tokens.bin')
}

function tone3kLegacyTokensPath(): string {
  return join(app.getPath('userData'), 'tone3000-tokens.json')
}

async function loadTone3kTokens(): Promise<void> {
  try {
    const securePath = tone3kSecureTokensPath()
    const buf = await fs.promises.readFile(securePath)
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf-8')
    tone3kTokens = JSON.parse(json) as Tone3kTokens
    return
  } catch { /* fall through to legacy */ }
  try {
    const legacyPath = tone3kLegacyTokensPath()
    tone3kTokens = JSON.parse(await fs.promises.readFile(legacyPath, 'utf-8')) as Tone3kTokens
    await saveTone3kTokens()
    try { await fs.promises.unlink(legacyPath) } catch { /* ok */ }
  } catch { /* no saved tokens */ }
}

async function saveTone3kTokens(): Promise<void> {
  if (!tone3kTokens) return
  try {
    const payload = JSON.stringify(tone3kTokens)
    const securePath = tone3kSecureTokensPath()
    if (safeStorage.isEncryptionAvailable()) {
      await fs.promises.writeFile(securePath, safeStorage.encryptString(payload))
    } else {
      await fs.promises.writeFile(securePath, payload, 'utf-8')
    }
    try { await fs.promises.unlink(tone3kLegacyTokensPath()) } catch { /* ok */ }
  } catch { /* non-critical */ }
}

async function ensureValidToken(): Promise<boolean> {
  if (!tone3kTokens) return false
  if (Date.now() < tone3kTokens.expiresAt - 60_000) return true
  try {
    const res = await fetch(`${T3K_BASE}/api/v1/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: tone3kTokens.refreshToken, client_id: tone3kTokens.clientId })
    })
    if (!res.ok) { tone3kTokens = null; return false }
    const d = await res.json() as { access_token: string; refresh_token?: string; expires_in: number }
    tone3kTokens = { ...tone3kTokens, accessToken: d.access_token, refreshToken: d.refresh_token ?? tone3kTokens.refreshToken, expiresAt: Date.now() + d.expires_in * 1000 }
    await saveTone3kTokens()
    return true
  } catch { return false }
}

app.whenReady().then(async () => {
  // Serve local filesystem files under local-file:// scheme
  protocol.handle('local-file', (req) => {
    const fileUrl = 'file://' + req.url.slice('local-file://'.length)
    return net.fetch(fileUrl)
  })

  log('app.whenReady fired')
  switchLogToUserData()
  await loadTone3kTokens()
  companionBridgeConfig = loadCompanionBridgeConfig()
  companionBridgeConfig.enabled = loadEnableCompanionAppSetting()
  saveCompanionBridgeConfig()
  companionInbox = loadCompanionInbox()
  trainerHistory = loadTrainerHistory()
  trainerSkipped = loadTrainerSkipped()
  trainerQueue = loadTrainerQueue()
  trainerState = { ...trainerState, history: trainerHistory, queue: trainerQueue, watcherState: makeTrainerWatcherSnapshot() }
  startCompanionBridgeServer()
  log(`log file moved to userData: ${logPath}`)

  app.setName('NAM Lab')
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.coretonecaptures.namlab')
  }

  // IPC: Expose userData path synchronously (used by preload to read settings.json)
  ipcMain.on('app:getUserDataPath', (event) => {
    event.returnValue = app.getPath('userData')
  })

  // IPC: Persist settings to userData/settings.json (fire-and-forget from renderer)
  // Bridge start/stop is driven by companion:updateBridgeConfig (called by the Settings
  // toggle), which applies the change and returns fresh info atomically. We deliberately
  // do NOT start/stop here too — that was a redundant second start/stop on every save.
  // The enable value is still read back from settings.json at startup.
  ipcMain.on('settings:save', (_event, json: string) => {
    try {
      fs.writeFileSync(join(app.getPath('userData'), 'settings.json'), json, 'utf-8')
    } catch (err) {
      log(`settings:save error: ${String(err)}`)
    }
  })

  ipcMain.handle('companion:setContext', async (_event, payload: { rootFolder?: string; activeFolder?: string }) => {
    companionContext = {
      rootFolder: normalizeSlashPath(payload?.rootFolder),
      activeFolder: normalizeSlashPath(payload?.activeFolder),
    }
    invalidateCompanionPackCache()
    return { success: true }
  })

  ipcMain.handle('companion:getBridgeInfo', async () => ({
    enabled: companionBridgeConfig?.enabled ?? false,
    running: companionBridgeServer != null,
    port: companionBridgeConfig?.port ?? COMPANION_BRIDGE_PORT,
    token: companionBridgeConfig?.token ?? '',
    bindAddress: companionBridgeConfig?.bindAddress ?? COMPANION_BRIDGE_BIND_ADDRESS,
    hostHints: getCompanionHostHints(),
    configPath: companionBridgeConfigPath(),
    inboxPath: companionInboxPath(),
  }))

  ipcMain.handle('companion:getInbox', async () => ({
    success: true,
    items: companionInbox,
  }))

  ipcMain.handle('companion:markInboxReviewed', async (_event, itemId: string) => {
    const updated = markCompanionInboxItemReviewed(itemId)
    if (!updated) return { success: false, error: 'Inbox item not found.' }
    return { success: true, item: updated }
  })

  ipcMain.handle('companion:deleteInboxItem', async (_event, itemId: string) => {
    const existing = companionInbox.find((item) => item.id === itemId)
    if (!existing) return { success: false, error: 'Inbox item not found.' }
    companionInbox = companionInbox.filter((item) => item.id !== itemId)
    // Only unlink assets that actually live in our inbox-assets dir (defense-in-depth
    // against a tampered inbox JSON pointing assetPath elsewhere).
    if (existing.assetPath && isPathWithin(companionInboxAssetsDir(), existing.assetPath)) {
      try { await fs.promises.unlink(existing.assetPath) } catch { /* ignore missing asset */ }
    }
    saveCompanionInbox()
    return { success: true }
  })

  ipcMain.handle('companion:updateBridgeConfig', async (_event, payload: {
    enabled?: boolean
    regenerateToken?: boolean
  }) => {
    if (!companionBridgeConfig) {
      companionBridgeConfig = loadCompanionBridgeConfig()
    }
    if (typeof payload?.enabled === 'boolean') {
      companionBridgeConfig.enabled = payload.enabled
    }
    if (payload?.regenerateToken) {
      companionBridgeConfig.token = crypto.randomBytes(24).toString('hex')
    }
    saveCompanionBridgeConfig()
    if (companionBridgeConfig.enabled) {
      startCompanionBridgeServer()
    } else {
      stopCompanionBridgeServer()
    }
    return {
      success: true,
      enabled: companionBridgeConfig.enabled,
      running: companionBridgeServer != null,
      port: companionBridgeConfig.port,
      token: companionBridgeConfig.token,
      bindAddress: companionBridgeConfig.bindAddress,
      hostHints: getCompanionHostHints(),
      configPath: companionBridgeConfigPath(),
      inboxPath: companionInboxPath(),
    }
  })

  // ── AI key helpers (safeStorage) ──────────────────────────────────────────
  function aiKeyPath(provider: string): string {
    return join(app.getPath('userData'), `ai-key-${provider}.bin`)
  }

  function storeAiKey(provider: string, key: string): void {
    const p = aiKeyPath(provider)
    if (safeStorage.isEncryptionAvailable()) {
      fs.writeFileSync(p, safeStorage.encryptString(key))
    } else {
      fs.writeFileSync(p, key, 'utf-8')
    }
  }

  function readAiKey(provider: string): string | null {
    const p = aiKeyPath(provider)
    try {
      const buf = fs.readFileSync(p)
      return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf-8')
    } catch {
      return null
    }
  }

  function clearAiKey(provider: string): void {
    try { fs.unlinkSync(aiKeyPath(provider)) } catch { /* already gone */ }
  }

  // IPC: Save AI key (key never travels back to renderer)
  ipcMain.handle('app:saveAiKey', async (_event, provider: string, key: string) => {
    try {
      storeAiKey(provider, key.trim())
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // IPC: Clear AI key
  ipcMain.handle('app:clearAiKey', async (_event, provider: string) => {
    clearAiKey(provider)
    return { success: true }
  })

  // IPC: AI enrich — sends a prompt to the configured provider, returns text
  ipcMain.handle('app:aiEnrich', async (_event, payload: { prompt: string; provider: string; model: string }) => {
    const key = readAiKey(payload.provider)
    if (!key) return { success: false, error: 'No API key stored for ' + payload.provider }
    try {
      if (payload.provider === 'anthropic') {
        const res = await net.fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: payload.model || 'claude-haiku-4-5-20251001',
            max_tokens: 1024,
            messages: [{ role: 'user', content: payload.prompt }],
          }),
        })
        if (!res.ok) return { success: false, error: `Anthropic ${res.status}: ${await res.text()}` }
        const data = await res.json() as { content?: { text?: string }[] }
        return { success: true, text: data.content?.[0]?.text ?? '' }
      } else if (payload.provider === 'openai') {
        const res = await net.fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model: payload.model || 'gpt-4o-mini',
            messages: [{ role: 'user', content: payload.prompt }],
            max_tokens: 1024,
          }),
        })
        if (!res.ok) return { success: false, error: `OpenAI ${res.status}: ${await res.text()}` }
        const data = await res.json() as { choices?: { message?: { content?: string } }[] }
        return { success: true, text: data.choices?.[0]?.message?.content ?? '' }
      }
      return { success: false, error: 'Unknown provider: ' + payload.provider }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // IPC: Open file dialog
  ipcMain.handle('dialog:openFiles', async () => {
    const result = await showOpenDialogSafely({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'NAM Files', extensions: ['nam'] }]
    })
    return result.filePaths
  })

  // IPC: Open image file picker (PNG/JPG/SVG/WEBP) for logo upload
  ipcMain.handle('dialog:openImageFile', async () => {
    const result = await showOpenDialogSafely({
      properties: ['openFile'],
      filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp'] }]
    })
    return result.filePaths[0] ?? null
  })

  // IPC: Open import spreadsheet file picker (.xlsx or .csv)
  ipcMain.handle('dialog:openImportFile', async () => {
    const result = await showOpenDialogSafely({
      properties: ['openFile'],
      filters: [{ name: 'Spreadsheet', extensions: ['xlsx', 'csv'] }]
    })
    return result.filePaths[0] ?? null
  })

  ipcMain.handle('dialog:openAudioFile', async () => {
    const result = await showOpenDialogSafely({
      properties: ['openFile'],
      filters: [
        { name: 'Audio', extensions: ['wav', 'wave', 'aif', 'aiff'] },
        { name: 'All Files', extensions: ['*'] },
      ]
    })
    return result.filePaths[0] ?? null
  })

  ipcMain.handle('dialog:openAudioFiles', async () => {
    const result = await showOpenDialogSafely({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Audio', extensions: ['wav', 'wave', 'aif', 'aiff'] },
        { name: 'All Files', extensions: ['*'] },
      ]
    })
    return result.filePaths
  })

  // IPC: Open folder dialog
  ipcMain.handle('dialog:openFolder', async (_event, defaultPath?: string) => {
    const result = await showOpenDialogSafely({
      properties: ['openDirectory'],
      ...(defaultPath ? { defaultPath } : {})
    })
    return result.filePaths[0] ?? null
  })

  // IPC: Read any file as base64 (used for xlsx import parsing)
  ipcMain.handle('file:readBinary', async (_event, filePath: string) => {
    try {
      const buf = fs.readFileSync(filePath)
      return { data: buf.toString('base64') }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('file:hashMany', async (_event, filePaths: string[]) => {
    const CONCURRENCY = 8
    const results: Array<{ filePath: string; success: boolean; hash?: string; error?: string }> = []

    for (let i = 0; i < filePaths.length; i += CONCURRENCY) {
      const batch = filePaths.slice(i, i + CONCURRENCY)
      const batchResults = await Promise.all(batch.map(async (filePath) => {
        try {
          const hash = await hashFileSha256(filePath)
          return { filePath, success: true, hash }
        } catch (err) {
          return { filePath, success: false, error: String(err) }
        }
      }))
      results.push(...batchResults)
    }

    return results
  })

  ipcMain.handle('file:hashManyWithoutMetadata', async (_event, filePaths: string[]) => {
    const CONCURRENCY = 8
    const results: Array<{ filePath: string; success: boolean; hash?: string; error?: string }> = []

    for (let i = 0; i < filePaths.length; i += CONCURRENCY) {
      const batch = filePaths.slice(i, i + CONCURRENCY)
      const batchResults = await Promise.all(batch.map(async (filePath) => {
        try {
          const hash = await hashFileWithoutMetadataSha256(filePath)
          return { filePath, success: true, hash }
        } catch (err) {
          return { filePath, success: false, error: String(err) }
        }
      }))
      results.push(...batchResults)
    }

    return results
  })

  // IPC: Read a NAM file metadata (without exposing weights to renderer)
  const errorLogPath = join(app.getPath('userData'), 'parse-errors.log')
  ipcMain.handle('file:read', async (_event, filePath: string) => {
    try {
      const stat = await fs.promises.stat(filePath)
      const cache = loadFileCache()
      const cached = cache[filePath]
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        const cachedData = { ...(cached.data as Record<string, unknown>) }
        const cachedMeta = cachedData.metadata && typeof cachedData.metadata === 'object'
          ? liftUiMetadata({ ...(cachedData.metadata as Record<string, unknown>) }, cachedData)
          : cachedData.metadata
        return { success: true, ...cachedData, metadata: cachedMeta, filePath, mtimeMs: stat.mtimeMs, birthtimeMs: stat.birthtimeMs, sizeBytes: stat.size }
      }
      const content = await fs.promises.readFile(filePath, 'utf-8')
      const data = JSON.parse(content)
      const meta = liftUiMetadata(data.metadata ?? {}, data)
      const topNotes = Array.isArray(data.notes) ? (data.notes as unknown[]).filter((n): n is string => typeof n === 'string') : undefined
      const result = {
        success: true,
        filePath,
        version: data.version ?? '?',
        notes: topNotes,
        metadata: meta,
        architecture: data.architecture ?? '?',
        config: data.config ?? null,
        mtimeMs: stat.mtimeMs,
        birthtimeMs: stat.birthtimeMs,
        sizeBytes: stat.size,
      }
      // Update cache entry — save lazily (written on app quit or folder scan)
      cache[filePath] = { mtimeMs: stat.mtimeMs, size: stat.size, data: { version: result.version, notes: result.notes, metadata: meta, architecture: result.architecture, config: result.config } }
      return result
    } catch (err) {
      const line = `[${new Date().toISOString()}] ${filePath}\n  ${String(err)}\n`
      fs.appendFileSync(errorLogPath, line, 'utf-8')
      return { success: false, error: String(err) }
    }
  })

  // IPC: Return the path to the parse error log file
  ipcMain.handle('log:getErrorLogPath', () => errorLogPath)

  // IPC: Write updated metadata back to file (preserves weights and all non-editable fields)
  // Only updates the fields the editor explicitly manages â€” never injects new keys.
  // Uses surgical text replacement so only the changed value bytes are modified;
  // all formatting, spacing, and field order in the original file are preserved exactly.
  const EDITABLE_FIELDS = [
    'name', 'modeled_by', 'gear_type', 'gear_make', 'gear_model',
    'tone_type', 'input_level_dbu', 'output_level_dbu', 'loudness', 'gain'
  ] as const
  ipcMain.handle('file:writeMetadata', async (_event, filePath: string, metadata: unknown, context?: MetadataWriteContext) => {
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      const data = JSON.parse(content)
      const orig = data.metadata ?? {}
      const effectiveOrig = liftUiMetadata({ ...(orig as Record<string, unknown>) }, data)
      const incoming = metadata as Record<string, unknown>
      const incomingKeys = Object.keys(incoming)
      const isBlankValue = (value: unknown) => value == null || value === ''
      const isPresentValue = (value: unknown) => value != null && value !== ''
      const writeSource = typeof context?.source === 'string' && context.source.trim() ? context.source.trim() : 'unknown'
      const writeBatchId = typeof context?.batchId === 'string' ? context.batchId : ''
      const writeIndex = typeof context?.index === 'number' && Number.isFinite(context.index) ? context.index : null
      const writeTotal = typeof context?.total === 'number' && Number.isFinite(context.total) ? context.total : null
      const requestedFields = Array.isArray(context?.fields) ? context.fields.map(String).filter(Boolean) : []

      // Numeric metadata fields â€” must always be written as JSON numbers, never strings
      const NUMERIC_META_FIELDS = new Set(['input_level_dbu', 'output_level_dbu', 'loudness', 'gain'])

      // Build patch map: only touch fields the renderer explicitly sent.
      // This preserves unrelated metadata when a workflow performs a surgical write
      // (for example metadata suggestions that only send the selected suggestion fields).
      const patches: Record<string, unknown> = {}
      for (const key of EDITABLE_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(incoming, key)) continue
        let val: unknown = incoming[key] ?? null
        // Coerce string numbers to actual numbers for numeric fields
        if (val != null && NUMERIC_META_FIELDS.has(key) && typeof val === 'string') {
          val = parseFloat(val as string)
        }
        patches[key] = val
      }

      // Apply surgical patches â€” only the value bytes for each field are changed
      let patched = patchMetadataFields(content, patches)

      // Handle nb_trained_epochs â€” stored at metadata.training.nam_bot.trained_epochs
      const currentNamBot = getPreferredNamBot(effectiveOrig)
      const hasTopLevelNamBot = !!(orig.nam_bot && typeof orig.nam_bot === 'object')
      const hasLegacyNamBot = !!(orig.training && typeof orig.training === 'object' && (orig.training as Record<string, unknown>).nam_bot)
      const origEpochs = currentNamBot?.trained_epochs ?? null
      let shouldVerifyEpochs = false
      let expectedEpochs: number | null = null
      if (Object.prototype.hasOwnProperty.call(incoming, 'nb_trained_epochs')) {
        const newEpochs = incoming.nb_trained_epochs != null ? Number(incoming.nb_trained_epochs) : null
        if (newEpochs !== origEpochs) {
          if (hasTopLevelNamBot || !hasLegacyNamBot) patched = patchTopLevelNamBotField(patched, 'trained_epochs', newEpochs)
          else patched = patchLegacyNamBotField(patched, 'trained_epochs', newEpochs)
          shouldVerifyEpochs = true
          expectedEpochs = newEpochs
        }
      }

      // Handle NAM Lab extended fields â€” stored at metadata.nam_lab.*
      const origNl = (effectiveOrig.nam_lab ?? {}) as Record<string, unknown>
      const nlKeys = ['mics','cabinet','cabinet_config','amp_channel','boost_pedal','amp_settings','pedal_settings','amp_switches','comments','about','rating'] as const
      for (const k of nlKeys) {
        const rendererKey = `nl_${k}`
        if (!Object.prototype.hasOwnProperty.call(incoming, rendererKey)) continue
        const origVal = origNl[k] ?? null
        const newVal = incoming[rendererKey] != null ? incoming[rendererKey] : null
        if (origVal !== newVal || (origVal == null && newVal != null)) {
          patched = patchNamLabField(patched, k, newVal)
        }
      }

      // Handle latency_recommended — stored at metadata.training.data.latency.calibration.recommended
      if (Object.prototype.hasOwnProperty.call(incoming, 'latency_recommended')) {
        const newLatency = incoming.latency_recommended != null ? Math.round(Number(incoming.latency_recommended)) : null
        if (newLatency !== null) patched = patchLatencyRecommended(patched, newLatency)
      }

      const clearingFields: string[] = []
      const fillingFields: string[] = []
      const changedFields: string[] = []
      for (const key of EDITABLE_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(incoming, key)) continue
        if (effectiveOrig[key] !== incoming[key]) changedFields.push(key)
        if (isPresentValue(effectiveOrig[key]) && isBlankValue(incoming[key])) {
          clearingFields.push(key)
        }
        if (isBlankValue(effectiveOrig[key]) && isPresentValue(incoming[key])) {
          fillingFields.push(key)
        }
      }
      for (const key of nlKeys) {
        const rendererKey = `nl_${key}`
        if (!Object.prototype.hasOwnProperty.call(incoming, rendererKey)) continue
        if (origNl[key] !== incoming[rendererKey]) changedFields.push(rendererKey)
        if (isPresentValue(origNl[key]) && isBlankValue(incoming[rendererKey])) {
          clearingFields.push(rendererKey)
        }
        if (isBlankValue(origNl[key]) && isPresentValue(incoming[rendererKey])) {
          fillingFields.push(rendererKey)
        }
      }
      if (Object.prototype.hasOwnProperty.call(incoming, 'nb_trained_epochs') && shouldVerifyEpochs) {
        changedFields.push('nb_trained_epochs')
      }
      if (Object.prototype.hasOwnProperty.call(incoming, 'latency_recommended')) {
        changedFields.push('latency_recommended')
      }
      const protectedClearFields = new Set([
        'gear_type',
        'gear_make',
        'gear_model',
        'tone_type',
        'nb_trained_epochs',
        'nl_cabinet',
        'nl_cabinet_config',
        'nl_amp_channel',
        'nl_amp_settings',
        'nl_amp_switches',
      ])
      const suspiciousClears = clearingFields.filter((field) => protectedClearFields.has(field))
      if (suspiciousClears.length > 0 && incomingKeys.length > clearingFields.length) {
        log(`writeMetadata refused protected-clear source="${writeSource}" batch="${writeBatchId}" index=${writeIndex ?? ''}/${writeTotal ?? ''} file="${filePath}" protected="${suspiciousClears.join(',')}" clearing="${clearingFields.join(',')}" filling="${fillingFields.join(',')}" changedFields="${changedFields.join(',')}" requestedFields="${requestedFields.join(',')}" keys="${incomingKeys.join(',')}"`)
        return { success: false, error: `Refusing to clear protected metadata fields: ${suspiciousClears.join(', ')}` }
      }
      if (clearingFields.length >= 3 && incomingKeys.length > clearingFields.length) {
        log(`writeMetadata refused mass-clear source="${writeSource}" batch="${writeBatchId}" index=${writeIndex ?? ''}/${writeTotal ?? ''} file="${filePath}" clearing="${clearingFields.join(',')}" filling="${fillingFields.join(',')}" changedFields="${changedFields.join(',')}" requestedFields="${requestedFields.join(',')}" keys="${incomingKeys.join(',')}"`)
        return { success: false, error: `Refusing to clear ${clearingFields.length} existing metadata fields at once` }
      }

      // Validate output is well-formed JSON before touching disk
      try { JSON.parse(patched) } catch (ve) {
        return { success: false, error: `Patch produced invalid JSON â€” file not written. ${String(ve)}` }
      }
      suppressWatcher()
      log(`writeMetadata source="${writeSource}" batch="${writeBatchId}" index=${writeIndex ?? ''}/${writeTotal ?? ''} file="${filePath}" keys="${incomingKeys.join(',')}" requestedFields="${requestedFields.join(',')}" changedFields="${changedFields.join(',')}" filling="${fillingFields.join(',')}" clearing="${clearingFields.join(',')}" changed=${patched !== content}`)
      fs.writeFileSync(filePath, patched, 'utf-8')
      const verifyContent = fs.readFileSync(filePath, 'utf-8')
      const verifyData = JSON.parse(verifyContent)
      const verifyMeta = (verifyData.metadata ?? {}) as Record<string, unknown>
      const verifyNl = (verifyMeta.nam_lab ?? {}) as Record<string, unknown>
      const verifyNamBot = getPreferredNamBot(verifyMeta)
      const mismatches: string[] = []
      const valueMatches = (actual: unknown, expected: unknown): boolean => {
        const normalizedActual = actual == null ? null : actual
        const normalizedExpected = expected == null ? null : expected
        return JSON.stringify(normalizedActual) === JSON.stringify(normalizedExpected)
      }
      for (const [key, expected] of Object.entries(patches)) {
        if (!valueMatches(verifyMeta[key] ?? null, expected)) mismatches.push(key)
      }
      for (const k of nlKeys) {
        const rendererKey = `nl_${k}`
        if (!Object.prototype.hasOwnProperty.call(incoming, rendererKey)) continue
        const expected = incoming[rendererKey] != null ? incoming[rendererKey] : null
        if (!valueMatches(verifyNl[k] ?? null, expected)) mismatches.push(rendererKey)
      }
      if (shouldVerifyEpochs) {
        if (!valueMatches(verifyNamBot?.trained_epochs ?? null, expectedEpochs)) mismatches.push('nb_trained_epochs')
      }
      if (Object.prototype.hasOwnProperty.call(incoming, 'latency_recommended')) {
        const trainingData = (verifyMeta.training as Record<string, unknown> | undefined)?.data as Record<string, unknown> | undefined
        const latencyCal = (trainingData?.latency as Record<string, unknown> | undefined)?.calibration as Record<string, unknown> | undefined
        const expected = incoming.latency_recommended != null ? Math.round(Number(incoming.latency_recommended)) : null
        if (!valueMatches(latencyCal?.recommended ?? null, expected)) mismatches.push('latency_recommended')
      }
      if (mismatches.length > 0) {
        log(`writeMetadata verify-failed source="${writeSource}" batch="${writeBatchId}" file="${filePath}" mismatches="${mismatches.join(',')}" keys="${incomingKeys.join(',')}"`)
        return { success: false, error: `Saved file failed verification for: ${mismatches.join(', ')}` }
      }
      log(`writeMetadata verify-ok source="${writeSource}" batch="${writeBatchId}" file="${filePath}" fields="${incomingKeys.join(',')}"`)
      delete loadFileCache()[filePath]
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
    const scan = async (dir: string, files: string[]): Promise<void> => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (hidden.has(entry.name.toLowerCase())) continue
          await scan(full, files)
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.nam')) {
          files.push(full.replace(/\\/g, '/'))
        }
      }
    }
    const TIMEOUT_MS = 300000
    try {
      const files: string[] = []
      await Promise.race([
        scan(folderPath, files),
        new Promise<never>((_, reject) => { const t = setTimeout(() => reject(new Error('Scan timed out after 5 minutes â€” check network share connectivity')), TIMEOUT_MS); t.unref() })
      ])
      // Prune cache entries for files no longer in this folder
      const fileSet = new Set(files)
      const normFolder = folderPath.replace(/\\/g, '/')
      const cache = loadFileCache()
      let pruned = false
      for (const key of Object.keys(cache)) {
        if (key.startsWith(normFolder + '/') && !fileSet.has(key)) {
          delete cache[key]
          pruned = true
        }
      }
      if (pruned) saveFileCache()
      return { success: true, files }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // IPC: Scan folder + read all .nam files in one round-trip.
  // Returns combined scan+parse results so renderer avoids N individual readFile calls.
  ipcMain.handle('folder:scanAndRead', async (_event, folderPath: string, hiddenFolders?: string) => {
    const hidden = new Set(
      ['_duplicates', ...(hiddenFolders ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)]
    )
    const paths: string[] = []
    const scan = async (dir: string): Promise<void> => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (hidden.has(entry.name.toLowerCase())) continue
          await scan(full)
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.nam')) {
          paths.push(full.replace(/\\/g, '/'))
        }
      }
    }
    const TIMEOUT_MS = 300000
    try {
      await Promise.race([
        scan(folderPath),
        new Promise<never>((_, reject) => { const t = setTimeout(() => reject(new Error('Scan timed out after 5 minutes')), TIMEOUT_MS); t.unref() })
      ])
    } catch (err) {
      return { success: false, error: String(err), files: [] }
    }
    // Read all files concurrently (20 at a time) â€” in-process, no IPC per file
    const CONCURRENCY = 20
    const results: unknown[] = []
    for (let i = 0; i < paths.length; i += CONCURRENCY) {
      const batch = paths.slice(i, i + CONCURRENCY)
      const batchResults = await Promise.all(batch.map((filePath) => {
        try {
          const content = fs.readFileSync(filePath, 'utf-8')
          const data = JSON.parse(content)
          const meta = liftUiMetadata(data.metadata ?? {}, data)
          const topNotes = Array.isArray(data.notes) ? (data.notes as unknown[]).filter((n): n is string => typeof n === 'string') : undefined
          return { success: true, filePath, version: data.version ?? '?', notes: topNotes, metadata: meta, architecture: data.architecture ?? '?', config: data.config ?? null }
        } catch (err) {
          const line = `[${new Date().toISOString()}] ${filePath}\n  ${String(err)}\n`
          fs.appendFileSync(errorLogPath, line, 'utf-8')
          return { success: false, error: String(err) }
        }
      }))
      results.push(...batchResults)
    }
    return { success: true, files: results }
  })

  // IPC: Scan a folder for image files (non-recursive)
  ipcMain.handle('folder:scanImages', async (_event, folderPath: string) => {
    try {
      const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'])
      const entries = await fs.promises.readdir(folderPath, { withFileTypes: true })
      const images = entries
        .filter((e) => e.isFile() && IMAGE_EXTS.has(extname(e.name).toLowerCase()))
        .map((e) => join(folderPath, e.name).replace(/\\/g, '/'))
      return { success: true, images }
    } catch {
      return { success: false, images: [] as string[] }
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
    const buildTree = async (dir: string): Promise<FolderNode> => {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true })
      const children: FolderNode[] = []
      let fileCount = 0
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (hidden.has(entry.name.toLowerCase())) continue
          children.push(await buildTree(join(dir, entry.name)))
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.nam')) {
          fileCount++
        }
      }
      const totalCount = fileCount + children.reduce((s, c) => s + c.totalCount, 0)
      const name = norm(dir).split('/').pop() ?? dir
      return { name, path: norm(dir), children, fileCount, totalCount }
    }
    const TIMEOUT_MS = 300000
    try {
      const tree = await Promise.race([
        buildTree(folderPath),
        new Promise<never>((_, reject) => { const t = setTimeout(() => reject(new Error('Scan timed out after 5 minutes â€” check network share connectivity')), TIMEOUT_MS); t.unref() })
      ])
      return { success: true, tree }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // IPC: Move a file to a different folder (physical rename on disk)
  ipcMain.handle('file:move', async (_event, sourcePath: string, destDir: string, force = false, destBaseName?: string) => {
    try {
      const fileName = (destBaseName && destBaseName.trim()) || sourcePath.replace(/\\/g, '/').split('/').pop()!
      const destPath = join(destDir, fileName)
      if (fs.existsSync(destPath)) {
        if (!force) return { success: false, error: 'exists', destPath: destPath.replace(/\\/g, '/') }
        fs.unlinkSync(destPath)
      }
      suppressWatcher()
      fs.renameSync(sourcePath, destPath)
      return { success: true, destPath: destPath.replace(/\\/g, '/') }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // IPC: Move file(s) to the OS trash (recoverable)
  ipcMain.handle('file:trash', async (_event, filePaths: string[]) => {
    const results: { filePath: string; success: boolean; error?: string; deleteMode?: 'trash' | 'delete' }[] = []
    for (const filePath of filePaths) {
      try {
        suppressWatcher()
        const deleteMode = await deleteWithFallback(filePath)
        results.push({ filePath, success: true, deleteMode })
      } catch (err) {
        results.push({ filePath, success: false, error: String(err) })
      }
    }
    return results
  })

  // IPC: Copy file(s) to a destination folder (non-destructive)
  ipcMain.handle('file:copy', async (_event, filePaths: string[], destDir: string, destBaseNames?: string[]) => {
    const results: { filePath: string; success: boolean; destPath?: string; error?: string }[] = []
    for (let index = 0; index < filePaths.length; index += 1) {
      const filePath = filePaths[index]
      try {
        const fileName = (destBaseNames?.[index] && destBaseNames[index].trim()) || filePath.replace(/\\/g, '/').split('/').pop()!
        const destPath = join(destDir, fileName)
        if (fs.existsSync(destPath)) {
          results.push({ filePath, success: false, error: 'exists' })
          continue
        }
        suppressWatcher()
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
        if (patched !== content) { suppressWatcher(); fs.writeFileSync(filePath, patched, 'utf8') }
        results.push({ filePath, success: true })
      } catch (err) {
        results.push({ filePath, success: false, error: String(err) })
      }
    }
    return results
  })

  ipcMain.handle('file:cleanOutdatedNamBot', async (_event, filePaths: string[]) => {
    const results: { filePath: string; success: boolean; error?: string; changed?: boolean }[] = []
    for (const filePath of filePaths) {
      try {
        const content = fs.readFileSync(filePath, 'utf8')
        const migrated = migrateLegacyNamBotMetadata(content)
        if (migrated.changed) {
          suppressWatcher()
          fs.writeFileSync(filePath, migrated.content, 'utf8')
          delete loadFileCache()[filePath]
        }
        results.push({ filePath, success: true, changed: migrated.changed })
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

  ipcMain.handle('path:getDeleteBehavior', async (_event, filePaths: string[]) => {
    return getDeleteBehavior(Array.isArray(filePaths) ? filePaths : [])
  })

  // IPC: Reveal a file in Finder / Explorer
  ipcMain.handle('shell:revealFile', (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle('shell:openFile', async (_event, filePath: string) => {
    const err = await shell.openPath(filePath)
    return { success: !err, error: err || undefined }
  })

  // IPC: Restore keyboard focus after native dialogs or component unmounts.
  // On Windows: blurâ†’focus cycle resets Chromium's stale internal focus state.
  // On macOS: blur() causes a visible window flash â€” webContents.focus() alone is enough.
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
      suppressWatcher()
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
        const f = filename?.toLowerCase() ?? ''
        if (!f.endsWith('.nam') || f.endsWith('.json')) return
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          if (Date.now() < watcherSuppressUntil) return
          safeSend('folder:changed')
        }, 1500)
      })
    } catch (err) {
      log(`folder:watch error: ${String(err)}`)
    }
  })

  ipcMain.handle('folderWatch:setState', async (_event, payload: {
    rules?: FolderWatchRule[]
    imports?: Record<string, FolderWatchImportEntry[]>
  }) => {
    const nextRules = Array.isArray(payload?.rules) ? payload.rules : []
    const nextImports = new Map<string, FolderWatchImportEntry[]>()
    for (const [key, entries] of Object.entries(payload?.imports ?? {})) {
      nextImports.set(
        key,
        Array.isArray(entries)
          ? entries
              .map((entry) => ({
                sourcePath: normalizePath(String(entry?.sourcePath ?? '')),
                sizeBytes: Number(entry?.sizeBytes ?? 0),
                mtimeMs: Number(entry?.mtimeMs ?? 0),
                importedAt: String(entry?.importedAt ?? ''),
                ...(entry?.contentHash ? { contentHash: String(entry.contentHash) } : {}),
              }))
              .filter((entry) => entry.sourcePath && entry.sizeBytes >= 0 && entry.mtimeMs > 0)
          : []
      )
    }
    folderWatchImports = nextImports
    if (!folderWatchRulesEqual(folderWatchRules, nextRules)) {
      log(`folderWatch setState rules-changed rules=${nextRules.length} importKeys=${nextImports.size}`)
      resetFolderWatchRules(nextRules)
    } else {
      log(`folderWatch setState imports-only rules=${nextRules.length} importKeys=${nextImports.size}`)
    }
  })

  ipcMain.handle('folderWatch:resync', async (_event, sourceFolder: string) => {
    const normalized = normalizePath(String(sourceFolder ?? '').trim())
    log(`folderWatch manual-resync requested sourceFolder="${normalized}"`)
    const rule = folderWatchRules.find(
      (r) => normalizePath(r.sourceFolder).toLowerCase() === normalized.toLowerCase()
    )
    if (rule) {
      await syncExistingWatchedFiles({
        ...rule,
        sourceFolder: normalizePath(rule.sourceFolder),
        destFolder: normalizePath(rule.destFolder),
      })
    } else {
      log(`folderWatch manual-resync no-rule sourceFolder="${normalized}"`)
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
  ipcMain.handle('folder:deleteEmpty', async (_event, folderPath: string) => {
    try {
      const normalized = normalizePath(folderPath)
      const removedCount = await deleteEmptyFolderTree(normalized)
      return { success: true, removedCount }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('folder:move', async (_event, sourcePath: string, destParentPath: string, allowMerge = false) => {
    try {
      const normSource = normalizePath(sourcePath)
      const name = basename(normSource)
      const newPath = join(normalizePath(destParentPath), name)
      log(`folder:move source="${sourcePath}" normSource="${normSource}" dest="${destParentPath}" newPath="${newPath}" srcExists=${fs.existsSync(normSource)}`)
      if (fs.existsSync(newPath)) {
        const destStat = await fs.promises.stat(newPath)
        if (!destStat.isDirectory()) {
          return { success: false, error: 'A non-folder item with that name already exists at the destination' }
        }
        if (!allowMerge) {
          return { success: false, error: 'merge-required', mergeTargetPath: newPath.replace(/\\/g, '/') }
        }
        const mergeResult = await mergeFolderContents(normSource, newPath)
        const remaining = await fs.promises.readdir(normSource)
        if (remaining.length === 0) {
          suppressWatcher()
          await fs.promises.rmdir(normSource)
        }
        return {
          success: true,
          newPath: newPath.replace(/\\/g, '/'),
          mergedIntoExisting: true,
          skippedPaths: mergeResult.skippedPaths,
        }
      }
      suppressWatcher()
      fs.renameSync(normSource, newPath)
      return { success: true, newPath: newPath.replace(/\\/g, '/') }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  log('creating window...')
  createWindow()
  log('window created')

  // Auto-start queue on launch if the user opted in.
  try {
    const settingsPath = join(app.getPath('userData'), 'settings.json')
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')) as { trainingAutoStartQueueOnLaunch?: boolean; trainingAutoStartSkipIfPaused?: boolean }
    if (s.trainingAutoStartQueueOnLaunch) {
      const skip = s.trainingAutoStartSkipIfPaused && trainerPauseAfterCurrent
      if (!skip) {
        trainerPauseAfterCurrent = false
        void pumpTrainerQueue()
      }
    }
  } catch { /* settings.json missing on first launch — nothing to do */ }

  // Send any files queued before window was ready (macOS open-file events + Windows argv)
  const argvFiles = getArgvFiles()
  if (argvFiles.length > 0) pendingOpenPaths.push(...argvFiles)

  // Pull model: renderer calls this once mounted to get any startup files.
  // This avoids the race where did-finish-load fires before React subscribes.
  ipcMain.handle('app:getPendingFiles', () => {
    const valid = pendingOpenPaths.splice(0).filter((p) => p.toLowerCase().endsWith('.nam') && fs.existsSync(p))
    return valid
  })

  // IPC: Open URL in default browser
  ipcMain.handle('app:openExternal', (_event, url: string) => {
    openExternalSafe(url, ['https:', 'mailto:'])
  })

  ipcMain.handle('app:showMessageBox', async (_event, options: {
    type?: 'none' | 'info' | 'error' | 'question' | 'warning'
    title?: string
    message: string
    detail?: string
    buttons: string[]
    defaultId?: number
    cancelId?: number
    noLink?: boolean
  }) => {
    const targetWindow = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined
    const result = await dialog.showMessageBox(targetWindow, {
      type: options.type ?? 'info',
      title: options.title,
      message: options.message,
      detail: options.detail,
      buttons: options.buttons,
      defaultId: options.defaultId,
      cancelId: options.cancelId,
      noLink: options.noLink ?? true,
    })
    return { response: result.response }
  })

  ipcMain.handle('app:showTextContextMenu', async (_event, params: { hasSelection: boolean; isEditable: boolean }) => {
    if (!mainWindow) return
    const { hasSelection, isEditable } = params
    if (!hasSelection && !isEditable) return

    const template: Electron.MenuItemConstructorOptions[] = []
    if (hasSelection) template.push({ role: 'copy', label: 'Copy' })
    if (isEditable) {
      if (template.length > 0) template.push({ type: 'separator' })
      template.push(
        { role: 'cut', label: 'Cut' },
        { role: 'paste', label: 'Paste' }
      )
    }
    if (template.length > 0) template.push({ type: 'separator' })
    template.push({ role: 'selectAll', label: 'Select All' })

    Menu.buildFromTemplate(template).popup({ window: mainWindow })
  })

  // IPC: Detect whether a non-NAM-Lab default handler is registered for .nam files
  ipcMain.handle('app:detectNamPlayer', async () => {
    try {
      const { execSync } = await import('child_process')
      if (process.platform === 'win32') {
        const assoc = execSync('cmd /c assoc .nam', { encoding: 'utf8', timeout: 3000, windowsHide: true }).trim()
        if (!assoc.includes('=')) return false
        const progId = assoc.split('=')[1].trim()
        const ftype = execSync(`cmd /c ftype ${progId}`, { encoding: 'utf8', timeout: 3000, windowsHide: true }).trim()
        const ourExe = process.execPath.replace(/\\/g, '/').toLowerCase()
        const ftypeLower = ftype.replace(/\\/g, '/').toLowerCase()
        return ftypeLower.includes('.exe') && !ftypeLower.includes(ourExe)
      }
      // macOS / Linux: no reliable shell-only method â€” rely on manual path setting
      return false
    } catch {
      return false
    }
  })

  // IPC: Browse for NAM standalone executable
  ipcMain.handle('dialog:browseExecutable', async () => {
    if (!mainWindow) return null
    const filters = process.platform === 'win32'
      ? [{ name: 'Executable', extensions: ['exe'] }]
      : process.platform === 'darwin'
        ? [{ name: 'Application', extensions: ['app'] }]
        : [{ name: 'All Files', extensions: ['*'] }]
    const result = await showOpenDialogSafely({
      title: 'Select Neural Amp Modeler standalone',
      properties: ['openFile'],
      filters
    }, mainWindow)
    return result.canceled ? null : result.filePaths[0]
  })

  // Return the live history explicitly — the high-frequency 'trainer:update' push strips it, so this
  // on-demand fetch is how the renderer seeds its history on mount.
  ipcMain.handle('trainer:getState', async () => ({ ...trainerState, history: trainerHistory }))

  ipcMain.handle('trainer:cancel', async () => {
    if (!trainerChild || trainerState.status !== 'running' && trainerState.status !== 'starting') {
      return { success: false, error: 'No training run is currently active.' }
    }
    try {
      const canceledAt = new Date().toISOString()
      // Emergency stop targets the CURRENT capture only — other queued jobs stay queued.
      // The active job will be sent back to status='queued' in the close handler so it can be
      // resumed as the first item when the user clicks Resume / Start queue.
      requestEmergencyRequeueCurrentJob(true)
      trainerChild.kill()
      trainerState = {
        ...trainerState,
        status: 'canceled',
        finishedAt: canceledAt,
        error: '',
      }
      emitTrainerState()
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('trainer:start', async (_event, payload: TrainerStartPayload) => {
    const pythonPath = (payload.pythonPath ?? '').trim()
    const inputPath = (payload.inputPath ?? '').trim()
    const outputPath = (payload.outputPath ?? '').trim()
    const trainPath = (payload.trainPath ?? '').trim()
    if (!pythonPath || !inputPath || !outputPath || !trainPath) {
      return { success: false, error: 'Python path, input audio, output audio, and train destination are required.' }
    }
    await enqueueTrainingPayloads([{ ...payload, pythonPath, inputPath, outputPath, trainPath }])
    return { success: true }
  })

  ipcMain.handle('trainer:enqueue', async (_event, payloads: TrainerStartPayload[], opts?: { staged?: boolean }) => {
    const validPayloads = payloads
      .map((payload) => ({
        ...payload,
        pythonPath: (payload.pythonPath ?? '').trim(),
        inputPath: (payload.inputPath ?? '').trim(),
        outputPath: (payload.outputPath ?? '').trim(),
        trainPath: (payload.trainPath ?? '').trim(),
      }))
      .filter((payload) => payload.pythonPath && payload.inputPath && payload.outputPath && payload.trainPath)
    if (validPayloads.length === 0) {
      return { success: false, error: 'No valid training jobs were provided.' }
    }
    const queued = await enqueueTrainingPayloads(validPayloads, opts?.staged ?? false)
    return { success: true, queued }
  })

  ipcMain.handle('trainer:setProfilesState', async (_event, payload: {
    pythonPath: string
    inputPath: string
    modeledBy: string
    inputLevelDbu: number | null
    outputLevelDbu: number | null
    retainGraphs: boolean
    normalizeWav?: boolean
    normalizeWavTargetDb?: number
    profiles: TrainingProfile[]
    userCaptureProfiles?: UserCaptureProfile[]
  }) => {
    trainerConfiguredPythonPath = (payload?.pythonPath ?? '').trim()
    trainerConfiguredInputPath = (payload?.inputPath ?? '').trim()
    trainerConfiguredModeledBy = (payload?.modeledBy ?? '').trim()
    trainerConfiguredInputLevelDbu = Number.isFinite(payload?.inputLevelDbu) ? payload.inputLevelDbu ?? null : null
    trainerConfiguredOutputLevelDbu = Number.isFinite(payload?.outputLevelDbu) ? payload.outputLevelDbu ?? null : null
    trainerConfiguredNormalizeWav = payload?.normalizeWav ?? false
    trainerConfiguredNormalizeWavTargetDb = Number.isFinite(payload?.normalizeWavTargetDb) ? (payload.normalizeWavTargetDb ?? -5.0) : -5.0
    trainerUserCaptureProfiles = Array.isArray(payload?.userCaptureProfiles) ? payload.userCaptureProfiles : []
    resetTrainingWatchProfiles(Array.isArray(payload?.profiles) ? payload.profiles : [], payload?.retainGraphs ?? true)
    return { success: true }
  })

  ipcMain.handle('trainer:getProfilesState', async () => makeTrainerWatcherSnapshot())

  ipcMain.handle('trainer:markWatchCurrentSeen', async (_event, profileId: string) => {
    const target = trainingProfiles.find((profile) => profile.id === profileId && profile.sourceMode === 'watcher')
    if (!target) return { success: false, error: 'Training watcher profile not found.' }
    const marked = await markExistingTrainingWatcherFilesAsSeen(target)
    emitTrainerState()
    return { success: true, marked }
  })

  ipcMain.handle('trainer:clearProfileSkippedAndRescan', async (_event, profileId: string) => {
    const target = trainingProfiles.find((profile) => profile.id === profileId && profile.sourceMode === 'watcher')
    if (!target) return { success: false, error: 'Training watcher profile not found.' }
    const before = trainerSkipped.filter((e) => e.profileId === profileId).length
    trainerSkipped = trainerSkipped.filter((e) => e.profileId !== profileId)
    saveTrainerSkipped()
    log(`[watcher "${target.name}"] cleared ${before} skipped entry/entries, forcing re-scan`)
    await enqueueExistingTrainingWatcherFiles(target)
    await ensureTrainingWatcherAutoStart(target)
    emitTrainerState()
    return { success: true, cleared: before }
  })

  ipcMain.handle('trainer:getWatcherFilesStatus', async (_event, profileId: string, watchFolder: string, architectures: string[]) => {
    const sourceFolder = (watchFolder ?? '').trim()
    if (!sourceFolder) return { success: true, files: [] }
    let wavFiles: string[] = []
    try {
      wavFiles = await scanWavFilesInFolder(sourceFolder)
    } catch (e) {
      return { success: false, error: `Could not scan folder: ${String(e)}` }
    }
    const activeJobId = trainerState.activeJobId
    const files = await Promise.all(wavFiles.map(async (filePath) => {
      let sizeBytes = 0, mtimeMs = 0
      try { const s = await fs.promises.stat(filePath); sizeBytes = s.size; mtimeMs = s.mtimeMs } catch { /* ignore */ }
      const statuses = (architectures ?? []).map((arch) => {
        const normFile = normalizePath(filePath)
        const activeJob = activeJobId ? trainerQueue.find((j) => j.jobId === activeJobId) : null
        if (activeJob && normalizePath(activeJob.outputPath) === normFile && activeJob.profileId === profileId && activeJob.architecture === arch) return { architecture: arch, status: 'running' as const }
        if (trainerQueue.some((j) => normalizePath(j.outputPath) === normFile && j.profileId === profileId && j.architecture === arch && j.status === 'queued')) return { architecture: arch, status: 'queued' as const }
        if (trainerSkipped.some((e) => normalizePath(e.sourcePath) === normFile && e.profileId === profileId && e.architecture === arch)) return { architecture: arch, status: 'skipped' as const }
        const hist = trainerHistory.find((e) => normalizePath(e.sourcePath) === normFile && e.profileId === profileId && e.architecture === arch)
        if (hist) return { architecture: arch, status: hist.status as 'done' | 'failed' | 'canceled' | 'skipped' }
        return { architecture: arch, status: 'pending' as const }
      })
      return { filePath, fileName: basename(filePath), sizeBytes, mtimeMs, statuses }
    }))
    return { success: true, files }
  })

  ipcMain.handle('trainer:resetWatcherFile', async (_event, profileId: string, filePath: string) => {
    const profile = trainingProfiles.find((p) => p.id === profileId && p.sourceMode === 'watcher')
    if (!profile) return { success: false, error: 'Profile not found.' }
    const norm = normalizePath(filePath)
    trainerSkipped = trainerSkipped.filter((e) => !(e.profileId === profileId && normalizePath(e.sourcePath) === norm))
    trainerHistory = trainerHistory.filter((e) => !(e.profileId === profileId && normalizePath(e.sourcePath) === norm))
    saveTrainerSkipped()
    saveTrainerHistory()
    emitTrainerHistory()
    const payloads = await buildTrainerPayloadsForProfile(profile, trainerConfiguredPythonPath, trainerConfiguredInputPath, [filePath], 'watcher', { id: crypto.randomUUID(), label: `Watcher - ${profile.name}`, createdAt: new Date().toISOString() })
    if (payloads.length > 0) {
      await enqueueTrainingPayloads(payloads)
      await ensureTrainingWatcherAutoStart(profile)
    }
    emitTrainerState()
    return { success: true, queued: payloads.length }
  })

  ipcMain.handle('trainer:retrainFileAction', async (_event, profileId: string, filePath: string, action: 'wipe-retrain' | 'retrain-new' | 'mark-skipped') => {
    const profile = trainingProfiles.find((p) => p.id === profileId && p.sourceMode === 'watcher')
    if (!profile) return { success: false, error: 'Profile not found.' }
    const norm = normalizePath(filePath)

    if (action === 'mark-skipped') {
      for (const arch of profile.architectures) {
        if (!trainerSkipped.some((e) => e.profileId === profileId && normalizePath(e.sourcePath) === norm && e.architecture === arch)) {
          appendTrainerSkipped({ skipId: crypto.randomUUID(), profileId, profileName: profile.name, sourcePath: filePath, architecture: arch as TrainerArchitecture, sourceSizeBytes: null, sourceMtimeMs: null, skippedAt: new Date().toISOString(), reason: 'manually skipped' })
        }
      }
      trainerQueue = trainerQueue.filter((j) => !(j.profileId === profileId && normalizePath(j.outputPath) === norm && j.status === 'queued'))
      emitTrainerState()
      return { success: true }
    }

    if (action === 'wipe-retrain') {
      const toDelete = trainerHistory.filter((e) => e.profileId === profileId && normalizePath(e.sourcePath) === norm)
      for (const entry of toDelete) {
        if (entry.finalModelPath) { try { fs.unlinkSync(entry.finalModelPath) } catch { /* ignore */ } }
      }
    }

    // Both wipe-retrain and retrain-new: clear history + skipped, re-enqueue
    trainerSkipped = trainerSkipped.filter((e) => !(e.profileId === profileId && normalizePath(e.sourcePath) === norm))
    trainerHistory = trainerHistory.filter((e) => !(e.profileId === profileId && normalizePath(e.sourcePath) === norm))
    saveTrainerSkipped()
    saveTrainerHistory()
    emitTrainerHistory()

    const payloads = await buildTrainerPayloadsForProfile(profile, trainerConfiguredPythonPath, trainerConfiguredInputPath, [filePath], 'watcher', { id: crypto.randomUUID(), label: `Watcher - ${profile.name}`, createdAt: new Date().toISOString() })

    if (action === 'retrain-new') {
      for (const payload of payloads) {
        const finalRoot = (payload.finalModelRoot ?? payload.trainPath).trim()
        const architectureFolder = getTrainerArchitectureFolderName(payload.architecture as TrainerArchitecture)
        const architectureFinalRoot = payload.appendModelArchitectureFolder === false ? finalRoot : join(finalRoot, architectureFolder)
        const baseName = deriveTrainerModelName(payload.outputPath, payload.architecture as TrainerArchitecture, payload.namingTemplate, payload.profileName, payload.thresholdEsr)
        payload.modelNameSuffix = findNextModelNameSuffix(baseName, architectureFinalRoot)
      }
    }

    if (payloads.length > 0) {
      await enqueueTrainingPayloads(payloads)
      await ensureTrainingWatcherAutoStart(profile)
    }
    emitTrainerState()
    return { success: true, queued: payloads.length }
  })

  ipcMain.handle('trainer:setProfileRunning', async (_event, profileId: string, running: boolean) => {
    const target = trainingProfiles.find((profile) => profile.id === profileId && profile.sourceMode === 'watcher')
    if (!target) return { success: false, error: 'Training watcher profile not found.' }
    if (!target.enabled) return { success: false, error: 'Enable the watcher profile before starting it.' }
    if (running) trainingWatcherRunning.add(profileId)
    else trainingWatcherRunning.delete(profileId)
    resetTrainingWatchProfiles(trainingProfiles, trainingRetainGraphs)
    return { success: true }
  })

  ipcMain.handle('trainer:runFolderOnce', async (_event, payload: {
    profile: TrainingProfile
    folderPath: string
    pythonPath: string
    inputPath: string
    normalizeWav?: boolean
    normalizeWavTargetDb?: number
    submissionId?: string
    submissionLabel?: string
    submissionCreatedAt?: string
  }) => {
    const folderPath = (payload?.folderPath ?? '').trim()
    const pythonPath = (payload?.pythonPath ?? '').trim()
    const inputPath = (payload?.inputPath ?? '').trim()
    if (!folderPath || !pythonPath || !inputPath) {
      return { success: false, error: 'Folder path, Python path, and input audio are required.' }
    }
    const files = await scanWavFilesInFolder(folderPath)
    if (files.length === 0) {
      return { success: false, error: 'No WAV files were found in that folder.' }
    }
    const payloads = await buildTrainerPayloadsForProfile(
      payload.profile,
      pythonPath,
      inputPath,
      files,
      'manual-folder-run',
      payload.submissionId && payload.submissionLabel
        ? {
            id: payload.submissionId,
            label: payload.submissionLabel,
            createdAt: payload.submissionCreatedAt ?? new Date().toISOString(),
          }
        : undefined,
      payload.normalizeWav != null
        ? { normalizeWav: payload.normalizeWav, normalizeWavTargetDb: payload.normalizeWavTargetDb ?? -5.0 }
        : undefined
    )
    const queued = await enqueueTrainingPayloads(payloads)
    return { success: true, queued, scanned: files.length }
  })

  ipcMain.handle('trainer:setPauseAfterCurrent', async (_event, pause: boolean) => {
    trainerPauseAfterCurrent = !!pause
    emitTrainerState()
    if (!trainerPauseAfterCurrent) {
      await pumpTrainerQueue()
    }
    return { success: true }
  })

  ipcMain.handle('trainer:startQueued', async () => {
    trainerPauseAfterCurrent = false
    emitTrainerState()
    await pumpTrainerQueue()
    return { success: true }
  })

  ipcMain.handle('trainer:retryFailed', async () => {
    let retried = 0
    trainerQueue = trainerQueue.map((job) => {
      if (job.status !== 'error') return job
      retried += 1
      return resetTrainerJobForQueue(job)
    })
    emitTrainerState()
    await pumpTrainerQueue()
    return { success: true, retried }
  })

  ipcMain.handle('trainer:retryJob', async (_event, jobId: string) => {
    const index = findTrainerJobIndex(jobId)
    if (index === -1) return { success: false, error: 'Training queue item not found.' }
    const job = trainerQueue[index]
    if (job.status !== 'error' && job.status !== 'canceled') {
      return { success: false, error: 'Only failed or canceled training items can be retried.' }
    }
    trainerQueue[index] = resetTrainerJobForQueue(job)
    emitTrainerState()
    await pumpTrainerQueue()
    return { success: true }
  })

  ipcMain.handle('trainer:clearQueue', async () => {
    // Drop everything that isn't the active job or a staged draft.
    // Staged stays in the Batches tab — that's a separate "drafts" inventory.
    // Active job is left alone so a running training isn't interrupted; user can Emergency Stop first if they want to nuke that too.
    const activeId = trainerState.activeJobId
    const before = trainerQueue.length
    trainerQueue = trainerQueue.filter((job) =>
      job.status === 'staged' ||
      (activeId && job.jobId === activeId && (job.status === 'starting' || job.status === 'running'))
    )
    const removed = before - trainerQueue.length
    emitTrainerState()
    return { success: true, removed }
  })

  ipcMain.handle('trainer:clearFinished', async () => {
    pruneFinishedBatchesFromQueue()
    emitTrainerState()
    return { success: true }
  })

  // Permanently remove ALL watcher-sourced jobs from the queue and mark each one's source file as
  // already-seen (baseline-seen skip), so the next folder scan / fs.watch event does NOT re-enqueue
  // them. The currently-running job (if it's a watcher job) is left alone — it can't be interrupted
  // mid-training; the user must Emergency Stop first.
  ipcMain.handle('trainer:clearWatcherJobs', async () => {
    const activeId = trainerState.activeJobId
    const activeIsRunning = activeId != null && (trainerState.status === 'starting' || trainerState.status === 'running')
    const toRemove = trainerQueue.filter((job) =>
      job.sourceMode === 'watcher' && !(activeIsRunning && job.jobId === activeId)
    )
    if (toRemove.length === 0) return { success: true, removed: 0 }
    for (const job of toRemove) {
      appendTrainerSkipped({
        skipId: crypto.randomUUID(),
        profileId: job.profileId,
        profileName: job.profileName,
        sourcePath: job.outputPath,
        architecture: job.architecture,
        sourceSizeBytes: job.sourceSizeBytes ?? null,
        sourceMtimeMs: job.sourceMtimeMs ?? null,
        skippedAt: new Date().toISOString(),
        reason: 'baseline-seen',
      })
    }
    const removeIds = new Set(toRemove.map((job) => job.jobId))
    trainerQueue = trainerQueue.filter((job) => !removeIds.has(job.jobId))
    saveTrainerSkipped()
    saveTrainerQueue()
    emitTrainerState()
    return { success: true, removed: toRemove.length }
  })

  ipcMain.handle('trainer:removeQueued', async () => {
    trainerQueue = trainerQueue.filter((job) => job.status !== 'queued')
    pruneFinishedBatchesFromQueue() // removing queued jobs may leave a batch fully terminal
    emitTrainerState()
    return { success: true }
  })

  ipcMain.handle('trainer:removeJob', async (_event, jobId: string) => {
    const index = findTrainerJobIndex(jobId)
    if (index === -1) return { success: false, error: 'Training queue item not found.' }
    if (trainerState.activeJobId === jobId && (trainerState.status === 'starting' || trainerState.status === 'running')) {
      return { success: false, error: 'Cannot remove the active training job while it is running.' }
    }
    trainerQueue.splice(index, 1)
    pruneFinishedBatchesFromQueue() // removing a job may leave its batch fully terminal
    emitTrainerState()
    return { success: true }
  })

  ipcMain.handle('trainer:dismissBatch', async (_event, submissionId: string) => {
    if (!submissionId) return { success: false, error: 'No submission ID.' }
    const activeId = trainerState.activeJobId
    const before = trainerQueue.length
    // Remove all jobs in this batch except the currently running one (can't interrupt mid-training).
    trainerQueue = trainerQueue.filter(j => j.submissionId !== submissionId || j.jobId === activeId)
    const removed = before - trainerQueue.length
    emitTrainerState()
    return { success: true, removed }
  })

  ipcMain.handle('trainer:purgeHistoryEntries', async (_event, historyIds: string[]) => {
    if (!Array.isArray(historyIds) || historyIds.length === 0) return { success: false, error: 'No history entries to purge.', removed: 0 }
    const ids = new Set(historyIds)
    const before = trainerHistory.length
    trainerHistory = trainerHistory.filter((e) => !ids.has(e.historyId))
    const removed = before - trainerHistory.length
    if (removed === 0) return { success: false, error: 'No matching history entries found.', removed: 0 }
    saveTrainerHistory()
    trainerState = { ...trainerState, history: trainerHistory }
    emitTrainerHistory()
    emitTrainerState()
    return { success: true, removed }
  })

  ipcMain.handle('trainer:watcherQueueAction', async (_event, jobId: string, action: 'remove' | 'skip' | 'move-canceled' | 'retry-now') => {
    const index = findTrainerJobIndex(jobId)
    if (index === -1) return { success: false, error: 'Training queue item not found.' }
    const job = trainerQueue[index]
    if (job.sourceMode !== 'watcher') return { success: false, error: 'That queue item is not from a watch folder.' }
    if (trainerState.activeJobId === jobId && (trainerState.status === 'starting' || trainerState.status === 'running')) {
      return { success: false, error: 'Cannot change the active training job while it is running.' }
    }

    if (action === 'retry-now') {
      clearTrainerSkipped(job.profileId, job.outputPath, job.architecture)
      const moved = makeQueuedTrainerJobNext(jobId)
      trainerPauseAfterCurrent = false
      emitTrainerState()
      await pumpTrainerQueue()
      return moved ? { success: true } : { success: false, error: 'Could not make that watcher item next.' }
    }

    if (action === 'remove') {
      trainerQueue.splice(index, 1)
      emitTrainerState()
      return { success: true }
    }

    if (action === 'skip') {
      appendTrainerSkipped({
        skipId: crypto.randomUUID(),
        profileId: job.profileId,
        profileName: job.profileName,
        sourcePath: job.outputPath,
        architecture: job.architecture,
        sourceSizeBytes: job.sourceSizeBytes,
        sourceMtimeMs: job.sourceMtimeMs,
        skippedAt: new Date().toISOString(),
        reason: 'Skipped from watcher queue by user.',
      })
      appendTrainerCanceledHistory(job, 'Skipped from watcher queue by user.', '', 'skipped')
      trainerQueue.splice(index, 1)
      emitTrainerState()
      return { success: true }
    }

    const profile = trainingProfiles.find((item) => item.id === job.profileId)
    const cancelRoot = profile?.watchFolder?.trim()
    if (!cancelRoot) return { success: false, error: 'Watch folder is missing, so the source cannot be moved to _Canceled.' }
    const destinationDir = join(cancelRoot, '_Canceled')
    await fs.promises.mkdir(destinationDir, { recursive: true })
    const destinationPath = await ensureUniqueFilePath(join(destinationDir, basename(job.outputPath)))
    suppressWatcher()
    await fs.promises.rename(job.outputPath, destinationPath)
    const normalizedSource = normalizePath(job.outputPath)
    const removedJobs = trainerQueue.filter((item) =>
      item.sourceMode === 'watcher' &&
      item.profileId === job.profileId &&
      normalizePath(item.outputPath) === normalizedSource &&
      item.status === 'queued'
    )
    trainerQueue = trainerQueue.filter((item) => !removedJobs.some((removed) => removed.jobId === item.jobId))
    for (const removedJob of removedJobs) {
      appendTrainerCanceledHistory(removedJob, 'Moved source to _Canceled by user.', destinationPath)
    }
    emitTrainerState()
    return { success: true }
  })

  ipcMain.handle('trainer:moveJob', async (_event, jobId: string, direction: 'up' | 'down') => {
    if (direction !== 'up' && direction !== 'down') {
      return { success: false, error: 'Invalid queue move direction.' }
    }
    const moved = moveQueuedTrainerJob(jobId, direction)
    if (!moved) return { success: false, error: `Could not move that queue item ${direction}.` }
    emitTrainerState()
    return { success: true }
  })

  ipcMain.handle('trainer:makeNext', async (_event, jobId: string) => {
    const moved = makeQueuedTrainerJobNext(jobId)
    if (!moved) return { success: false, error: 'Could not make that queue item next.' }
    emitTrainerState()
    return { success: true }
  })

  ipcMain.handle('trainer:reorderJob', async (_event, jobId: string, beforeJobId: string) => {
    const moved = reorderQueuedTrainerJob(jobId, beforeJobId)
    if (!moved) return { success: false, error: 'Could not reorder that queue item.' }
    emitTrainerState()
    return { success: true }
  })

  ipcMain.handle('trainer:cancelBatch', async (_event, submissionId: string) => {
    const canceledAt = new Date().toISOString()
    let found = false
    const activeIsInBatch = trainerState.activeJobId != null &&
      trainerQueue.find(j => j.jobId === trainerState.activeJobId)?.submissionId === submissionId
    // Cancel all queued/staged jobs in this submission
    trainerQueue = trainerQueue.map((job) => {
      if (job.submissionId !== submissionId) return job
      if (job.status === 'queued' || job.status === 'staged') {
        found = true
        return { ...job, status: 'canceled', finishedAt: canceledAt, error: 'Batch canceled.' }
      }
      return job
    })
    // Also kill the active run if it belongs to this submission
    if (activeIsInBatch && trainerChild && (trainerState.status === 'running' || trainerState.status === 'starting')) {
      found = true
      trainerState = {
        ...trainerState,
        status: 'canceled',
        finishedAt: canceledAt,
        error: 'Batch canceled.',
      }
      emitTrainerState()
      trainerChild.kill()
    }
    if (!found) return { success: false, error: 'No queued jobs found for that batch.' }
    emitTrainerState()
    return { success: true }
  })

  ipcMain.handle('trainer:unstageSubmission', async (_event, submissionId: string) => {
    let found = false
    trainerQueue = trainerQueue.map((job) => {
      if (job.submissionId !== submissionId || job.status !== 'staged') return job
      found = true
      return { ...job, status: 'queued' }
    })
    if (!found) return { success: false, error: 'No staged jobs found for that batch.' }
    emitTrainerState()
    await pumpTrainerQueue()
    return { success: true }
  })

  ipcMain.handle('trainer:stageJob', async (_event, jobId: string) => {
    const job = trainerQueue.find((j) => j.jobId === jobId)
    if (!job) return { success: false, error: 'Job not found.' }
    if (job.status !== 'queued') return { success: false, error: 'Only queued jobs can be moved to staged.' }
    trainerQueue = trainerQueue.map((j) => j.jobId === jobId ? { ...j, status: 'staged' } : j)
    emitTrainerState()
    return { success: true }
  })

  ipcMain.handle('trainer:stageSubmission', async (_event, submissionId: string) => {
    let found = false
    trainerQueue = trainerQueue.map((job) => {
      if (job.submissionId !== submissionId || job.status !== 'queued') return job
      found = true
      return { ...job, status: 'staged' }
    })
    if (!found) return { success: false, error: 'No queued jobs found for that batch.' }
    emitTrainerState()
    return { success: true }
  })

  ipcMain.handle('trainer:moveSubmissionBefore', async (_event, submissionId: string, beforeSubmissionId: string) => {
    const moved = moveSubmissionBeforeSubmission(submissionId, beforeSubmissionId)
    if (!moved) return { success: false, error: 'Could not reorder that batch.' }
    emitTrainerState()
    return { success: true }
  })

  ipcMain.handle('trainer:moveSubmissionToEnd', async (_event, submissionId: string) => {
    const moved = moveSubmissionToEndOfQueue(submissionId)
    if (!moved) return { success: false, error: 'Could not move that batch to end.' }
    emitTrainerState()
    return { success: true }
  })

  ipcMain.handle(
    'trainer:editSubmission',
    async (_event, submissionId: string, changes: { epochs?: number; thresholdEsr?: number | null; lr?: number; lrDecay?: number; submissionLabel?: string }) => {
      const now = new Date().toISOString()
      const hasSettingsChange = typeof changes.epochs === 'number' || changes.thresholdEsr !== undefined || typeof changes.lr === 'number' || typeof changes.lrDecay === 'number'
      let changed = false
      trainerQueue = trainerQueue.map((job) => {
        if (job.submissionId !== submissionId) return job
        // Label change applies to all jobs in the submission (so the header always shows the new name).
        // Settings changes (epochs, ESR, LR) and editedAt apply only to queued jobs.
        const isEditable = job.status === 'queued' || job.status === 'staged'
        const settingsUpdate = isEditable && hasSettingsChange ? {
          ...(typeof changes.epochs === 'number' ? { epochs: changes.epochs, progressEpochTotal: changes.epochs } : {}),
          ...(changes.thresholdEsr !== undefined ? { thresholdEsr: changes.thresholdEsr } : {}),
          ...(typeof changes.lr === 'number' ? { lr: changes.lr } : {}),
          ...(typeof changes.lrDecay === 'number' ? { lrDecay: changes.lrDecay } : {}),
          editedAt: now,
        } : {}
        const labelUpdate = typeof changes.submissionLabel === 'string' ? { submissionLabel: changes.submissionLabel } : {}
        if (Object.keys(settingsUpdate).length === 0 && Object.keys(labelUpdate).length === 0) return job
        changed = true
        return { ...job, ...settingsUpdate, ...labelUpdate }
      })
      if (!changed) return { success: false, error: 'No jobs found for that batch.' }
      emitTrainerState()
      saveTrainerQueue()
      return { success: true }
    }
  )

  ipcMain.handle('trainer:retryHistoryEntry', async (_event, historyId: string) => {
    const entry = trainerHistory.find((item) => item.historyId === historyId)
    if (!entry) return { success: false, error: 'Training history entry not found.' }
    if (!entry.profileId) return { success: false, error: 'Only profile-backed watcher or folder runs can be retried from history right now.' }
    const profile = trainingProfiles.find((item) => item.id === entry.profileId)
    if (!profile) return { success: false, error: 'The training profile used by that history entry no longer exists.' }
    if (!trainerConfiguredPythonPath || !trainerConfiguredInputPath) {
      return { success: false, error: 'Configure the NAM Python path and input WAV before retrying from history.' }
    }
    const sourcePath = [entry.processedWavPath, entry.sourcePath].find((candidate) => candidate && fs.existsSync(candidate))
    if (!sourcePath) return { success: false, error: 'The source WAV for that history entry could not be found.' }
    clearTrainerSkipped(entry.profileId, entry.sourcePath, entry.architecture)
    clearTrainerSkipped(entry.profileId, sourcePath, entry.architecture)
    const payloads = (await buildTrainerPayloadsForProfile(
      profile,
      trainerConfiguredPythonPath,
      trainerConfiguredInputPath,
      [sourcePath],
      entry.sourceMode,
      {
        id: crypto.randomUUID(),
        label: `Retry - ${entry.profileName ?? profile.name}`,
        createdAt: new Date().toISOString(),
      }
    )).filter((payload) => payload.architecture === entry.architecture)
    if (payloads.length === 0) {
      return { success: false, error: 'That history entry could not be re-queued.' }
    }
    const queued = await enqueueTrainingPayloads(payloads)
    if (queued > 0) {
      entry.retriedAt = new Date().toISOString()
      saveTrainerHistory()
      emitTrainerHistory()
    }
    return { success: queued > 0, queued, error: queued > 0 ? undefined : 'That retry did not add a new queue item.' }
  })

  ipcMain.handle('trainer:markHistoryRetried', async (_event, historyIds: string[]) => {
    if (!Array.isArray(historyIds) || historyIds.length === 0) return { success: false }
    const ids = new Set(historyIds)
    const now = new Date().toISOString()
    let marked = 0
    for (const entry of trainerHistory) {
      if (ids.has(entry.historyId)) { entry.retriedAt = now; marked++ }
    }
    if (marked > 0) { saveTrainerHistory(); emitTrainerHistory() }
    return { success: marked > 0 }
  })

  // Clear the now-redundant live-queue rows that a History retry just superseded. When you
  // "Retry failed" (or "Retry batch") from History, the retried jobs come back as a brand-new
  // submission — but the ORIGINAL finished rows kept sitting in the live queue as `error` /
  // `canceled` / `success`, still counting toward the queue's Failed tile and never clearing
  // (a fully-failed batch never auto-prunes). This removes exactly those superseded rows.
  //
  // Matched by (submissionId, sourcePath, architecture) — the triple that uniquely identifies
  // one capture × one architecture within a batch (history entries carry a fresh UUID, not the
  // original jobId, so we can't match by id). Only TERMINAL rows are ever removed: a row still
  // `running` or `queued` is genuinely unfinished work and is left completely untouched, so
  // retrying the finished failures of a batch that's still partway through never disturbs the
  // rest of it. Removing all-error rows leaves any remaining rows all-success, which the
  // existing prune then clears — so a fully-done batch's card disappears entirely, while a
  // still-live batch's card stays minus the retried failures.
  ipcMain.handle('trainer:clearSupersededQueueRows', async (_event, refs: Array<{ submissionId?: string | null; sourcePath: string; architecture: string }>) => {
    if (!Array.isArray(refs) || refs.length === 0) return { success: false, removed: 0 }
    const activeId = trainerState.activeJobId
    const keyOf = (submissionId: string | null | undefined, sourcePath: string, architecture: string) =>
      `${submissionId ?? ''} ${normalizePath(sourcePath)} ${architecture}`
    const targets = new Set(refs.map((r) => keyOf(r.submissionId, r.sourcePath, r.architecture)))
    const before = trainerQueue.length
    trainerQueue = trainerQueue.filter((job) => {
      if (job.jobId === activeId) return true                       // never touch the running job
      if (!isTrainerQueueTerminalStatus(job.status)) return true    // never touch queued/running/staged
      return !targets.has(keyOf(job.submissionId, job.outputPath, job.architecture))
    })
    const removed = before - trainerQueue.length
    // Removing terminal error rows may leave a batch all-success — let the normal rule prune it.
    pruneFinishedBatchesFromQueue()
    if (removed > 0) emitTrainerState()
    return { success: true, removed }
  })

  const namVersionCache = new Map<string, 'a1' | 'a2'>()
  ipcMain.handle('trainer:detectNamVersion', async (_event, pythonPath: string) => {
    const key = (pythonPath ?? '').trim()
    if (!key) return { version: 'unknown' }
    if (namVersionCache.has(key)) return { version: namVersionCache.get(key) }
    try {
      const { execFile } = await import('child_process')
      const version = await new Promise<'a1' | 'a2'>((resolve, reject) => {
        execFile(
          key,
          ['-c', 'import nam.train.core as c; print("a2" if not hasattr(c, "Architecture") else "a1")'],
          { timeout: 10000 },
          (err, stdout) => {
            if (err) return reject(err)
            resolve(stdout.trim() === 'a2' ? 'a2' : 'a1')
          }
        )
      })
      namVersionCache.set(key, version)
      return { version }
    } catch {
      return { version: 'unknown' }
    }
  })

  // IPC: Open a .nam file in NAM standalone (via explicit path or OS default)
  ipcMain.handle('app:openInNam', async (_event, filePath: string, standalonePath: string) => {
    try {
      if (standalonePath) {
        const { spawn } = await import('child_process')
        if (process.platform === 'darwin' && standalonePath.endsWith('.app')) {
          spawn('open', ['-a', standalonePath, filePath], { detached: true, stdio: 'ignore' }).unref()
        } else {
          spawn(standalonePath, [filePath], { detached: true, stdio: 'ignore' }).unref()
        }
        return { success: true }
      }
      const err = await shell.openPath(filePath)
      return { success: !err, error: err || undefined }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // IPC: Check for updates via GitHub releases API
  // IPC: Walk up from folderPath (exclusive) to rootPath (inclusive) and return
  // the first ancestor directory that contains nam-pack.json, or null if none.
  ipcMain.handle('folder:findPackOwner', async (_event, folderPath: string, rootPath: string) => {
    const norm = (p: string) => p.replace(/\\/g, '/')
    let current = norm(folderPath)
    const root = norm(rootPath)
    while (true) {
      const lastSlash = current.lastIndexOf('/')
      if (lastSlash <= 0) break
      const parent = current.substring(0, lastSlash)
      if (parent.length < root.length) break
      try {
        await fs.promises.access(join(parent, 'nam-pack.json'))
        return parent  // found
      } catch {
        // not here, keep walking
      }
      if (parent === root) break
      current = parent
    }
    return null
  })

  // IPC: Walk the folder tree and return paths of folders that have a non-empty nam-pack.json title
  ipcMain.handle('folder:findPackFolders', async (_event, rootPath: string) => {
    const results: string[] = []
    const walk = async (dir: string, depth: number) => {
      if (depth > 8) return
      try {
        const packPath = join(dir, 'nam-pack.json')
        try {
          const raw = await fs.promises.readFile(packPath, 'utf-8')
          const data = JSON.parse(raw)
          if (data && typeof data.title === 'string' && data.title.trim()) {
            results.push(dir.replace(/\\/g, '/'))
          }
        } catch { /* no pack here */ }
        const entries = await fs.promises.readdir(dir, { withFileTypes: true })
        await Promise.all(entries.filter((e) => e.isDirectory()).map((e) => walk(join(dir, e.name), depth + 1)))
      } catch { /* skip unreadable dirs */ }
    }
    await walk(rootPath, 0)
    return results
  })

  // IPC: Read nam-pack.json from a folder
  ipcMain.handle('folder:readPackInfo', async (_event, folderPath: string) => {
    try {
      const packPath = join(folderPath, 'nam-pack.json')
      const raw = await fs.promises.readFile(packPath, 'utf-8')
      return { success: true, data: JSON.parse(raw) }
    } catch {
      return { success: true, data: null }
    }
  })

  // IPC: Write nam-pack.json to a folder
  ipcMain.handle('folder:writePackInfo', async (_event, folderPath: string, data: unknown) => {
    try {
      const packPath = join(folderPath, 'nam-pack.json')
      suppressWatcher()
      await fs.promises.writeFile(packPath, JSON.stringify(data, null, 2), 'utf-8')
      invalidateCompanionPackCache()
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // IPC: Delete nam-pack.json from a folder
  ipcMain.handle('folder:deletePackInfo', async (_event, folderPath: string) => {
    try {
      const packPath = join(folderPath, 'nam-pack.json')
      suppressWatcher()
      await fs.promises.unlink(packPath)
      invalidateCompanionPackCache()
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // IPC: Read README.txt (case-insensitive) from a folder
  ipcMain.handle('folder:readReadme', async (_event, folderPath: string) => {
    try {
      const entries = await fs.promises.readdir(folderPath, { withFileTypes: true })
      const candidates = entries.filter((entry) => entry.isFile() && /\.txt$/i.test(entry.name) && /readme/i.test(entry.name))
      const match = candidates.find((entry) => /^readme\.txt$/i.test(entry.name)) ?? candidates[0]
      if (!match) return { success: true, exists: false, fileName: 'README.txt', content: '' }
      const fullPath = join(folderPath, match.name)
      const content = await fs.promises.readFile(fullPath, 'utf-8')
      return { success: true, exists: true, fileName: match.name, content }
    } catch (e) {
      return { success: false, error: String(e), exists: false, fileName: 'README.txt', content: '' }
    }
  })

  // IPC: Write README.txt to a folder
  ipcMain.handle('folder:writeReadme', async (_event, folderPath: string, fileName: string, content: string) => {
    try {
      const safeName = /^readme\.txt$/i.test(fileName) ? fileName : 'README.txt'
      suppressWatcher()
      await fs.promises.writeFile(join(folderPath, safeName), content, 'utf-8')
      return { success: true, fileName: safeName }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // IPC: Read nam-bundle.json from a folder
  ipcMain.handle('folder:readBundle', async (_event, folderPath: string) => {
    try {
      const raw = await fs.promises.readFile(join(folderPath, 'nam-bundle.json'), 'utf-8')
      return { success: true, data: JSON.parse(raw) }
    } catch {
      return { success: true, data: null }
    }
  })

  // IPC: Write nam-bundle.json to a folder
  ipcMain.handle('folder:writeBundle', async (_event, folderPath: string, data: unknown) => {
    try {
      suppressWatcher()
      await fs.promises.writeFile(join(folderPath, 'nam-bundle.json'), JSON.stringify(data, null, 2), 'utf-8')
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // IPC: Delete nam-bundle.json from a folder
  ipcMain.handle('folder:deleteBundle', async (_event, folderPath: string) => {
    try {
      suppressWatcher()
      await fs.promises.unlink(join(folderPath, 'nam-bundle.json'))
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  // IPC: Walk the folder tree and return paths of all folders that have nam-bundle.json
  ipcMain.handle('folder:listWavFiles', async (_event, folderPath: string) => {
    try {
      const entries = await fs.promises.readdir(folderPath, { withFileTypes: true })
      return entries
        .filter((e) => e.isFile() && /\.wav$/i.test(e.name))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b))
    } catch {
      return []
    }
  })

  ipcMain.handle('folder:listNamFiles', async (_event, folderPath: string) => {
    try {
      const entries = await fs.promises.readdir(folderPath, { withFileTypes: true })
      return entries
        .filter((e) => e.isFile() && /\.nam$/i.test(e.name))
        .map((e) => e.name)
        .sort((a, b) => a.localeCompare(b))
    } catch {
      return []
    }
  })

  ipcMain.handle('folder:scanBundlePaths', async (_event, rootPath: string) => {
    const results: string[] = []
    const walk = async (dir: string, depth: number) => {
      if (depth > 8) return
      try {
        await fs.promises.access(join(dir, 'nam-bundle.json'))
        results.push(dir.replace(/\\/g, '/'))
      } catch { /* no bundle here */ }
      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true })
        await Promise.all(entries.filter((e) => e.isDirectory()).map((e) => walk(join(dir, e.name), depth + 1)))
      } catch { /* skip unreadable dirs */ }
    }
    await walk(rootPath, 0)
    return results
  })

  // IPC: Walk the folder tree and return pack folders with titles (for bundle Add Pack picker)
  ipcMain.handle('folder:findBundlePackFolders', async (_event, rootPath: string) => {
    const results: { folderPath: string; title: string }[] = []
    const walk = async (dir: string, depth: number) => {
      if (depth > 8) return
      try {
        const raw = await fs.promises.readFile(join(dir, 'nam-pack.json'), 'utf-8')
        const data = JSON.parse(raw)
        if (data && typeof data.title === 'string' && data.title.trim()) {
          results.push({ folderPath: dir.replace(/\\/g, '/'), title: data.title.trim() })
        }
      } catch { /* no pack here */ }
      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true })
        await Promise.all(entries.filter((e) => e.isDirectory()).map((e) => walk(join(dir, e.name), depth + 1)))
      } catch { /* skip unreadable dirs */ }
    }
    await walk(rootPath, 0)
    return results
  })

  // IPC: Write HTML to a temp file and open in default browser for PDF save
  ipcMain.handle('app:exportPackSheet', async (_event, html: string) => {
    try {
      const os = await import('os')
      const tmpFile = join(os.tmpdir(), `nam-pack-export-${Date.now()}.html`)
      await fs.promises.writeFile(tmpFile, '﻿' + html, 'utf-8')
      await shell.openExternal(`file://${tmpFile}`)
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('app:checkForUpdates', async (_event, includeRc: boolean) => {
    try {
      const res = await fetch('https://api.github.com/repos/coretonecaptures/nam-editor/releases?per_page=20', {
        headers: { 'User-Agent': 'NAM-Lab-updater' }
      })
      if (!res.ok) return { error: `GitHub API returned ${res.status}` }
      const releases = await res.json() as Array<{ tag_name: string; prerelease: boolean; html_url: string }>
      const candidates = releases.filter((r) => includeRc ? true : !r.prerelease)
      if (candidates.length === 0) return { hasUpdate: false }
      const latest = candidates[0]
      const latestVersion = latest.tag_name.replace(/^v/, '')
      const currentVersion = app.getVersion()
      const hasUpdate = compareVersions(latestVersion, currentVersion) > 0
      return { hasUpdate, latestVersion, releaseUrl: latest.html_url }
    } catch (e) {
      return { error: String(e) }
    }
  })

  // â”€â”€ tone3000 IPC handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  ipcMain.handle('tone3000:status', async () => {
    if (!tone3kTokens) return { connected: false, username: null }
    const valid = await ensureValidToken()
    if (!valid) return { connected: false, username: null }
    try {
      const res = await fetch(`${T3K_BASE}/api/v1/user`, { headers: { Authorization: `Bearer ${tone3kTokens.accessToken}`, 'User-Agent': 'NAM-Lab' } })
      if (!res.ok) return { connected: false, username: null }
      const u = await res.json() as { username?: string }
      return { connected: true, username: u.username ?? null }
    } catch { return { connected: true, username: null } }
  })

  ipcMain.handle('tone3000:connect', (_event) => {
    return new Promise<{ ok: boolean; username?: string | null; error?: string }>((resolve) => {
      const codeVerifier = crypto.randomBytes(32).toString('base64url')
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
      const state = crypto.randomBytes(16).toString('hex')
      let port = 0

      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', `http://localhost`)
        if (url.pathname !== '/callback') { res.end(); return }

        const code = url.searchParams.get('code')
        const returnedState = url.searchParams.get('state')

        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end('<html><body style="font-family:sans-serif;padding:40px;background:#111;color:#fff"><h2>Connected to tone3000!</h2><p>Return to NAM Lab - you can close this tab.</p></body></html>')
        server.close()

        if (returnedState !== state || !code) { resolve({ ok: false, error: 'Invalid OAuth callback' }); return }

        try {
          const tokenRes = await fetch(`${T3K_BASE}/api/v1/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: `http://localhost:${port}/callback`, client_id: T3K_CLIENT_ID, code_verifier: codeVerifier })
          })
          if (!tokenRes.ok) { resolve({ ok: false, error: `Token exchange failed (${tokenRes.status})` }); return }
          const tokens = await tokenRes.json() as { access_token: string; refresh_token: string; expires_in: number }
          tone3kTokens = { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + tokens.expires_in * 1000, clientId: T3K_CLIENT_ID }
          await saveTone3kTokens()

          let username: string | null = null
          try {
            const userRes = await fetch(`${T3K_BASE}/api/v1/user`, { headers: { Authorization: `Bearer ${tokens.access_token}`, 'User-Agent': 'NAM-Lab' } })
            if (userRes.ok) { const u = await userRes.json() as { username?: string }; username = u.username ?? null }
          } catch { /* username not critical */ }

          resolve({ ok: true, username })
        } catch (e) { resolve({ ok: false, error: String(e) }) }
      })

      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as import('net').AddressInfo
        port = addr.port
        const params = new URLSearchParams({ response_type: 'code', client_id: T3K_CLIENT_ID, redirect_uri: `http://localhost:${port}/callback`, code_challenge: codeChallenge, code_challenge_method: 'S256', state })
        shell.openExternal(`${T3K_BASE}/api/v1/oauth/authorize?${params}`)
      })

      setTimeout(() => { server.close(); resolve({ ok: false, error: 'Login timed out after 5 minutes' }) }, 300_000).unref()
    })
  })

  ipcMain.handle('tone3000:disconnect', async () => {
    tone3kTokens = null
    try { await fs.promises.unlink(tone3kSecureTokensPath()) } catch { /* ok */ }
    try { await fs.promises.unlink(tone3kLegacyTokensPath()) } catch { /* ok */ }
    return { ok: true }
  })

  ipcMain.handle('tone3000:getTone', async (_event, toneId: number) => {
    const valid = await ensureValidToken()
    if (!valid || !tone3kTokens) return { error: 'Not authenticated' }
    try {
      const res = await fetch(`${T3K_BASE}/api/v1/tones/${toneId}`, { headers: { Authorization: `Bearer ${tone3kTokens.accessToken}`, 'User-Agent': 'NAM-Lab' } })
      if (!res.ok) return { error: `API error ${res.status}` }
      return { ok: true, tone: await res.json() }
    } catch (e) { return { error: String(e) } }
  })

  ipcMain.handle('tone3000:getModels', async (_event, toneId: number, architecture?: string) => {
    const valid = await ensureValidToken()
    if (!valid || !tone3kTokens) return { error: 'Not authenticated' }
    try {
      const all: unknown[] = []
      let page = 1
      let total = Infinity
      while (all.length < total && all.length < 500) {
        const sp = new URLSearchParams()
        sp.set('tone_id', String(toneId))
        sp.set('page', String(page))
        sp.set('page_size', '100')
        if (architecture) sp.set('architecture', architecture)
        const res = await fetch(`${T3K_BASE}/api/v1/models?${sp}`, { headers: { Authorization: `Bearer ${tone3kTokens.accessToken}`, 'User-Agent': 'NAM-Lab' } })
        if (!res.ok) return { error: `API error ${res.status}` }
        const d = await res.json() as { data: unknown[]; total: number }
        all.push(...(d.data ?? []))
        total = d.total ?? 0
        if (!d.data?.length) break
        page++
      }
      return { ok: true, models: all }
    } catch (e) { return { error: String(e) } }
  })

  ipcMain.handle('tone3000:download', async (_event, modelUrl: string, name: string) => {
      const valid = await ensureValidToken()
      if (!valid || !tone3kTokens) return { error: 'Not authenticated' }
    try {
      if (!isAllowedTone3000Url(modelUrl)) return { error: 'Blocked download URL' }
      let lastStatus: number | null = null
      let res: Response | null = null
      for (let attempt = 0; attempt < 4; attempt++) {
        res = await fetch(modelUrl, { headers: { Authorization: `Bearer ${tone3kTokens.accessToken}`, 'User-Agent': 'NAM-Lab' } })
        if (res.ok) break
        lastStatus = res.status
        if (res.status !== 429 || attempt === 3) break

        const retryAfterHeader = res.headers.get('retry-after')
        const retryAfterSeconds = retryAfterHeader ? Number.parseFloat(retryAfterHeader) : NaN
        const retryDelayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? Math.round(retryAfterSeconds * 1000)
          : 1000 * Math.pow(2, attempt)
        await wait(retryDelayMs)
      }
      if (!res || !res.ok) {
        if (lastStatus === 429) return { error: 'Download rate-limited by Tone3000 (429). Please try a smaller batch or retry in a moment.' }
        return { error: `Download failed (${lastStatus ?? 'unknown'})` }
      }
      const buffer = Buffer.from(await res.arrayBuffer())
      const safeName = name.replace(/[^\w.\- ]/g, '_').trim() || 'tone'
      const fileName = safeName.toLowerCase().endsWith('.nam') ? safeName : `${safeName}.nam`
      const dir = join(os.tmpdir(), 'nam-lab-downloads')
      await fs.promises.mkdir(dir, { recursive: true })
      const localPath = join(dir, fileName)
        await fs.promises.writeFile(localPath, buffer)
        return { ok: true, localPath: localPath.replace(/\\/g, '/') }
      } catch (e) { return { error: String(e) } }
    })

  ipcMain.handle('tone3000:fileExists', async (_event, destDir: string, name: string) => {
      try {
        const safeName = name.replace(/[^\w.\- ]/g, '_').trim() || 'tone'
        const fileName = safeName.toLowerCase().endsWith('.nam') ? safeName : `${safeName}.nam`
        const destPath = join(destDir, fileName)
        await fs.promises.access(destPath)
        return { exists: true, destPath: destPath.replace(/\\/g, '/') }
      } catch {
        return { exists: false }
      }
    })

  ipcMain.handle('tone3000:saveCoverImage', async (_event, imageUrl: string, destDir: string) => {
      const valid = await ensureValidToken()
      if (!valid || !tone3kTokens) return { error: 'Not authenticated' }
      try {
        if (!isAllowedTone3000Url(imageUrl)) return { error: 'Blocked image URL' }
        const coverPattern = /^ampcover\.(png|jpe?g|webp|gif|avif)$/i
        let existingCoverPath: string | null = null
        try {
          const entries = await fs.promises.readdir(destDir, { withFileTypes: true })
          const existing = entries.find((entry) => entry.isFile() && coverPattern.test(entry.name))
          if (existing) {
            existingCoverPath = join(destDir, existing.name)
          }
        } catch {
          /* fall through and try saving ampcover.png */
        }

      const res = await fetch(imageUrl, {
        headers: {
          Authorization: `Bearer ${tone3kTokens.accessToken}`,
          'User-Agent': 'NAM-Lab'
        }
      })
      if (!res.ok) return { error: `Image download failed (${res.status})` }

      const contentType = (res.headers.get('content-type') ?? '').toLowerCase()
      const extFromType =
        contentType.includes('image/jpeg') ? '.jpg' :
        contentType.includes('image/png') ? '.png' :
        contentType.includes('image/webp') ? '.webp' :
        contentType.includes('image/gif') ? '.gif' :
        contentType.includes('image/avif') ? '.avif' :
        ''
        const cleanUrl = imageUrl.split('?')[0]
        const extFromUrl = extname(cleanUrl).toLowerCase()
        const allowedExts = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'])
        const chosenExt =
          extFromType ||
          (allowedExts.has(extFromUrl) ? (extFromUrl === '.jpeg' ? '.jpg' : extFromUrl) : '') ||
          '.png'

        const buffer = Buffer.from(await res.arrayBuffer())
        let coverSkipped = false
        const destPath = existingCoverPath ?? join(destDir, `ampcover${chosenExt}`)
        if (!existingCoverPath) {
          await fs.promises.writeFile(destPath, buffer)
        } else {
          coverSkipped = true
        }

        const rawBaseName = basename(cleanUrl)
        const rawNameHasAllowedExt = allowedExts.has(extname(rawBaseName).toLowerCase())
        const sanitizedRawName = rawBaseName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim()
        const preferredSourceName = sanitizedRawName && rawNameHasAllowedExt && !/^ampcover\./i.test(sanitizedRawName)
          ? sanitizedRawName
          : `tone3000${chosenExt}`
        const normalizedSourceName = preferredSourceName.toLowerCase().endsWith('.jpeg')
          ? preferredSourceName.slice(0, -5) + '.jpg'
          : preferredSourceName
        const sourcePath = join(destDir, normalizedSourceName)
        let sourceSkipped = false
        try {
          await fs.promises.access(sourcePath)
          sourceSkipped = true
        } catch {
          await fs.promises.writeFile(sourcePath, buffer)
        }

        return {
          ok: true,
          skipped: coverSkipped,
          destPath: destPath.replace(/\\/g, '/'),
          sourcePath: sourcePath.replace(/\\/g, '/'),
          sourceSkipped,
        }
      } catch (e) {
        return { error: String(e) }
      }
    })

  ipcMain.handle('tone3000:search', async (_event, params: { query?: string; page?: number; pageSize?: number; gears?: string[]; sizes?: string[]; sort?: string; architecture?: string; platform?: string; format?: string }) => {
    const valid = await ensureValidToken()
    if (!valid || !tone3kTokens) return { error: 'Not authenticated' }
    const sp = new URLSearchParams()
    if (params.query) sp.set('query', params.query)
    sp.set('page', String(params.page ?? 1))
    sp.set('page_size', String(params.pageSize ?? 24))
    if (params.sort) sp.set('sort', params.sort)
    if (params.gears?.length) sp.set('gears', params.gears.join('_'))
    if (params.sizes?.length) sp.set('sizes', params.sizes.join('_'))
    if (params.architecture) sp.set('architecture', params.architecture)
    // Prefer the new 'format' param; fall back to 'platform' (still a valid alias per the API).
    if (params.format) sp.set('format', params.format)
    else if (params.platform) sp.set('platform', params.platform)
    try {
      const res = await fetch(`${T3K_BASE}/api/v1/tones/search?${sp}`, { headers: { Authorization: `Bearer ${tone3kTokens.accessToken}`, 'User-Agent': 'NAM-Lab' } })
      if (!res.ok) return { error: `API error ${res.status}` }
      return { ok: true, data: await res.json() }
    } catch (e) { return { error: String(e) } }
  })

  ipcMain.handle('tone3000:usersSearch', async (_event, params: { query: string; page?: number; pageSize?: number; sort?: string }) => {
    const valid = await ensureValidToken()
    if (!valid || !tone3kTokens) return { error: 'Not authenticated' }
    const sp = new URLSearchParams()
    sp.set('query', params.query)
    sp.set('page', String(params.page ?? 1))
    sp.set('page_size', String(params.pageSize ?? 10))
    if (params.sort) sp.set('sort', params.sort)
    try {
      const res = await fetch(`${T3K_BASE}/api/v1/users?${sp}`, { headers: { Authorization: `Bearer ${tone3kTokens.accessToken}`, 'User-Agent': 'NAM-Lab' } })
      if (!res.ok) return { error: `API error ${res.status}` }
      return { ok: true, data: await res.json() }
    } catch (e) { return { error: String(e) } }
  })

  ipcMain.handle('tone3000:created', async (_event, params: { page?: number; pageSize?: number }) => {
      const valid = await ensureValidToken()
      if (!valid || !tone3kTokens) return { error: 'Not authenticated' }
      const sp = new URLSearchParams()
      sp.set('page', String(params.page ?? 1))
      sp.set('page_size', String(params.pageSize ?? 24))
      try {
        const res = await fetch(`${T3K_BASE}/api/v1/tones/created?${sp}`, { headers: { Authorization: `Bearer ${tone3kTokens.accessToken}`, 'User-Agent': 'NAM-Lab' } })
        if (!res.ok) return { error: `API error ${res.status}` }
        return { ok: true, data: await res.json() }
      } catch (e) { return { error: String(e) } }
    })

  ipcMain.handle('tone3000:favorited', async (_event, params: { page?: number; pageSize?: number }) => {
      const valid = await ensureValidToken()
      if (!valid || !tone3kTokens) return { error: 'Not authenticated' }
      const sp = new URLSearchParams()
      sp.set('page', String(params.page ?? 1))
      sp.set('page_size', String(params.pageSize ?? 24))
      try {
        const res = await fetch(`${T3K_BASE}/api/v1/tones/favorited?${sp}`, { headers: { Authorization: `Bearer ${tone3kTokens.accessToken}`, 'User-Agent': 'NAM-Lab' } })
        if (!res.ok) return { error: `API error ${res.status}` }
        return { ok: true, data: await res.json() }
      } catch (e) { return { error: String(e) } }
    })


  // Download any public image URL and save as ampcover.{ext}, replacing existing cover
  ipcMain.handle('cover:downloadFromUrl', async (_event, imageUrl: string, destDir: string) => {
    try {
      const parsed = parseAllowedUrl(imageUrl, ['https:', 'http:'])
      if (!parsed) return { success: false, error: 'Only http/https image URLs are allowed.' }
      const coverPattern = /^ampcover\.(png|jpe?g|webp|gif|avif)$/i
      try {
        const entries = await fs.promises.readdir(destDir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isFile() && coverPattern.test(entry.name)) {
            await fs.promises.unlink(join(destDir, entry.name))
          }
        }
      } catch { /* dir may not exist yet */ }

      const res = await fetch(parsed.toString(), { headers: { 'User-Agent': 'NAM-Lab' } })
      if (!res.ok) return { success: false, error: `Download failed (HTTP ${res.status})` }

      const contentType = (res.headers.get('content-type') ?? '').toLowerCase()
      if (!contentType.startsWith('image/')) {
        return { success: false, error: `URL does not point to an image (got: ${contentType || 'unknown content type'}). Try right-clicking the image in your browser and choosing "Copy image address".` }
      }

      const extFromType =
        contentType.includes('jpeg') ? '.jpg' :
        contentType.includes('png') ? '.png' :
        contentType.includes('webp') ? '.webp' :
        contentType.includes('gif') ? '.gif' :
        contentType.includes('avif') ? '.avif' : ''
      const rawExt = extname(parsed.pathname).toLowerCase()
      const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'])
      const chosenExt = extFromType || (allowed.has(rawExt) ? (rawExt === '.jpeg' ? '.jpg' : rawExt) : '') || '.jpg'

      const buffer = Buffer.from(await res.arrayBuffer())
      const destPath = join(destDir, `ampcover${chosenExt}`)
      await fs.promises.writeFile(destPath, buffer)
      return { success: true, destPath }
    } catch (e: unknown) {
      return { success: false, error: String(e) }
    }
  })

  // Save ampcover from raw base64 bytes (FileReader fallback for drag-drop without .path)
  ipcMain.handle('cover:saveFromBase64', async (_event, base64: string, mimeType: string, destDir: string) => {
    try {
      const coverPattern = /^ampcover\.(png|jpe?g|webp|gif|avif)$/i
      try {
        const entries = await fs.promises.readdir(destDir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isFile() && coverPattern.test(entry.name)) {
            await fs.promises.unlink(join(destDir, entry.name))
          }
        }
      } catch { /* ignore */ }

      const ext =
        mimeType.includes('jpeg') ? '.jpg' :
        mimeType.includes('png') ? '.png' :
        mimeType.includes('webp') ? '.webp' :
        mimeType.includes('gif') ? '.gif' :
        mimeType.includes('avif') ? '.avif' : '.jpg'
      const buffer = Buffer.from(base64, 'base64')
      const destPath = join(destDir, `ampcover${ext}`)
      await fs.promises.writeFile(destPath, buffer)
      return { success: true, destPath }
    } catch (e: unknown) {
      return { success: false, error: String(e) }
    }
  })

  // Open a native image file picker and return the selected path
  ipcMain.handle('cover:openImagePicker', async () => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return null
    const result = await showOpenDialogSafely({
      title: 'Select cover image',
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'] }],
      properties: ['openFile'],
    }, win)
    return result.canceled ? null : result.filePaths[0] ?? null
  })

  // Copy a local file (e.g. dragged from Explorer) and save as ampcover.{ext}
  ipcMain.handle('cover:copyLocalFile', async (_event, srcPath: string, destDir: string) => {
    try {
      const coverPattern = /^ampcover\.(png|jpe?g|webp|gif|avif)$/i
      try {
        const entries = await fs.promises.readdir(destDir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isFile() && coverPattern.test(entry.name)) {
            await fs.promises.unlink(join(destDir, entry.name))
          }
        }
      } catch { /* ignore */ }

      const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'])
      const rawExt = extname(srcPath).toLowerCase()
      if (!allowed.has(rawExt)) return { success: false, error: 'Unsupported image type' }
      const chosenExt = rawExt === '.jpeg' ? '.jpg' : rawExt
      const destPath = join(destDir, `ampcover${chosenExt}`)
      await fs.promises.copyFile(srcPath, destPath)
      return { success: true, destPath }
    } catch (e: unknown) {
      return { success: false, error: String(e) }
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  saveFileCache()
  if (trainerQueueSaveTimer) { clearTimeout(trainerQueueSaveTimer); trainerQueueSaveTimer = null }
  saveTrainerQueue()
  stopCompanionBridgeServer()
  if (folderWatcher) {
    try { folderWatcher.close() } catch { /* ignore */ }
    folderWatcher = null
  }
  closeFolderWatchers()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
