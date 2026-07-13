import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { AppSettings, TrainingPreset, UserCaptureProfile } from '../types/settings'
import { HelpPopover } from './HelpPopover'
import { OutputFormulaField } from './OutputFormulaField'
import { CaptureProfileEditor } from './CaptureProfileEditor'
import type { TrainerArchitecture } from '../types/trainer'

const ARCHITECTURE_LABELS: Record<TrainerArchitecture, string> = {
  a2: 'A2',
  standard: 'Standard',
  complex: 'Complex',
  lite: 'Lite',
  feather: 'Feather',
  nano: 'Nano',
  revystd: 'REVySTD',
  revyhi: 'REVyHI',
  revxstd: 'REVxSTD',
}

const ARCHITECTURE_DISPLAY_ORDER: TrainerArchitecture[] = ['a2', 'standard', 'complex', 'lite', 'feather', 'nano', 'revystd', 'revyhi', 'revxstd']

function architectureFullLabel(arch: string): string {
  if (arch === 'a2') return 'A2'
  const short = ARCHITECTURE_LABELS[arch as TrainerArchitecture]
  return short ? `A1 - ${short}` : arch
}

function presetSignature(preset: TrainingPreset): string {
  return JSON.stringify({
    name: preset.name,
    architectures: preset.architectures,
    epochs: preset.epochs,
    thresholdEsr: preset.thresholdEsr,
    latencyMode: preset.latencyMode,
    latencyValue: preset.latencyValue,
    savePlot: preset.savePlot,
    ignoreChecks: preset.ignoreChecks,
  })
}

function buildNewPreset(nextIndex: number): TrainingPreset {
  return {
    id: `training-preset-${Date.now()}-${nextIndex}`,
    name: `Preset ${nextIndex}`,
    architectures: ['standard'],
    epochs: 1000,
    thresholdEsr: null,
    latencyMode: 'auto',
    latencyValue: null,
    savePlot: true,
    ignoreChecks: false,
    namingTemplate: '{basename}',
  }
}

type Props = {
  settings: AppSettings
  onSaveSettings: (settings: AppSettings) => void
  onOpenSettings?: (tab?: 'global' | 'defaults' | 'metadata' | 'pack' | 'training') => void
}

