import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { createCoreSchema } from './schema'
import { importLibrary } from './importLibrary'
import { enrichNamCaptures, listNamProjects, getNamProjectDetail, getNamLibraryOverview } from './namCaptureEnrichment'
import { writeNamLabResult, namLabResultPathFor } from './namCaptureResult'
import { queryItems, countItems } from './queryLibrary'

const tmpDirs: string[] = []
function makeTmpDir(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'nam-capture-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

/**
 * schemaVersion 2 on-disk shape, per NamCaptureStore.cpp:
 *   <root>/<Project>/_excitations/<shared>.wav
 *   <root>/<Project>/NAM Captures/<Capture Name>.wav + <Capture Name>.nam-capture.json
 * `excitation` in the sidecar is a relative path with `../` into _excitations/.
 */
function writeProject(
  root: string,
  project: { id: string; name: string },
  captures: Array<{
    captureName: string
    captureId: string
    recording?: string // defaults to "<captureName>.wav"
    synthetic?: boolean
    calibration?: boolean
    suggested?: boolean
  }>
): void {
  const projectDir = join(root, project.name)
  const capturesDir = join(projectDir, 'NAM Captures')
  const excDir = join(projectDir, '_excitations')
  fs.mkdirSync(capturesDir, { recursive: true })
  fs.mkdirSync(excDir, { recursive: true })
  fs.writeFileSync(join(excDir, 'shared-di-abc123-48000hz.wav'), 'x'.repeat(4096))

  for (const c of captures) {
    const recording = c.recording ?? `${c.captureName}.wav`
    fs.writeFileSync(join(capturesDir, recording), 'y'.repeat(4096))
    const json: Record<string, unknown> = {
      schemaVersion: 2,
      captureId: c.captureId,
      captureName: c.captureName,
      createdAt: '2026-08-30T12:00:00.000Z',
      app: 'IR Lab',
      captureScope: 'Cabinet',
      excitation: '../_excitations/shared-di-abc123-48000hz.wav',
      recording,
      excitationSourceName: 'Reamp DI',
      sampleRate: 48000,
      measuredLatencySamples: 384,
      projectId: project.id,
      projectName: project.name
    }
    if (c.synthetic) {
      json.synthetic = true
      json.syntheticSourceIrName = 'Mesa4x12.wav'
    }
    if (c.calibration) {
      json.calibration = {
        inputLevelDbu: 12.4,
        outputLevelDbu: 4.0,
        method: 'precision',
        confidence: 'meter-verified',
        profileName: 'Test Rig',
        calibratedAt: '2026-08-30T08:00:00.000Z'
      }
    }
    if (c.suggested) {
      json.modelMetadataSuggested = {
        name: c.captureName,
        modeledBy: 'Test Maker',
        gearMake: 'Fender',
        gearModel: 'Bassman',
        gearType: 'amp_cab',
        toneType: 'crunch'
      }
    }
    // Sidecar shares the recording's basename.
    const stem = recording.replace(/\.wav$/i, '')
    fs.writeFileSync(join(capturesDir, `${stem}.nam-capture.json`), JSON.stringify(json))
  }
}

/** "Amp A" — 2 real (one calibrated + hinted, one whose recording filename differs from the
 * capture name), "Amp B" — 1 real + 1 synthetic. */
function makeFixture(): { root: string } {
  const root = makeTmpDir()
  writeProject(root, { id: 'proj-a', name: 'Amp A' }, [
    { captureName: 'Amp A — Clean', captureId: 'cap0001', calibration: true, suggested: true },
    { captureName: 'Amp A — Crunch', captureId: 'cap0002', recording: 'take-2.wav' }
  ])
  writeProject(root, { id: 'proj-b', name: 'Amp B' }, [
    { captureName: 'Amp B — Lead', captureId: 'cap0003' },
    { captureName: 'Amp B — Synthetic', captureId: 'cap0004', synthetic: true }
  ])
  return { root }
}

function recordingPathOf(db: DatabaseSync, captureId: string): string {
  return (db.prepare(`SELECT recording_path r FROM nam_capture_item WHERE capture_id = ?`).get(captureId) as { r: string }).r
}

describe('enrichNamCaptures (schemaVersion 2)', () => {
  it('globs *.nam-capture.json per folder, groups by projectId, resolves ../ excitation paths', async () => {
    const { root } = makeFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })

    const enrich = enrichNamCaptures(db, stats.libraryRootId)
    expect(enrich.projectsFound).toBe(2)
    expect(enrich.capturesEnriched).toBe(4)
    expect(enrich.syntheticCaptures).toBe(1)

    // 4 recordings promoted; 2 shared excitations stay kind='ir'.
    const kinds = db
      .prepare(`SELECT kind, COUNT(*) as n FROM item GROUP BY kind ORDER BY kind`)
      .all() as Array<{ kind: string; n: number }>
    expect(kinds).toEqual([
      { kind: 'ir', n: 2 },
      { kind: 'nam_capture', n: 4 }
    ])

    // excitation resolved from the sidecar's own '../_excitations/...' relative path.
    const clean = db
      .prepare(`SELECT excitation_path e, recording_path r FROM nam_capture_item WHERE capture_id = 'cap0001'`)
      .get() as { e: string; r: string }
    expect(clean.e.replace(/\\/g, '/').endsWith('/Amp A/_excitations/shared-di-abc123-48000hz.wav')).toBe(true)
    expect(clean.e.includes('..')).toBe(false) // normalized
    expect(clean.r.replace(/\\/g, '/').endsWith('/Amp A/NAM Captures/Amp A — Clean.wav')).toBe(true)

    // recording resolved from the JSON field, not the sidecar stem — cap0002 -> take-2.wav.
    expect(recordingPathOf(db, 'cap0002').replace(/\\/g, '/').endsWith('/NAM Captures/take-2.wav')).toBe(true)

    // calibration -> input/output_level_dbu (+ provenance); modelMetadataSuggested -> suggested_*.
    const row = db
      .prepare(
        `SELECT input_level_dbu i, output_level_dbu o, calibration_method m, calibration_confidence c,
                suggested_gear_type gt, suggested_tone_type tt, suggested_modeled_by mb
         FROM nam_capture_item WHERE capture_id = 'cap0001'`
      )
      .get() as Record<string, unknown>
    expect(row.i).toBe(12.4)
    expect(row.o).toBe(4)
    expect(row.m).toBe('precision')
    expect(row.c).toBe('meter-verified')
    expect(row.gt).toBe('amp_cab')
    expect(row.tt).toBe('crunch')
    expect(row.mb).toBe('Test Maker')

    // cap0002 carried neither block.
    const bare = db
      .prepare(`SELECT input_level_dbu i, suggested_gear_type gt FROM nam_capture_item WHERE capture_id = 'cap0002'`)
      .get() as { i: number | null; gt: string | null }
    expect(bare.i).toBeNull()
    expect(bare.gt).toBeNull()
  })

  it('exposes calibration + suggested blocks (only when present) on the detail rows', async () => {
    const { root } = makeFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    enrichNamCaptures(db, stats.libraryRootId)

    const ampA = listNamProjects(db).find((p) => p.name === 'Amp A')!
    const detail = getNamProjectDetail(db, ampA.collectionId)!
    const clean = detail.captures.find((c) => c.captureId === 'cap0001')!
    expect(clean.calibration?.inputLevelDbu).toBe(12.4)
    expect(clean.suggested?.gearType).toBe('amp_cab')
    const crunch = detail.captures.find((c) => c.captureId === 'cap0002')!
    expect(crunch.calibration).toBeNull()
    expect(crunch.suggested).toBeNull()
  })

  it('keeps NAM recordings AND the shared _excitations WAV out of the IR browse/counts', async () => {
    const { root } = makeFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    enrichNamCaptures(db, stats.libraryRootId)

    // 4 recordings (kind='nam_capture') + 2 shared excitations (kind='ir', in _excitations/).
    expect(db.prepare(`SELECT COUNT(*) c FROM item`).get()).toEqual({ c: 6 })
    // IR mode's browse sees none of them.
    expect(queryItems(db, { offset: 0, limit: 50 })).toEqual([])
    expect(countItems(db, { offset: 0, limit: 50 })).toBe(0)
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

  it('trained state comes from <CaptureName>.nam-lab-result.json beside the recording WAV', async () => {
    const { root } = makeFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    enrichNamCaptures(db, stats.libraryRootId)

    const ampA = listNamProjects(db).find((p) => p.name === 'Amp A')!
    expect(getNamProjectDetail(db, ampA.collectionId)!.trainedCount).toBe(0)

    const rec = recordingPathOf(db, 'cap0001')
    writeNamLabResult(rec, {
      trainedAt: '2026-08-30T00:00:00.000Z',
      modelName: 'Amp A — Clean',
      architecture: 'a1',
      validationEsr: 0.012,
      outputModelPath: 'x.nam',
      trainerJobId: 'job-1'
    })
    // sidecar landed next to the WAV, named after the capture.
    expect(namLabResultPathFor(rec).replace(/\\/g, '/').endsWith('/NAM Captures/Amp A — Clean.nam-lab-result.json')).toBe(true)

    const detail = getNamProjectDetail(db, ampA.collectionId)!
    expect(detail.trainedCount).toBe(1)
    expect(detail.captures.find((c) => c.captureId === 'cap0001')!.result?.validationEsr).toBe(0.012)
    expect(detail.captures.find((c) => c.captureId === 'cap0002')!.trained).toBe(false)
  })

  it('getNamLibraryOverview aggregates coverage, breakdowns and per-project ESR', async () => {
    const { root } = makeFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    enrichNamCaptures(db, stats.libraryRootId)

    writeNamLabResult(recordingPathOf(db, 'cap0001'), {
      trainedAt: '2026-08-30T00:00:00.000Z', modelName: 'A Clean', architecture: 'a1',
      validationEsr: 0.01, outputModelPath: 'x.nam', trainerJobId: 'j1'
    })
    writeNamLabResult(recordingPathOf(db, 'cap0002'), {
      trainedAt: '2026-08-30T00:00:00.000Z', modelName: 'A Crunch', architecture: 'a2',
      validationEsr: 0.03, outputModelPath: 'y.nam', trainerJobId: 'j2'
    })

    const o = getNamLibraryOverview(db)
    expect(o.totalProjects).toBe(2)
    expect(o.totalCaptures).toBe(4)
    expect(o.trainedCaptures).toBe(2)
    expect(o.syntheticCaptures).toBe(1)
    expect(o.avgTrainedEsr).toBeCloseTo(0.02, 6)
    expect(o.byScope).toEqual([{ key: 'Cabinet', count: 4 }])
    expect(o.bySampleRate).toEqual([{ key: '48k', count: 4 }])
    expect(o.byArchitecture.find((r) => r.key === 'a1')?.count).toBe(1)
    expect(o.byArchitecture.find((r) => r.key === 'a2')?.count).toBe(1)
    expect(o.byArchitecture.find((r) => r.key === 'unknown')?.count).toBe(2)
    const ampA = o.projects.find((p) => p.name === 'Amp A')!
    expect(ampA.avgTrainedEsr).toBeCloseTo(0.02, 6)
    expect(o.projects.find((p) => p.name === 'Amp B')!.avgTrainedEsr).toBeNull()
  })
})
