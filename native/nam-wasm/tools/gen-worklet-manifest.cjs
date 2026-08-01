/**
 * Extract the wasm import/export name mapping from an Emscripten glue file.
 *
 * WHY THIS EXISTS
 * ---------------
 * The live player runs NAM inference inside an AudioWorkletProcessor. That scope is a classic
 * script context with no `import`, no `importScripts`, no `fetch` and no DOM, so Emscripten's
 * generated glue can't run there — the worklet has to instantiate the wasm itself with a small
 * hand-written import shim.
 *
 * Doing that requires knowing which export is which. At -O3 Emscripten minifies the wasm
 * boundary to single letters (`namProcessBuffer` becomes `q`, etc.) and keeps the mapping only
 * inside the glue it generates. Those letters are assignment-order dependent, so hardcoding them
 * would silently break the moment a function is added or reordered — and "silently" here means
 * calling the wrong C function from the audio thread.
 *
 * So we parse the mapping out of the glue at build time and emit it as JSON for the worklet to
 * read. Generated, never hand-edited.
 */
const fs = require('fs')
const path = require('path')

const gluePath = process.argv[2]
const outPath = process.argv[3]

if (!gluePath || !outPath) {
  console.error('usage: gen-worklet-manifest.cjs <glue.js> <out.json>')
  process.exit(1)
}

const glue = fs.readFileSync(gluePath, 'utf8')

// Exports: `_namProcessBuffer = Module["_namProcessBuffer"] = wasmExports["q"];`
const wasmExportMap = {}
for (const match of glue.matchAll(/Module\["(_[A-Za-z0-9_]+)"\]\s*=\s*wasmExports\["([A-Za-z0-9_$]+)"\]/g)) {
  wasmExportMap[match[1]] = match[2]
}

// The ctors call is emitted bare rather than via Module[...], so it needs its own pattern.
// Skipping it would leave C++ static initializers unrun.
// Every other export is assigned to a variable; the ctors call is the only one INVOKED bare
// (`...TTY.init();wasmExports["k"]();...`). Matching on that is stable across debug and release
// glue, where the surrounding comments differ. Assert exactly one so a future glue change that
// adds another bare call fails loudly instead of picking the wrong function.
const bareCalls = [
  ...new Set(
    [...glue.matchAll(/(?<![=:]\s*)wasmExports\["([A-Za-z0-9_$]+)"\]\(\)/g)].map((m) => m[1])
  )
]
const namedCtors = glue.match(/__wasm_call_ctors\s*=\s*wasmExports\["([A-Za-z0-9_$]+)"\]/)

if (namedCtors) {
  wasmExportMap.__wasm_call_ctors = namedCtors[1]
} else if (bareCalls.length === 1) {
  wasmExportMap.__wasm_call_ctors = bareCalls[0]
} else if (bareCalls.length > 1) {
  console.error(
    `ERROR: expected one bare wasmExports call (the ctors); found ${bareCalls.length}: ${bareCalls.join(', ')}`
  )
  process.exit(1)
}

// Imports: `wasmImports={a:___assert_fail,b:_fd_write,...}` — letter -> real name, which we
// invert so the shim can look up "which letter do I supply ___assert_fail as".
const importsBlock = glue.match(/wasmImports\s*=\s*\{([^}]*)\}/)
const wasmImportMap = {}
if (importsBlock) {
  for (const entry of importsBlock[1].split(',')) {
    const pair = entry.split(':')
    if (pair.length < 2) continue
    // Emscripten annotates these with `/** @export */` for closure; strip comments and quotes.
    const letter = pair[0]
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .trim()
      .replace(/^["']|["']$/g, '')
    const realName = pair[1].trim()
    if (letter && realName) wasmImportMap[realName] = letter
  }
}

const REQUIRED_EXPORTS = [
  '_namLoadModel',
  '_namProcessBuffer',
  '_namResetModel',
  '_namFreeModel',
  '_namGetLoudness',
  '_namHasLoudness',
  '_namSetSlimmableSize',
  '_namGetLastError',
  '_malloc',
  '_free'
]

const missing = REQUIRED_EXPORTS.filter((name) => !wasmExportMap[name])
if (missing.length > 0) {
  console.error(`ERROR: could not find these exports in ${path.basename(gluePath)}:`)
  for (const name of missing) console.error(`  ${name}`)
  console.error('The glue format may have changed; update the regexes in this script.')
  process.exit(1)
}
if (!wasmExportMap.__wasm_call_ctors) {
  console.error('ERROR: could not find __wasm_call_ctors. C++ static init would never run.')
  process.exit(1)
}
if (Object.keys(wasmImportMap).length === 0) {
  console.error('ERROR: could not parse wasmImports. The shim would supply nothing.')
  process.exit(1)
}

fs.writeFileSync(outPath, JSON.stringify({ exports: wasmExportMap, imports: wasmImportMap }, null, 2) + '\n', 'utf8')
console.log(
  `    manifest: ${Object.keys(wasmExportMap).length} exports, ${Object.keys(wasmImportMap).length} imports`
)
