/* ────────────────────────────────────────────────────────────────────────────
   Charts.tsx &mdash; reference SVG chart primitives for the NAM Lab dashboards
   Drop into:  src/renderer/src/components/dashboard/Charts.tsx
   No dependencies. Pure SVG + React. Theme-agnostic: pass explicit colors.

   THEMING NOTE
   These primitives take an explicit `track` (the unfilled groove) color so they
   work in both the default dark theme and the charcoal theme. Pass a value that
   matches the surrounding card. Suggested:
     default dark : '#1f2937'  (gray-800)
     charcoal     : '#2f2f2f'
   The simplest approach: read it once from a CSS var you set per-theme, e.g.
     const track = 'var(--chart-track)';
   and define `--chart-track` on `.dark` (#1f2937) and `html.charcoal` (#2f2f2f).
   ──────────────────────────────────────────────────────────────────────────── */
import React from 'react'

export interface Segment { value: number; color: string; label?: string }

export function polar(cx: number, cy: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }
}
export function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const s = polar(cx, cy, r, endDeg)
  const e = polar(cx, cy, r, startDeg)
  const large = endDeg - startDeg <= 180 ? 0 : 1
  return `M ${s.x} ${s.y} A ${r} ${r} 0 ${large} 0 ${e.x} ${e.y}`
}

/* Donut &mdash; proportional ring. Put a number/label in children for the hole. */
export function Donut({
  segments, size = 120, thickness = 16, gap = 2.5, track = 'var(--chart-track,#2f2f2f)', children,
}: {
  segments: Segment[]; size?: number; thickness?: number; gap?: number; track?: string; children?: React.ReactNode
}) {
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  const total = segments.reduce((s, x) => s + x.value, 0) || 1
  let offset = 0
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={thickness} />
        {segments.map((seg, i) => {
          const frac = seg.value / total
          const len = Math.max(frac * c - gap, 0)
          const el = (
            <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={seg.color} strokeWidth={thickness}
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset * c} />
          )
          offset += frac
          return el
        })}
      </svg>
      {children && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', textAlign: 'center', lineHeight: 1 }}>
          {children}
        </div>
      )}
    </div>
  )
}

/* Gauge &mdash; 0..100 score over a `sweep`° arc (default 270). */
export function Gauge({
  value, size = 160, thickness = 13, color = '#14b8a6', track = 'var(--chart-track,#2f2f2f)', sweep = 270, children,
}: {
  value: number; size?: number; thickness?: number; color?: string; track?: string; sweep?: number; children?: React.ReactNode
}) {
  const cx = size / 2, cy = size / 2, r = (size - thickness) / 2
  const start = -sweep / 2, end = sweep / 2
  const valEnd = start + (Math.min(Math.max(value, 0), 100) / 100) * sweep
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size}>
        <path d={arcPath(cx, cy, r, start, end)} fill="none" stroke={track} strokeWidth={thickness} strokeLinecap="round" />
        <path d={arcPath(cx, cy, r, start, valEnd)} fill="none" stroke={color} strokeWidth={thickness} strokeLinecap="round" />
      </svg>
      {children && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', textAlign: 'center', lineHeight: 1 }}>
          {children}
        </div>
      )}
    </div>
  )
}

/* ProgressRing &mdash; full-circle progress. */
export function ProgressRing({
  value, size = 64, thickness = 7, color = '#14b8a6', track = 'var(--chart-track,#2f2f2f)', children,
}: {
  value: number; size?: number; thickness?: number; color?: string; track?: string; children?: React.ReactNode
}) {
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  const len = (Math.min(Math.max(value, 0), 100) / 100) * c
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={thickness} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={thickness}
          strokeLinecap="round" strokeDasharray={`${len} ${c - len}`} />
      </svg>
      {children && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{children}</div>}
    </div>
  )
}

