import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import {
  buildNamCaptureImportPayloads,
  type NamCaptureImportItem,
  type NamCaptureImportConfig,
  type NamCaptureImportDefaults,
  type ProfileResolver
} from './namCaptureTraining'

const tmp: string[] = []
afterEach(() => {
  for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true })
})

/** A pair of real (empty) files on disk so the existence check passes. */
function realPair(name: string): { excitationPath: string; recordingPath: string } {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'nam-train-'))
  tmp.push(dir)
  const excitationPath = join(dir, `${name}-exc.wav`)
  const recordingPath = join(dir, `${name}.wav`)
  fs.writeFileSync(excitationPath, '')
  fs.writeFileSync(recordingPath, '')
  return { excitationPath, recordingPath }
}

function item(name: string, extra: Partial<NamCaptureImportItem> = {}): NamCaptureImportItem {
  return {
    ...realPair(name),
    captureId: `id-${name}`,
    captureName: name,
    captureFolderPath: '/proj/NAM Captures',
    projectName: 'Proj',
    synthetic: false,
    ...extra
  }
}

const baseConfig: NamCaptureImportConfig = {
  pythonPath: '  /usr/bin/python  ',
  finalModelRoot: '  /models  ',
  architecture: 'standard',
  epochs: 100,
  thresholdEsr: null,
  latency: null,
  includeSynthetic: false
}
const defaults: NamCaptureImportDefaults = {
  normalizeWav: false,
  normalizeWavTargetDb: -5,
  modeledBy: 'Default Maker',
  inputLevelDbu: 12.5,
  outputLevelDbu: null
}
const stdProfile: ProfileResolver = (arch) =>
  arch === 'standard'
    ? { waveNetConfig: { layers_configs: [], head_scale: 0.02 }, lr: 0.01, lrDecay: 0.003, batchSize: 8, ny: 4096, fitMrstft: false }
    : null

describe('buildNamCaptureImportPayloads', () => {
  it('pairs each capture DI<->return and trims python/model paths', async () => {
    const a = item('A')
    const b = item('B')
    const { payloads, skipped } = await buildNamCaptureImportPayloads([a, b], baseConfig, defaults, stdProfile)
    expect(skipped).toEqual([])
    expect(payloads).toHaveLength(2)
    expect(payloads[0].inputPath).toBe(a.excitationPath)
    expect(payloads[0].outputPath).toBe(a.recordingPath)
    expect(payloads[0].pythonPath).toBe('/usr/bin/python')
    expect(payloads[0].trainPath).toBe('/models')
    expect(payloads[0].sourceMode).toBe('nam-capture-import')
    expect(payloads[0].namingTemplate).toBe('A')
    // profile config applied
    expect(payloads[0].lr).toBe(0.01)
    expect(payloads[0].batchSize).toBe(8)
    expect(payloads[0].namMode).toBe('a1')
  })

  it('skips synthetic captures unless includeSynthetic, and reports the skip', async () => {
    const real = item('real')
    const synth = item('synth', { synthetic: true })
    const off = await buildNamCaptureImportPayloads([real, synth], baseConfig, defaults, stdProfile)
    expect(off.payloads.map((p) => p.namCaptureName)).toEqual(['real'])
    expect(off.skipped).toEqual([{ captureName: 'synth', reason: 'synthetic' }])

    const on = await buildNamCaptureImportPayloads(
      [real, synth],
      { ...baseConfig, includeSynthetic: true },
      defaults,
      stdProfile
    )
    expect(on.payloads.map((p) => p.namCaptureName).sort()).toEqual(['real', 'synth'])
  })

  it('skips a capture whose WAVs are not on disk', async () => {
    const ghost: NamCaptureImportItem = {
      excitationPath: '/nope/exc.wav',
      recordingPath: '/nope/rec.wav',
      captureId: 'g',
      captureName: 'ghost',
      captureFolderPath: '/x',
      projectName: 'P',
      synthetic: false
    }
    const { payloads, skipped } = await buildNamCaptureImportPayloads([ghost, item('ok')], baseConfig, defaults, stdProfile)
    expect(payloads.map((p) => p.namCaptureName)).toEqual(['ok'])
    expect(skipped).toEqual([{ captureName: 'ghost', reason: 'not-on-disk' }])
  })

  it('capture calibration + hints win over the trainer-tab defaults; hints also carried as namSuggested*', async () => {
    const c = item('cal', {
      inputLevelDbu: 20,
      outputLevelDbu: 17.5,
      suggested: { modeledBy: 'Core Tone', gearMake: 'Two Rock', gearModel: 'Trad Clean', gearType: 'amp', toneType: 'clean' }
    })
    const { payloads } = await buildNamCaptureImportPayloads([c], baseConfig, defaults, stdProfile)
    const p = payloads[0]
    expect(p.inputLevelDbu).toBe(20)
    expect(p.outputLevelDbu).toBe(17.5)
    expect(p.modeledBy).toBe('Core Tone')
    expect(p.namSuggestedGearMake).toBe('Two Rock')
    expect(p.namSuggestedGearType).toBe('amp')
    expect(p.namSuggestedToneType).toBe('clean')

    // no calibration/hints -> falls back to defaults, namSuggested* null
    const { payloads: bare } = await buildNamCaptureImportPayloads([item('bare')], baseConfig, defaults, stdProfile)
    expect(bare[0].inputLevelDbu).toBe(12.5)
    expect(bare[0].modeledBy).toBe('Default Maker')
    expect(bare[0].namSuggestedGearMake).toBeNull()
  })

  it('a2 architecture -> namMode a2, no profile lookup, null captureProfileId', async () => {
    const { payloads } = await buildNamCaptureImportPayloads(
      [item('x')],
      { ...baseConfig, architecture: 'a2' },
      defaults,
      stdProfile
    )
    expect(payloads[0].namMode).toBe('a2')
    expect(payloads[0].captureProfileId).toBeNull()
    expect(payloads[0].waveNetConfig).toBeNull()
  })

  it('stamps the submission on every payload when given one', async () => {
    const sub = { id: 's1', label: 'Proj — 2', createdAt: '2026-08-31T00:00:00.000Z' }
    const { payloads } = await buildNamCaptureImportPayloads(
      [item('a'), item('b')],
      { ...baseConfig, submission: sub },
      defaults,
      stdProfile
    )
    expect(payloads.every((p) => p.submissionId === 's1' && p.submissionLabel === 'Proj — 2')).toBe(true)
  })

  it('returns nothing when python path / model root / architecture is blank', async () => {
    const r1 = await buildNamCaptureImportPayloads([item('a')], { ...baseConfig, pythonPath: '   ' }, defaults, stdProfile)
    expect(r1.payloads).toEqual([])
    const r2 = await buildNamCaptureImportPayloads([item('a')], { ...baseConfig, finalModelRoot: '' }, defaults, stdProfile)
    expect(r2.payloads).toEqual([])
  })
})
