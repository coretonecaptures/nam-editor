import { describe, expect, it } from 'vitest'
import {
  availableFacets,
  isQueueEligible,
  matchesFacets,
  sortProjects,
  toBatchItem,
  deriveCaptureStatus,
  type FacetState
} from './NamProjectsShell'
import type { NamCaptureRow } from '../../types/namProjects'
import type { TrainerQueueJob } from '../../types/trainer'

/** Top-10 NAM Projects to-do item: "pure helpers already extractable and untested" (TODO.md ->
 * UI test harness, tier 1). Not extracted into src/renderer/src/lib/ as the doc's own
 * Modularization item eventually wants -- that's real surgery on a 2400-line file; this pass only
 * exports the existing functions as-is and tests them from outside, zero behavior change. */

const emptyFacets: FacetState = {
  scope: [],
  sampleRate: [],
  gearType: [],
  toneType: [],
  calibration: [],
  architecture: []
}

function makeCapture(overrides: Partial<NamCaptureRow> = {}): NamCaptureRow {
  return {
    itemId: 'item-1',
    captureId: 'cap0001',
    captureName: 'FMAN100 Crunch 1',
    captureScope: 'DirectAmp',
    sampleRate: 48000,
    measuredLatencySamples: 128,
    synthetic: false,
    syntheticSourceIrName: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    excitationPath: '/proj/_excitations/sweep-abc123-48000hz.wav',
    excitationSourceName: 'sweep.wav',
    stimulusSha256: null,
    recordingPath: '/proj/NAM Captures/FMAN100 Crunch 1.wav',
    captureFolderPath: '/proj/NAM Captures',
    recordingBitDepth: 24,
    recordingChannels: 1,
    recordingDurationSec: 8.5,
    audioFormat: 'PCM',
    recordingFile: null,
    calibration: null,
    suggested: null,
    effective: {
      modeledBy: null,
      gearMake: null,
      gearModel: null,
      gearType: null,
      toneType: null,
      inputLevelDbu: null,
      outputLevelDbu: null
    },
    metadataEdited: false,
    trained: false,
    result: null,
    modelFile: null,
    graphExists: false,
    ...overrides
  }
}

function makeQueueJob(overrides: Partial<TrainerQueueJob> = {}): TrainerQueueJob {
  return {
    jobId: 'job-1',
    status: 'queued',
    pythonPath: '/usr/bin/python3',
    inputPath: '/proj/NAM Captures/FMAN100 Crunch 1.wav',
    outputPath: '/out',
    trainPath: '/train',
    namMode: 'a1',
    architecture: 'standard',
    waveNetConfig: null,
    lr: 0.01,
    lrDecay: 0.0001,
    batchSize: 16,
    ny: 8192,
    fitMrstft: false,
    normalizeWav: false,
    normalizeWavTargetDb: -18,
    captureProfileId: null,
    epochs: 1000,
    latency: null,
    thresholdEsr: null,
    savePlot: true,
    silent: false,
    ignoreChecks: false,
    modelName: 'FMAN100 Crunch 1',
    outputModelPath: '/out/FMAN100 Crunch 1.nam',
    checkpointModelPath: '/train/checkpoint.ckpt',
    attempts: 0,
    startedAt: null,
    finishedAt: null,
    error: '',
    validationEsr: null,
    progressPercent: null,
    progressEpochCurrent: null,
    progressEpochTotal: null,
    progressBatchCurrent: null,
    progressBatchTotal: null,
    progressRate: null,
    progressLatestLine: '',
    profileId: null,
    profileName: null,
    modeledBy: null,
    inputLevelDbu: null,
    outputLevelDbu: null,
    sourceMode: 'nam-capture-import',
    finalModelRoot: '/out',
    processedWavRoot: '/processed',
    graphRoot: '/graph',
    graphRootResolved: true,
    sourcePostProcess: 'keep',
    workspacePath: '/workspace',
    graphPath: '/graph/plot.png',
    sourceSizeBytes: null,
    sourceMtimeMs: null,
    submissionId: null,
    submissionLabel: null,
    submissionCreatedAt: null,
    namCaptureId: 'cap0001',
    ...overrides
  }
}