/* Sparkline &mdash; tiny line + soft fill. */
export function Sparkline({
  data, color = '#14b8a6', width = 120, height = 32, strokeWidth = 1.75, fill = true,
  invert = false,
}: { data: number[]; color?: string; width?: number; height?: number; strokeWidth?: number; fill?: boolean; invert?: boolean }) {
  const max = Math.max(...data), min = Math.min(...data)
  const range = max - min || 1
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    let norm = (v - min) / range
    if (invert) norm = 1 - norm
    const y = height - norm * (height - strokeWidth * 2) - strokeWidth
    return [x, y] as const
  })
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
  const area = `${line} L${width} ${height} L0 ${height} Z`
  const id = React.useId()
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      {fill && (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${id})`} />
        </>
      )}
      <path d={line} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

/* AreaChart &mdash; line + gradient fill with dashed gridlines and optional month labels. */
export function AreaChart({
  data, color = '#14b8a6', width = 360, height = 120, labels, gridLines = 3,
}: { data: number[]; color?: string; width?: number; height?: number; labels?: string[]; gridLines?: number }) {
  const max = Math.max(...data) * 1.08
  const n = data.length
  const pad = { t: 8, b: 16 }
  const w = width, h = height - pad.t - pad.b
  const pts = data.map((v, i) => [(i / (n - 1)) * w, pad.t + h - (v / max) * h] as const)
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
  const area = `${line} L${w} ${pad.t + h} L0 ${pad.t + h} Z`
  const id = React.useId()
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.30" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {Array.from({ length: gridLines }).map((_, i) => {
        const y = pad.t + (h / gridLines) * (i + 1)
        return <line key={i} x1={0} y1={y} x2={w} y2={y} stroke="currentColor" opacity={0.12} strokeWidth="1" strokeDasharray="2 4" />
      })}
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.length > 0 && <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={3} fill={color} />}
      {labels && labels.map((lb, i) => {
        if (n > 8 && i % 2 !== 0 && i !== n - 1) return null
        return <text key={i} x={(i / (n - 1)) * w} y={height - 2} fill="currentColor" opacity={0.5} fontSize="9" textAnchor="middle">{lb}</text>
      })}
    </svg>
  )
}

/* TrendLine &mdash; line chart, `invert` flips the scale (for ESR where lower = better). */
export function TrendLine({
  data, color = '#22c55e', width = 360, height = 110, invert = false,
}: { data: number[]; color?: string; width?: number; height?: number; invert?: boolean }) {
  const max = Math.max(...data), min = Math.min(...data)
  const range = max - min || 1
  const pad = { t: 10, b: 10 }
  const w = width, h = height - pad.t - pad.b
  const pts = data.map((v, i) => {
    let norm = (v - min) / range
    if (invert) norm = 1 - norm
    return [(i / (data.length - 1)) * w, pad.t + h - norm * h] as const
  })
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 3.5 : 1.5} fill={color} opacity={i === pts.length - 1 ? 1 : 0.5} />)}
    </svg>
  )
}

/* Heatmap &mdash; GitHub-style activity grid. Pass a `weeks × 7` matrix of 0..1 values
   (see buildActivityMatrix in dashboardMetrics.ts to derive from file mtimes). */
export function Heatmap({
  matrix, base = '#2a2a2a', color = '#14b8a6', cell = 12, gap = 3.5,
}: { matrix: number[][]; base?: string; color?: string; cell?: number; gap?: number }) {
  const days = ['', 'M', '', 'W', '', 'F', '']
  const c2 = hexToRgb(color), c1 = hexToRgb(base)
  const mix = (t: number) => {
    if (t < 0.08) return base
    const r = Math.round(c1[0] + (c2[0] - c1[0]) * t)
    const g = Math.round(c1[1] + (c2[1] - c1[1]) * t)
    const b = Math.round(c1[2] + (c2[2] - c1[2]) * t)
    return `rgb(${r},${g},${b})`
  }
  const W = matrix.length * (cell + gap) + 18
  const H = 7 * (cell + gap) + 2
  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      {days.map((lb, d) => lb ? <text key={d} x="0" y={d * (cell + gap) + cell} fill="currentColor" opacity={0.45} fontSize="8">{lb}</text> : null)}
      {matrix.map((col, w) => col.map((v, d) => (
        <rect key={`${w}-${d}`} x={18 + w * (cell + gap)} y={d * (cell + gap)} width={cell} height={cell} rx="2" fill={mix(v)} />
      )))}
    </svg>
  )
}

/* StackedMeter &mdash; horizontal stacked proportion bar. */
export function StackedMeter({
  segments, height = 12, radius = 5, gap = 1.5,
}: { segments: Segment[]; height?: number; radius?: number; gap?: number }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1
  return (
    <div style={{ display: 'flex', height, borderRadius: radius, overflow: 'hidden', gap }}>
      {segments.map((seg, i) => (
        <div key={i} title={seg.label} style={{ width: `${(seg.value / total) * 100}%`, background: seg.color }} />
      ))}
    </div>
  )
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

// Scale/hit-testing helpers live in ./scales (pure, no JSX) so they are unit-testable without a
// JSX transform. Re-exported here because existing call sites import them from Charts.
export {
  paddedDomain,
  makeScale,
  niceTicks,
  nearestPoint,
  gainRamp,
  type PlottedPoint
} from './scales'

/* EsrCurve &mdash; ESR-vs-epoch, log scale, descending. Optional target line. */
export function EsrCurve({
  data, color = 'var(--nm-accent,#6366f1)', width = 640, height = 240, target = null,
  labels = true, variant = 'area' as 'area' | 'line' | 'minimal', logScale = true,
}: {
  data: { epoch: number; esr: number }[]
  color?: string; width?: number; height?: number; target?: number | null
  labels?: boolean; variant?: 'area' | 'line' | 'minimal'; logScale?: boolean
}) {
  const id = React.useId()
  const pad = { t: 16, r: 16, b: 26, l: 44 }
  const w = width - pad.l - pad.r, h = height - pad.t - pad.b
  const vals = data.map((d) => logScale ? Math.log10(Math.max(d.esr, 1e-5)) : d.esr)
  const allRef = target != null && logScale ? [...vals, Math.log10(target)] : [...vals, ...(target != null ? [target] : [])]
  const vmax = allRef.length ? Math.max(...allRef) : 0
  const vmin = allRef.length ? Math.min(...allRef) : -2
  const range = (vmax - vmin) || 1
  const padFrac = 0.12
  const lo = vmin - range * padFrac, hi = vmax + range * padFrac
  const span = hi - lo || 1
  const n = data.length
  const X = (i: number) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * w)
  const Y = (v: number) => pad.t + h - ((v - lo) / span) * h
  const pts = vals.map((v, i) => [X(i), Y(v)] as const)
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
  const area = `${line} L${X(n - 1)} ${pad.t + h} L${pad.l} ${pad.t + h} Z`
  const ticks = logScale
    ? [0.001, 0.005, 0.01, 0.05, 0.1].filter((t) => Math.log10(t) >= lo && Math.log10(t) <= hi)
    : Array.from({ length: 4 }, (_, i) => vmin + (range * (i + 1)) / 4)
  const tgtY = target != null ? Y(logScale ? Math.log10(target) : target) : null
  const last = pts[pts.length - 1]
  if (n === 0) {
    return (
      <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
        <text x={width / 2} y={height / 2} fill="currentColor" opacity={0.3} fontSize="12" textAnchor="middle">No data yet</text>
      </svg>
    )
  }
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t, i) => {
        const yy = Y(logScale ? Math.log10(t) : t)
        return (
          <g key={i}>
            <line x1={pad.l} y1={yy} x2={pad.l + w} y2={yy} stroke="currentColor" opacity={0.1} strokeWidth="1" strokeDasharray="2 4" />
            {labels && <text x={pad.l - 8} y={yy + 3} fill="currentColor" opacity={0.42} fontSize="10" textAnchor="end" fontFamily="var(--font-mono,'IBM Plex Mono',monospace)">{t < 0.01 ? t.toFixed(3) : t.toFixed(2)}</text>}
          </g>
        )
      })}
      {tgtY != null && (
        <g>
          <line x1={pad.l} y1={tgtY} x2={pad.l + w} y2={tgtY} stroke="#10b981" opacity={0.7} strokeWidth="1.5" strokeDasharray="5 4" />
          <text x={pad.l + w} y={tgtY - 6} fill="#10b981" fontSize="10" textAnchor="end" fontFamily="var(--font-mono,'IBM Plex Mono',monospace)">target {target}</text>
        </g>
      )}
      {variant === 'area' && <path d={area} fill={`url(#${id})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth={variant === 'minimal' ? 1.75 : 2.25} strokeLinejoin="round" strokeLinecap="round" />
      {variant !== 'minimal' && last && (
        <>
          <circle cx={last[0]} cy={last[1]} r={4.5} fill={color} />
          <circle cx={last[0]} cy={last[1]} r={9} fill={color} opacity={0.18}>
            <animate attributeName="r" values="6;11;6" dur="1.8s" repeatCount="indefinite" />
          </circle>
        </>
      )}
      {labels && <text x={pad.l} y={height - 4} fill="currentColor" opacity={0.4} fontSize="10">epoch 0</text>}
      {labels && data[n - 1] && <text x={pad.l + w} y={height - 4} fill="currentColor" opacity={0.4} fontSize="10" textAnchor="end">{`epoch ${data[n - 1].epoch}`}</text>}
    </svg>
  )
}

