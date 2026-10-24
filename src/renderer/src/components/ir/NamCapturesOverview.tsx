import { useState } from 'react'
import { D1StatCard, D1BarList, CARD, EYEBROW } from '../FolderDashboard'
import { Gauge, StackedMeter } from '../dashboard/Charts'
import { getEsrTone } from '../../utils/esr'
import type { NamLibraryOverview } from '../../types/namProjects'

/**
 * NAM Capture Projects Overview — rebuilt on NAM Lab's own dashboard pieces (D1StatCard, D1BarList,
 * Gauge, StackedMeter, CARD/EYEBROW) so it reads like the Library/Folder dashboards instead of a
 * grey stats table. Same data as before (NamLibraryOverview); no backend changes.
 */

const TRAINED = '#22c55e'
const UNTRAINED = '#f59e0b'
const SYNTH = '#8b5cf6'
const TRACK = 'var(--chart-track,#2f2f2f)'

// Same palettes as FolderDashboard / IrLibraryOverview.
const SCOPE_COLORS = ['#3b82f6', '#f97316', '#22c55e', '#a855f7', '#14b8a6', '#f43f5e']
const FORMAT_COLORS = ['#14b8a6', '#22c55e', '#84cc16', '#eab308', '#f59e0b', '#f97316']
const ARCH_COLORS: Record<string, string> = {
  complex: '#a855f7', standard: '#3b82f6', lite: '#22c55e', feather: '#f59e0b', nano: '#f97316',
  a1: '#3b82f6', a2: '#06b6d4', unknown: '#6b7280'
}
const ESR_HEX = { green: '#34d399', amber: '#fbbf24', red: '#f87171', none: '' } as const

function coverageColor(pct: number): string {
  return pct >= 85 ? '#22c55e' : pct >= 50 ? '#14b8a6' : pct >= 25 ? '#f59e0b' : '#ef4444'
}

function rows(entries: Array<{ key: string; count: number }>, color: (k: string, i: number) => string) {
  return entries.map((e, i) => ({ key: e.key, label: e.key, count: e.count, color: color(e.key, i) }))
}

function Legend({ color, label, value }: { color: string; label: string; value: number }): React.ReactElement {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
      <span className="text-gray-500 dark:text-gray-400 flex-1">{label}</span>
      <span className="font-mono tabular-nums text-gray-700 dark:text-gray-300">{value.toLocaleString()}</span>
    </div>
  )
}

