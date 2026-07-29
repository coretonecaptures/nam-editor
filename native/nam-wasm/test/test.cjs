/**
 * Smoke test for the offline NAM inference WASM module.
 *
 * Verifies the two things this module has to get right:
 *   1. Inference actually runs and produces plausible audio (not silence, not NaN).
 *   2. The module's memory is a plain ArrayBuffer, NOT a SharedArrayBuffer. This is the whole
 *      reason the module exists — a SharedArrayBuffer would drag in the crossOriginIsolated
 *      requirement that made the real-time player impossible in Electron.
 *
 * Run:
 *   ./build.sh --with-test-build
 *   node test/test.cjs
 */
const fs = require('fs')
const path = require('path')

const MODULE_PATH = path.join(__dirname, '..', 'build', 'nam-offline-node.cjs')
const MODELS_DIR = path.join(__dirname, 'models')

const SAMPLE_RATE = 48000
const NUM_SAMPLES = SAMPLE_RATE // one second

async function main() {
  if (!fs.existsSync(MODULE_PATH)) {
    console.error(`Test module not found at ${MODULE_PATH}`)
    console.error('Build it first:  ./build.sh --with-test-build')
    process.exit(1)
  }

  const createNamModule = require(MODULE_PATH)
  const Module = await createNamModule()
  console.log('WASM module instantiated OK\n')

  // 220Hz sine at -12dBFS — a plausible guitar fundamental.
  const input = new Float32Array(NUM_SAMPLES)
  for (let i = 0; i < NUM_SAMPLES; i++) {
    input[i] = Math.sin((2 * Math.PI * 220 * i) / SAMPLE_RATE) * 0.25
  }

  const models = fs.readdirSync(MODELS_DIR).filter((f) => f.endsWith('.nam'))
  let pass = 0
  let fail = 0

  for (const name of models) {
    const text = fs.readFileSync(path.join(MODELS_DIR, name), 'utf8')

    const byteLen = Module.lengthBytesUTF8(text) + 1
    const jsonPtr = Module._malloc(byteLen)
    Module.stringToUTF8(text, jsonPtr, byteLen)
    const model = Module._namLoadModel(jsonPtr)
    Module._free(jsonPtr)

    if (!model) {
      const reason = Module.UTF8ToString(Module._namGetLastError())
      console.log(`  FAIL ${name.padEnd(28)} model failed to load: ${reason}`)
      fail++
      continue
    }

    const hasLoudness = Module._namHasLoudness(model)
    const loudness = Module._namGetLoudness(model)

    const resetOk = Module._namResetModel(model, SAMPLE_RATE, NUM_SAMPLES)

    const inPtr = Module._malloc(NUM_SAMPLES * 4)
    const outPtr = Module._malloc(NUM_SAMPLES * 4)
    Module.HEAPF32.set(input, inPtr >> 2)

    const started = process.hrtime.bigint()
    const ok = Module._namProcessBuffer(model, inPtr, outPtr, NUM_SAMPLES)
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6

    // Copy out before any further allocation — memory growth can detach the heap view.
    const out = new Float32Array(
      Module.HEAPF32.subarray(outPtr >> 2, (outPtr >> 2) + NUM_SAMPLES)
    )
    Module._free(inPtr)
    Module._free(outPtr)
    Module._namFreeModel(model)

    let peak = 0
    let sumSquares = 0
    let nonFinite = 0
    for (let i = 0; i < NUM_SAMPLES; i++) {
      const v = out[i]
      if (!Number.isFinite(v)) {
        nonFinite++
        continue
      }
      const abs = Math.abs(v)
      if (abs > peak) peak = abs
      sumSquares += v * v
    }
    const rms = Math.sqrt(sumSquares / NUM_SAMPLES)

    const problems = []
    if (!resetOk) problems.push(`namResetModel returned 0: ${Module.UTF8ToString(Module._namGetLastError())}`)
    if (!ok) problems.push(`namProcessBuffer returned 0: ${Module.UTF8ToString(Module._namGetLastError())}`)
    if (nonFinite > 0) problems.push(`${nonFinite} non-finite samples`)
    if (peak === 0) problems.push('output is pure silence')

    const realtimeFactor = NUM_SAMPLES / SAMPLE_RATE / (elapsedMs / 1000)
    if (problems.length === 0) pass++
    else fail++

    console.log(
      `  ${problems.length === 0 ? 'PASS' : 'FAIL'} ${name.padEnd(28)}` +
        `peak=${peak.toFixed(4)} rms=${rms.toFixed(4)} ` +
        `loudness=${hasLoudness ? `${loudness.toFixed(2)}dB` : 'n/a'} ` +
        `render=${elapsedMs.toFixed(0)}ms (${realtimeFactor.toFixed(1)}x realtime)` +
        (problems.length ? `\n       -> ${problems.join('; ')}` : '')
    )
  }

  // Bad input must produce a readable message, not a crash and not an opaque value. A user hit
  // "Rendering failed: [object Object]" because a C++ throw crossed the Emscripten boundary
  // uncaught; namGetLastError() exists to make these cases explainable.
  console.log('\nError reporting:')
  // The "missing key" cases matter most: nlohmann's const operator[] asserts instead of
  // throwing, so before validation these aborted the entire WASM module rather than failing.
  for (const [label, badJson] of [
    ['malformed JSON', '{not valid json'],
    ['valid JSON, not a model', '{"hello":"world"}'],
    ['missing version', '{"architecture":"WaveNet","config":{},"weights":[]}'],
    ['missing architecture', '{"version":"0.5.0","config":{},"weights":[]}'],
    ['missing config', '{"version":"0.5.0","architecture":"WaveNet","weights":[]}'],
    ['non-string architecture', '{"version":"0.5.0","architecture":42,"config":{},"weights":[]}'],
    ['missing weights', '{"version":"0.5.0","architecture":"WaveNet","config":{}}'],
    ['empty object', '{}'],
  ]) {
    const bytes = Module.lengthBytesUTF8(badJson) + 1
    const ptr = Module._malloc(bytes)
    Module.stringToUTF8(badJson, ptr, bytes)
    const handle = Module._namLoadModel(ptr)
    Module._free(ptr)

    const message = Module.UTF8ToString(Module._namGetLastError())
    const good = handle === 0 && typeof message === 'string' && message.length > 0
    if (good) pass++
    else fail++
    console.log(`  ${good ? 'PASS' : 'FAIL'} ${label.padEnd(24)} -> ${message || '(no message)'}`)
    if (handle !== 0) Module._namFreeModel(handle)
  }

  // The module must still be usable after those failures. An abort() would have torn the
  // instance down, making every later load fail too -- so this asserts the failures were
  // genuinely recoverable, not just quiet.
  {
    const text = fs.readFileSync(path.join(MODELS_DIR, models[0]), 'utf8')
    const bytes = Module.lengthBytesUTF8(text) + 1
    const ptr = Module._malloc(bytes)
    Module.stringToUTF8(text, ptr, bytes)
    const handle = Module._namLoadModel(ptr)
    Module._free(ptr)

    const recovered = handle !== 0
    if (recovered) {
      Module._namFreeModel(handle)
      pass++
    } else {
      fail++
    }
    console.log(
      `  ${recovered ? 'PASS' : 'FAIL'} module still usable after bad input` +
        (recovered ? '' : ' -> instance was torn down (abort?)')
    )
  }

  // The property this module's entire design depends on.
  const bufferType = Module.HEAPF32.buffer.constructor.name
  const sharedMemoryUsed = bufferType !== 'ArrayBuffer'
  console.log(`\nWASM memory backing: ${bufferType}`)
  if (sharedMemoryUsed) {
    console.log('  FAIL expected ArrayBuffer. A SharedArrayBuffer means a threaded build crept')
    console.log('       back in, which reintroduces the crossOriginIsolated requirement that')
    console.log('       makes the player impossible in Electron. Check for -pthread /')
    console.log('       -sAUDIO_WORKLET / -sWASM_WORKERS in build.sh.')
    fail++
  } else {
    console.log('  PASS plain ArrayBuffer — no cross-origin isolation required.')
    pass++
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