describe('deriveCaptureStatus', () => {
  it('trained wins regardless of queue state', () => {
    expect(deriveCaptureStatus(makeCapture({ trained: true }), [makeQueueJob({ status: 'error' })])).toBe('trained')
  })

  it('missing when either WAV path is absent, even with a matching queue job', () => {
    expect(deriveCaptureStatus(makeCapture({ excitationPath: null }), [])).toBe('missing')
    expect(deriveCaptureStatus(makeCapture({ recordingPath: null }), [makeQueueJob()])).toBe('missing')
  })

  it('queued / training / failed derive from the matching queue job by namCaptureId', () => {
    const c = makeCapture({ captureId: 'cap0001' })
    expect(deriveCaptureStatus(c, [makeQueueJob({ status: 'staged' })])).toBe('queued')
    expect(deriveCaptureStatus(c, [makeQueueJob({ status: 'queued' })])).toBe('queued')
    expect(deriveCaptureStatus(c, [makeQueueJob({ status: 'running' })])).toBe('training')
    expect(deriveCaptureStatus(c, [makeQueueJob({ status: 'starting' })])).toBe('training')
    expect(deriveCaptureStatus(c, [makeQueueJob({ status: 'error' })])).toBe('failed')
  })

  it('falls back to untrained when no job matches this capture', () => {
    const c = makeCapture({ captureId: 'cap0001' })
    expect(deriveCaptureStatus(c, [makeQueueJob({ namCaptureId: 'some-other-capture' })])).toBe('untrained')
    expect(deriveCaptureStatus(c, [])).toBe('untrained')
  })

  it('a canceled or succeeded job does not itself flip status — falls back to untrained/trained', () => {
    const c = makeCapture({ captureId: 'cap0001' })
    expect(deriveCaptureStatus(c, [makeQueueJob({ status: 'canceled' })])).toBe('untrained')
    expect(deriveCaptureStatus(c, [makeQueueJob({ status: 'success' })])).toBe('untrained')
  })

  it('matches by itemId fallback when captureId is null, same as toBatchItem', () => {
    const c = makeCapture({ captureId: null, itemId: 'item-xyz' })
    expect(deriveCaptureStatus(c, [makeQueueJob({ namCaptureId: 'item-xyz', status: 'running' })])).toBe('training')
  })
})

describe('sortProjects', () => {
  const a = { name: 'Bravo', createdAt: '2026-09-01T00:00:00.000Z', captureCount: 4, trainedCount: 2 }
  const b = { name: 'Alpha', createdAt: '2026-09-03T00:00:00.000Z', captureCount: 4, trainedCount: 0 }
  const c = { name: 'Charlie', createdAt: null, captureCount: 0, trainedCount: 0 }

  it('name: locale-alphabetical', () => {
    expect(sortProjects([a, b, c], 'name').map((p) => p.name)).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })

  it('newest: most recent createdAt first, missing date sorts last (not first)', () => {
    expect(sortProjects([a, b, c], 'newest').map((p) => p.name)).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })

  it('leastTrained: lowest trained-fraction first; an empty project (0/0) ranks as fully untrained', () => {
    // a: 2/4 = 0.5, b: 0/4 = 0, c: 0/0 -> treated as 0 (no divide-by-zero, no NaN)
    const sorted = sortProjects([a, b, c], 'leastTrained')
    expect(sorted.map((p) => p.name)).toEqual(['Alpha', 'Charlie', 'Bravo'])
  })

  it('does not mutate the input array', () => {
    const input = [a, b, c]
    const copy = [...input]
    sortProjects(input, 'name')
    expect(input).toEqual(copy)
  })
})

describe('matchesFacets', () => {
  it('with no active facets, matches everything', () => {
    expect(matchesFacets(makeCapture(), emptyFacets)).toBe(true)
  })

  it('ANDs across different facet fields', () => {
    const c = makeCapture({ captureScope: 'DirectAmp', sampleRate: 48000 })
    const okBoth: FacetState = { ...emptyFacets, scope: ['DirectAmp'], sampleRate: ['48k'] }
    const failsOne: FacetState = { ...emptyFacets, scope: ['DirectAmp'], sampleRate: ['44.1k'] }
    expect(matchesFacets(c, okBoth)).toBe(true)
    expect(matchesFacets(c, failsOne)).toBe(false)
  })

  it('ORs within one facet field', () => {
    const c = makeCapture({ captureScope: 'Device' })
    const f: FacetState = { ...emptyFacets, scope: ['DirectAmp', 'Device'] }
    expect(matchesFacets(c, f)).toBe(true)
  })

  it('calibration facet distinguishes calibrated / uncalibrated / a specific confidence', () => {
    const calibrated = makeCapture({
      calibration: { inputLevelDbu: 12, outputLevelDbu: -3, method: 'tone', confidence: 'high', profileName: null, calibratedAt: null }
    })
    const uncalibrated = makeCapture({ calibration: null })
    expect(matchesFacets(calibrated, { ...emptyFacets, calibration: ['calibrated'] })).toBe(true)
    expect(matchesFacets(uncalibrated, { ...emptyFacets, calibration: ['calibrated'] })).toBe(false)
    expect(matchesFacets(uncalibrated, { ...emptyFacets, calibration: ['uncalibrated'] })).toBe(true)
    expect(matchesFacets(calibrated, { ...emptyFacets, calibration: ['conf:high'] })).toBe(true)
    expect(matchesFacets(calibrated, { ...emptyFacets, calibration: ['conf:low'] })).toBe(false)
  })
})

