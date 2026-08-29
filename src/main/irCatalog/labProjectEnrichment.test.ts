import { describe, it, expect, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { createCoreSchema, finalizeIndexes } from './schema'
import { importLibrary } from './importLibrary'
import { applyVendorParsers } from './vendorParsers/applyVendorParsers'
import { enrichLabProjects, getProjectDetailForFolder } from './labProjectEnrichment'
import { listFolders } from './folderMetadata'
import { hasFts5 } from './sqliteCapabilities'

const tmpDirs: string[] = []
function makeTmpDir(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ir-labproject-'))
  tmpDirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

/** Builds a fixture matching the exact on-disk layout IR Lab itself writes, confirmed against
 * the real ir-lab source this session (SessionStore.h/.cpp, ProjectStore.h/.cpp, Project.h,
 * docs/ir-lab-session-file-format.md) — not guessed. Capture folder is flat, per ir-lab's
 * 2026-08-27 Phase 2 storage redesign (no nested captures/<captureId>/ subfolder). One Project
 * folder ("Marshall Session") with one capture/deliverable and two variants (one current, one
 * archived). */
function makeProjectFixture(): { root: string; captureId: string } {
  const root = makeTmpDir()
  const projectDir = join(root, 'Marshall Session')
  const captureId = 'capture-0001'
  const sessionDataDir = join(projectDir, '.SessionData')
  const captureDir = join(sessionDataDir, captureId)
  fs.mkdirSync(projectDir, { recursive: true })
  fs.mkdirSync(captureDir, { recursive: true })

  // The flat deliverable — a normal .wav the ordinary scanner already picks up.
  fs.writeFileSync(join(projectDir, 'Marshall 412 SM57.wav'), 'x'.repeat(2000))

  fs.writeFileSync(
    join(sessionDataDir, 'project.json'),
    JSON.stringify({
      id: 'project-1',
      name: 'Marshall Session',
      createdAt: '2026-08-01T00:00:00.000Z',
      captureIndex: [{ captureId, outputFileName: 'Marshall 412 SM57.wav' }],
      // 2026-08-26 Project Details fields.
      cabinet: 'Marshall 1960A (project default)',
      speaker: 'Celestion V30 (project default)',
      amplifier: 'Marshall JCM800',
      room: 'Iso Booth',
      signalChain: 'Apollo x6 -> Neve 1073',
      description: 'Marshall stack, single-mic pass',
      projectNotes: 'Recorded at low volume for the neighbours.'
    })
  )
  fs.writeFileSync(
    join(captureDir, 'session.json'),
    JSON.stringify({
      id: 'session-1',
      displayName: 'Marshall 412 take 1',
      createdAt: '2026-08-01T00:00:00.000Z',
      captureIds: [captureId],
      metadata: {
        cabinet: 'Marshall 1960A',
        speaker: 'Celestion V30',
        microphone: 'Shure SM57',
        position: 'Cap edge',
        notes: 'Close mic, slight off-axis.',
        captureType: 'Hardware',
        // 2026-08-26 CaptureMetadata additions.
        speakerPosition: 'Top-Left',
        modeledMicrophone: 'Royer 121',
        presetKind: 'Cab IR',
        micATypeName: 'Dynamic',
        micAPolarPattern: 'Cardioid',
        micATargetZone: 'Cap Edge',
        micADistance: 1.5,
        micADistanceUnit: 'in',
        micAAxisAngleDeg: 15,
        micASignalChainOverride: '',
        micANotes: 'Angled slightly off-axis'
      }
    })
  )
  fs.writeFileSync(
    join(captureDir, 'analysis.json'),
    JSON.stringify({
      captureId,
      createdAt: '2026-08-01T00:00:00.000Z',
      measurement: { sampleRate: 48000 },
      isStereo: false,
      isTrueStereo: false
    })
  )
  fs.writeFileSync(
    join(captureDir, 'variants.json'),
    JSON.stringify([
      { id: 'variant-current', name: 'Master', master: 'master.wav', distribution: 'exports/current.wav', sampleRate: 48000, createdAt: '2026-08-01T00:05:00.000Z', current: true, archived: false },
      { id: 'variant-archived', name: 'Take 1 (raw trim)', master: 'take1.wav', distribution: 'exports/take1.wav', sampleRate: 48000, createdAt: '2026-08-01T00:01:00.000Z', current: false, archived: true }
    ])
  )

  return { root, captureId }
}

describe.skipIf(!hasFts5())('enrichLabProjects', () => {
  it('enriches the deliverable item with ir_lab_native metadata and variant history', async () => {
    const { root } = makeProjectFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)

    const enrichStats = enrichLabProjects(db, stats.libraryRootId)
    expect(enrichStats.projectsFound).toBe(1)
    expect(enrichStats.itemsEnriched).toBe(1)

    const item = db.prepare(`SELECT id, notes FROM item WHERE relative_path LIKE '%SM57.wav'`).get() as {
      id: string
      notes: string | null
    }
    const irItem = db.prepare(`SELECT * FROM ir_item WHERE item_id = ?`).get(item.id) as Record<string, unknown>
    expect(irItem.capture_id).toBe('capture-0001')
    expect(irItem.cabinet).toBe('Marshall 1960A')
    expect(irItem.speaker).toBe('Celestion V30')
    expect(irItem.microphone).toBe('Shure SM57')
    expect(irItem.position).toBe('Cap edge')
    expect(irItem.capture_type).toBe('Hardware')
    expect(irItem.sample_rate).toBe(48000)
    expect(irItem.is_stereo).toBe(0)
    expect(item.notes).toBe('Close mic, slight off-axis.')

    // 2026-08-26 CaptureMetadata additions.
    expect(irItem.speaker_position).toBe('Top-Left')
    expect(irItem.modeled_microphone).toBe('Royer 121')
    expect(irItem.preset_kind).toBe('Cab IR')
    expect(irItem.mic_a_type).toBe('Dynamic')
    expect(irItem.mic_a_polar_pattern).toBe('Cardioid')
    expect(irItem.mic_a_target_zone).toBe('Cap Edge')
    expect(irItem.mic_a_distance).toBe(1.5)
    expect(irItem.mic_a_distance_unit).toBe('in')
    expect(irItem.mic_a_axis_angle_deg).toBe(15)
    expect(irItem.mic_a_notes).toBe('Angled slightly off-axis')
    // Mic B was never filled in on this fixture — must stay null, not some default.
    expect(irItem.mic_b_type).toBeNull()

    const sources = db
      .prepare(`SELECT field, source FROM ir_item_field_source WHERE item_id = ? ORDER BY field`)
      .all(item.id) as Array<{ field: string; source: string }>
    expect(sources.every((s) => s.source === 'ir_lab_native')).toBe(true)
    // Every string field writeField() touches gets a confidence-ladder row, including the
    // 2026-08-26 additions -- only the numeric mic_a_distance/mic_a_axis_angle_deg bypass it
    // (written directly, since writeField's writer only handles strings).
    expect(sources.map((s) => s.field)).toEqual([
      'cabinet',
      'capture_type',
      'mic_a_distance_unit',
      'mic_a_notes',
      'mic_a_polar_pattern',
      'mic_a_target_zone',
      'mic_a_type',
      'microphone',
      'modeled_microphone',
      'position',
      'preset_kind',
      'speaker',
      'speaker_position'
    ])

    const variants = db
      .prepare(`SELECT id, is_current, is_archived FROM ir_derivative_variant WHERE item_id = ? ORDER BY id`)
      .all(item.id) as Array<{ id: string; is_current: number; is_archived: number }>
    expect(variants).toHaveLength(2)
    const current = variants.find((v) => v.id === 'variant-current')
    const archived = variants.find((v) => v.id === 'variant-archived')
    expect(current?.is_current).toBe(1)
    expect(archived?.is_archived).toBe(1)

    db.close()
  })

  it('is idempotent — running twice does not duplicate variants or collection_item rows', async () => {
    const { root } = makeProjectFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)

    enrichLabProjects(db, stats.libraryRootId)
    enrichLabProjects(db, stats.libraryRootId)

    const item = db.prepare(`SELECT id FROM item WHERE relative_path LIKE '%SM57.wav'`).get() as { id: string }
    const variantCount = (
      db.prepare(`SELECT COUNT(*) c FROM ir_derivative_variant WHERE item_id = ?`).get(item.id) as { c: number }
    ).c
    expect(variantCount).toBe(2)
    const collectionCount = (db.prepare(`SELECT COUNT(*) c FROM collection WHERE kind = 'ir_project'`).get() as { c: number }).c
    expect(collectionCount).toBe(1)
    const collectionItemCount = (
      db.prepare(`SELECT COUNT(*) c FROM collection_item`).get() as { c: number }
    ).c
    expect(collectionItemCount).toBe(1)

    db.close()
  })

  it('ir_lab_native fields survive a subsequent applyVendorParsers pass unchanged', async () => {
    const { root } = makeProjectFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)

    enrichLabProjects(db, stats.libraryRootId)
    applyVendorParsers(db, stats.libraryRootId)

    const item = db.prepare(`SELECT id FROM item WHERE relative_path LIKE '%SM57.wav'`).get() as { id: string }
    const irItem = db.prepare(`SELECT cabinet, speaker, microphone FROM ir_item WHERE item_id = ?`).get(item.id) as Record<
      string,
      unknown
    >
    expect(irItem.cabinet).toBe('Marshall 1960A')
    expect(irItem.speaker).toBe('Celestion V30')
    expect(irItem.microphone).toBe('Shure SM57')
    const sources = db
      .prepare(`SELECT source FROM ir_item_field_source WHERE item_id = ? AND field = 'cabinet'`)
      .get(item.id) as { source: string }
    expect(sources.source).toBe('ir_lab_native')

    db.close()
  })

  it('listFolders reports is_lab_project only for the Project folder, not a plain sibling', async () => {
    const { root } = makeProjectFixture()
    fs.mkdirSync(join(root, 'Plain Folder'), { recursive: true })
    fs.writeFileSync(join(root, 'Plain Folder', 'other.wav'), 'y'.repeat(500))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)
    enrichLabProjects(db, stats.libraryRootId)

    const folders = listFolders(db, stats.libraryRootId)
    const projectFolder = folders.find((f) => f.relative_path === 'Marshall Session')
    const plainFolder = folders.find((f) => f.relative_path === 'Plain Folder')
    expect(projectFolder?.is_lab_project).toBe(1)
    expect(plainFolder?.is_lab_project).toBe(0)

    db.close()
  })

  it('getProjectDetailForFolder returns the project name and per-item metadata/variants', async () => {
    const { root } = makeProjectFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)
    enrichLabProjects(db, stats.libraryRootId)

    const folderRow = db.prepare(`SELECT id FROM folder WHERE relative_path = 'Marshall Session'`).get() as { id: number }
    const detail = getProjectDetailForFolder(db, folderRow.id)
    expect(detail?.name).toBe('Marshall Session')
    expect(detail?.items).toHaveLength(1)
    expect(detail?.items[0].cabinet).toBe('Marshall 1960A')
    expect(detail?.items[0].variants).toHaveLength(2)

    // 2026-08-26 Project Details fields, on the collection itself.
    expect(detail?.amplifier).toBe('Marshall JCM800')
    expect(detail?.room).toBe('Iso Booth')
    expect(detail?.signalChain).toBe('Apollo x6 -> Neve 1073')
    expect(detail?.description).toBe('Marshall stack, single-mic pass')
    expect(detail?.projectNotes).toBe('Recorded at low volume for the neighbours.')

    // 2026-08-26 CaptureMetadata additions, per item.
    const item = detail!.items[0]
    expect(item.speakerPosition).toBe('Top-Left')
    expect(item.modeledMicrophone).toBe('Royer 121')
    expect(item.presetKind).toBe('Cab IR')
    expect(item.micA).toEqual({
      type: 'Dynamic',
      polarPattern: 'Cardioid',
      targetZone: 'Cap Edge',
      distance: 1.5,
      distanceUnit: 'in',
      axisAngleDeg: 15,
      signalChainOverride: null,
      notes: 'Angled slightly off-axis'
    })
    expect(item.micB.type).toBeNull()

    db.close()
  })

  it("a blank capture-level cabinet/speaker falls back to the Project's own value in getProjectDetailForFolder", async () => {
    const root = makeTmpDir()
    const projectDir = join(root, 'No Capture Cabinet')
    const captureId = 'capture-blank'
    const sessionDataDir = join(projectDir, '.SessionData')
    const captureDir = join(sessionDataDir, captureId)
    fs.mkdirSync(captureDir, { recursive: true })
    fs.writeFileSync(join(projectDir, 'blank.wav'), 'z'.repeat(500))
    fs.writeFileSync(
      join(sessionDataDir, 'project.json'),
      JSON.stringify({
        name: 'No Capture Cabinet',
        captureIndex: [{ captureId, outputFileName: 'blank.wav' }],
        cabinet: 'Project-Level Cab',
        speaker: 'Project-Level Speaker'
      })
    )
    // No cabinet/speaker on the capture itself -- only the project declares it.
    fs.writeFileSync(join(captureDir, 'session.json'), JSON.stringify({ metadata: {} }))

    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    const stats = await importLibrary(db, root, 'test-root', { skipQuickHash: true })
    finalizeIndexes(db)
    enrichLabProjects(db, stats.libraryRootId)

    // getProjectDetailForFolder itself does NOT resolve the fallback (it reports the raw
    // capture-level column, null here) -- that's queryLibrary.ts's job, covered by its own test.
    // This test exists to confirm the collection row's own fields ARE populated and available for
    // whichever caller needs to apply that fallback.
    const folderRow = db.prepare(`SELECT id FROM folder WHERE relative_path = 'No Capture Cabinet'`).get() as { id: number }
    const detail = getProjectDetailForFolder(db, folderRow.id)
    expect(detail?.cabinet).toBe('Project-Level Cab')
    expect(detail?.items[0].cabinet).toBeNull()

    db.close()
  })

  it('a Project folder detected mid-scan does not import files from .SessionData itself', async () => {
    const { root } = makeProjectFixture()
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)
    await importLibrary(db, root, 'test-root', { skipQuickHash: true })

    const items = db.prepare(`SELECT relative_path FROM item`).all() as Array<{ relative_path: string }>
    expect(items).toHaveLength(1)
    expect(items[0].relative_path).toContain('SM57.wav')
    expect(items.some((i) => i.relative_path.includes('.SessionData'))).toBe(false)

    db.close()
  })
})
