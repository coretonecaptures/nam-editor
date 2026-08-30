import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { createCoreSchema } from './schema'
import { importLibrary } from './importLibrary'
import { enrichNamCaptures, listNamProjects, getNamProjectDetail, getNamLibraryOverview } from './namCaptureEnrichment'
import { writeNamLabResult } from './namCaptureResult'


const tmpDirs: string[] = []
function makeTmpDir(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'nam-capture-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

/** One capture folder matching exactly what IR Lab's NamCaptureStore.cpp writes: a flat
 * <sanitizedName>-<captureId>/ folder holding the DI/return pair and nam-capture.json. Filenames
 * come from the JSON's own excitation/recording fields, not a fixed convention. */
function writeCapture(
  root: string,
  opts: {
    folderName: string
    captureId: string
    captureName: string
    projectId: string
    projectName: string
    excitation?: string
    recording?: string
    synthetic?: boolean
    syntheticSourceIrName?: string
  }
): string {
  const dir = join(root, opts.folderName)
  fs.mkdirSync(dir, { recursive: true })
  const excitation = opts.excitation ?? 'excitation.wav'
  const recording = opts.recording ?? 'recording.wav'
  fs.writeFileSync(join(dir, excitation), 'x'.repeat(4096))
  fs.writeFileSync(join(dir, recording), 'y'.repeat(4096))
  fs.writeFileSync(
    join(dir, 'nam-capture.json'),
    JSON.stringify({
      schemaVersion: 1,
      captureId: opts.captureId,
      captureName: opts.captureName,
      createdAt: '2026-08-20T12:00:00.000Z',
      captureScope: 'Cabinet',
      excitation,
      recording,
      excitationSourceName: 'Reamp DI',
      stimulusSha256: 'abc123',
      sampleRate: 48000,
      measuredLatencySamples: 512,
      projectId: opts.projectId,
      projectName: opts.projectName,
      ...(opts.synthetic ? { synthetic: true, syntheticSourceIrName: opts.syntheticSourceIrName ?? 'SomeCab.wav' } : {})
    })
  )
  return dir
}

/** Two projects: "Amp A" with two real captures, "Amp B" with one real + one synthetic. */
function makeFixture(): { root: string } {
  const root = makeTmpDir()
  writeCapture(root, {
    folderName: 'amp-a-clean-cap0001',
    captureId: 'cap0001',
    captureName: 'Amp A — Clean',
    projectId: 'proj-a',
    projectName: 'Amp A'
  })
  writeCapture(root, {
    folderName: 'amp-a-crunch-cap0002',
    captureId: 'cap0002',
    captureName: 'Amp A — Crunch',
    projectId: 'proj-a',
    projectName: 'Amp A',
    excitation: 'di.wav',
    recording: 'return.wav'
  })
  writeCapture(root, {
    folderName: 'amp-b-lead-cap0003',
    captureId: 'cap0003',
    captureName: 'Amp B — Lead',
    projectId: 'proj-b',
    projectName: 'Amp B'
  })
  writeCapture(root, {
    folderName: 'amp-b-synth-cap0004',
    captureId: 'cap0004',
    captureName: 'Amp B — Synthetic',
    projectId: 'proj-b',
    projectName: 'Amp B',
    synthetic: true,
    syntheticSourceIrName: 'Mesa4x12.wav'
  })
  return { root }
}

describe('enrichNamCaptures', () => {
  it('groups captures by projectId and records pre-training facts', async () => {
    const { root } = makeFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })

    const enrich = enrichNamCaptures(db, stats.libraryRootId)
    expect(enrich.projectsFound).toBe(2)
    expect(enrich.capturesEnriched).toBe(4)
    expect(enrich.syntheticCaptures).toBe(1)

    // The return WAV is promoted to kind='nam_capture'; the DI stays kind='ir'.
    const kinds = db
      .prepare(`SELECT kind, COUNT(*) as n FROM item GROUP BY kind ORDER BY kind`)
      .all() as Array<{ kind: string; n: number }>
    expect(kinds).toEqual([
      { kind: 'ir', n: 4 },
      { kind: 'nam_capture', n: 4 }
    ])

    // Pairing is resolved from the JSON's own filenames — di.wav / return.wav on cap0002.
    const crunch = db
      .prepare(
        `SELECT nc.excitation_path as e, nc.recording_path as r, nc.synthetic as s
         FROM nam_capture_item nc WHERE nc.capture_id = 'cap0002'`
      )
      .get() as { e: string; r: string; s: number }
    expect(crunch.e.endsWith('di.wav')).toBe(true)
    expect(crunch.r.endsWith('return.wav')).toBe(true)
    expect(crunch.s).toBe(0)

    const synthRow = db
      .prepare(`SELECT synthetic, synthetic_source_ir_name FROM nam_capture_item WHERE capture_id = 'cap0004'`)
      .get() as { synthetic: number; synthetic_source_ir_name: string }
    expect(synthRow.synthetic).toBe(1)
    expect(synthRow.synthetic_source_ir_name).toBe('Mesa4x12.wav')
  })

  it('is idempotent across repeated scans', async () => {
    const { root } = makeFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    enrichNamCaptures(db, stats.libraryRootId)
    enrichNamCaptures(db, stats.libraryRootId)

    const projects = db.prepare(`SELECT COUNT(*) as n FROM collection WHERE kind = 'nam_project'`).get() as { n: number }
    expect(projects.n).toBe(2)
    const links = db.prepare(`SELECT COUNT(*) as n FROM collection_item`).get() as { n: number }
    expect(links.n).toBe(4)
  })

  it('listNamProjects / getNamProjectDetail report trained state from the nam-lab-result.json sidecar', async () => {
    const { root } = makeFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    enrichNamCaptures(db, stats.libraryRootId)

    const projects = listNamProjects(db)
    expect(projects.map((p) => p.name).sort()).toEqual(['Amp A', 'Amp B'])
    const ampA = projects.find((p) => p.name === 'Amp A')!
    expect(ampA.captureCount).toBe(2)
    expect(ampA.trainedCount).toBe(0)

    // Mark one Amp A capture trained by dropping the sidecar into its folder.
    writeNamLabResult(join(root, 'amp-a-clean-cap0001'), {
      trainedAt: '2026-08-29T00:00:00.000Z',
      modelName: 'Amp A — Clean',
      architecture: 'a1',
      validationEsr: 0.012,
      outputModelPath: join(root, 'models', 'Amp A — Clean.nam'),
      trainerJobId: 'job-1'
    })

    const detail = getNamProjectDetail(db, ampA.collectionId)!
    expect(detail.trainedCount).toBe(1)
    const clean = detail.captures.find((c) => c.captureId === 'cap0001')!
    expect(clean.trained).toBe(true)
    expect(clean.result?.validationEsr).toBe(0.012)
    const crunch = detail.captures.find((c) => c.captureId === 'cap0002')!
    expect(crunch.trained).toBe(false)
  })

  it('getNamLibraryOverview aggregates coverage, breakdowns and per-project ESR', async () => {
    const { root } = makeFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    enrichNamCaptures(db, stats.libraryRootId)

    writeNamLabResult(join(root, 'amp-a-clean-cap0001'), {
      trainedAt: '2026-08-29T00:00:00.000Z', modelName: 'A Clean', architecture: 'a1',
      validationEsr: 0.01, outputModelPath: 'x.nam', trainerJobId: 'j1'
    })
    writeNamLabResult(join(root, 'amp-a-crunch-cap0002'), {
      trainedAt: '2026-08-29T00:00:00.000Z', modelName: 'A Crunch', architecture: 'a2',
      validationEsr: 0.03, outputModelPath: 'y.nam', trainerJobId: 'j2'
    })

    const o = getNamLibraryOverview(db)
    expect(o.totalProjects).toBe(2)
    expect(o.totalCaptures).toBe(4)
    expect(o.trainedCaptures).toBe(2)
    expect(o.untrainedCaptures).toBe(2)
    expect(o.syntheticCaptures).toBe(1)
    expect(o.avgTrainedEsr).toBeCloseTo(0.02, 6)
    expect(o.byScope).toEqual([{ key: 'Cabinet', count: 4 }])
    expect(o.bySampleRate).toEqual([{ key: '48k', count: 4 }])
    expect(o.byArchitecture.find((r) => r.key === 'a1')?.count).toBe(1)
    expect(o.byArchitecture.find((r) => r.key === 'a2')?.count).toBe(1)
    expect(o.byArchitecture.find((r) => r.key === 'unknown')?.count).toBe(2)
    const ampA = o.projects.find((p) => p.name === 'Amp A')!
    expect(ampA.trainedCount).toBe(2)
    expect(ampA.avgTrainedEsr).toBeCloseTo(0.02, 6)
    const ampB = o.projects.find((p) => p.name === 'Amp B')!
    expect(ampB.avgTrainedEsr).toBeNull()
  })
})
