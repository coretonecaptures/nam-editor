import { useMemo } from 'react'
import type { NamFile } from '../types/nam'
import { detectPreset } from '../utils/detectPreset'
import { getGearImageSrc } from '../assets/gear'

interface Props {
  files: NamFile[]
  folderName: string
}

const CORE_FIELDS = [
  'name', 'modeled_by', 'gear_make', 'gear_model',
  'gear_type', 'tone_type', 'input_level_dbu',
] as const

const GEAR_COLORS: Record<string, string> = {
  amp:           '#f97316',
  amp_cab:       '#3b82f6',
  pedal:         '#22c55e',
  pedal_amp:     '#eab308',
  amp_pedal_cab: '#a855f7',
  preamp:        '#f43f5e',
  studio:        '#14b8a6',
}
const GEAR_LABELS: Record<string, string> = {
  amp: 'Amp', amp_cab: 'Amp + Cab', pedal: 'Pedal',
  pedal_amp: 'Pedal Amp', amp_pedal_cab: 'Full Rig',
  preamp: 'Preamp', studio: 'Studio',
}

const TONE_COLORS: Record<string, string> = {
  clean:      '#0ea5e9',
  crunch:     '#f59e0b',
  hi_gain:    '#dc2626',
  fuzz:       '#9333ea',
  overdrive:  '#16a34a',
  distortion: '#f43f5e',
  other:      '#6b7280',
}
const TONE_LABELS: Record<string, string> = {
  clean: 'Clean', crunch: 'Crunch', hi_gain: 'Hi Gain',
  fuzz: 'Fuzz', overdrive: 'Overdrive', distortion: 'Distortion', other: 'Other',
}

const PRESET_ORDER = ['Complex', 'Standard', 'Lite', 'Feather', 'Nano', 'REVySTD', 'REVyHI', 'REVxSTD', 'Unknown']
const PRESET_COLORS: Record<string, string> = {
  Complex:  '#a855f7',
  Standard: '#3b82f6',
  Lite:     '#22c55e',
  Feather:  '#f59e0b',
  Nano:     '#f97316',
  REVySTD:  '#06b6d4',
  REVyHI:   '#0ea5e9',
  REVxSTD:  '#8b5cf6',
  Unknown:  '#6b7280',
}

function getEsr(file: NamFile): number | null {
  const esr = (file.metadata.training as Record<string, unknown> | undefined)?.validation_esr
  return typeof esr === 'number' ? esr : null
}

function StatBox({ value, label, sub }: { value: number | string; label: string; sub?: string }) {
  return (
    <div className="flex-1 rounded-xl bg-gray-800/60 border border-gray-700/40 px-3 py-2.5 text-center">
      <div className="text-2xl font-bold text-white leading-none">{value}</div>
      <div className="text-[10px] text-gray-400 mt-1 leading-tight">{label}</div>
      {sub && <div className="text-[9px] text-gray-600 mt-0.5">{sub}</div>}
    </div>
  )
}

function BudgetRow({
  icon, label, count, maxCount, color,
}: {
  icon?: React.ReactNode
  label: string
  count: number
  maxCount: number
  color: string
}) {
  const pct = maxCount > 0 ? count / maxCount : 0
  return (
    <div className="flex items-center gap-2 min-h-[26px]">
      <div className="w-5 flex-shrink-0 flex items-center justify-center">
        {icon ?? <span style={{ color }} className="text-[9px] leading-none">●</span>}
      </div>
      <div className="flex-1 relative rounded overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded"
          style={{ width: `${Math.max(pct * 100, 6)}%`, backgroundColor: color + '2e' }}
        />
        <span
          className="relative block px-2 py-0.5 text-[11px] font-semibold truncate"
          style={{ color }}
        >
          {label}
        </span>
      </div>
      <span className="text-[11px] text-gray-500 w-7 text-right flex-shrink-0 tabular-nums">{count}</span>
    </div>
  )
}

