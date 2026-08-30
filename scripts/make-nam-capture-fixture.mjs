/**
 * Builds a synthetic IR Lab "NAM Capture" library for exercising the NAM Projects mode without
 * a real IR Lab install. Matches exactly what NamCaptureStore.cpp writes (confirmed against
 * ir-lab source + docs/nam-capture-import-plan-2026-08-29.md §2):
 *
 *   <out>/<sanitizedName>-<captureId>/
 *       excitation.wav      32-bit float mono
 *       recording.wav        32-bit float mono, same sample count
 *       nam-capture.json
 *
 * Two projects. "Fixture Amp A" — two real captures. "Fixture Amp B" — one real, one
 * synthetic: true (so the default-exclude path is exercised). One capture deliberately names
 * its WAVs di.wav / return.wav rather than the conventional names, to prove the importer resolves
 * paths from the JSON fields and never assumes filenames.
 *
 *   node scripts/make-nam-capture-fixture.mjs [outDir]
 *
 * Default outDir: .nam-capture-fixture/ at the repo root (gitignored).
 */
import * as fs from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = process.argv[2] ? process.argv[2] : join(repoRoot, '.nam-capture-fixture')

const SAMPLE_RATE = 48000
const DURATION_SEC = 0.75
const N = Math.floor(SAMPLE_RATE * DURATION_SEC)

/** 32-bit float mono WAV (format code 3, IEEE float). */
function writeFloatWav(path, samples) {
  const dataBytes = samples.length * 4
  const buf = Buffer.alloc(44 + dataBytes)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataBytes, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16) // fmt chunk size
  buf.writeUInt16LE(3, 20) // IEEE float
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(SAMPLE_RATE, 24)
  buf.writeUInt32LE(SAMPLE_RATE * 4, 28) // byte rate
  buf.writeUInt16LE(4, 32) // block align
  buf.writeUInt16LE(32, 34) // bits per sample
  buf.write('data', 36)
  buf.writeUInt32LE(dataBytes, 40)
  for (let i = 0; i < samples.length; i++) buf.writeFloatLE(samples[i], 44 + i * 4)
  fs.mkdirSync(dirname(path), { recursive: true })
  fs.writeFileSync(path, buf)
}

/** A quick decaying multi-tone "DI". */
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

/** A cheap "amp": soft clip + one-pole lowpass, so recording != excitation but is derived from it. */
function reamp(di) {
  const out = new Float32Array(di.length)
  let lp = 0
  const a = 0.2
  for (let i = 0; i < di.length; i++) {
    const driven = Math.tanh(di[i] * 3)
    lp = lp + a * (driven - lp)
    out[i] = lp * 0.8
  }
  return out
}

function writeCapture(project, opts) {
  const dir = join(outDir, opts.folderName)
  const excitationName = opts.excitation ?? 'excitation.wav'
  const recordingName = opts.recording ?? 'recording.wav'
  const di = excitation(opts.seed)
  writeFloatWav(join(dir, excitationName), di)
  writeFloatWav(join(dir, recordingName), reamp(di))
  const json = {
    schemaVersion: 1,
    captureId: opts.captureId,
    captureName: opts.captureName,
    createdAt: opts.createdAt,
    captureScope: 'Cabinet',
    excitation: excitationName,
    recording: recordingName,
    excitationSourceName: 'Fixture DI sweep',
    stimulusSha256: 'fixture-' + opts.captureId,
    sampleRate: SAMPLE_RATE,
    measuredLatencySamples: 384,
    projectId: project.id,
    projectName: project.name,
  }
  if (opts.synthetic) {
    json.synthetic = true
    json.syntheticSourceIrName = opts.syntheticSourceIrName ?? 'FixtureCab_4x12.wav'
  }
  fs.writeFileSync(join(dir, 'nam-capture.json'), JSON.stringify(json, null, 2) + '\n')
  return dir
}

fs.rmSync(outDir, { recursive: true, force: true })

const ampA = { id: 'fixture-proj-a', name: 'Fixture Amp A' }
const ampB = { id: 'fixture-proj-b', name: 'Fixture Amp B' }

writeCapture(ampA, {
  folderName: 'fixture-amp-a-clean-fa01',
  captureId: 'fa01',
  captureName: 'Fixture Amp A — Clean',
  createdAt: '2026-08-20T10:00:00.000Z',
  seed: 1,
})
writeCapture(ampA, {
  folderName: 'fixture-amp-a-crunch-fa02',
  captureId: 'fa02',
  captureName: 'Fixture Amp A — Crunch',
  createdAt: '2026-08-20T10:30:00.000Z',
  seed: 2,
  excitation: 'di.wav', // non-conventional names on purpose
  recording: 'return.wav',
})
writeCapture(ampB, {
  folderName: 'fixture-amp-b-lead-fb01',
  captureId: 'fb01',
  captureName: 'Fixture Amp B — Lead',
  createdAt: '2026-08-21T09:00:00.000Z',
  seed: 3,
})
writeCapture(ampB, {
  folderName: 'fixture-amp-b-synthetic-fb02',
  captureId: 'fb02',
  captureName: 'Fixture Amp B — Synthetic blend',
  createdAt: '2026-08-21T09:15:00.000Z',
  seed: 4,
  synthetic: true,
})

console.log('NAM Capture fixture written to:', outDir)
console.log('Projects: "Fixture Amp A" (2 captures), "Fixture Amp B" (1 real + 1 synthetic)')
console.log('Add it in the app via "Add Library Folder…" pointed at that directory.')
