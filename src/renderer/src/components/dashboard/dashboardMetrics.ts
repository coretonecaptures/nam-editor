/* ────────────────────────────────────────────────────────────────────────────
   dashboardMetrics.ts — derived metrics for the NAM Lab dashboards
   Drop into:  src/renderer/src/components/dashboard/dashboardMetrics.ts

   Everything here is computed from the EXISTING NamFile[] you already pass to
   NamDashboard / FolderDashboard. The functions cover both the metrics the
   current dashboards show AND the new "useful data" the redesign adds:
     • libraryHealth() / folderHealth()  — composite 0..100 score
     • buildGrowthSeries()               — captures added per month (uses birthtimeMs)
     • buildEsrTrend()                   — avg validation ESR per month (mtimeMs + training)
     • buildEsrRuns()                    — ESR per recent capture, newest→oldest
     • buildActivityMatrix()             — weeks×7 activity grid (uses mtimeMs)
     • topMakes()                        — gear_make leaderboard
   Tune the weights to taste — they are intentionally simple and transparent.
   ──────────────────────────────────────────────────────────────────────────── */
import type { NamFile } from '../../types/nam'

/* The 7 fields the app already counts for "completeness". Keep in sync with
   COMPLETENESS_FIELDS in NamDashboard.tsx / CORE_FIELDS in FolderDashboard.tsx. */
const CORE_FIELDS: (keyof NamFile['metadata'])[] = [
  'name', 'modeled_by', 'gear_make', 'gear_model', 'gear_type', 'tone_type', 'input_level_dbu',
]

export function getEsr(f: NamFile): number | null {
  const esr = (f.metadata.training as Record<string, unknown> | undefined)?.validation_esr
  return typeof esr === 'number' ? esr : null
}

function completeness(files: NamFile[]) {
  let complete = 0, partial = 0, incomplete = 0
  for (const f of files) {
    const missing = CORE_FIELDS.filter((k) => f.metadata[k] == null || f.metadata[k] === '').length
    if (missing === 0) complete++
    else if (missing === 1) partial++
    else incomplete++
  }
  return { complete, partial, incomplete }
}

function esrBuckets(files: NamFile[]) {
  let good = 0, ok = 0, review = 0, none = 0
  for (const f of files) {
    const e = getEsr(f)
    if (e == null) none++
    else if (e < 0.01) good++
    else if (e <= 0.05) ok++
    else review++
  }
  return { good, ok, review, none }
}

export interface HealthPart { label: string; pct: number; weight: string }
export interface Health { score: number; grade: string; parts: HealthPart[] }

function grade(score: number) {
  return score >= 85 ? 'Excellent' : score >= 70 ? 'Healthy' : score >= 50 ? 'Needs work' : 'At risk'
}

/* LIBRARY HEALTH — completeness 40% · training quality 35% · saved 15% · dup-free 10% */
export function libraryHealth(files: NamFile[]): Health {
  const total = files.length || 1
  const { complete } = completeness(files)
  const { good, ok } = esrBuckets(files)
  const completePct = complete / total
  const esrPass = (good + ok) / total
  const saved = 1 - files.filter((f) => f.isDirty).length / total
  // duplicate-free: share of files whose filename is unique
  const counts = new Map<string, number>()
  for (const f of files) { const k = f.fileName.trim().toLowerCase(); counts.set(k, (counts.get(k) ?? 0) + 1) }
  const dupFiles = [...counts.values()].filter((c) => c > 1).reduce((s, c) => s + c, 0)
  const dupFree = 1 - dupFiles / total
  const score = Math.round((completePct * 0.4 + esrPass * 0.35 + saved * 0.15 + dupFree * 0.10) * 100)
  return {
    score, grade: grade(score),
    parts: [
      { label: 'Metadata complete', pct: Math.round(completePct * 100), weight: '40%' },
      { label: 'Training quality', pct: Math.round(esrPass * 100), weight: '35%' },
      { label: 'Changes saved', pct: Math.round(saved * 100), weight: '15%' },
      { label: 'Duplicate-free', pct: Math.round(dupFree * 100), weight: '10%' },
    ],
  }
}