/* QualityBars &mdash; ESR quality distribution: vertical green/amber/red bars per session/day. */
export function QualityBars({
  groups, width = 360, height = 150,
}: { groups: { label: string; green: number; amber: number; red: number }[]; width?: number; height?: number }) {
  const pad = { t: 10, b: 22 }
  const h = height - pad.t - pad.b
  const m = Math.max(...groups.map((g) => g.green + g.amber + g.red), 1)
  const bw = groups.length ? width / groups.length : width
  const colW = Math.min(bw * 0.5, 26)
  const segs: [keyof typeof groups[0], string][] = [['green', '#10b981'], ['amber', '#f59e0b'], ['red', '#ef4444']]
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {groups.map((g, i) => {
        const cx = i * bw + bw / 2
        let yTop = pad.t + h
        return (
          <g key={i}>
            {segs.map(([k, c]) => {
              const v = g[k] as number
              if (!v) return null
              const segH = (v / m) * h
              yTop -= segH
              return <rect key={k} x={cx - colW / 2} y={yTop} width={colW} height={Math.max(segH - 1.5, 0)} rx="2" fill={c} />
            })}
            <text x={cx} y={height - 7} fill="currentColor" opacity={0.5} fontSize="9.5" textAnchor="middle">{g.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

/* Burndown &mdash; remaining queue vs done, two stacked-ish lines over time. */
export function Burndown({
  remaining, done, color = 'var(--nm-accent,#6366f1)', width = 360, height = 130,
}: { remaining: number[]; done: number[]; color?: string; width?: number; height?: number }) {
  const id = React.useId()
  const pad = { t: 12, b: 18, l: 8, r: 8 }
  const w = width - pad.l - pad.r, h = height - pad.t - pad.b
  const n = remaining.length
  const max = Math.max(...remaining, ...done, 1)
  const X = (i: number) => pad.l + (n <= 1 ? 0 : (i / (n - 1)) * w)
  const Y = (v: number) => pad.t + h - (v / max) * h
  const mk = (arr: number[]) => arr.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(' ')
  const remLine = mk(remaining)
  const remArea = `${remLine} L${X(n - 1)} ${pad.t + h} L${pad.l} ${pad.t + h} Z`
  if (n === 0) return null
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.24" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={remArea} fill={`url(#${id})`} />
      <path d={mk(done)} fill="none" stroke="#10b981" strokeWidth="2" strokeDasharray="4 3" strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
      <path d={remLine} fill="none" stroke={color} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
