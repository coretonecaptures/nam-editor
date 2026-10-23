// Regression checks for docs/training-audit.md: each asserts the FIXED behaviour.
// Extracts actual functions/IPC handlers with the TypeScript AST; never boots Electron,
// runs Python training, opens user files, or deletes real artifacts.
// Run: node scripts/audit-training.cjs   (runner checks: python scripts/audit-training-runner.py)
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const ts = require('typescript')
const source = fs.readFileSync(path.join(__dirname, '../src/main/index.ts'), 'utf8')
const ast = ts.createSourceFile('index.ts', source, ts.ScriptTarget.Latest, true)
function functionText(name) {
  const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)
  assert(node, `missing function ${name}`)
  return node.getText(ast)
}
function handlerText(channel) {
  let found
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'ipcMain.handle'
      && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === channel) found = node.arguments[1]
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert(found, `missing handler ${channel}`)
  return found.getText(ast)
}
function evaluate(ctx, code) {
  return vm.runInContext(ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText, ctx)
}
const defaults = {
  trainerQueue: [], trainerHistory: [], trainerSkipped: [], trainerState: {},
  trainerPauseAfterCurrent: true, trainerPostProcessing: false, trainerChild: null,
  trainerEmergencyRequeue: false, trainerEmergencyRequeueJobId: null,
  trainerStickyPreferenceCleared: false, trainerLastCallbackEsrEpoch: 0,
  normalizePath: p => (p ?? '').replace(/\\/g, '/').toLowerCase(),
  log() {}, emitTrainerState() {}, emitTrainerHistory() {}, saveTrainerQueue() {},
  enrichTrainerCheckFailure(error) { return error }, deriveTrainerFailureFromLogs() { return '' },
  saveTrainerHistory() {}, saveTrainerSkipped() {}, suppressWatcher() {},
  stopCheckpointPoll() {}, consumeTrainerChunk() { return '' }, processTrainerOutputLine() {},
  loadAlwaysIgnoreTrainingChecksSetting() { return false },
  async recordTrainerFailureSnapshot() {}, async pruneTrainerArtifacts() {},
  async pumpTrainerQueue() {},
  TRAINER_QUEUE_PERSIST_CAP: 2000, trainerPreflightAbort: null,
  crypto: { randomUUID: () => 'diagnostic-id' },
  ...path,
}
function context(extra = {}, functions = []) {
  const ctx = vm.createContext({ ...defaults, trainerQueue: [], trainerHistory: [], trainerSkipped: [],
    trainerState: {}, ...extra })
  evaluate(ctx, `class TrainerPreflightAborted extends Error { constructor(mode) { super(mode); this.mode = mode; this.name = 'TrainerPreflightAborted' } }; globalThis.TrainerPreflightAborted = TrainerPreflightAborted`)
  for (const name of functions) evaluate(ctx, functionText(name))
  return ctx
}
function job(extra = {}) {
  return {
    jobId: 'job-a', submissionId: 'batch-a', status: 'queued', pythonPath: '/fake/python',
    inputPath: '/fake/input.wav', outputPath: '/fake/return.wav', trainPath: '/fake/workspace',
    workspacePath: '/fake/workspace', finalModelRoot: '/fake/models', modelName: 'Capture',
    architecture: 'standard', namMode: 'a1', appendModelArchitectureFolder: false,
    attempts: 0, epochs: 10, sourceMode: 'manual-direct', latency: null,
    sourcePostProcess: 'keep', ...extra
  }
}
function trainingContext() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
  child.kill = () => true
  const unlinked = []
  const histories = []
  const ctx = context({
    app: { getPath: () => '/fake/userData' }, process: { env: {} },
    fs: { existsSync: () => true, promises: {
      async access() {}, async stat() { return { size: 42, mtimeMs: 100 } },
      async mkdir() {}, async writeFile() {}, async unlink(p) { unlinked.push(p) }
    } },
    require: id => { assert.equal(id, 'child_process'); return { spawn: () => child } },
    async ensureTrainerRunnerScript() { return '/fake/runner.py' },
    setInterval() { return 1 }, clearInterval() {},
    appendTrainerHistory(entry) { histories.push(entry) },
    pruneFinishedBatchesFromQueue() { return false },
    getTrainerArchitectureFolderName(a) { return a },
    trainerQueue: [job()], trainerCheckpointPollTimer: null,
  }, ['updateTrainerJob', 'startTrainerJob', 'getActiveTrainerJob', 'isPathInside', 'namCaptureRecipeOf'])
  return { ctx, child, unlinked, histories }
}
async function main() {
  {
    const q = Array.from({ length: 2001 }, (_, i) => job({ jobId: `j${i}` }))
    q.push(job({ jobId: 'done', status: 'success' }))
    const ctx = context({ trainerQueue: q }, ['isTrainerQueueTerminalStatus', 'getPersistableTrainerQueueJobs'])
    const saved = ctx.getPersistableTrainerQueueJobs()
    assert.equal(saved.length, 2001); assert.equal(saved[0].jobId, 'j0')
    assert(!saved.some((j) => j.jobId === 'done'))
    console.log('OK #3: all 2001 pending jobs persisted; the terminal row made room')
  }
  {
    const { ctx, child, unlinked, histories } = trainingContext()
    await ctx.startTrainerJob(ctx.trainerQueue[0])
    ctx.trainerState.status = 'canceled'
    child.emit('close', 1, null)
    await new Promise((r) => setTimeout(r, 20))
    assert(!unlinked.some(p => p.split(String.fromCharCode(92)).join('/') === '/fake/models/Capture.nam'))
    assert.equal(histories[0].attempts, 1)
    console.log('OK #1/#10: cancel does not touch the final-destination model; history attempts=1')
  }
  {
    const { ctx, child, histories } = trainingContext()
    ctx.trainerPauseAfterCurrent = false; ctx.setTimeout = setTimeout; ctx.clearTimeout = clearTimeout
    let pumped = 0
    ctx.pumpTrainerQueue = async () => { pumped++ }
    await ctx.startTrainerJob(ctx.trainerQueue[0])
    child.emit('error', new Error('spawn failed'))
    assert.equal(pumped, 0, 'error alone must not advance the queue')
    child.emit('close', -2, null)
    child.emit('close', -2, null)
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(pumped, 1); assert.equal(histories.length, 1)
    assert.equal(histories[0].status, 'error')
    console.log('OK #2: spawn error + close finalize exactly once, one history row, one pump')
  }
  {
    const rendererSource = fs.readFileSync(path.join(__dirname, '../src/renderer/src/components/TrainingPanel.tsx'), 'utf8')
    const rendererAst = ts.createSourceFile('TrainingPanel.tsx', rendererSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let retryFunction
    const visit = n => {
      if (ts.isVariableDeclaration(n) && n.name.getText(rendererAst) === 'handleRetryHistoryBatch') retryFunction = n.initializer
      ts.forEachChild(n, visit)
    }
    visit(rendererAst)
    let captured = null; let namCall = null; let queuedCount = 1; let marked = 0; let cleared = 0
    const ctx = context({
      settings: { namPythonPath: '/fake/python', namTrainingInputWav: '/fake/GLOBAL-DI.wav' },
      normalizeWavOverride: 'global', normalizeWavTargetDb: '-5',
      resolveNormalize: () => ({ normalizeWav: true, normalizeWavTargetDb: -5 }),
      makeSubmissionId: () => 'retry', deriveNamMode: () => 'a1', lookupProfileConfig: () => null,
      setQueueActionError() {}, setHistoryContextMenu() {},
      window: { api: {
        async enqueueTrainerRuns(payloads) { captured = payloads; return { success: true, queued: queuedCount } },
        async retryNamCaptureHistory(ids) { namCall = ids; return { success: true, queued: 1, acceptedIds: ids } },
        markHistoryRetried() { marked++ }, clearSupersededQueueRows() { cleared++ }
      } }
    })
    evaluate(ctx, `globalThis.retryBatch = ${retryFunction.getText(rendererAst)}`)
    await ctx.retryBatch([{ historyId: 'h1', sourceMode: 'nam-capture-import', sourcePath: '/fake/Capture.wav',
      architecture: 'standard', epochs: 10, profileId: null, finalModelName: 'My Capture' }], 'retry')
    assert.equal(captured, null); assert.deepEqual([...namCall], ['h1'])
    console.log('OK #4 (renderer): IR Lab rows go to the main-process recipe retry, never the global-DI builder')
    queuedCount = 0
    await ctx.retryBatch([{ historyId: 'h2', sourcePath: '/fake/Capture.wav', architecture: 'standard', epochs: 10 }], 'retry')
    assert.equal(marked, 0); assert.equal(cleared, 0)
    console.log('OK #15: zero-enqueued retry marks/clears nothing')
  }
  {
    const ctx = context({}, ['namCaptureRecipeOf'])
    const r = ctx.namCaptureRecipeOf(job({ sourceMode: 'nam-capture-import', inputPath: '/cap/excitation.wav', namCaptureId: 'c1' }))
    assert.equal(r.excitationPath, '/cap/excitation.wav'); assert.equal(r.captureId, 'c1')
    assert.equal(ctx.namCaptureRecipeOf(job()), undefined)
    console.log('OK #4 (main): history recipe stores the capture DI + provenance')
  }

  {
    let preflightResolve
    const { ctx } = trainingContext()
    ctx.fs.promises.access = () => new Promise((r) => { preflightResolve = r })
    evaluate(ctx, `globalThis.cancel = ${handlerText('trainer:cancel')}`)
    evaluate(ctx, functionText('handleTrainerPreflightAbort'))
    evaluate(ctx, functionText('resetTrainerJobForQueue'))
    ctx.TRAINER_IDLE_STATE = {}; ctx.persistTrainerQueueThrottled = () => {}; ctx.appendTrainerCanceledHistory = () => {}
    const running = ctx.startTrainerJob(ctx.trainerQueue[0]).catch((e) => e)
    await new Promise((r) => setTimeout(r, 5))
    assert.equal((await ctx.cancel()).success, true)
    preflightResolve()
    const err = await running
    assert.equal(err && err.name, 'TrainerPreflightAborted')
    console.log('OK #5: Emergency Stop during preflight is accepted and aborts before spawn')
  }
  {
    const ctx = context({ trainerSkipped: [{ profileId: 'p', sourcePath: '/fake/return.wav',
      architecture: 'standard', sourceMtimeMs: null, sourceSizeBytes: null }] }, ['trainerHistoryAlreadyHasSource'])
    assert.equal(ctx.trainerHistoryAlreadyHasSource('p', '/fake/return.wav', 'standard', 100, 42), true)
    console.log('OK #7: fingerprint-less manual skip now blocks re-enqueue')
  }
  {
    const timers = new Map(); let serial = 0; let stats = 0
    const ctx = context({
      trainingWatcherPendingTimers: new Map(), trainingWatcherPendingCounts: new Map(),
      setTimeout(fn) { timers.set(++serial, fn); return serial },
      clearTimeout(id) { timers.delete(id) },
      fs: { existsSync: () => true }, async wait() {},
      async statTrainingSource() { return { sizeBytes: ++stats, mtimeMs: stats } }
    }, ['makeTrainingWatcherTimerKey', 'clearTrainingWatcherTimer', 'scheduleTrainingWatcherFile'])
    ctx.scheduleTrainingWatcherFile({ id: 'p' }, '/fake/return.wav')
    const first = [...timers.values()][0]; timers.clear()
    await first()
    assert.equal(ctx.trainingWatcherPendingTimers.size, 1)
    assert.equal(ctx.trainingWatcherPendingCounts.get('p'), 1)
    console.log('OK #6: unstable file keeps its retry timer; pending count stays 1')
  }
  {
    const ctx = context({ trainerQueue: [job(), job({ jobId: 'job-b', status: 'staged' })] })
    const hist = []; ctx.appendTrainerCanceledHistory = (j) => hist.push(j.jobId)
    evaluate(ctx, `globalThis.cancelBatch = ${handlerText('trainer:cancelBatch')}`)
    await ctx.cancelBatch(null, 'batch-a')
    assert.deepEqual(hist.sort(), ['job-a', 'job-b'])
    console.log('OK #9: canceled queued/staged jobs get history rows')
  }
  {
    const ctx = context({ trainerQueue: [job({ status: 'error' })] }, ['isTrainerQueueTerminalStatus'])
    evaluate(ctx, `globalThis.clearFinished = ${handlerText('trainer:clearFinished')}`)
    const r = await ctx.clearFinished()
    assert.equal(ctx.trainerQueue.length, 0); assert.equal(r.removed, 1)
    console.log('OK #11: Clear finished removes a fully failed batch')
  }
  {
    let queued = false
    const ctx = context({
      trainerConfiguredPythonPath: '/fake/python', trainerConfiguredInputPath: '/fake/input.wav',
      trainingProfiles: [{ id: 'p', architectures: ['standard'], watchFolder: '/fake' }],
      trainerHistory: [{ historyId: 'h', profileId: 'p', sourcePath: '/fake/return.wav', sourceMode: 'watcher',
        architecture: 'standard', status: 'success', sourceMtimeMs: 100, sourceSizeBytes: 42 }],
      fs: { existsSync: () => true }, clearTrainerSkipped() {},
      async buildTrainerPayloadsForProfile(_p, _a, _b, _c, _d, _e, _f, options) { return options && options.explicitRetry ? [{ architecture: 'standard' }] : [] },
      async enqueueTrainingPayloads() { queued = true; return 1 }
    })
    evaluate(ctx, `globalThis.retry = ${handlerText('trainer:retryHistoryEntry')}`)
    assert.equal((await ctx.retry(null, 'h')).success, true); assert.equal(queued, true)
    console.log('OK #8: individual history retry passes the explicit-retry bypass')
  }
  console.log('Training regression checks passed. All training/filesystem/process mutations were mocked.')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
