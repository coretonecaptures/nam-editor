import { app, shell, BrowserWindow, ipcMain, dialog, protocol, net, Menu } from 'electron'
import { join, dirname, basename, extname, normalize as normalizePath } from 'path'
import fs from 'fs'
import os from 'os'
import http from 'http'
import crypto from 'crypto'

const isDev = process.env['ELECTRON_RENDERER_URL'] !== undefined

// Compares two semver strings (e.g. "0.5.5" > "0.5.4", "0.5.5" > "0.5.5-rc1")
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
  // Both are RC: compare the numeric suffix (rc2 > rc1)
  if (va.pre !== null && vb.pre !== null) {
    const na = parseInt(va.pre.replace(/\D/g, ''), 10) || 0
    const nb = parseInt(vb.pre.replace(/\D/g, ''), 10) || 0
    return na - nb
  }
  return 0
}

// Module-level reference so IPC handlers can always reach the window
let mainWindow: BrowserWindow | null = null

// Folder watcher for auto-refresh feature
let folderWatcher: import('fs').FSWatcher | null = null
let folderWatchRules: FolderWatchRule[] = []
const folderWatchers = new Map<string, import('fs').FSWatcher>()
const folderWatchInFlight = new Set<string>()
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
}

let folderWatchImports = new Map<string, FolderWatchImportEntry[]>()

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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type TrainerArchitecture = 'standard' | 'complex' | 'lite' | 'feather' | 'nano' | 'revystd' | 'revyhi' | 'revxstd'
type TrainerQueueJobStatus = 'queued' | 'starting' | 'running' | 'success' | 'error' | 'canceled'

interface TrainerStartPayload {
  pythonPath: string
  inputPath: string
  outputPath: string
  trainPath: string
  architecture: TrainerArchitecture
  epochs: number
  latency: number | null
  thresholdEsr: number | null
  savePlot: boolean
  silent: boolean
  ignoreChecks: boolean
}

interface TrainerQueueJob {
  jobId: string
  status: TrainerQueueJobStatus
  pythonPath: string
  inputPath: string
  outputPath: string
  trainPath: string
  architecture: TrainerArchitecture
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
}

let trainerState: TrainerStateSnapshot = { ...TRAINER_IDLE_STATE }
let trainerChild: import('child_process').ChildProcessWithoutNullStreams | null = null
let trainerQueue: TrainerQueueJob[] = []
let trainerPauseAfterCurrent = false

