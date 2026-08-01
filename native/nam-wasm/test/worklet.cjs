/**
 * Validates the AudioWorklet path without a browser.
 *
 * The worklet instantiates the wasm itself against a hand-written import shim and a generated
 * name manifest, because Emscripten's glue can't run in AudioWorkletGlobalScope. That means two
 * things can silently break:
 *
 *   1. A stale manifest. If the wasm is rebuilt and the manifest isn't (or the regexes in
 *      gen-worklet-manifest.cjs stop matching), the letters still *look* valid but point at the
 *      wrong functions. The failure would be calling arbitrary C from the audio thread.
 *   2. A missing import stub. Adding code that pulls in a new Emscripten import would make
 *      instantiation throw inside the worklet, where there's no console to see it.
 *
 * This mirrors the worklet's own instantiation exactly, so either problem fails here — in a
 * plain `node` run — instead of on the audio thread.
 *
 * Run: node test/worklet.cjs
 */
const fs = require('fs')
const path = require('path')

const PUBLIC_DIR = path.join(__dirname, '..', '..', '..', 'src', 'renderer', 'public')
const WASM_PATH = path.join(PUBLIC_DIR, 'nam-worklet.wasm')
const MANIFEST_PATH = path.join(PUBLIC_DIR, 'nam-worklet.manifest.json')
const MODELS_DIR = path.join(__dirname, 'models')

const QUANTUM = 128
const SAMPLE_RATE = 48000

let pass = 0
let fail = 0

function check(ok, label, detail) {
  if (ok) {
    pass++
    console.log(`  PASS ${label}`)
  } else {
    fail++
    console.log(`  FAIL ${label}${detail ? ` -> ${detail}` : ''}`)
  }
  return ok
}

function main() {
  for (const [label, filePath] of [
    ['nam-worklet.wasm exists', WASM_PATH],
    ['nam-worklet.manifest.json exists', MANIFEST_PATH]
  ]) {
    if (!check(fs.existsSync(filePath), label, 'run ./build.sh')) return
  }

  const wasmBytes = fs.readFileSync(WASM_PATH)
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'))
  const module = new WebAssembly.Module(wasmBytes)

  // Every import the wasm declares must have a stub, or instantiation throws in the worklet.
  const declaredImports = WebAssembly.Module.imports(module)
  const manifestLetters = new Set(Object.values(manifest.imports))
  const unmapped = declaredImports.filter((i) => !manifestLetters.has(i.name))
  check(
    unmapped.length === 0,
    `all ${declaredImports.length} wasm imports are covered by the manifest`,
    unmapped.map((i) => `${i.module}.${i.name}`).join(', ')
  )

  // Same stub set the worklet installs (see src/renderer/public/nam-worklet.js).
  let aborted = null
  const stubs = {
    ___assert_fail: () => { aborted = 'assert' },
    __abort_js: () => { aborted = 'abort' },
    _emscripten_resize_heap: () => 0,
    _environ_get: () => 0,
    _environ_sizes_get: () => 0,
    _fd_close: () => 0,
    _fd_read: () => 0,
    _fd_seek: () => 0,
    _fd_write: () => 0
  }

  const importObject = { a: {} }
  let missingStub = null
  for (const [realName, letter] of Object.entries(manifest.imports)) {
    if (!stubs[realName]) { missingStub = realName; break }
    importObject.a[letter] = stubs[realName]
  }
  if (!check(!missingStub, 'every manifest import has a stub', missingStub)) return

  let instance
  try {
    instance = new WebAssembly.Instance(module, importObject)
  } catch (err) {
    check(false, 'wasm instantiates with only the shim stubs', String(err))
    return
  }
  check(true, 'wasm instantiates with only the shim stubs')

  const raw = instance.exports

  // Memory must be a plain ArrayBuffer. A SharedArrayBuffer here means a threaded build crept
  // back in, which reintroduces the crossOriginIsolated wall that makes the live player
  // impossible in Electron.
  let memory = null
  for (const value of Object.values(raw)) {
    if (value instanceof WebAssembly.Memory) { memory = value; break }
  }
  if (!check(memory !== null, 'wasm exports a memory')) return
  check(
    memory.buffer.constructor.name === 'ArrayBuffer',
    'memory is a plain ArrayBuffer (no cross-origin isolation needed)',
    memory.buffer.constructor.name
  )

  // Resolve every mapped export and confirm it's actually a function.
  const fn = {}
  let badExport = null
  for (const [name, letter] of Object.entries(manifest.exports)) {
    const candidate = raw[letter]
    if (typeof candidate !== 'function') { badExport = `${name} -> ${letter}`; break }
    fn[name] = candidate
  }
  if (!check(!badExport, 'every manifest export resolves to a function', badExport)) return

  fn.__wasm_call_ctors()
  check(aborted === null, 'static initializers ran without aborting', aborted)

  // The real proof the manifest isn't just structurally valid but semantically correct: run a
  // model end to end. A shuffled mapping would fail here rather than producing plausible audio.
  const heapU8 = new Uint8Array(memory.buffer)
  const heapF32 = new Float32Array(memory.buffer)

  const models = fs.existsSync(MODELS_DIR)
    ? fs.readdirSync(MODELS_DIR).filter((f) => f.endsWith('.nam'))
    : []
  if (!check(models.length > 0, 'test models present', MODELS_DIR)) return

  for (const name of models) {
    const text = fs.readFileSync(path.join(MODELS_DIR, name), 'utf8')
    const bytes = Buffer.from(text, 'utf8')

    const jsonPtr = fn._malloc(bytes.length + 1)
    heapU8.set(bytes, jsonPtr)
    heapU8[jsonPtr + bytes.length] = 0
    const handle = fn._namLoadModel(jsonPtr)
    fn._free(jsonPtr)

    if (!check(handle !== 0, `${name}: loads via the shim`)) continue
    if (!check(fn._namResetModel(handle, SAMPLE_RATE, QUANTUM) !== 0, `${name}: resets`)) {
      fn._namFreeModel(handle)
      continue
    }

    const inPtr = fn._malloc(QUANTUM * 4)
    const outPtr = fn._malloc(QUANTUM * 4)

    // A few quanta, as the audio thread would drive it.
    let peak = 0
    let nonFinite = 0
    let processFailed = false
    for (let block = 0; block < 20; block++) {
      for (let i = 0; i < QUANTUM; i++) {
        const t = block * QUANTUM + i
        heapF32[(inPtr >> 2) + i] = Math.sin((2 * Math.PI * 220 * t) / SAMPLE_RATE) * 0.3
      }
      if (fn._namProcessBuffer(handle, inPtr, outPtr, QUANTUM) === 0) { processFailed = true; break }
      for (let i = 0; i < QUANTUM; i++) {
        const v = heapF32[(outPtr >> 2) + i]
        if (!Number.isFinite(v)) { nonFinite++; continue }
        const a = Math.abs(v)
        if (a > peak) peak = a
      }
    }

    fn._free(inPtr)
    fn._free(outPtr)
    fn._namFreeModel(handle)

    check(!processFailed, `${name}: processes ${QUANTUM}-frame quanta`)
    check(nonFinite === 0, `${name}: no non-finite output`, `${nonFinite} samples`)
    check(peak > 0, `${name}: produced audio (peak ${peak.toFixed(5)})`)
  }

  check(aborted === null, 'no abort/assert fired during the whole run', aborted)
}

console.log('AudioWorklet shim validation\n')
main()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