describe('availableFacets', () => {
  it('tallies scope/rate/gearType/toneType/architecture and sorts by count desc, then alpha', () => {
    const caps = [
      makeCapture({ captureScope: 'DirectAmp' }),
      makeCapture({ captureScope: 'DirectAmp' }),
      makeCapture({ captureScope: 'Device' })
    ]
    const facets = availableFacets(caps)
    expect(facets.scope).toEqual([
      { value: 'DirectAmp', count: 2 },
      { value: 'Device', count: 1 }
    ])
  })

  it('splits calibrated/uncalibrated counts and adds a per-confidence breakdown', () => {
    const caps = [
      makeCapture({ calibration: { inputLevelDbu: 1, outputLevelDbu: null, method: null, confidence: 'high', profileName: null, calibratedAt: null } }),
      makeCapture({ calibration: null })
    ]
    const facets = availableFacets(caps)
    expect(facets.calibration).toEqual([
      { value: 'calibrated', count: 1, label: 'Calibrated' },
      { value: 'uncalibrated', count: 1, label: 'Uncalibrated' },
      { value: 'conf:high', count: 1, label: 'high' }
    ])
  })

  it('an empty capture list yields empty facet lists, not an error', () => {
    const facets = availableFacets([])
    expect(facets.scope).toEqual([])
    expect(facets.calibration).toEqual([])
  })
})

describe('isQueueEligible', () => {
  it('requires untrained + both WAV paths present', () => {
    expect(isQueueEligible(makeCapture(), false)).toBe(true)
    expect(isQueueEligible(makeCapture({ trained: true }), false)).toBe(false)
    expect(isQueueEligible(makeCapture({ excitationPath: null }), false)).toBe(false)
    expect(isQueueEligible(makeCapture({ recordingPath: null }), false)).toBe(false)
  })

  it('excludes a synthetic capture unless includeSynthetic is true', () => {
    const synthetic = makeCapture({ synthetic: true })
    expect(isQueueEligible(synthetic, false)).toBe(false)
    expect(isQueueEligible(synthetic, true)).toBe(true)
  })
})

describe('toBatchItem', () => {
  it('effective metadata wins over the IR Lab suggestion when both are present', () => {
    const c = makeCapture({
      effective: { modeledBy: 'Me', gearMake: 'Suhr', gearModel: null, gearType: null, toneType: null, inputLevelDbu: 5, outputLevelDbu: null },
      suggested: { name: 'x', modeledBy: 'IR Lab guess', gearMake: 'Fender', gearModel: 'Deluxe', gearType: 'amp', toneType: 'clean' },
      calibration: { inputLevelDbu: -1, outputLevelDbu: -2, method: null, confidence: null, profileName: null, calibratedAt: null }
    })
    const item = toBatchItem(c, 'My Project')
    // effective.modeledBy/gearMake win outright; effective.gearModel/gearType/toneType are null
    // so those three fall back to the IR Lab suggestion.
    expect(item.suggested).toEqual({
      modeledBy: 'Me',
      gearMake: 'Suhr',
      gearModel: 'Deluxe',
      gearType: 'amp',
      toneType: 'clean'
    })
    // inputLevelDbu falls back to calibration only when effective is null -- effective wins here.
    expect(item.inputLevelDbu).toBe(5)
    expect(item.outputLevelDbu).toBe(-2) // effective null -> falls back to calibration
    expect(item.projectName).toBe('My Project')
    expect(item.synthetic).toBe(false)
  })

  it('suggested is null on the batch item when every metadata field is null on both sides', () => {
    const item = toBatchItem(makeCapture(), 'P')
    expect(item.suggested).toBeNull()
    expect(item.inputLevelDbu).toBeNull()
    expect(item.outputLevelDbu).toBeNull()
  })

  it('captureId falls back to itemId when the sidecar never set one', () => {
    const item = toBatchItem(makeCapture({ captureId: null, itemId: 'fallback-id' }), 'P')
    expect(item.captureId).toBe('fallback-id')
  })
})