export function TrainingPresetsPage({ settings, onSaveSettings, onOpenSettings }: Props) {
  const [captureProfileEditorOpen, setCaptureProfileEditorOpen] = useState(false)
  const [captureProfileEditorTarget, setCaptureProfileEditorTarget] = useState<UserCaptureProfile | null>(null)
  const [newItemId, setNewItemId] = useState<string | null>(null)
  const [collapsedPresetIds, setCollapsedPresetIds] = useState<Set<string>>(new Set())
  const newItemRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!newItemId || !newItemRef.current) return
    newItemRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    setNewItemId(null)
  }, [newItemId])

  useEffect(() => {
    setCollapsedPresetIds((prev) => {
      const validIds = new Set(settings.trainingPresets.map((preset) => preset.id))
      const next = new Set<string>()
      for (const presetId of prev) {
        if (validIds.has(presetId)) next.add(presetId)
      }
      return next.size === prev.size ? prev : next
    })
  }, [settings.trainingPresets])

  const duplicatePresetIds = useMemo(() => {
    return new Set(
      settings.trainingPresets
        .map((preset) => presetSignature(preset))
        .filter((sig, index, arr) => arr.indexOf(sig) !== index)
        .flatMap((sig) => settings.trainingPresets.filter((preset) => presetSignature(preset) === sig).map((preset) => preset.id))
    )
  }, [settings.trainingPresets])

  const favoritePreset = useMemo(
    () => settings.trainingFavoritePresetId
      ? settings.trainingPresets.find((preset) => preset.id === settings.trainingFavoritePresetId) ?? null
      : null,
    [settings.trainingFavoritePresetId, settings.trainingPresets]
  )

  const commitPresetList = (nextPresets: TrainingPreset[]) => {
    const nextFavoritePresetId =
      settings.trainingFavoritePresetId && nextPresets.some((preset) => preset.id === settings.trainingFavoritePresetId)
        ? settings.trainingFavoritePresetId
        : ''
    const nextLastSelectedPresetId =
      settings.trainingLastSelectedPresetId && nextPresets.some((preset) => preset.id === settings.trainingLastSelectedPresetId)
        ? settings.trainingLastSelectedPresetId
        : ''
    onSaveSettings({
      ...settings,
      trainingPresets: nextPresets,
      trainingFavoritePresetId: nextFavoritePresetId,
      trainingLastSelectedPresetId: nextLastSelectedPresetId,
    })
  }

  const updatePreset = (presetId: string, patch: Partial<TrainingPreset>) => {
    commitPresetList(settings.trainingPresets.map((preset) => (
      preset.id === presetId ? { ...preset, ...patch } : preset
    )))
  }

  const addPreset = () => {
    const nextPreset = buildNewPreset(settings.trainingPresets.length + 1)
    commitPresetList([...settings.trainingPresets, nextPreset])
    setNewItemId(nextPreset.id)
  }

  const duplicatePreset = (presetId: string) => {
    const source = settings.trainingPresets.find((preset) => preset.id === presetId)
    if (!source) return
    const clone: TrainingPreset = {
      ...source,
      id: `training-preset-${Date.now()}`,
      name: `${source.name} (copy)`,
    }
    commitPresetList([...settings.trainingPresets, clone])
    setNewItemId(clone.id)
  }

  const deletePreset = (presetId: string) => {
    commitPresetList(settings.trainingPresets.filter((preset) => preset.id !== presetId))
  }

  const toggleFavoritePreset = (presetId: string) => {
    onSaveSettings({
      ...settings,
      trainingFavoritePresetId: settings.trainingFavoritePresetId === presetId ? '' : presetId,
    })
  }

  const saveCaptureProfile = (saved: UserCaptureProfile) => {
    const existing = settings.userCaptureProfiles ?? []
    const updated = existing.some((profile) => profile.id === saved.id)
      ? existing.map((profile) => profile.id === saved.id ? saved : profile)
      : [...existing, saved]
    onSaveSettings({ ...settings, userCaptureProfiles: updated })
    setCaptureProfileEditorOpen(false)
    setCaptureProfileEditorTarget(null)
  }

  const togglePresetCollapse = (presetId: string) => {
    setCollapsedPresetIds((prev) => {
      const next = new Set(prev)
      if (next.has(presetId)) next.delete(presetId)
      else next.add(presetId)
      return next
    })
  }

  const expandAllPresets = () => setCollapsedPresetIds(new Set())

  const collapseAllPresets = () => setCollapsedPresetIds(new Set(settings.trainingPresets.map((preset) => preset.id)))

  return (
    <>
      <div className="px-6 py-5 space-y-4 max-w-[1400px] mx-auto w-full">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <h2 className="text-[18px] font-[680] text-nm-text">Presets</h2>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-panel-2 border border-nm-border-s text-nm-text-3">
              {settings.trainingPresets.length} preset{settings.trainingPresets.length === 1 ? '' : 's'}
            </span>
            <HelpPopover title="Training Presets" side="right">
              Presets are reusable training recipes for <strong>New Run</strong>, <strong>Quick Add</strong>, and watch folders.
              <br /><br />
              The <strong>starred preset</strong> is the one Quick Add / Dashboard uses by default.
              <br /><br />
              Bundles stay in <strong>Settings -&gt; Training</strong> for now. This page focuses on presets only.
            </HelpPopover>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {settings.trainingPresets.length > 1 && (
              <>
                <button
                  onClick={expandAllPresets}
                  className="h-9 inline-flex items-center px-2.5 rounded-[9px] text-[11.5px] font-medium border border-nm-border-s bg-panel-2 hover:bg-hov text-nm-text-2 transition-colors"
                >
                  Expand all
                </button>
                <button
                  onClick={collapseAllPresets}
                  className="h-9 inline-flex items-center px-2.5 rounded-[9px] text-[11.5px] font-medium border border-nm-border-s bg-panel-2 hover:bg-hov text-nm-text-2 transition-colors"
                >
                  Collapse all
                </button>
              </>
            )}
            {onOpenSettings && (
              <button
                onClick={() => onOpenSettings('training')}
                className="h-8 px-3 rounded-lg text-[12px] font-medium border border-nm-border-s bg-panel-2 hover:bg-hov text-nm-text-2 transition-colors"
              >
                Training settings
              </button>
            )}
            <button
              onClick={addPreset}
              className="h-8 px-3 rounded-lg text-[12px] font-semibold bg-nm-accent/15 border border-nm-accent/30 hover:bg-nm-accent/25 text-nm-accent transition-colors inline-flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Add preset
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-nm-border-s bg-panel-2 px-4 py-3 flex items-center gap-3 flex-wrap">
          <div className="w-8 h-8 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          </div>
          <div className="flex-1 min-w-[220px]">
            <div className="text-[12px] font-semibold text-nm-text">Quick Add favorite</div>
            <div className="text-[11px] text-nm-text-3">
              {favoritePreset
                ? `Dashboard Quick Add currently uses "${favoritePreset.name}".`
                : 'No favorite preset selected. Quick Add will fall back to a default Standard recipe.'}
            </div>
          </div>
          <div className="text-[11px] text-nm-text-3">
            Star any preset below to make it the Dashboard default.
          </div>
        </div>

        {settings.trainingPresets.length === 0 ? (
          <div className="rounded-2xl border border-nm-border-s bg-panel-2 p-8 text-center">
            <div className="text-[14px] font-semibold text-nm-text">No training presets yet</div>
            <div className="mt-1 text-[12px] text-nm-text-3">
              Add a preset to store reusable training recipes for New Run, Quick Add, and watch folders.
            </div>
            <button
              onClick={addPreset}
              className="mt-4 h-8 px-3 rounded-lg text-[12px] font-semibold bg-nm-accent/15 border border-nm-accent/30 hover:bg-nm-accent/25 text-nm-accent transition-colors"
            >
              Add first preset
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {settings.trainingPresets.map((preset, presetIndex) => {
              const isFavorite = settings.trainingFavoritePresetId === preset.id
              const isCollapsed = collapsedPresetIds.has(preset.id)
              const presetSummary = [
                preset.architectures.length > 0 ? preset.architectures.map((architecture) => architectureFullLabel(architecture)).join(', ') : 'No architectures',
                `${preset.epochs} epochs`,
                typeof preset.thresholdEsr === 'number' ? `Target ESR ${preset.thresholdEsr}` : 'No ESR target',
              ].join(' · ')
              return (
                <div
                  key={preset.id}
                  ref={preset.id === newItemId ? newItemRef : undefined}
                  className="rounded-2xl border border-nm-border-s bg-panel overflow-hidden shadow-sm"
                >
                  <div className="flex items-center gap-2 px-4 py-3 bg-panel-2 border-b border-nm-border-s">
                    <button
                      onClick={() => togglePresetCollapse(preset.id)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg border border-nm-border-s bg-panel hover:bg-hov text-nm-text-3 hover:text-nm-text transition-colors flex-shrink-0"
                      title={isCollapsed ? 'Expand preset' : 'Collapse preset'}
                    >
                      <svg className={`w-3.5 h-3.5 transition-transform ${isCollapsed ? '' : 'rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                      </svg>
                    </button>
                    <span className="w-6 h-6 flex items-center justify-center rounded-lg text-[11px] font-bold bg-field border border-field-bd text-nm-text-3 flex-shrink-0 tabular-nums">
                      {presetIndex + 1}
                    </span>
                    <input
                      type="text"
                      value={preset.name}
                      onChange={(event) => updatePreset(preset.id, { name: event.target.value })}
                      className="flex-1 h-9 px-3 bg-field border border-field-bd rounded-lg text-[13px] font-medium text-nm-text focus:outline-none focus:border-nm-accent"
                    />
                    <span className="hidden xl:block max-w-[340px] truncate text-[11px] text-nm-text-3">
                      {presetSummary}
                    </span>
                    <button
                      onClick={() => toggleFavoritePreset(preset.id)}
                      title={isFavorite ? 'Unset Quick Add favorite' : 'Use for Quick Add / Dashboard'}
                      className={`w-9 h-9 flex items-center justify-center rounded-lg border transition-colors ${
                        isFavorite
                          ? 'border-amber-400/40 bg-amber-500/15 text-amber-300'
                          : 'border-nm-border-s bg-panel hover:bg-amber-500/10 text-nm-text-3 hover:text-amber-300'
                      }`}
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => duplicatePreset(preset.id)}
                      title="Duplicate preset"
                      className="w-9 h-9 flex items-center justify-center rounded-lg border border-nm-border-s bg-panel hover:bg-hov text-nm-text-3 hover:text-nm-text transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
                      </svg>
                    </button>
                    <button
                      onClick={() => deletePreset(preset.id)}
                      title="Remove preset"
                      className="w-9 h-9 flex items-center justify-center rounded-lg border border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {duplicatePresetIds.has(preset.id) && (
                    <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-[11px] text-amber-300 flex items-center gap-1.5">
                      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                      </svg>
                      Exact duplicate of another preset. Change at least one field if this should behave differently.
                    </div>
                  )}

                  {!isCollapsed && (
                    <div className="px-4 py-4 space-y-4">
                    {isFavorite && (
                      <div className="rounded-xl border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                        Starred preset. Quick Add / Dashboard will use this recipe by default.
                      </div>
                    )}

                    <div className="grid gap-3 grid-cols-[minmax(0,1fr)_110px_170px_120px]">
                      <PresetField
                        label="Architecture(s)"
                        help={<>Pick one or more architectures. A2 produces one packed file with Full + Lite submodels. A1 selections fan out into one job per selected architecture. Custom capture profiles appear alongside the built-ins.</>}
                      >
                        <PresetArchitectureMultiSelect
                          values={preset.architectures}
                          onChange={(next) => updatePreset(preset.id, { architectures: next })}
                          userProfiles={settings.userCaptureProfiles ?? []}
                          onCreateProfile={() => {
                            setCaptureProfileEditorTarget(null)
                            setCaptureProfileEditorOpen(true)
                          }}
                          onEditProfile={(profile) => {
                            setCaptureProfileEditorTarget(profile)
                            setCaptureProfileEditorOpen(true)
                          }}
                        />
                      </PresetField>
                      <PresetField label="Epochs">
                        <input
                          type="number"
                          min={1}
                          value={preset.epochs}
                          onChange={(event) => updatePreset(preset.id, { epochs: Math.max(1, Number(event.target.value) || 1) })}
                          className="w-full h-10 px-3 bg-field border border-field-bd rounded-lg text-[13px] text-nm-text focus:outline-none focus:border-nm-accent"
                        />
                      </PresetField>
                      <PresetField label="Latency">
                        <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-2">
                          <select
                            value={preset.latencyMode}
                            onChange={(event) => updatePreset(preset.id, { latencyMode: event.target.value as TrainingPreset['latencyMode'] })}
                            className="w-full h-10 px-3 bg-field border border-field-bd rounded-lg text-[13px] text-nm-text focus:outline-none focus:border-nm-accent"
                          >
                            <option value="auto">Auto</option>
                            <option value="manual">Manual</option>
                          </select>
                          <input
                            type="number"
                            min={0}
                            value={preset.latencyValue ?? ''}
                            disabled={preset.latencyMode !== 'manual'}
                            onChange={(event) => updatePreset(preset.id, { latencyValue: event.target.value === '' ? null : Math.max(0, Number(event.target.value) || 0) })}
                            placeholder="Samples"
                            className="w-full h-10 px-3 bg-field border border-field-bd rounded-lg text-[13px] text-nm-text focus:outline-none focus:border-nm-accent disabled:opacity-50"
                          />
                        </div>
                      </PresetField>
                      <PresetField label="Target ESR" labelTitle="Leave blank to turn it off">
                        <input
                          type="number"
                          min={0}
                          step="0.0001"
                          value={preset.thresholdEsr ?? ''}
                          onChange={(event) => updatePreset(preset.id, { thresholdEsr: event.target.value === '' ? null : Number(event.target.value) })}
                          placeholder="Off"
                          className="w-full h-10 px-3 bg-field border border-field-bd rounded-lg text-[13px] text-nm-text focus:outline-none focus:border-nm-accent"
                        />
                      </PresetField>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <PresetToggle label="Save ESR plot" checked={preset.savePlot} onChange={(value) => updatePreset(preset.id, { savePlot: value })} />
                      <PresetToggle label="Ignore checks" checked={preset.ignoreChecks} onChange={(value) => updatePreset(preset.id, { ignoreChecks: value })} />
                      <PresetField label="Normalize WAV" hint="Override global setting">
                        <div className="flex items-center gap-2">
                          <select
                            value={preset.normalizeWav ?? 'global'}
                            onChange={(event) => updatePreset(preset.id, { normalizeWav: event.target.value as 'global' | 'on' | 'off' })}
                            className="h-10 px-3 bg-field border border-field-bd rounded-lg text-[13px] text-nm-text focus:outline-none focus:border-nm-accent"
                          >
                            <option value="global">Global</option>
                            <option value="on">On</option>
                            <option value="off">Off</option>
                          </select>
                          {(preset.normalizeWav ?? 'global') !== 'off' && (
                            <>
                              <input
                                type="number"
                                step="0.5"
                                max="0"
                                min="-30"
                                value={preset.normalizeWavTargetDb ?? ''}
                                onChange={(event) => updatePreset(preset.id, { normalizeWavTargetDb: event.target.value === '' ? null : Number(event.target.value) })}
                                placeholder={String(settings.normalizeWavTargetDb ?? -5.0)}
                                className="w-20 h-10 px-3 bg-field border border-field-bd rounded-lg text-[13px] text-nm-text focus:outline-none focus:border-nm-accent"
                              />
                              <span className="text-[11px] text-nm-text-3">dBFS</span>
                            </>
                          )}
                        </div>
                      </PresetField>
                    </div>

                    <PresetField label="NAM output path formula" hint="Leave blank to inherit the global output formula">
                      <OutputFormulaField
                        value={preset.outputFormulaOverride ?? ''}
                        onChange={(value) => updatePreset(preset.id, { outputFormulaOverride: value })}
                        exampleStagingPath={settings.namTrainingInputWav ? settings.namTrainingInputWav.replace(/\\/g, '/').split('/').slice(0, -1).join('/') : undefined}
                        exampleArchitecture={preset.architectures[0]}
                        isPresetOverride
                        globalFormula={settings.trainingOutputFormula ?? ''}
                      />
                    </PresetField>

                    <PresetField label="Graph output path formula" hint="Leave blank to inherit the global graph formula">
                      <OutputFormulaField
                        value={preset.graphOutputFormulaOverride ?? ''}
                        onChange={(value) => updatePreset(preset.id, { graphOutputFormulaOverride: value })}
                        exampleStagingPath={settings.namTrainingInputWav ? settings.namTrainingInputWav.replace(/\\/g, '/').split('/').slice(0, -1).join('/') : undefined}
                        exampleArchitecture={preset.architectures[0]}
                        isPresetOverride
                        globalFormula={settings.trainingGraphFormula ?? ''}
                        suggestionFormula="../../Graphs/{folder}/{architecture}"
                      />
                    </PresetField>

                    <PresetField label="Naming template" hint="Use {basename} for the source WAV filename without extension">
                      <input
                        value={preset.namingTemplate ?? '{basename}'}
                        onChange={(event) => updatePreset(preset.id, { namingTemplate: event.target.value })}
                        placeholder="{basename}"
                        className="w-full h-10 px-3 bg-field border border-field-bd rounded-lg text-[13px] text-nm-text focus:outline-none focus:border-nm-accent font-mono"
                      />
                    </PresetField>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {captureProfileEditorOpen && (
        <CaptureProfileEditor
          profile={captureProfileEditorTarget}
          onSave={saveCaptureProfile}
          onCancel={() => {
            setCaptureProfileEditorOpen(false)
            setCaptureProfileEditorTarget(null)
          }}
        />
      )}
    </>
  )
}

function PresetField({
  label,
  hint,
  labelTitle,
  help,
  children,
}: {
  label: string
  hint?: string
  labelTitle?: string
  help?: ReactNode
  children: ReactNode
}) {
  return (
    <div>
      <div className="flex items-center gap-1 mb-1.5">
        <label title={labelTitle} className={`text-[11px] font-[600] text-nm-text-2 ${labelTitle ? 'cursor-help' : ''}`}>
          {label}
          {labelTitle && (
            <span className="ml-1 inline-flex align-middle text-nm-text-3" aria-hidden="true">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                <circle cx="12" cy="12" r="8.25" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 10.25v5" />
                <circle cx="12" cy="7.75" r="0.75" fill="currentColor" stroke="none" />
              </svg>
            </span>
          )}
          {hint && <span className="ml-2 text-nm-text-3 font-normal">{hint}</span>}
        </label>
        {help && <HelpPopover>{help}</HelpPopover>}
      </div>
      {children}
    </div>
  )
}

function PresetToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`h-10 px-3 rounded-xl border text-left transition-colors flex items-center gap-2 ${
        checked
          ? 'border-nm-accent/40 bg-nm-accent/10 text-nm-text'
          : 'border-nm-border-s bg-panel-2 hover:bg-hov text-nm-text-2'
      }`}
    >
      <span className={`w-4 h-4 rounded-full border flex items-center justify-center ${checked ? 'border-nm-accent bg-nm-accent' : 'border-nm-text-3/50'}`}>
        {checked && <span className="w-1.5 h-1.5 rounded-full bg-accent-text" />}
      </span>
      <span className="text-[12px] font-medium">{label}</span>
    </button>
  )
}

function PresetArchitectureMultiSelect({
  values,
  onChange,
  userProfiles = [],
  onCreateProfile,
  onEditProfile,
}: {
  values: string[]
  onChange: (next: string[]) => void
  userProfiles?: UserCaptureProfile[]
  onCreateProfile?: () => void
  onEditProfile?: (profile: UserCaptureProfile) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const allOptions = [
    ...ARCHITECTURE_DISPLAY_ORDER.map((id) => ({ id, name: architectureFullLabel(id) })),
    ...userProfiles.map((profile) => ({ id: profile.id, name: profile.name })),
  ]
  const label = values.length === 0
    ? 'Choose profiles'
    : values.length === 1
      ? (allOptions.find((option) => option.id === values[0])?.name ?? values[0])
      : `${values.length} selected`

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="w-full h-10 px-3 bg-field border border-field-bd rounded-lg text-[13px] text-nm-text focus:outline-none focus:border-nm-accent flex items-center justify-between gap-3"
      >
        <span className="truncate">{label}</span>
        <svg className={`w-3.5 h-3.5 flex-shrink-0 text-nm-text-3 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <div className="absolute z-30 mt-2 w-full rounded-xl border border-nm-border bg-panel shadow-xl overflow-hidden">
          <div className="max-h-64 overflow-y-auto p-2 space-y-1">
            <div className="px-2.5 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-nm-text-3">Built-in</div>
            {ARCHITECTURE_DISPLAY_ORDER.map((option) => {
              const checked = values.includes(option)
              return (
                <label key={option} className={`flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer text-[13px] ${checked ? 'bg-nm-accent/10 text-nm-accent' : 'text-nm-text-2 hover:bg-hov'}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => {
                      if (event.target.checked) onChange([...values, option])
                      else onChange(values.filter((item) => item !== option))
                    }}
                    className="accent-nm-accent"
                  />
                  <span>{architectureFullLabel(option)}</span>
                </label>
              )
            })}
            {userProfiles.length > 0 && (
              <div className="px-2.5 pt-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-nm-text-3 border-t border-nm-border-s mt-1">Custom</div>
            )}
            {userProfiles.map((profile) => {
              const checked = values.includes(profile.id)
              return (
                <div key={profile.id} className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 ${checked ? 'bg-nm-accent/10' : 'hover:bg-hov'}`}>
                  <label className="flex items-center gap-2 flex-1 cursor-pointer text-[13px]">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => {
                        if (event.target.checked) onChange([...values, profile.id])
                        else onChange(values.filter((item) => item !== profile.id))
                      }}
                      className="accent-nm-accent"
                    />
                    <span className={checked ? 'text-nm-accent' : 'text-nm-text-2'}>{profile.name}</span>
                  </label>
                  {onEditProfile && (
                    <button
                      onClick={() => {
                        onEditProfile(profile)
                        setOpen(false)
                      }}
                      className="text-[10px] text-nm-text-3 hover:text-nm-text px-1"
                    >
                      Edit
                    </button>
                  )}
                </div>
              )
            })}
            {onCreateProfile && (
              <button
                onClick={() => {
                  onCreateProfile()
                  setOpen(false)
                }}
                className="w-full text-left px-2.5 py-1.5 text-[11px] text-nm-accent hover:bg-hov border-t border-nm-border-s mt-1"
              >
                + New capture profile...
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
