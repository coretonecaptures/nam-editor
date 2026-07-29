// ESR tone + best-ESR selection helpers.
//
// A1 captures have a single scalar `metadata.training.validation_esr`. A2 captures
// contain two sub-models in one file. NAM's official trainer writes the AGGREGATE
// (sum of both sub-models' ESRs) to `validation_esr`, which makes A2 captures look
// about 2x worse than equivalent A1 ones when compared against A1 thresholds.
//
// NAM Lab may store per-sub-model values in one of two places:
// - metadata.nam_lab.a2_full_validation_esr / a2_lite_validation_esr
// - config.submodels[*].model.metadata.nam_lab.a2_full_validation_esr / a2_lite_validation_esr
//
// When a NAM-Lab-trained A2 capture has those fields, we use the FULL value with the
// regular A1 thresholds so A1 and A2 can be compared more directly.
//
// When a capture only has the aggregate (downloaded / official-trainer A2), we use
// looser thresholds since aggregate is bounded by roughly 2 * ESR_full in the best case.

export type EsrKind = 'a1' | 'a2_full' | 'a2_aggregate'
export type EsrTone = 'green' | 'amber' | 'red' | 'none'

export interface EsrToneInfo {
  text: string
  classes: string
  tone: EsrTone
}

export interface CaptureBestEsr {
  value: number | null
  kind: EsrKind
  label: string
  sourceField: string
}

function getTopLevelNamLab(meta: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!meta) return undefined
  const namLab = meta.nam_lab
  if (!namLab || typeof namLab !== 'object' || Array.isArray(namLab)) return undefined
  return namLab as Record<string, unknown>
}

function getSubmodelBlock(meta: Record<string, unknown> | undefined, index: number, blockKey: 'nam_lab' | 'nam_bot'): Record<string, unknown> | undefined {
  if (!meta) return undefined
  const config = meta.config as Record<string, unknown> | undefined
  const submodels = config?.submodels
  if (!Array.isArray(submodels) || !submodels[index] || typeof submodels[index] !== 'object') return undefined
  const model = (submodels[index] as Record<string, unknown>).model
  if (!model || typeof model !== 'object' || Array.isArray(model)) return undefined
  const metadata = (model as Record<string, unknown>).metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined
  const block = (metadata as Record<string, unknown>)[blockKey]
  if (!block || typeof block !== 'object' || Array.isArray(block)) return undefined
  return block as Record<string, unknown>
}

function getSubmodelNamLab(meta: Record<string, unknown> | undefined, index: number): Record<string, unknown> | undefined {
  return getSubmodelBlock(meta, index, 'nam_lab')
}

// Some A2 files (confirmed live: a pack trained through an older/external pipeline, not this
// app's own a2_full_validation_esr / a2_lite_validation_esr naming) instead store each
// sub-model's own ESR under a plain `validation_esr` key inside that sub-model's OWN
// nam_lab/nam_bot block — e.g. config.submodels[1].model.metadata.nam_lab.validation_esr.
// When that's all a file has, the named-field lookup above finds nothing, isA2Metadata still
// detects A2 via the architecture string, and the top-level aggregate field gets used instead
// — but in these files metadata.training.validation_esr is ALREADY identical to the Full
// sub-model's own value (verified byte-for-byte equal across a real sampled pack), not a true
// sum-of-both-submodels aggregate. Grading that value against the looser AGGREGATE thresholds
// (<0.02/<0.07) instead of the correct single-sub-model ones (<0.01/<0.05) silently inflated
// several files from "OK" to "Excellent". This fallback recovers the real per-sub-model value
// so getA2FullEsr/getA2LiteEsr succeed and the correct (stricter) thresholds apply.
function getSubmodelOwnEsr(meta: Record<string, unknown> | undefined, index: number): number | null {
  const fromNamLab = getSubmodelBlock(meta, index, 'nam_lab')?.validation_esr
  if (typeof fromNamLab === 'number') return fromNamLab
  const fromNamBot = getSubmodelBlock(meta, index, 'nam_bot')?.validation_esr
  if (typeof fromNamBot === 'number') return fromNamBot
  return null
}

function readNumericNamLabField(
  meta: Record<string, unknown> | undefined,
  field: string,
  submodelIndex?: number
): number | null {
  const fromTop = getTopLevelNamLab(meta)?.[field]
  if (typeof fromTop === 'number') return fromTop
  if (typeof submodelIndex === 'number') {
    const fromSubmodel = getSubmodelNamLab(meta, submodelIndex)?.[field]
    if (typeof fromSubmodel === 'number') return fromSubmodel
  }
  const config = meta?.config as Record<string, unknown> | undefined
  const submodels = config?.submodels
  if (Array.isArray(submodels)) {
    for (let i = 0; i < submodels.length; i += 1) {
      if (typeof submodelIndex === 'number' && i === submodelIndex) continue
      const fromAnySubmodel = getSubmodelNamLab(meta, i)?.[field]
      if (typeof fromAnySubmodel === 'number') return fromAnySubmodel
    }
  }
  return null
}

