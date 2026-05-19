import React, { useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { BUILT_IN_CAPTURE_PROFILES, type CaptureProfile, type WaveNetLayerConfig, type WaveNetConfig } from '../types/trainer'
import type { UserCaptureProfile } from '../types/settings'

interface CaptureProfileEditorProps {
  profile: UserCaptureProfile | null
  onSave: (profile: UserCaptureProfile) => void
  onCancel: () => void
}

const DEFAULT_LR = 0.004
const DEFAULT_LR_DECAY = 0.002
const DEFAULT_EPOCHS = 1000
const DEFAULT_BATCH_SIZE = 16
const DEFAULT_NY = 8192

function makeBlankLayer(inputSize = 1): WaveNetLayerConfig {
  return {
    input_size: inputSize,
    condition_size: 1,
    channels: 8,
    head_size: 8,
    kernel_size: 3,
    dilations: [1, 2, 4, 8, 16, 32, 64, 128, 256, 512],
    activation: 'Tanh',
    gated: false,
    head_bias: false,
  }
}

function parseDilations(raw: string): number[] | null {
  try {
    const trimmed = raw.trim()
    if (!trimmed) return null
    const parts = trimmed.split(',').map((s) => s.trim()).filter(Boolean)
    const nums = parts.map(Number)
    if (nums.some((n) => !Number.isFinite(n) || n <= 0)) return null
    return nums
  } catch {
    return null
  }
}

function extractNamBotConfig(raw: string): { layers_configs?: WaveNetLayerConfig[]; head_scale?: number; lr?: number; lr_decay?: number } | null {
  try {
    const parsed = JSON.parse(raw)
    const asLayers = (arr: unknown): WaveNetLayerConfig[] | null => {
      if (!Array.isArray(arr)) return null
      const layers: WaveNetLayerConfig[] = []
      for (const item of arr) {
        if (typeof item !== 'object' || item === null) return null
        const l = item as Record<string, unknown>
        layers.push({
          input_size: typeof l['input_size'] === 'number' ? l['input_size'] : 1,
          condition_size: typeof l['condition_size'] === 'number' ? l['condition_size'] : 1,
          channels: typeof l['channels'] === 'number' ? l['channels'] : 8,
          head_size: typeof l['head_size'] === 'number' ? l['head_size'] : 8,
          kernel_size: typeof l['kernel_size'] === 'number' ? l['kernel_size'] : 3,
          dilations: Array.isArray(l['dilations']) ? l['dilations'].filter((d) => typeof d === 'number') : [1],
          activation: 'Tanh',
          gated: l['gated'] === true,
          head_bias: l['head_bias'] === true,
        })
      }
      return layers.length > 0 ? layers : null
    }

    // Direct layers_configs array
    if (Array.isArray(parsed)) {
      const layers = asLayers(parsed)
      return layers ? { layers_configs: layers } : null
    }

    if (typeof parsed !== 'object' || parsed === null) return null
    const obj = parsed as Record<string, unknown>

    // NAM-BOT: expert.model.net.config.layers_configs
    const expertModel = (obj['expert'] as Record<string, unknown>)?.['model'] as Record<string, unknown> | undefined
    const netCfg = (expertModel?.['net'] as Record<string, unknown>)?.['config'] as Record<string, unknown> | undefined
    if (netCfg?.['layers_configs']) {
      const layers = asLayers(netCfg['layers_configs'])
      const headScale = typeof netCfg['head_scale'] === 'number' ? netCfg['head_scale'] : undefined
      const lr = typeof (expertModel?.['optimizer'] as Record<string, unknown>)?.['lr'] === 'number'
        ? (expertModel?.['optimizer'] as Record<string, unknown>)['lr'] as number
        : undefined
      const lrDecay = typeof (expertModel?.['lr_scheduler'] as Record<string, unknown>)?.['kwargs'] === 'object'
        ? (((expertModel?.['lr_scheduler'] as Record<string, unknown>)?.['kwargs'] as Record<string, unknown>)?.['gamma'] as number | undefined)
        : undefined
      return layers ? { layers_configs: layers, head_scale: headScale, lr, lr_decay: lrDecay !== undefined ? 1 - lrDecay : undefined } : null
    }

    // Simple object with layers_configs
    if (obj['layers_configs']) {
      const layers = asLayers(obj['layers_configs'])
      const headScale = typeof obj['head_scale'] === 'number' ? obj['head_scale'] : undefined
      return layers ? { layers_configs: layers, head_scale: headScale } : null
    }

    return null
  } catch {
    return null
  }
}

export function CaptureProfileEditor({ profile, onSave, onCancel }: CaptureProfileEditorProps) {
  const [name, setName] = useState(profile?.name ?? '')
  const [description, setDescription] = useState(profile?.description ?? '')
  const [lr, setLr] = useState(String(profile?.lr ?? DEFAULT_LR))
  const [lrDecay, setLrDecay] = useState(String(profile?.lrDecay ?? DEFAULT_LR_DECAY))
  const [defaultEpochs, setDefaultEpochs] = useState(String(profile?.defaultEpochs ?? DEFAULT_EPOCHS))
  const [batchSize, setBatchSize] = useState(String(profile?.batchSize ?? DEFAULT_BATCH_SIZE))
  const [ny, setNy] = useState(String(profile?.ny ?? DEFAULT_NY))
  const [fitMrstft, setFitMrstft] = useState(profile?.fitMrstft ?? true)
  const [headScale, setHeadScale] = useState(String(profile?.waveNetConfig?.head_scale ?? 0.02))
  const [layers, setLayers] = useState<WaveNetLayerConfig[]>(
    profile?.waveNetConfig?.layers_configs?.length ? profile.waveNetConfig.layers_configs : [makeBlankLayer()]
  )
  const [jsonPaste, setJsonPaste] = useState('')
  const [jsonError, setJsonError] = useState('')
  const [saveError, setSaveError] = useState('')

  const handleCloneFrom = useCallback((builtInId: string) => {
    const p = BUILT_IN_CAPTURE_PROFILES.find((b) => b.id === builtInId)
    if (!p) return
    setLr(String(p.lr))
    setLrDecay(String(p.lrDecay))
    setDefaultEpochs(String(p.defaultEpochs))
    setBatchSize(String(p.batchSize))
    setNy(String(p.ny))
    setFitMrstft(p.fitMrstft)
    setHeadScale(String(p.waveNetConfig.head_scale))
    setLayers(p.waveNetConfig.layers_configs.map((l) => ({ ...l })))
  }, [])

  const handleApplyJson = () => {
    const extracted = extractNamBotConfig(jsonPaste)
    if (!extracted || !extracted.layers_configs) {
      setJsonError('Could not parse layers_configs. Paste a layers_configs array or a NAM-BOT preset export.')
      return
    }
    setJsonError('')
    setLayers(extracted.layers_configs)
    if (extracted.head_scale !== undefined) setHeadScale(String(extracted.head_scale))
    if (extracted.lr !== undefined) setLr(String(extracted.lr))
    if (extracted.lr_decay !== undefined) setLrDecay(String(extracted.lr_decay))
  }

  const handleSave = () => {
    if (!name.trim()) { setSaveError('Profile name is required.'); return }
    const parsedLr = Number(lr)
    const parsedLrDecay = Number(lrDecay)
    const parsedEpochs = Math.floor(Number(defaultEpochs))
    const parsedBatchSize = Math.floor(Number(batchSize))
    const parsedNy = Math.floor(Number(ny))
    const parsedHeadScale = Number(headScale)
    if (!Number.isFinite(parsedLr) || parsedLr <= 0) { setSaveError('LR must be a positive number.'); return }
    if (!Number.isFinite(parsedLrDecay) || parsedLrDecay <= 0) { setSaveError('LR Decay must be a positive number.'); return }
    if (!Number.isFinite(parsedEpochs) || parsedEpochs <= 0) { setSaveError('Epochs must be a positive whole number.'); return }
    if (!Number.isFinite(parsedBatchSize) || parsedBatchSize <= 0) { setSaveError('Batch Size must be a positive whole number.'); return }
    if (!Number.isFinite(parsedNy) || parsedNy <= 0) { setSaveError('NY must be a positive whole number.'); return }
    if (!Number.isFinite(parsedHeadScale) || parsedHeadScale <= 0) { setSaveError('Head Scale must be a positive number.'); return }
    if (layers.length === 0) { setSaveError('At least one layer is required.'); return }

    const waveNetConfig: WaveNetConfig = {
      head_scale: parsedHeadScale,
      layers_configs: layers,
    }

    const saved: UserCaptureProfile = {
      id: profile?.id ?? `profile-${Date.now()}`,
      name: name.trim(),
      description: description.trim(),
      waveNetConfig,
      lr: parsedLr,
      lrDecay: parsedLrDecay,
      defaultEpochs: parsedEpochs,
      batchSize: parsedBatchSize,
      ny: parsedNy,
      fitMrstft,
    }
    onSave(saved)
  }

  const updateLayer = (index: number, patch: Partial<WaveNetLayerConfig>) => {
    setLayers((prev) => prev.map((l, i) => i === index ? { ...l, ...patch } : l))
  }

  const removeLayer = (index: number) => {
    setLayers((prev) => prev.filter((_, i) => i !== index))
  }

  const addLayer = () => {
    const lastChannels = layers[layers.length - 1]?.channels ?? 8
    setLayers((prev) => [...prev, { ...makeBlankLayer(lastChannels), head_bias: true }])
  }

  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-start justify-center bg-black/70 overflow-y-auto py-8 px-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-4xl">
        <div className="px-5 pt-5 pb-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {profile ? 'Edit Profile' : 'New Capture Profile'}
          </h2>
          <button onClick={onCancel} className="p-1.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Name + Description */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Profile Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. My HiRes"
                className="w-full px-3 py-1.5 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                Start from built-in
                <span className="ml-1 font-normal text-gray-400">(optional — populates all fields)</span>
              </label>
              <select
                defaultValue=""
                onChange={(e) => { if (e.target.value) handleCloneFrom(e.target.value) }}
                className="w-full px-3 py-1.5 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
              >
                <option value="">— pick a starting point —</option>
                {BUILT_IN_CAPTURE_PROFILES.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short description"
              className="w-full px-3 py-1.5 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Training Params */}
          <div>
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">Training Params</div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {[
                { label: 'LR', value: lr, set: setLr, placeholder: '0.004' },
                { label: 'LR Decay', value: lrDecay, set: setLrDecay, placeholder: '0.002' },
                { label: 'Epochs', value: defaultEpochs, set: setDefaultEpochs, placeholder: '1000' },
                { label: 'Batch Size', value: batchSize, set: setBatchSize, placeholder: '16' },
                { label: 'NY', value: ny, set: setNy, placeholder: '8192' },
              ].map(({ label, value, set, placeholder }) => (
                <div key={label}>
                  <label className="block text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1">{label}</label>
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => set(e.target.value)}
                    placeholder={placeholder}
                    className="w-full px-2 py-1.5 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500 font-mono"
                  />
                </div>
              ))}
              <div className="flex flex-col justify-end">
                <label className="block text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1">Fit MRSTFT</label>
                <div className="h-[30px] flex items-center">
                  <input type="checkbox" checked={fitMrstft} onChange={(e) => setFitMrstft(e.target.checked)} className="accent-indigo-600 w-4 h-4" />
                </div>
              </div>
            </div>
          </div>

          {/* WaveNet Config */}
          <div>
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">WaveNet Config</div>
            <div className="mb-3">
              <label className="block text-[10px] font-medium text-gray-500 dark:text-gray-400 mb-1">Head Scale</label>
              <input
                type="text"
                value={headScale}
                onChange={(e) => setHeadScale(e.target.value)}
                placeholder="0.02"
                className="w-32 px-2 py-1.5 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded text-xs font-mono text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
              />
            </div>

            {/* Layer form */}
            <div className="space-y-2">
              {layers.map((layer, index) => (
                <div key={index} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/40 px-3 py-2.5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">Layer {index + 1}</span>
                    {layers.length > 1 && (
                      <button onClick={() => removeLayer(index)} className="text-[10px] text-red-500 hover:text-red-600 dark:text-red-400">Remove</button>
                    )}
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: 'Channels', key: 'channels' as const },
                      { label: 'Head Size', key: 'head_size' as const },
                      { label: 'Kernel', key: 'kernel_size' as const },
                      { label: 'Input Size', key: 'input_size' as const },
                    ].map(({ label, key }) => (
                      <div key={key}>
                        <label className="block text-[9px] font-medium text-gray-400 dark:text-gray-500 mb-0.5">{label}</label>
                        <input
                          type="number"
                          min={1}
                          value={layer[key]}
                          onChange={(e) => updateLayer(index, { [key]: Math.max(1, Number(e.target.value) || 1) })}
                          className="w-full px-2 py-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-xs font-mono text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    ))}
                  </div>
                  <div className="mt-2">
                    <label className="block text-[9px] font-medium text-gray-400 dark:text-gray-500 mb-0.5">
                      Dilations <span className="font-normal">(comma-separated)</span>
                    </label>
                    <input
                      type="text"
                      value={layer.dilations.join(', ')}
                      onChange={(e) => {
                        const parsed = parseDilations(e.target.value)
                        if (parsed) updateLayer(index, { dilations: parsed })
                      }}
                      className="w-full px-2 py-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-xs font-mono text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <label className="flex items-center gap-1.5 text-[10px] text-gray-500 dark:text-gray-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={layer.head_bias}
                        onChange={(e) => updateLayer(index, { head_bias: e.target.checked })}
                        className="accent-indigo-600"
                      />
                      Head Bias
                    </label>
                  </div>
                </div>
              ))}
              <button
                onClick={addLayer}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 flex items-center gap-1 mt-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                Add Layer
              </button>
            </div>
          </div>

          {/* JSON paste */}
          <div>
            <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
              — or paste JSON —
            </div>
            <div className="text-[10px] text-gray-400 dark:text-gray-500 mb-1.5">
              Paste a <code className="px-0.5 py-0 bg-gray-100 dark:bg-gray-800 rounded">layers_configs</code> array or a full NAM-BOT preset export. Non-config keys are ignored.
            </div>
            <textarea
              value={jsonPaste}
              onChange={(e) => { setJsonPaste(e.target.value); setJsonError('') }}
              rows={8}
              placeholder={'[\n  { "input_size": 1, "channels": 8, "head_size": 8, ... },\n  ...\n]'}
              className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg text-xs font-mono text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500 resize-none"
            />
            {jsonError && <div className="text-[11px] text-red-500 mt-1">{jsonError}</div>}
            <button
              onClick={handleApplyJson}
              disabled={!jsonPaste.trim()}
              className="mt-2 px-3 py-1.5 rounded-md text-xs font-medium bg-indigo-100 dark:bg-indigo-900/30 hover:bg-indigo-200 dark:hover:bg-indigo-800/40 text-indigo-700 dark:text-indigo-300 disabled:opacity-50 transition-colors"
            >
              Apply JSON →
            </button>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <div>
            {saveError && <span className="text-xs text-red-500">{saveError}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-gray-200 dark:bg-gray-800 hover:bg-gray-300 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
            >
              Save Profile
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