const TRAINER_RUNNER_SOURCE = String.raw`import json
import os
import shutil
import sys
import traceback
from pathlib import Path

from nam.train.core import train


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
    if not root.exists():
        return str(root / f"{model_name}.nam")

    direct = root / f"{model_name}.nam"
    if direct.exists():
        return str(direct)

    candidates = list(root.rglob("*.nam"))
    if not candidates:
        return str(direct)

    best = [path for path in candidates if "checkpoint_best" in path.stem.lower()]
    matching = [path for path in candidates if model_name.lower() in path.stem.lower()]
    pool = best if best else matching if matching else candidates
    newest = max(pool, key=lambda path: path.stat().st_mtime)
    return str(newest)


def _promote_output_model_path(train_path, model_name, discovered_path):
    target = Path(train_path) / f"{model_name}.nam"
    source = Path(discovered_path)
    if not source.exists():
        return str(target)
    if source.resolve() == target.resolve():
        return str(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    return str(target)


def main():
    if len(sys.argv) < 2:
        raise RuntimeError("Expected payload JSON path")

    payload_path = sys.argv[1]
    with open(payload_path, "r", encoding="utf-8") as handle:
        payload = json.load(handle)

    result = train(
        input_path=payload["inputPath"],
        output_path=payload["outputPath"],
        train_path=payload["trainPath"],
        epochs=payload["epochs"],
        latency=payload.get("latency"),
        threshold_esr=payload.get("thresholdEsr"),
        model_type="WaveNet",
        architecture=payload["architecture"],
        batch_size=16,
        ny=8192,
        lr=0.004,
        lr_decay=0.002,
        save_plot=payload.get("savePlot", True),
        silent=payload.get("silent", False),
        modelname=payload["modelName"],
        ignore_checks=payload.get("ignoreChecks", False),
        fit_mrstft=True,
        user_metadata=None,
    )

    discovered_output = _find_output_model_path(payload["trainPath"], payload["modelName"])
    promoted_output = _promote_output_model_path(payload["trainPath"], payload["modelName"], discovered_output)

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

function emitTrainerState(): void {
  if (trainerState.activeJobId) {
    updateTrainerJob(trainerState.activeJobId, {
      status: trainerState.status === 'starting' ? 'starting' : trainerState.status === 'running' ? 'running' : trainerState.status === 'success' ? 'success' : trainerState.status === 'error' ? 'error' : trainerState.status === 'canceled' ? 'canceled' : 'queued',
      startedAt: trainerState.startedAt,
      finishedAt: trainerState.finishedAt,
      outputModelPath: trainerState.outputModelPath,
      checkpointModelPath: trainerState.checkpointModelPath,
      error: trainerState.error,
      validationEsr: trainerState.validationEsr,
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
  }
  mainWindow?.webContents.send('trainer:update', trainerState)
}

function appendTrainerLog(line: string): void {
  const trimmed = line.replace(/\r/g, '').trimEnd()
  if (!trimmed) return
  trainerState = {
    ...trainerState,
    logs: [...trainerState.logs, trimmed].slice(-600),
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
    }
    emitTrainerState()
    return true
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

  if (/^Validating data/i.test(clean) || /^V[23] checks/i.test(clean) || /^Checking blips/i.test(clean) || /^Replicate ESR/i.test(clean) || /^-Checks passed/i.test(clean) || /^Failed checks!/i.test(clean)) {
    trainerState = {
      ...trainerState,
      progressPhase: 'Validation / checks',
      progressLatestLine: clean,
    }
    emitTrainerState()
    return false
  }

  if (/^Delay /i.test(clean) || /^After aplying safety factor/i.test(clean) || /^Plotting the latency/i.test(clean) || /^Cannot automatically analyze the latency/i.test(clean)) {
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
      trainerState = {
        ...trainerState,
        validationEsr: typeof parsed.validationEsr === 'number' ? parsed.validationEsr : trainerState.validationEsr,
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

function deriveTrainerModelName(outputPath: string, architecture: TrainerArchitecture): string {
  const _unused = architecture
  const base = basename(outputPath, extname(outputPath)).trim() || 'model'
  return base
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
    default:
      return architecture
  }
}

function createTrainerJob(payload: TrainerStartPayload): TrainerQueueJob {
  const modelName = deriveTrainerModelName(payload.outputPath, payload.architecture)
  const architectureFolder = getTrainerArchitectureFolderName(payload.architecture)
  const architectureTrainPath = join(payload.trainPath.trim(), architectureFolder)
  return {
    jobId: crypto.randomUUID(),
    status: 'queued',
    pythonPath: payload.pythonPath.trim(),
    inputPath: payload.inputPath.trim(),
    outputPath: payload.outputPath.trim(),
    trainPath: architectureTrainPath,
    architecture: payload.architecture,
    epochs: payload.epochs,
    latency: payload.latency,
    thresholdEsr: payload.thresholdEsr,
    savePlot: payload.savePlot,
    silent: payload.silent,
    ignoreChecks: payload.ignoreChecks,
    modelName,
    outputModelPath: join(architectureTrainPath, `${modelName}.nam`),
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
  }
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
    finishedAt: null,
    error: '',
    validationEsr: null,
    progressPercent: null,
    progressEpochCurrent: null,
    progressEpochTotal: job.epochs,
    progressBatchCurrent: null,
    progressBatchTotal: null,
    progressRate: null,
    progressLatestLine: '',
  }
}

function nextQueuedTrainerJob(): TrainerQueueJob | null {
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
  return true
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

function getFolderWatchImports(rule: FolderWatchRule): FolderWatchImportEntry[] {
  return folderWatchImports.get(makeFolderWatchKey(rule.sourceFolder, rule.destFolder)) ?? []
}

function hasImportedWatchedFile(rule: FolderWatchRule, sourcePath: string, sizeBytes: number, mtimeMs: number): boolean {
  return getFolderWatchImports(rule).some((entry) =>
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

async function copyWatchedFile(rule: FolderWatchRule, filePath: string): Promise<void> {
  const normalizedSource = normalizePath(filePath)
  const key = `${rule.destFolder}::${normalizedSource}`
  if (folderWatchInFlight.has(key)) return
  folderWatchInFlight.add(key)
  try {
    const stable = await waitForStableFile(normalizedSource)
    if (!stable) {
      mainWindow?.webContents.send('folderWatch:error', {
        sourceFolder: rule.sourceFolder.replace(/\\/g, '/'),
        destFolder: rule.destFolder.replace(/\\/g, '/'),
        message: `Timed out waiting for ${basename(normalizedSource)} to finish writing`
      })
      return
    }
    const stat = await fs.promises.stat(normalizedSource)
    if (!stat.isFile()) return
    if (hasImportedWatchedFile(rule, normalizedSource, stat.size, stat.mtimeMs)) return
    const fileName = basename(normalizedSource)
    const destPath = join(rule.destFolder, fileName)
    if (fs.existsSync(destPath)) return
    suppressWatcher()
    await fs.promises.copyFile(normalizedSource, destPath)
    const importEntry: FolderWatchImportEntry = {
      sourcePath: normalizedSource.replace(/\\/g, '/'),
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
      importedAt: new Date().toISOString(),
    }
    rememberImportedWatchedFile(rule, importEntry)
    mainWindow?.webContents.send('folderWatch:copied', {
      sourcePath: normalizedSource.replace(/\\/g, '/'),
      destPath: destPath.replace(/\\/g, '/'),
      sourceFolder: rule.sourceFolder.replace(/\\/g, '/'),
      destFolder: rule.destFolder.replace(/\\/g, '/'),
      importEntry,
    })
  } catch (err) {
    mainWindow?.webContents.send('folderWatch:error', {
      sourceFolder: rule.sourceFolder.replace(/\\/g, '/'),
      destFolder: rule.destFolder.replace(/\\/g, '/'),
      message: String(err)
    })
  } finally {
    folderWatchInFlight.delete(key)
  }
}

async function syncExistingWatchedFiles(rule: FolderWatchRule): Promise<void> {
  try {
    const entries = await fs.promises.readdir(rule.sourceFolder, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.nam')) continue
      await copyWatchedFile(rule, join(rule.sourceFolder, entry.name))
    }
  } catch (err) {
    mainWindow?.webContents.send('folderWatch:error', {
      sourceFolder: rule.sourceFolder.replace(/\\/g, '/'),
      destFolder: rule.destFolder.replace(/\\/g, '/'),
      message: `Initial sync failed: ${String(err)}`
    })
  }
}

function resetFolderWatchRules(rules: FolderWatchRule[]): void {
  folderWatchRules = rules
  closeFolderWatchers()

  for (const rule of folderWatchRules) {
    if (!rule.enabled) continue
    const sourceFolder = normalizePath(rule.sourceFolder)
    const destFolder = normalizePath(rule.destFolder)
    if (!sourceFolder || !destFolder) continue
    if (sourceFolder.toLowerCase() === destFolder.toLowerCase()) continue
    if (isNestedPath(sourceFolder, destFolder) || isNestedPath(destFolder, sourceFolder)) {
      log(`folderWatch skipped nested rule source="${sourceFolder}" dest="${destFolder}"`)
      continue
    }
    try {
      const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>()
      const watcher = fs.watch(sourceFolder, { recursive: false }, (_eventType, filename) => {
        const nextFilename = String(filename ?? '').trim()
        const lowerName = nextFilename.toLowerCase()
        if (!lowerName.endsWith('.nam') || lowerName.endsWith('.json')) return
        const existingTimer = pendingTimers.get(lowerName)
        if (existingTimer) clearTimeout(existingTimer)
        const timer = setTimeout(() => {
          pendingTimers.delete(lowerName)
          const fullPath = join(sourceFolder, nextFilename)
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
  mainWindow.on('close', saveWinState)

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Prevent Electron from navigating to dropped file URLs - without this,
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

function liftUiMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  const nb = getPreferredNamBot(meta)
  if (nb?.trained_epochs != null) meta.nb_trained_epochs = nb.trained_epochs
  if (nb?.preset_name != null) meta.nb_preset_name = nb.preset_name
  const nl = meta.nam_lab as Record<string, unknown> | undefined
  if (nl) {
    if (meta.nb_trained_epochs == null && nl.trained_epochs != null) meta.nb_trained_epochs = nl.trained_epochs
    if (meta.nb_preset_name == null && nl.preset_name != null) meta.nb_preset_name = nl.preset_name
    const nlKeys = ['mics','cabinet','cabinet_config','amp_channel','boost_pedal','amp_settings','pedal_settings','amp_switches','comments','rating'] as const
    for (const k of nlKeys) {
      if (nl[k] != null) meta[`nl_${k}`] = nl[k]
    }
  }
  return meta
}

function persistTrainerMetadata(content: string, epochs: number, architecture: string): string {
  let patched = content
  patched = patchTopLevelNamBotField(patched, 'trained_epochs', epochs)
  patched = patchTopLevelNamBotField(patched, 'preset_name', architecture)
  patched = patchNamLabField(patched, 'trained_epochs', epochs)
  patched = patchNamLabField(patched, 'preset_name', architecture)
  return patched
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

  // No nam_lab block â€” inject it directly into the metadata block
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

  // No training block at all â€” inject training.nam_bot into the metadata block
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

// Patch a field inside metadata.nam_bot, creating the structure if needed.
function patchTopLevelNamBotField(content: string, field: string, value: unknown): string {
  const newVal = serializeJsonValue(value)
  const fieldRe = new RegExp(
    `("${escapeRe(field)}")(\\s*:\\s*)(null|"(?:[^"\\\\]|\\\\.)*"|-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)`
  )

  const namBotRe = /"nam_bot"\s*:\s*\{/
  const metaKeyMatch = /"metadata"\s*:\s*\{/.exec(content)
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

async function loadTone3kTokens(): Promise<void> {
  try {
    const p = join(app.getPath('userData'), 'tone3000-tokens.json')
    tone3kTokens = JSON.parse(await fs.promises.readFile(p, 'utf-8')) as Tone3kTokens
  } catch { /* no saved tokens */ }
}

async function saveTone3kTokens(): Promise<void> {
  if (!tone3kTokens) return
  try {
    const p = join(app.getPath('userData'), 'tone3000-tokens.json')
    await fs.promises.writeFile(p, JSON.stringify(tone3kTokens), 'utf-8')
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
  ipcMain.on('settings:save', (_event, json: string) => {
    try {
      fs.writeFileSync(join(app.getPath('userData'), 'settings.json'), json, 'utf-8')
    } catch (err) {
      log(`settings:save error: ${String(err)}`)
    }
  })

  // IPC: Open file dialog
  ipcMain.handle('dialog:openFiles', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'NAM Files', extensions: ['nam'] }]
    })
    return result.filePaths
  })

  // IPC: Open image file picker (PNG/JPG/SVG/WEBP) for logo upload
  ipcMain.handle('dialog:openImageFile', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp'] }]
    })
    return result.filePaths[0] ?? null
  })

  // IPC: Open import spreadsheet file picker (.xlsx or .csv)
  ipcMain.handle('dialog:openImportFile', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Spreadsheet', extensions: ['xlsx', 'csv'] }]
    })
    return result.filePaths[0] ?? null
  })

  ipcMain.handle('dialog:openAudioFile', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Audio', extensions: ['wav', 'wave', 'aif', 'aiff'] },
        { name: 'All Files', extensions: ['*'] },
      ]
    })
    return result.filePaths[0] ?? null
  })

  ipcMain.handle('dialog:openAudioFiles', async () => {
    const result = await dialog.showOpenDialog({
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
    const result = await dialog.showOpenDialog({
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
          ? liftUiMetadata({ ...(cachedData.metadata as Record<string, unknown>) })
          : cachedData.metadata
        return { success: true, ...cachedData, metadata: cachedMeta, filePath, mtimeMs: stat.mtimeMs, birthtimeMs: stat.birthtimeMs, sizeBytes: stat.size }
      }
      const content = await fs.promises.readFile(filePath, 'utf-8')
      const data = JSON.parse(content)
      const meta = liftUiMetadata(data.metadata ?? {})
      const result = {
        success: true,
        filePath,
        version: data.version ?? '?',
        metadata: meta,
        architecture: data.architecture ?? '?',
        config: data.config ?? null,
        mtimeMs: stat.mtimeMs,
        birthtimeMs: stat.birthtimeMs,
        sizeBytes: stat.size,
      }
      // Update cache entry â€” save lazily (written on app quit or folder scan)
      cache[filePath] = { mtimeMs: stat.mtimeMs, size: stat.size, data: { version: result.version, metadata: meta, architecture: result.architecture, config: result.config } }
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
    'tone_type', 'input_level_dbu', 'output_level_dbu'
  ] as const
  ipcMain.handle('file:writeMetadata', async (_event, filePath: string, metadata: unknown) => {
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      const data = JSON.parse(content)
      const orig = data.metadata ?? {}
      const incoming = metadata as Record<string, unknown>

      // Numeric metadata fields â€” must always be written as JSON numbers, never strings
      const NUMERIC_META_FIELDS = new Set(['input_level_dbu', 'output_level_dbu'])

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
      const currentNamBot = getPreferredNamBot(orig)
      const hasTopLevelNamBot = !!(orig.nam_bot && typeof orig.nam_bot === 'object')
      const hasLegacyNamBot = !!(orig.training && typeof orig.training === 'object' && (orig.training as Record<string, unknown>).nam_bot)
      const origEpochs = currentNamBot?.trained_epochs ?? null
      if (Object.prototype.hasOwnProperty.call(incoming, 'nb_trained_epochs')) {
        const newEpochs = incoming.nb_trained_epochs != null ? Number(incoming.nb_trained_epochs) : null
        if (newEpochs !== origEpochs) {
          if (hasTopLevelNamBot || !hasLegacyNamBot) patched = patchTopLevelNamBotField(patched, 'trained_epochs', newEpochs)
          else patched = patchLegacyNamBotField(patched, 'trained_epochs', newEpochs)
        }
      }

      // Handle NAM Lab extended fields â€” stored at metadata.nam_lab.*
      const origNl = (orig.nam_lab ?? {}) as Record<string, unknown>
      const nlKeys = ['mics','cabinet','cabinet_config','amp_channel','boost_pedal','amp_settings','pedal_settings','amp_switches','comments','rating'] as const
      for (const k of nlKeys) {
        const rendererKey = `nl_${k}`
        if (!Object.prototype.hasOwnProperty.call(incoming, rendererKey)) continue
        const origVal = origNl[k] ?? null
        const newVal = incoming[rendererKey] != null ? incoming[rendererKey] : null
        if (origVal !== newVal || (origVal == null && newVal != null)) {
          patched = patchNamLabField(patched, k, newVal)
        }
      }

      // Validate output is well-formed JSON before touching disk
      try { JSON.parse(patched) } catch (ve) {
        return { success: false, error: `Patch produced invalid JSON â€” file not written. ${String(ve)}` }
      }
      suppressWatcher()
      fs.writeFileSync(filePath, patched, 'utf-8')
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
          const meta = liftUiMetadata(data.metadata ?? {})
          return { success: true, filePath, version: data.version ?? '?', metadata: meta, architecture: data.architecture ?? '?', config: data.config ?? null }
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
          mainWindow?.webContents.send('folder:changed')
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
              }))
              .filter((entry) => entry.sourcePath && entry.sizeBytes >= 0 && entry.mtimeMs > 0)
          : []
      )
    }
    folderWatchImports = nextImports
    resetFolderWatchRules(Array.isArray(payload?.rules) ? payload.rules : [])
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
    shell.openExternal(url)
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
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select Neural Amp Modeler standalone',
      properties: ['openFile'],
      filters
    })
    return result.canceled ? null : result.filePaths[0]
  })

  async function startTrainerJob(job: TrainerQueueJob): Promise<void> {
    const pythonPath = job.pythonPath
    const inputPath = job.inputPath
    const outputPath = job.outputPath
    const trainPath = job.trainPath
    const runId = job.jobId

    updateTrainerJob(job.jobId, {
      status: 'starting',
      attempts: job.attempts + 1,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: '',
      validationEsr: null,
      outputModelPath: join(trainPath, `${job.modelName}.nam`),
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
      outputModelPath: join(trainPath, `${job.modelName}.nam`),
      checkpointModelPath: '',
      savePlot: job.savePlot,
      silent: job.silent,
      ignoreChecks: job.ignoreChecks,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      logs: [],
      error: '',
      validationEsr: null,
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
    await fs.promises.mkdir(trainPath, { recursive: true })

    const runnerPath = await ensureTrainerRunnerScript()
    const payloadDir = join(app.getPath('userData'), 'trainer')
    await fs.promises.mkdir(payloadDir, { recursive: true })
    const payloadPath = join(payloadDir, `run-${runId}.json`)
    const runnerPayload = {
      inputPath,
      outputPath,
      trainPath,
      architecture: job.architecture,
      epochs: job.epochs,
      latency: job.latency,
      thresholdEsr: job.thresholdEsr,
      savePlot: job.savePlot,
      silent: job.silent,
      ignoreChecks: job.ignoreChecks,
      modelName: job.modelName,
    }
    await fs.promises.writeFile(payloadPath, JSON.stringify(runnerPayload, null, 2), 'utf-8')

    const { spawn } = await import('child_process')
    trainerChild = spawn(pythonPath, ['-u', runnerPath, payloadPath], {
      cwd: trainPath,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    trainerState = { ...trainerState, status: 'running', progressPhase: 'Launching trainer' }
    emitTrainerState()

    let stdoutRemainder = ''
    let stderrRemainder = ''

    trainerChild.stdout.on('data', (chunk: Buffer) => {
      stdoutRemainder = consumeTrainerChunk(stdoutRemainder, chunk)
    })

    trainerChild.stderr.on('data', (chunk: Buffer) => {
      stderrRemainder = consumeTrainerChunk(stderrRemainder, chunk)
    })

    trainerChild.once('error', async (error) => {
      trainerState = {
        ...trainerState,
        status: 'error',
        finishedAt: new Date().toISOString(),
        error: String(error),
      }
      trainerChild = null
      emitTrainerState()
      if (!trainerPauseAfterCurrent) await pumpTrainerQueue()
    })

    trainerChild.once('close', async (code, signal) => {
      if (stdoutRemainder.trim()) processTrainerOutputLine(stdoutRemainder.trim())
      if (stderrRemainder.trim()) processTrainerOutputLine(stderrRemainder.trim())
      const wasCanceled = trainerState.status === 'canceled'
      const finalStatus: TrainerStateSnapshot['status'] = wasCanceled ? 'canceled' : code === 0 ? 'success' : 'error'
      let finalError = trainerState.error
      if (!wasCanceled && code !== 0 && !finalError) {
        finalError = signal ? `Training process stopped by signal ${signal}` : `Training process exited with code ${code}`
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
      try { await fs.promises.unlink(payloadPath) } catch { /* ignore */ }

      if (finalStatus === 'success' && trainerState.outputModelPath) {
        try {
          const content = await fs.promises.readFile(trainerState.outputModelPath, 'utf-8')
          const patched = persistTrainerMetadata(content, job.epochs, job.architecture)
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

      emitTrainerState()
      if (!trainerPauseAfterCurrent) {
        await pumpTrainerQueue()
      } else {
        trainerState = { ...trainerState, activeJobId: null, runId: null }
        emitTrainerState()
      }
    })
  }

  async function pumpTrainerQueue(): Promise<void> {
    if (trainerChild || trainerState.status === 'starting' || trainerState.status === 'running') return
    const nextJob = nextQueuedTrainerJob()
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
      updateTrainerJob(nextJob.jobId, {
        status: 'error',
        finishedAt: new Date().toISOString(),
        error: String(error),
      })
      trainerState = {
        ...TRAINER_IDLE_STATE,
        status: 'error',
        error: String(error),
        finishedAt: new Date().toISOString(),
        activeJobId: null,
        queue: trainerQueue,
        pauseAfterCurrent: trainerPauseAfterCurrent,
      }
      emitTrainerState()
      if (!trainerPauseAfterCurrent) {
        await pumpTrainerQueue()
      }
    }
  }

  ipcMain.handle('trainer:getState', async () => trainerState)

  ipcMain.handle('trainer:cancel', async () => {
    if (!trainerChild || trainerState.status !== 'running' && trainerState.status !== 'starting') {
      return { success: false, error: 'No training run is currently active.' }
    }
    try {
      const canceledAt = new Date().toISOString()
      trainerQueue = trainerQueue.map((job) => (
        job.status === 'queued'
          ? {
              ...job,
              status: 'canceled',
              finishedAt: canceledAt,
              error: 'Canceled before start by emergency stop.',
            }
          : job
      ))
      trainerPauseAfterCurrent = false
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
    trainerQueue.push(createTrainerJob({ ...payload, pythonPath, inputPath, outputPath, trainPath }))
    emitTrainerState()
    await pumpTrainerQueue()
    return { success: true }
  })

  ipcMain.handle('trainer:enqueue', async (_event, payloads: TrainerStartPayload[]) => {
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
    trainerQueue.push(...validPayloads.map((payload) => createTrainerJob(payload)))
    emitTrainerState()
    await pumpTrainerQueue()
    return { success: true, queued: validPayloads.length }
  })

  ipcMain.handle('trainer:setPauseAfterCurrent', async (_event, pause: boolean) => {
    trainerPauseAfterCurrent = !!pause
    emitTrainerState()
    if (!trainerPauseAfterCurrent) {
      await pumpTrainerQueue()
    }
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

  ipcMain.handle('trainer:clearFinished', async () => {
    trainerQueue = trainerQueue.filter((job) => !['success', 'error', 'canceled'].includes(job.status))
    emitTrainerState()
    return { success: true }
  })

  ipcMain.handle('trainer:removeQueued', async () => {
    trainerQueue = trainerQueue.filter((job) => job.status !== 'queued')
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
      await fs.promises.writeFile(tmpFile, html, 'utf-8')
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
    try { await fs.promises.unlink(join(app.getPath('userData'), 'tone3000-tokens.json')) } catch { /* ok */ }
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

  ipcMain.handle('tone3000:getModels', async (_event, toneId: number) => {
    const valid = await ensureValidToken()
    if (!valid || !tone3kTokens) return { error: 'Not authenticated' }
    try {
      const all: unknown[] = []
      let page = 1
      let total = Infinity
      while (all.length < total && all.length < 500) {
        const res = await fetch(`${T3K_BASE}/api/v1/models?tone_id=${toneId}&page=${page}&page_size=100`, { headers: { Authorization: `Bearer ${tone3kTokens.accessToken}`, 'User-Agent': 'NAM-Lab' } })
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

  ipcMain.handle('tone3000:search', async (_event, params: { query?: string; page?: number; pageSize?: number; gears?: string[]; sizes?: string[]; sort?: string }) => {
    const valid = await ensureValidToken()
    if (!valid || !tone3kTokens) return { error: 'Not authenticated' }
    const sp = new URLSearchParams()
    if (params.query) sp.set('query', params.query)
    sp.set('page', String(params.page ?? 1))
    sp.set('page_size', String(params.pageSize ?? 24))
    if (params.sort) sp.set('sort', params.sort)
    if (params.gears?.length) sp.set('gears', params.gears.join('_'))
    if (params.sizes?.length) sp.set('sizes', params.sizes.join('_'))
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  saveFileCache()
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