export function NamCapturesOverview({
  overview,
  onOpenProject,
  buildReport,
  onCopyError
}: {
  overview: NamLibraryOverview
  onOpenProject: (collectionId: string) => void
  buildReport: (o: NamLibraryOverview) => string
  onCopyError: () => void
}): React.ReactElement {
  const [copied, setCopied] = useState(false)
  const o = overview
  const pct = o.totalCaptures ? Math.round((o.trainedCaptures / o.totalCaptures) * 100) : 0
  const color = coverageColor(pct)
  const esr = getEsrTone(o.avgTrainedEsr, 'a1', 4)
  const grade = !o.totalCaptures ? 'No captures yet' : pct === 100 ? 'Fully trained' : pct >= 50 ? 'Mostly trained' : 'Needs training'
  const projects = [...o.projects].sort(
    (a, b) => b.captureCount - b.trainedCount - (a.captureCount - a.trainedCount) || a.name.localeCompare(b.name)
  )

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(buildReport(o))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      onCopyError()
    }
  }

  return (
    <div className="flex flex-col gap-3 max-w-[960px]">
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className={EYEBROW}>Capture Report</span>
          <span className="text-sm font-semibold text-nm-text">All NAM Capture projects</span>
        </div>
        <button
          onClick={() => void copy()}
          className="px-2.5 py-1 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov flex-shrink-0"
        >
          {copied ? 'Copied ✓' : 'Copy report (Markdown)'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] gap-3">
        {/* Coverage hero — same composition as FolderDashboard's Pack Health card. */}
        <div className={`${CARD} flex flex-row gap-4 items-center`}>
          <div className="flex-shrink-0">
            <Gauge value={pct} size={132} thickness={13} color={color}>
              <span className="text-4xl font-bold tabular-nums text-gray-900 dark:text-gray-100 leading-none">{pct}</span>
              <span className="font-mono text-[9px] tracking-widest uppercase text-gray-400 dark:text-gray-500 mt-1">% trained</span>
            </Gauge>
          </div>
          <div className="flex flex-col gap-3 flex-1 min-w-0">
            <div className="flex flex-col gap-0.5">
              <span className={EYEBROW}>Training coverage</span>
              <span className="text-sm font-semibold leading-tight" style={{ color }}>{grade}</span>
            </div>
            <StackedMeter
              height={10}
              segments={[
                { label: `Trained ${o.trainedCaptures}`, value: o.trainedCaptures, color: TRAINED },
                { label: `Untrained ${o.untrainedCaptures}`, value: o.untrainedCaptures, color: UNTRAINED }
              ]}
            />
            <div className="flex flex-col gap-1.5">
              <Legend color={TRAINED} label="Trained" value={o.trainedCaptures} />
              <Legend color={UNTRAINED} label="Untrained" value={o.untrainedCaptures} />
              <Legend color={SYNTH} label="Synthetic" value={o.syntheticCaptures} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <D1StatCard label="Projects" value={o.totalProjects} />
          <D1StatCard label="Captures" value={o.totalCaptures} sub={o.syntheticCaptures ? `${o.syntheticCaptures} synthetic` : undefined} />
          <D1StatCard label="Trained" value={o.trainedCaptures} sub={`${o.untrainedCaptures} to go`} />
          <div className="bg-gray-100 dark:bg-gray-800/60 rounded-xl p-3.5 flex flex-col gap-1">
            <span className={EYEBROW}>Mean ESR</span>
            <span className={`text-2xl font-bold tabular-nums leading-none ${o.avgTrainedEsr != null ? esr.classes : 'text-gray-400'}`}>
              {o.avgTrainedEsr != null ? o.avgTrainedEsr.toFixed(4) : '—'}
            </span>
            <span className="text-[10px] text-gray-400 dark:text-gray-500">across trained captures</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <D1BarList title="Capture scope" rows={rows(o.byScope, (_, i) => SCOPE_COLORS[i % SCOPE_COLORS.length])} />
        <D1BarList title="Sample rate" rows={rows(o.bySampleRate, (_, i) => FORMAT_COLORS[i % FORMAT_COLORS.length])} />
        <D1BarList title="Trained architecture" rows={rows(o.byArchitecture, (k) => ARCH_COLORS[k.toLowerCase()] ?? '#6366f1')} />
      </div>

      <div className={`${CARD} flex flex-col gap-2`}>
        <div className="flex items-baseline justify-between">
          <span className={EYEBROW}>Per project</span>
          <span className="text-[10px] text-gray-400 dark:text-gray-500">Most untrained first · click to open</span>
        </div>
        <div className="flex flex-col">
          {projects.map((p) => {
            const pp = p.captureCount ? Math.round((p.trainedCount / p.captureCount) * 100) : 0
            const t = getEsrTone(p.avgTrainedEsr, 'a1', 4)
            return (
              <button
                key={p.collectionId}
                onClick={() => onOpenProject(p.collectionId)}
                className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_auto_auto] items-center gap-3 px-2 py-2 -mx-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800/60 text-left transition-colors"
              >
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-medium text-nm-text truncate">{p.name}</span>
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">
                    {p.captureCount} capture{p.captureCount === 1 ? '' : 's'}
                    {p.syntheticCount ? ` · ${p.syntheticCount} synthetic` : ''}
                  </span>
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: TRACK }}>
                    <div className="h-full rounded-full" style={{ width: `${pp}%`, background: pp === 100 ? TRAINED : coverageColor(pp) }} />
                  </div>
                  <span className="font-mono tabular-nums text-[10px] text-gray-500 dark:text-gray-400 w-14 text-right">
                    {p.trainedCount}/{p.captureCount}
                  </span>
                </div>
                <span
                  className="font-mono tabular-nums text-[10px] px-1.5 py-0.5 rounded w-[62px] text-center"
                  style={
                    t.tone === 'none'
                      ? { color: '#9ca3af' }
                      : { color: ESR_HEX[t.tone], background: `${ESR_HEX[t.tone]}1f` }
                  }
                  title="Mean validation ESR"
                >
                  {p.avgTrainedEsr != null ? p.avgTrainedEsr.toFixed(4) : '—'}
                </span>
                <span className="text-gray-400 dark:text-gray-600 text-xs">›</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
