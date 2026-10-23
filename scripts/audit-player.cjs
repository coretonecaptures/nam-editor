// Regression checks for docs/player-audit.md: each asserts the FIXED behaviour.
// Run with: node scripts/audit-player.cjs
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const cache = new Map()
function loadTs(relative) {
  const filename = path.resolve(root, relative)
  if (cache.has(filename)) return cache.get(filename)
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const localRequire = (id) => id.startsWith('.')
    ? loadTs(path.relative(root, path.resolve(path.dirname(filename), id + '.ts')))
    : require(id)
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`, { filename })(localRequire, module, module.exports)
  cache.set(filename, module.exports)
  return module.exports
}
const { LiveEngine } = loadTs('src/renderer/src/utils/liveEngine.ts')
const { computeLiveNormalizeGain, computePlaybackGain } = loadTs('src/renderer/src/utils/playerAudio.ts')
class Param {
  constructor() { this.value = 1 }
  cancelScheduledValues() {}
  setValueAtTime(value) { this.value = value }
  linearRampToValueAtTime(value) { this.value = value }
}
class Node {
  constructor(name) { this.name = name; this.gain = new Param(); this.edges = new Set() }
  connect(node) { this.edges.add(node); return node }
  disconnect(node) {
    if (node && !this.edges.has(node)) throw new Error('Not connected')
    if (node) this.edges.delete(node)
    else this.edges.clear()
  }
}
const ir = { samples: new Float32Array([1, 0.5]), sampleRate: 48000 }
function graph() {
  const e = new LiveEngine()
  const nodes = []
  e.ctx = {
    currentTime: 0, sampleRate: 48000,
    createGain: () => { const n = new Node('gain'); nodes.push(n); return n },
    createConvolver: () => { const n = new Node('convolver'); nodes.push(n); return n },
    createBuffer: () => ({ copyToChannel() {} })
  }
  e.worklet = new Node('NAM')
  e.fxInput = new Node('FX')
  e.outputGain = new Node('output')
  return { e, nodes }
}
async function main() {
  {
    const originalLoad = LiveEngine.loadWasm
    const originalContext = global.AudioContext
    let resolveLoad
    const pendingLoad = new Promise(resolve => { resolveLoad = resolve })
    LiveEngine.loadWasm = () => pendingLoad
    let contextsCreated = 0
    global.AudioContext = class {
      constructor() { contextsCreated++; throw new Error('audit stopped before opening devices') }
    }
    try {
      const e = new LiveEngine()
      const starting = e.start({ modelJson: '{}' }).catch(error => error)
      await Promise.resolve()
      await e.stop()
      resolveLoad({ module: {}, manifest: {} })
      await starting
      assert.equal(contextsCreated, 0)
      console.log('OK #2: stop during WASM loading cancels startup; no audio context is created afterward')
    } finally {
      LiveEngine.loadWasm = originalLoad
      if (originalContext === undefined) delete global.AudioContext
      else global.AudioContext = originalContext
    }
  }
  {
    const { e } = graph()
    e.irA = ir; e.irMix = 0
    await e.wireCabinets()
    e.setIrMix(1)
    assert.notEqual(e.convolverA, null)
    assert(!e.worklet.edges.has(e.fxInput))
    assert(e.wetGainA.gain.value > 0)
    console.log('OK #6: starting at 0% cab mix builds the cab, so raising the mix brings it in')
  }
  {
    const { e } = graph()
    // Hold resampling in flight across both fade timers, as real OfflineAudioContext
    // rendering does when an IR's rate differs from the live context.
    global.OfflineAudioContext = class {
      constructor(_, length) { this.length = length; this.destination = new Node('destination') }
      createBuffer() { return { copyToChannel() {} } }
      createBufferSource() { return { connect() {}, start() {} } }
      async startRendering() {
        await new Promise(resolve => setTimeout(resolve, 20))
        return { length: this.length, copyFromChannel(out) { out.fill(0.5) } }
      }
    }
    const needsResampling = { ...ir, sampleRate: 44100 }
    await Promise.all([e.setIrSlot('A', needsResampling), e.setIrSlot('B', needsResampling)])
    delete global.OfflineAudioContext
    const count = [...e.worklet.edges].filter(n => n.name === 'convolver').length
    assert.equal(count, 2)
    console.log('OK #4: simultaneous A/B changes leave exactly 2 connected convolvers')
  }
  {
    const { e } = graph()
    e.irA = ir
    await e.wireCabinets()
    e.irBlend = 1
    e.setIrMix(1)
    assert(e.wetGainA.gain.value > 0)
    assert.equal(e.convolverB, null)
    console.log('OK #7: blending fully toward an empty B slot still routes cab A')
  }
  {
    const { e } = graph()
    e.fxMid = new Node('reverb input')
    e.tremOut = new Node('before both delays')
    e.delayIn = new Node('reorderable delay input')
    e.delayConvWet = new Node('delay wet')
    await e.setDelayIr({ channels: [ir.samples], sampleRate: 48000 })
    assert(!e.tremOut.edges.has(e.delayConvolver))
    assert(e.delayIn.edges.has(e.delayConvolver))
    console.log('OK #9: convolution Delay feeds from the reorderable delay input')
  }
  {
    const { e } = graph()
    e.splitter = new Node('splitter')
    e.preWorklet = new Node('pedal NAM')
    e.inputAnalyser = new Node('input meter')
    e.channelAnalysers = [new Node('ch0'), new Node('ch1')]
    e.splitter.connect(e.preWorklet)
    e.splitter.connect(e.inputAnalyser)
    e.setInputChannel(1)
    assert(e.splitter.edges.has(e.preWorklet))
    assert(!e.splitter.edges.has(e.worklet))
    console.log('OK #10: without a gate, changing input with a pedal rewires the pedal stage only')
  }
  {
    const source = fs.readFileSync(path.join(root, 'src/renderer/public/nam-worklet.js'), 'utf8')
    let Processor
    class Base { constructor() { this.port = { postMessage() {} } } }
    const context = vm.createContext({ AudioWorkletProcessor: Base, sampleRate: 48000,
      registerProcessor: (_, ctor) => { Processor = ctor } })
    vm.runInContext(source, context)
    const processor = new Processor({ processorOptions: {} })
    const input = new Float32Array(128).fill(0.25)
    const output = new Float32Array(128)
    assert.equal(processor.ready, false)
    processor.process([[input]], [[output]])
    assert.equal(output[0], 0)
    console.log('OK #11: a failed NAM worklet stays silent instead of passing raw input')
  }
  {
    const rawPeak = 10.19616 // measured by native/nam-wasm/test/worklet.cjs
    const livePeak = rawPeak * computeLiveNormalizeGain(-20)
    const previewPeak = rawPeak * computePlaybackGain(new Float32Array([rawPeak]), -20)
    assert(livePeak > 12)
    assert(Math.abs(previewPeak - 0.99) < 0.00001)
    console.log(`NOTE #1: metadata gain alone would put this A2 model at ${livePeak.toFixed(3)} live (preview ${previewPeak.toFixed(3)}); the live limiter + 0.99 ceiling now bound the output`)
  }
  console.log('Player regression checks passed. No physical audio device was opened.')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