/* PACK HEALTH — training quality 40% · completeness 35% · readiness 25% */
export function folderHealth(
  files: NamFile[],
  readiness: { packInfo: boolean; readme: boolean; cover: boolean; gallery: number },
): Health {
  const total = files.length || 1
  const { complete } = completeness(files)
  const { good, ok } = esrBuckets(files)
  const completePct = complete / total
  const esrPass = (good + ok) / total
  const readyParts = [readiness.packInfo, readiness.readme, readiness.cover, readiness.gallery > 0]
  const readyPct = readyParts.filter(Boolean).length / readyParts.length
  const score = Math.round((esrPass * 0.4 + completePct * 0.35 + readyPct * 0.25) * 100)
  return {
    score, grade: grade(score),
    parts: [
      { label: 'Training quality', pct: Math.round(esrPass * 100), weight: '40%' },
      { label: 'Metadata complete', pct: Math.round(completePct * 100), weight: '35%' },
      { label: 'Pack readiness', pct: Math.round(readyPct * 100), weight: '25%' },
    ],
  }
}

/* GROWTH — captures added per calendar month, oldest→newest. Uses birthtimeMs. */
export function buildGrowthSeries(files: NamFile[], months = 14): { m: string; add: number }[] {
  const now = new Date()
  const labels: { key: string; m: string }[] = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    labels.push({ key: `${d.getFullYear()}-${d.getMonth()}`, m: d.toLocaleString(undefined, { month: 'short' }) })
  }
  const counts = new Map<string, number>()
  for (const f of files) {
    if (!f.birthtimeMs) continue
    const d = new Date(f.birthtimeMs)
    counts.set(`${d.getFullYear()}-${d.getMonth()}`, (counts.get(`${d.getFullYear()}-${d.getMonth()}`) ?? 0) + 1)
  }
  return labels.map((l) => ({ m: l.m, add: counts.get(l.key) ?? 0 }))
}

/* ESR TREND — average validation ESR per month, oldest→newest. Uses mtimeMs. */
export function buildEsrTrend(files: NamFile[], months = 14): number[] {
  const now = new Date()
  const buckets: { sum: number; n: number }[] = Array.from({ length: months }, () => ({ sum: 0, n: 0 }))
  for (const f of files) {
    const e = getEsr(f); if (e == null || !f.mtimeMs) continue
    const d = new Date(f.mtimeMs)
    const idx = months - 1 - ((now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()))
    if (idx >= 0 && idx < months) { buckets[idx].sum += e; buckets[idx].n++ }
  }
  // forward-fill empty months so the line stays continuous
  let last = 0.015
  return buckets.map((b) => { if (b.n) last = b.sum / b.n; return +last.toFixed(4) })
}

/* ESR RUNS — ESR for the N most-recently-updated captures (newest last for the chart). */
export function buildEsrRuns(files: NamFile[], n = 18): number[] {
  return [...files]
    .filter((f) => getEsr(f) != null && f.mtimeMs)
    .sort((a, b) => (a.mtimeMs ?? 0) - (b.mtimeMs ?? 0))
    .slice(-n)
    .map((f) => getEsr(f) as number)
}

/* ACTIVITY MATRIX — weeks×7 grid of 0..1 normalised edit counts. Uses mtimeMs. */
export function buildActivityMatrix(files: NamFile[], weeks = 18): number[][] {
  const dayMs = 86_400_000
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const start = today.getTime() - (weeks * 7 - 1 - today.getDay()) * dayMs
  const perDay = new Map<number, number>()
  for (const f of files) {
    if (!f.mtimeMs) continue
    const day = Math.floor((f.mtimeMs - start) / dayMs)
    if (day >= 0) perDay.set(day, (perDay.get(day) ?? 0) + 1)
  }
  const max = Math.max(1, ...perDay.values())
  const matrix: number[][] = []
  for (let w = 0; w < weeks; w++) {
    const col: number[] = []
    for (let d = 0; d < 7; d++) col.push((perDay.get(w * 7 + d) ?? 0) / max)
    matrix.push(col)
  }
  return matrix
}

/* TOP MAKES — leaderboard from metadata.gear_make. Pass your gear color map for bar colors. */
export function topMakes(files: NamFile[], limit = 8): { name: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const f of files) {
    const m = f.metadata.gear_make?.trim()
    if (m) counts.set(m, (counts.get(m) ?? 0) + 1)
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, limit)
}