function MiniBar({ label, count, maxCount, color }: { label: string; count: number; maxCount: number; color: string }) {
  const pct = maxCount > 0 ? count / maxCount : 0
  return (
    <div className="flex items-center gap-2 min-h-[20px]">
      <span className="text-[10px] text-gray-400 w-16 text-right flex-shrink-0 truncate">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-gray-700/50 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.max(pct * 100, 2)}%`, backgroundColor: color }} />
      </div>
      <span className="text-[10px] text-gray-500 w-5 text-right flex-shrink-0 tabular-nums">{count}</span>
    </div>
  )
}

export function FolderDashboard({ files }: Props) {
  const stats = useMemo(() => {
    const total = files.length
    const missing = files.filter((f) =>
      CORE_FIELDS.some((field) => !f.metadata[field] && f.metadata[field] !== 0)
    ).length

    // Preset distribution
    const presetMap = new Map<string, number>()
    for (const f of files) {
      const p = detectPreset(f.config) ?? 'Unknown'
      presetMap.set(p, (presetMap.get(p) ?? 0) + 1)
    }
    const presets = PRESET_ORDER
      .filter((k) => presetMap.has(k))
      .map((k) => ({ key: k, count: presetMap.get(k)! }))

    // ESR buckets
    let esrGood = 0, esrOk = 0, esrReview = 0, esrNone = 0
    for (const f of files) {
      const esr = getEsr(f)
      if (esr === null) esrNone++
      else if (esr < 0.01) esrGood++
      else if (esr < 0.05) esrOk++
      else esrReview++
    }

    // Gear type distribution
    const gearMap = new Map<string, number>()
    for (const f of files) {
      const g = f.metadata.gear_type
      if (g) gearMap.set(g, (gearMap.get(g) ?? 0) + 1)
    }
    const gearRows = [...gearMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, count }))

    // Tone type distribution
    const toneMap = new Map<string, number>()
    for (const f of files) {
      const t = f.metadata.tone_type
      if (t) toneMap.set(t, (toneMap.get(t) ?? 0) + 1)
    }
    const toneRows = [...toneMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, count }))

    const maxPreset = Math.max(...presets.map((p) => p.count), 1)
    const maxGear = Math.max(...gearRows.map((r) => r.count), 1)
    const maxTone = Math.max(...toneRows.map((r) => r.count), 1)

    return { total, missing, presets, maxPreset, esrGood, esrOk, esrReview, esrNone, gearRows, maxGear, toneRows, maxTone }
  }, [files])

  if (files.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500 text-sm">
        No captures in this folder
      </div>
    )
  }

  const esrCovered = stats.esrGood + stats.esrOk + stats.esrReview
  const esrMaxCount = Math.max(stats.esrGood, stats.esrOk, stats.esrReview, stats.esrNone, 1)

  return (
    <div className="h-full overflow-y-auto p-4 flex flex-col gap-4">

      {/* Stat boxes */}
      <div className="flex gap-3">
        <StatBox value={stats.total} label="captures" />
        <StatBox
          value={stats.missing}
          label="missing metadata"
          sub={stats.missing === 0 ? 'all complete' : `${Math.round(stats.missing / stats.total * 100)}% incomplete`}
        />
      </div>

      {/* Formats + ESR row */}
      <div className="flex gap-3">
        {/* Preset formats */}
        <div className="flex-1 rounded-xl bg-gray-800/40 border border-gray-700/40 p-3">
          <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Formats</h3>
          {stats.presets.length === 0 ? (
            <p className="text-[11px] text-gray-600">No preset data</p>
          ) : (
            <div className="flex flex-col gap-1">
              {stats.presets.map(({ key, count }) => (
                <MiniBar
                  key={key}
                  label={key}
                  count={count}
                  maxCount={stats.maxPreset}
                  color={PRESET_COLORS[key] ?? '#6b7280'}
                />
              ))}
            </div>
          )}
        </div>

        {/* ESR quality */}
        <div className="flex-1 rounded-xl bg-gray-800/40 border border-gray-700/40 p-3">
          <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">ESR Quality</h3>
          <div className="flex flex-col gap-1">
            {esrCovered === 0 && stats.esrNone === stats.total ? (
              <p className="text-[11px] text-gray-600">No ESR data</p>
            ) : (
              <>
                {stats.esrGood > 0 && (
                  <BudgetRow label="Excellent  < 0.01" count={stats.esrGood} maxCount={esrMaxCount} color="#22c55e" />
                )}
                {stats.esrOk > 0 && (
                  <BudgetRow label="OK  0.01–0.05" count={stats.esrOk} maxCount={esrMaxCount} color="#f59e0b" />
                )}
                {stats.esrReview > 0 && (
                  <BudgetRow label="Review  > 0.05" count={stats.esrReview} maxCount={esrMaxCount} color="#ef4444" />
                )}
                {stats.esrNone > 0 && (
                  <BudgetRow label="No data" count={stats.esrNone} maxCount={esrMaxCount} color="#4b5563" />
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Gear + Tone columns */}
      <div className="flex gap-3">
        {/* Gear type */}
        <div className="flex-1 rounded-xl bg-gray-800/40 border border-gray-700/40 p-3">
          <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Gear Type</h3>
          {stats.gearRows.length === 0 ? (
            <p className="text-[11px] text-gray-600">No gear data</p>
          ) : (
            <div className="flex flex-col">
              {stats.gearRows.map(({ key, count }) => {
                const imgSrc = getGearImageSrc(key)
                const color = GEAR_COLORS[key] ?? '#6b7280'
                return (
                  <BudgetRow
                    key={key}
                    icon={
                      imgSrc
                        ? <img src={imgSrc} alt={key} className="h-4 w-4 object-contain opacity-70" />
                        : <span style={{ color }} className="text-[9px] leading-none">●</span>
                    }
                    label={GEAR_LABELS[key] ?? key}
                    count={count}
                    maxCount={stats.maxGear}
                    color={color}
                  />
                )
              })}
            </div>
          )}
        </div>

        {/* Tone type */}
        <div className="flex-1 rounded-xl bg-gray-800/40 border border-gray-700/40 p-3">
          <h3 className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Tone Type</h3>
          {stats.toneRows.length === 0 ? (
            <p className="text-[11px] text-gray-600">No tone data</p>
          ) : (
            <div className="flex flex-col">
              {stats.toneRows.map(({ key, count }) => (
                <BudgetRow
                  key={key}
                  label={TONE_LABELS[key] ?? key}
                  count={count}
                  maxCount={stats.maxTone}
                  color={TONE_COLORS[key] ?? '#6b7280'}
                />
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  )
}