// Detect A2 from metadata structure. A2 usually reports architecture SlimmableContainer,
// or carries the A2 sub-model ESR fields somewhere in NAM Lab metadata.
function isA2Metadata(meta: Record<string, unknown> | undefined): boolean {
  if (!meta) return false
  if (typeof readNumericNamLabField(meta, 'a2_full_validation_esr', 1) === 'number') return true
  if (typeof readNumericNamLabField(meta, 'a2_lite_validation_esr', 0) === 'number') return true
  const config = meta.config as Record<string, unknown> | undefined
  if (config?.condition_dsp) return true
  const arch = meta.architecture
  if (typeof arch === 'string' && /SlimmableContainer/i.test(arch)) return true
  return false
}

export function getA2FullEsr(meta: Record<string, unknown> | undefined): number | null {
  const named = readNumericNamLabField(meta, 'a2_full_validation_esr', 1)
  if (typeof named === 'number') return named
  return getSubmodelOwnEsr(meta, 1)
}

export function getCaptureBestEsr(meta: Record<string, unknown> | undefined): CaptureBestEsr {
  if (!meta) return { value: null, kind: 'a1', label: 'Validation ESR', sourceField: '' }
  const training = meta.training as Record<string, unknown> | undefined

  const fullFromNamLab = getA2FullEsr(meta)
  if (typeof fullFromNamLab === 'number') {
    return {
      value: fullFromNamLab,
      kind: 'a2_full',
      label: 'A2 Full',
      sourceField: 'metadata.nam_lab.a2_full_validation_esr'
    }
  }

  if (isA2Metadata(meta)) {
    const agg = training?.validation_esr
    if (typeof agg === 'number') {
      return {
        value: agg,
        kind: 'a2_aggregate',
        label: 'A2 Aggregate',
        sourceField: 'metadata.training.validation_esr'
      }
    }
    return { value: null, kind: 'a2_aggregate', label: 'A2 Aggregate', sourceField: '' }
  }

  const a1 = training?.validation_esr
  if (typeof a1 === 'number') {
    return { value: a1, kind: 'a1', label: 'Validation ESR', sourceField: 'metadata.training.validation_esr' }
  }
  return { value: null, kind: 'a1', label: 'Validation ESR', sourceField: '' }
}

// Tone thresholds depend on the ESR kind:
// - A1 / A2 Full (single sub-model): <0.01 green, <0.05 amber, else red
// - A2 Aggregate (sum of two sub-models): looser thresholds because aggregate is about 2x.
export function getEsrTone(esr: number | null | undefined, kind: EsrKind = 'a1', digits = 6): EsrToneInfo {
  if (typeof esr !== 'number') {
    return { text: '-', classes: 'text-nm-text-3', tone: 'none' }
  }
  const thresholds = kind === 'a2_aggregate'
    ? { green: 0.02, amber: 0.07 }
    : { green: 0.01, amber: 0.05 }
  if (esr < thresholds.green) return { text: esr.toFixed(digits), classes: 'text-emerald-400', tone: 'green' }
  if (esr < thresholds.amber) return { text: esr.toFixed(digits), classes: 'text-amber-400', tone: 'amber' }
  return { text: esr.toFixed(digits), classes: 'text-red-400', tone: 'red' }
}

export function getEsrToneFromMeta(meta: Record<string, unknown> | undefined, digits = 6): EsrToneInfo & { kind: EsrKind; label: string } {
  const best = getCaptureBestEsr(meta)
  const tone = getEsrTone(best.value, best.kind, digits)
  return { ...tone, kind: best.kind, label: best.label }
}

export function getA2LiteEsr(meta: Record<string, unknown> | undefined): number | null {
  const named = readNumericNamLabField(meta, 'a2_lite_validation_esr', 0)
  if (typeof named === 'number') return named
  return getSubmodelOwnEsr(meta, 0)
}

export function getA2AggregateEsr(meta: Record<string, unknown> | undefined): number | null {
  if (!meta) return null
  if (!isA2Metadata(meta)) return null
  const t = meta.training as Record<string, unknown> | undefined
  const v = t?.validation_esr
  return typeof v === 'number' ? v : null
}

export { isA2Metadata }

export interface BestEsr {
  value: number | null
  kind: EsrKind
}

export function getBestJobEsr(job: {
  architecture?: string | null
  validationEsr: number | null
  validationEsrFull?: number | null
}): BestEsr {
  if (job.architecture === 'a2') {
    if (typeof job.validationEsrFull === 'number') return { value: job.validationEsrFull, kind: 'a2_full' }
    if (typeof job.validationEsr === 'number') return { value: job.validationEsr, kind: 'a2_aggregate' }
    return { value: null, kind: 'a2_aggregate' }
  }
  return { value: job.validationEsr, kind: 'a1' }
}

export function getBestLiveEsr(state: {
  architecture?: string | null
  epochValidationEsr?: number | null
  epochValidationEsrFull?: number | null
  epochValidationEsrAggregate?: number | null
  validationEsr?: number | null
}): BestEsr {
  if (state.architecture === 'a2') {
    if (typeof state.epochValidationEsrFull === 'number') return { value: state.epochValidationEsrFull, kind: 'a2_full' }
    const agg = state.epochValidationEsrAggregate ?? state.epochValidationEsr ?? state.validationEsr ?? null
    return { value: agg, kind: 'a2_aggregate' }
  }
  const val = state.epochValidationEsr ?? state.validationEsr ?? null
  return { value: val, kind: 'a1' }
}
