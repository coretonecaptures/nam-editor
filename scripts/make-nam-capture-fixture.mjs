/**
 * Builds a synthetic IR Lab "NAM Capture" library (schemaVersion 2) for exercising the NAM
 * Projects mode without a real IR Lab install. Matches what NamCaptureStore.cpp writes
 * (ir-lab branch nam-calibration-system + docs/nam_lab_metadata_handoff_2026-08-29.md
 * "UPDATE 2026-08-30" sections):
 *
 *   <out>/<Project>/
 *       _excitations/<stem>-<hash12>-<rate>hz.wav      24-bit PCM mono, one per (excitation, rate)
 *       NAM Captures/
 *           <Capture Name>.wav                          24-bit PCM mono, the recording
 *           <Capture Name>.nam-capture.json             sidecar, SAME BASENAME
 *
 * The sidecar's `excitation` is a RELATIVE path with `../` into _excitations/. Two projects.
 * "Fixture Amp A" — two real captures, one carrying a `calibration` block + `modelMetadataSuggested`.
 * "Fixture Amp B" — one real, one `synthetic: true`.
 *
 *   node scripts/make-nam-capture-fixture.mjs [outDir]
 *
 * Default outDir: .nam-capture-fixture/ at the repo root (gitignored).
 */
import * as fs from 'node:fs'
import * as crypto from 'node:crypto'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = process.argv[2] ? process.argv[2] : join(repoRoot, '.nam-capture-fixture')

const SAMPLE_RATE = 48000
const DURATION_SEC = 0.75
const N = Math.floor(SAMPLE_RATE * DURATION_SEC)

/** 24-bit PCM mono WAV. */
function writePcm24Wav(path, samples) {
  const dataBytes = samples.length * 3
  const buf = Buffer.alloc(44 + dataBytes)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataBytes, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24)
  buf.writeUInt32LE(SAMPLE_RATE * 3, 28) // byte rate
  buf.writeUInt16LE(3, 32) // block align
  buf.writeUInt16LE(24, 34) // bits per sample
  buf.write('data', 36)
  buf.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    const v = Math.round(s * 0x7fffff)
    const u = v < 0 ? v + 0x1000000 : v
    buf.writeUIntLE(u, 44 + i * 3, 3)
  }
  fs.mkdirSync(dirname(path), { recursive: true })
  fs.writeFileSync(path, buf)
}

function excitation(seed) {
  const out = new Float32Array(N)
  for (let i = 0; i < N; i++) {
    const t = i / SAMPLE_RATE
    const env = Math.exp(-3 * t)
    out[i] =
      0.4 * env * Math.sin(2 * Math.PI * (110 + seed * 10) * t) +
      0.2 * env * Math.sin(2 * Math.PI * (220 + seed * 20) * t)
  }
  return out
}

function reamp(di) {
  const out = new Float32Array(di.length)
  let lp = 0
  for (let i = 0; i < di.length; i++) {
    const driven = Math.tanh(di[i] * 3)
    lp = lp + 0.2 * (driven - lp)
    out[i] = lp * 0.8
  }
  return out
}

// One shared excitation per project (seeded per project so the hash differs), written once.
function sharedExcitation(projectDir, seed) {
  const di = excitation(seed)
  const hash = crypto.createHash('sha256').update(Buffer.from(new Float64Array(di).buffer)).digest('hex').slice(0, 12)
  const file = join(projectDir, '_excitations', `fixture_di-${hash}-${SAMPLE_RATE}hz.wav`)
  if (!fs.existsSync(file)) writePcm24Wav(file, di)
  return { file, di }
}

function writeCapture(projectDir, project, opts) {
  const capturesDir = join(projectDir, 'NAM Captures')
  const { file: excFile, di } = sharedExcitation(projectDir, project.seed)
  const wav = join(capturesDir, `${opts.captureName}.wav`)
  writePcm24Wav(wav, reamp(di))
  const excitationRel = relative(capturesDir, excFile).replace(/\\/g, '/')
  const json = {
    schemaVersion: 2,
    captureId: opts.captureId,
    captureName: opts.captureName,
    createdAt: opts.createdAt,
    app: 'IR Lab',
    captureScope: opts.captureScope ?? 'Cabinet',
    excitation: excitationRel,
    recording: `${opts.captureName}.wav`,
    excitationSourceName: 'fixture_di.wav',
    stimulusSha256: 'fixture-' + opts.captureId,
    sampleRate: SAMPLE_RATE,
    measuredLatencySamples: 384,
    projectId: project.id,
    projectName: project.name,
  }
  if (opts.synthetic) {
    json.synthetic = true
    json.syntheticSourceIrName = 'FixtureCab_4x12.wav'
  }
  if (opts.calibration) {
    json.calibration = {
      inputLevelDbu: 12.4,
      outputLevelDbu: 4.0,
      method: 'precision',
      confidence: 'meter-verified',
      profileName: 'Fixture Rig',
      calibratedAt: '2026-08-30T08:00:00.000Z',
    }
  }
  if (opts.suggested) {
    json.modelMetadataSuggested = {
      name: opts.captureName,
      modeledBy: 'Fixture Maker',
      gearMake: 'Fender',
      gearModel: 'Bassman AA864',
      gearType: 'amp_cab',
      toneType: 'crunch',
    }
  }
  fs.writeFileSync(join(capturesDir, `${opts.captureName}.nam-capture.json`), JSON.stringify(json, null, 2) + '\n')
}

fs.rmSync(outDir, { recursive: true, force: true })

const ampA = { id: 'fixture-proj-a', name: 'Fixture Amp A', seed: 1 }
const ampB = { id: 'fixture-proj-b', name: 'Fixture Amp B', seed: 3 }
const ampADir = join(outDir, 'Fixture Amp A')
const ampBDir = join(outDir, 'Fixture Amp B')

writeCapture(ampADir, ampA, {
  captureName: 'Fixture Amp A — Clean',
  captureId: 'fa01',
  createdAt: '2026-08-30T10:00:00.000Z',
  calibration: true,
  suggested: true,
})
writeCapture(ampADir, ampA, {
  captureName: 'Fixture Amp A — Crunch',
  captureId: 'fa02',
  createdAt: '2026-08-30T10:30:00.000Z',
})
writeCapture(ampBDir, ampB, {
  captureName: 'Fixture Amp B — Lead',
  captureId: 'fb01',
  createdAt: '2026-08-31T09:00:00.000Z',
})
writeCapture(ampBDir, ampB, {
  captureName: 'Fixture Amp B — Synthetic blend',
  captureId: 'fb02',
  createdAt: '2026-08-31T09:15:00.000Z',
  synthetic: true,
})

console.log('NAM Capture fixture (schemaVersion 2) written to:', outDir)
console.log('Projects: "Fixture Amp A" (2 captures, one calibrated + hinted), "Fixture Amp B" (1 real + 1 synthetic)')
console.log('Add it via "Add Folder" in NAM Projects mode, pointed at that directory.')
