// ESR tone + best-ESR selection helpers.
//
// A1 captures have a single scalar `metadata.training.validation_esr`. A2 captures (PackedWaveNet)
// contain two sub-models in one file. NAM's official trainer writes the AGGREGATE (sum of both
// sub-models' ESRs) to `validation_esr`, which makes A2 captures look ~2x worse than equivalent
// A1 ones when compared against A1 thresholds.
//
// NAM Lab's training pipeline also writes per-sub-model values into the nam_lab block:
//   - metadata.nam_lab.a2_full_validation_esr  (channels_8 sub-model — what the plugin loads)
//   - metadata.nam_lab.a2_lite_validation_esr  (channels_3 sub-model)
//
// When a NAM-Lab-trained A2 capture has those nam_lab fields, we use the FULL value with the
// regular A1 thresholds so A1 and A2 can be compared apples-to-apples.
//
// When a capture only has the aggregate (downloaded / official-trainer A2), we use ~2x thresholds
// since aggregate is bounded by `2 * ESR_full` in the best case.

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
  label: string                  // human label e.g. "A2 Full", "A2 Aggregate", "Validation ESR"
  sourceField: string            // the metadata path it came from, for tooltips
}

// Detect A2 from metadata structure. A2 wraps layers inside a `condition_dsp` block, or carries
// any of the NAM Lab sub-model ESR fields.
function isA2Metadata(meta: Record<string, unknown> | undefined): boolean {
  if (!meta) return false
  const nl = meta.nam_lab as Record<string, unknown> | undefined
  if (typeof nl?.a2_full_validation_esr === 'number') return true
  if (typeof nl?.a2_lite_validation_esr === 'number') return true
  const config = meta.config as Record<string, unknown> | undefined
  if (config?.condition_dsp) return true
  // Some A2 files report architecture as 'SlimmableContainer'
  const arch = meta.architecture
  if (typeof arch === 'string' && /SlimmableContainer/i.test(arch)) return true
  return false
}

export function getCaptureBestEsr(meta: Record<string, unknown> | undefined): CaptureBestEsr {
  if (!meta) return { value: null, kind: 'a1', label: 'Validation ESR', sourceField: '' }
  const nl = meta.nam_lab as Record<string, unknown> | undefined
  const training = meta.training as Record<string, unknown> | undefined

  // 1. NAM Lab A2 — prefer the Full sub-model ESR (channels_8 = what the plugin loads).
  const fullFromNamLab = nl?.a2_full_validation_esr
  if (typeof fullFromNamLab === 'number') {
    return { value: fullFromNamLab, kind: 'a2_full', label: 'A2 Full', sourceField: 'metadata.nam_lab.a2_full_validation_esr' }
  }

  // 2. A2 without nam_lab full — only the aggregate is available.
  if (isA2Metadata(meta)) {
    const agg = training?.validation_esr
    if (typeof agg === 'number') {
      return { value: agg, kind: 'a2_aggregate', label: 'A2 Aggregate', sourceField: 'metadata.training.validation_esr' }
    }
    return { value: null, kind: 'a2_aggregate', label: 'A2 Aggregate', sourceField: '' }
  }

  // 3. A1 single ESR.
  const a1 = training?.validation_esr
  if (typeof a1 === 'number') {
    return { value: a1, kind: 'a1', label: 'Validation ESR', sourceField: 'metadata.training.validation_esr' }
  }
  return { value: null, kind: 'a1', label: 'Validation ESR', sourceField: '' }
}

// Tone thresholds depend on the ESR kind:
//   - A1 / A2 Full (single sub-model): <0.01 green, <0.05 amber, else red
//   - A2 Aggregate (sum of two sub-models): doubled because aggregate is bounded by 2*ESR_full
//     in the best case. The threshold table below approximates "A1 equivalent" tone.
export function getEsrTone(esr: number | null | undefined, kind: EsrKind = 'a1', digits = 6): EsrToneInfo {
  if (typeof esr !== 'number') {
    return { text: '—', classes: 'text-nm-text-3', tone: 'none' }
  }
  const thresholds = kind === 'a2_aggregate'
    ? { green: 0.02, amber: 0.07 }
    : { green: 0.01, amber: 0.05 }
  if (esr < thresholds.green) return { text: esr.toFixed(digits), classes: 'text-emerald-400', tone: 'green' }
  if (esr < thresholds.amber) return { text: esr.toFixed(digits), classes: 'text-amber-400', tone: 'amber' }
  return { text: esr.toFixed(digits), classes: 'text-red-400', tone: 'red' }
}

// Convenience: takes a capture's metadata, returns tone info using best-available ESR.
export function getEsrToneFromMeta(meta: Record<string, unknown> | undefined, digits = 6): EsrToneInfo & { kind: EsrKind; label: string } {
  const best = getCaptureBestEsr(meta)
  const tone = getEsrTone(best.value, best.kind, digits)
  return { ...tone, kind: best.kind, label: best.label }
}

// For the A2 Lite sub-model card display.
export function getA2LiteEsr(meta: Record<string, unknown> | undefined): number | null {
  if (!meta) return null
  const nl = meta.nam_lab as Record<string, unknown> | undefined
  const v = nl?.a2_lite_validation_esr
  return typeof v === 'number' ? v : null
}

// For the A2 Aggregate card display (the main validation_esr field on A2 captures, post the
// official-convention switch).
export function getA2AggregateEsr(meta: Record<string, unknown> | undefined): number | null {
  if (!meta) return null
  if (!isA2Metadata(meta)) return null
  const t = meta.training as Record<string, unknown> | undefined
  const v = t?.validation_esr
  return typeof v === 'number' ? v : null
}

export { isA2Metadata }

// ── Trainer-state / history helpers ──────────────────────────────────────────
// These work on TrainerHistoryEntry / TrainerQueueJob / TrainerStateSnapshot
// shapes — not on .nam file metadata.

export interface BestEsr {
  value: number | null
  kind: EsrKind
}

// Best ESR for a completed history entry or queue job.
// Prefers Full sub-model for A2 (same thresholds as A1); falls back to aggregate (2× thresholds).
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

// Best ESR for the live trainer state (per-epoch values).
// For A2, prefer the Full sub-model when available, otherwise fall back through:
//   aggregate callback -> generic epoch ESR -> final persisted validationEsr
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
