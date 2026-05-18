// utils/packExportAdvanced.ts
// =====================================================================
// Advanced PDF export — sits alongside your existing packExport.ts.
// Same DATA shape (PackInfo, NamFile.metadata, info.exportColumns) so
// PackInfoEditor doesn't need data changes; just wire a second button.
//
// USAGE in PackInfoEditor.tsx (next to the existing Simple PDF button):
// ----------------------------------------------------------------------
//   import { generatePackHtmlAdvanced } from '../utils/packExportAdvanced'
//
//   const handleExportAdvanced = async () => {
//     setExporting(true)
//     if (!saved) await handleSave()
//     const logo = darkExport ? (logoDark || undefined) : (logoLight || undefined)
//     const html = generatePackHtmlAdvanced(pack, folderPath, folderName, captures, darkExport, logo, darkAccentColor)
//     const res = await window.api.exportPackSheet(html)
//     setExporting(false)
//     if (!res.success) setStatus(`Export failed: ${res.error ?? 'unknown error'}`)
//   }
//
//   <button onClick={handleExport}>Export Simple PDF</button>
//   <button onClick={handleExportAdvanced}>Export Advanced PDF</button>
//
// KEY FIXES vs. the Simple version
// ----------------------------------------------------------------------
//  1. PROPER PRINT MARGINS. Uses `@page { margin: 18mm 14mm }` so every
//     printed page gets the same border. The Simple version's
//     `@page { margin: 0 }` + custom .content padding is what causes
//     padding to disappear on pages 2+.
//
//  2. RUNNING FOOTER ON EVERY PAGE. `@page { @bottom-left/center/right }`
//     rules auto-render brand · copyright · `page / pages` on every page
//     via Chrome's print engine (Electron's renderer).
//
//  3. CAPTURES TABLE PAGINATES NATURALLY. `<thead>` repeats automatically
//     (display: table-header-group), each row has break-inside: avoid,
//     no tfoot height-spacer trick.
//
//  4. SETTINGS RENDER AS STYLED MONO TEXT. The raw `nl_amp_settings`
//     string is split into `Name Value` pairs visually (knob letter in
//     accent, value in fg) — works for any amp's notation, no parsing
//     contract required.
//
//  5. info.footer surfaces in a colophon block at the bottom of the
//     last page (next to the logo), not on every page.
// =====================================================================

import type { NamFile } from '../types/nam'
import type { PackInfo } from '../components/PackInfoEditor'
import {
  PACK_CAPTURE_COLUMNS,
  DEFAULT_EXPORT_COLUMNS,
  parseDescription,
} from './packExport'

// Re-export so call sites can import from either file
export { PACK_CAPTURE_COLUMNS, DEFAULT_EXPORT_COLUMNS, parseDescription }

interface Theme {
  bg: string; fg: string; dim: string; dimmer: string; rule: string
  accent: string; cool: string
}

const DARK_THEME = (accent: string): Theme => ({
  bg: '#0e0d0b', fg: '#e8e1d3', dim: '#7a7263', dimmer: '#4a4338',
  rule: '#2a2722', accent, cool: '#8bc4d6',
})

const LIGHT_THEME = (accent: string): Theme => ({
  bg: '#ffffff', fg: '#1a1612', dim: '#6b6357', dimmer: '#a89f8e',
  rule: '#e6e0d2', accent, cool: '#2c6b85',
})

// Render a raw amp-settings string as styled mono text. Generic — works
// for any amp's knob layout. Pairs of "Name Value" are styled two-tone;
// strings the parser can't split fall back to verbatim text.
function styleSettings(raw: string, esc: (s: string) => string, t: Theme): string {
  if (!raw) return `<span style="color:${t.dimmer}">—</span>`
  const re = /([A-Za-z][A-Za-z0-9.]*)\s+([\d.]+)/g
  const parts: [string, string][] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) parts.push([m[1], m[2]])
  if (!parts.length) return `<span class="settings">${esc(raw)}</span>`
  return `<span class="settings">${parts.map(([k, v], i) =>
    `<span class="k">${esc(k)}</span><span class="v">${esc(v)}</span>` +
    (i < parts.length - 1 ? '<span class="sep">  </span>' : '')
  ).join('')}</span>`
}

export type ExportTarget = 'nam' | 'proxy' | 'qc' | 'tonex'

function mode<T>(arr: T[]): T | undefined {
  const counts = new Map<T, number>()
  for (const v of arr) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: T | undefined; let bestCount = 0
  for (const [v, c] of counts) if (c > bestCount) { best = v; bestCount = c }
  return best
}

function deriveStats(captures: NamFile[]) {
  const presets = [...new Set(captures.map(f => f.metadata.nb_preset_name).filter(Boolean))] as string[]
  const epochs = captures.map(f => f.metadata.nb_trained_epochs).filter(Boolean) as number[]
  const epochValue = mode(epochs)
  const esrValues = captures
    .map(f => (f.metadata.training as Record<string, unknown> | undefined)?.validation_esr)
    .filter((v): v is number => typeof v === 'number')
  const avgEsr = esrValues.length ? esrValues.reduce((a, b) => a + b, 0) / esrValues.length : null
  const levelValues = captures.map(f => f.metadata.input_level_dbu).filter(v => v != null)
  const refLevel = mode(levelValues)
  const gearValues = captures
    .map(f => [f.metadata.gear_make, f.metadata.gear_model].filter(Boolean).join(' ').trim())
    .filter(Boolean) as string[]
  const refGear = mode(gearValues)
  const toneTypes = [...new Set(captures.map(f => f.metadata.tone_type).filter(Boolean))] as string[]
  const channels = [...new Set(
    captures.map(f => f.metadata.nl_amp_channel).filter(Boolean)
  )].slice(0, 5) as string[]
  return { presets, epochValue, avgEsr, refLevel, refGear, toneTypes, channels }
}

export function generatePackHtmlAdvanced(
  info: PackInfo,
  folderPath: string,
  folderName: string,
  allCaptures: NamFile[],
  dark: boolean,
  logo?: string,
  darkAccentColor = '#f9b966',
  target: ExportTarget = 'nam'
): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const t = dark ? DARK_THEME(darkAccentColor) : LIGHT_THEME('#c46010')

  // Same subfolder/capture exclusion logic as the Simple version
  const normBase = folderPath.replace(/\\/g, '/') + '/'
  const captures = allCaptures.filter((f) => {
    const captureKey = f.metadata.name || f.fileName
    if (info.exportExcludedCaptures?.includes(captureKey)) return false
    if (!info.exportExcludedSubfolders?.length) return true
    const fp = f.filePath.replace(/\\/g, '/')
    if (!fp.startsWith(normBase)) return true
    const relFolder = fp.slice(normBase.length).split('/').slice(0, -1).join('/')
    return !info.exportExcludedSubfolders.includes(relFolder)
  })

  const activeCols = PACK_CAPTURE_COLUMNS.filter((c) =>
    (info.exportColumns ?? DEFAULT_EXPORT_COLUMNS).includes(c.id)
  )

  // ── Captures rows ──
  const captureHeaderCells = [
    `<th>Capture</th>`,
    ...activeCols.map((c) => {
      const align = c.id === 'tone_type' ? ' style="text-align:right"' : ''
      return `<th${align}>${esc(c.label)}</th>`
    }),
  ].join('')

  const captureRows = captures.map((f) => {
    const cells = activeCols.map((c) => {
      const v = c.accessor(f)
      if (!v) return `<td><span class="em-dash">—</span></td>`
      switch (c.id) {
        case 'nl_amp_channel':
          return `<td><span class="chan">${esc(v)}</span></td>`
        case 'nl_amp_settings':
          return `<td>${styleSettings(v, esc, t)}</td>`
        case 'tone_type':
          return `<td style="text-align:right"><span class="tone ${esc(v)}">${esc(v.replace('_', '-'))}</span></td>`
        default:
          return `<td class="dim">${esc(v)}</td>`
      }
    }).join('')
    return `<tr><td class="cap-name">${esc(f.metadata.name || f.fileName)}</td>${cells}</tr>`
  }).join('')

  // ── KV sections ──
  type LV = { label?: string; value?: string; term?: string; description?: string }
  const kvRows = (rows: LV[]) =>
    rows.map((r) => {
      const k = (r.label ?? r.term ?? '').trim()
      const v = (r.value ?? r.description ?? '').trim()
      return `<div class="kv-row"><div class="k">${esc(k)}</div><div class="v">${esc(v)}</div></div>`
    }).join('')

  const switchCards = info.switches.map((s, i) =>
    `<div class="switch-card">
       <div class="row"><div class="name">${esc(s.label)}</div><div class="num">${String(i + 1).padStart(2, '0')}</div></div>
       <hr/>
       <div class="desc">${esc(s.value)}</div>
     </div>`
  ).join('')

  const hasDesc      = info.description.trim().length > 0
  const hasEquip     = info.equipment.length > 0
  const hasPedals    = info.pedals.length > 0
  const hasSwitches  = info.switches.length > 0
  const hasGlossary  = info.glossary.length > 0
  const hasCaptures  = captures.length > 0
  const hasFooter    = info.footer.trim().length > 0

  // ── Stats bar ──
  const stats = deriveStats(captures)

  const statsBarHtml = (() => {
    const captureSubtitle = stats.channels.length
      ? stats.channels.join(' · ')
      : stats.toneTypes.map(tt => tt.replace('_', '-')).join(' · ')

    const statCol = (label: string, value: string, sub: string) =>
      `<div class="stat">
        <div class="stat-label">${label}</div>
        <div class="stat-value">${value}</div>
        ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
      </div>`

    const captureStat = statCol('Captures', String(captures.length), esc(captureSubtitle))

    if (target === 'proxy') {
      return `<div class="stats-bar">${captureStat}${statCol('Format', 'Proxy', 'Kemper / hardware')}</div>`
    }
    if (target === 'qc') {
      return `<div class="stats-bar">${captureStat}${statCol('Format', 'QC', 'Quad-Cortex / hardware')}</div>`
    }
    if (target === 'tonex') {
      return `<div class="stats-bar">${captureStat}${statCol('Format', 'ToneX', '')}</div>`
    }

    // NAM — full 4-column bar
    const algoValue = stats.presets[0] ? esc(stats.presets[0].toUpperCase()) : '—'
    const algoSub = stats.presets.length > 1
      ? esc('+ ' + stats.presets.slice(1).join(' / '))
      : ''
    const epochStr = stats.epochValue ? `${stats.epochValue.toLocaleString()} ep` : '—'
    const trainingSubSub = stats.avgEsr !== null && stats.avgEsr < 0.01 ? 'convergence-locked' : ''
    const refStr = stats.refLevel !== undefined ? String(stats.refLevel) : ''
    const refValue = refStr ? esc((refStr.startsWith('+') || refStr.startsWith('-') ? refStr : '+' + refStr) + ' dBu') : '—'
    const refSub = stats.refGear ? esc(stats.refGear) : ''

    return `<div class="stats-bar">
      ${captureStat}
      ${statCol('Algorithm', algoValue, algoSub)}
      ${statCol('Training', epochStr, trainingSubSub)}
      ${statCol('Reference', refValue, refSub)}
    </div>`
  })()

  // ── Contents ──
  const contentsSections: { title: string }[] = []
  if (hasDesc) contentsSections.push({ title: 'Overview' })
  if (hasCaptures) contentsSections.push({ title: 'Captures' })
  if (hasEquip) contentsSections.push({ title: 'Equipment' })
  if (hasPedals) contentsSections.push({ title: 'Drive Pedals' })
  if (hasSwitches) contentsSections.push({ title: 'Switches' })
  if (hasGlossary) contentsSections.push({ title: 'Glossary' })

  const contentsHtml = contentsSections.length > 1
    ? `<div class="contents">${contentsSections.map((s, i) =>
        `<div class="contents-item">
          <div class="contents-num">${String(i + 1).padStart(2, '0')}</div>
          <div class="contents-title">${esc(s.title)}</div>
        </div>`
      ).join('')}</div>`
    : ''

  // ── HTML ──
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(info.title || folderName)} — NAM Pack</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>
  @page {
    size: letter landscape;
    margin: 24mm 0 20mm 0;     /* top/bottom only — sides handled by body padding so they stay consistent regardless of print-dialog Margins setting */
    background: ${t.bg};
    @bottom-left   { content: "Core Tone Captures · coretonecaptures.com"; font: 8pt "IBM Plex Mono", monospace; color: ${t.dim}; letter-spacing: 0.18em; text-transform: uppercase; }
    @bottom-center { content: "© ${new Date().getFullYear()} Core Tone Captures"; font: 8pt "IBM Plex Mono", monospace; color: ${t.dimmer}; letter-spacing: 0.18em; text-transform: uppercase; }
    @bottom-right  { content: counter(page) " / " counter(pages); font: 8pt "IBM Plex Mono", monospace; color: ${t.dim}; letter-spacing: 0.18em; }
  }
  html, body { background: ${t.bg}; }
  body {
    color: ${t.fg};
    font-family: "IBM Plex Sans", system-ui, sans-serif;
    font-size: 10.5pt; line-height: 1.55;
    margin: 0;
    padding: 0 22mm;          /* side margins applied to EVERY printed page */
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .mono { font-family: "IBM Plex Mono", monospace; }
  .micro { font-family: "IBM Plex Mono", monospace; font-size: 8.5pt; letter-spacing: 0.22em; text-transform: uppercase; color: ${t.dim}; }
  h1, h2 { margin: 0; font-weight: 600; letter-spacing: -0.01em; }
  hr.rule { border: 0; border-top: 1px solid ${t.rule}; margin: 0; }

  .cover-header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 12pt; border-bottom: 1px solid ${t.rule}; }
  .cover-header img.logo { height: 44px; width: auto; }

  .cover-title { margin-top: 18pt; }
  .eyebrow { font-family: "IBM Plex Mono", monospace; font-size: 9pt; letter-spacing: 0.28em; text-transform: uppercase; color: ${t.accent}; margin-bottom: 8pt; }
  .wordmark { font-family: "IBM Plex Mono", monospace; font-size: 30pt; line-height: 1.05; font-weight: 600; letter-spacing: -0.03em; color: ${t.fg}; }
  .basedon { margin-top: 6pt; font-size: 12pt; color: ${t.dim}; }

  .desc { margin-top: 14pt; column-count: 2; column-gap: 18pt; font-size: 10pt; line-height: 1.65; color: ${t.fg}; }
  .desc p { margin: 0 0 8pt; break-inside: avoid; }

  .section { break-inside: avoid-page; margin-top: 16pt; }
  .section.break { break-before: page; margin-top: 0; padding-top: 32pt; }
  .section-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6pt; padding-bottom: 6pt; border-bottom: 1px solid ${t.rule}; }
  .section h2 { font-size: 18pt; }
  .section-sub { color: ${t.dim}; font-size: 10pt; margin-top: 2pt; max-width: 70%; }
  .section-num { color: ${t.accent}; }

  /* Captures table */
  table.captures { width: 100%; border-collapse: collapse; margin-top: 4pt; }
  table.captures thead { display: table-header-group; }
  table.captures thead th { font-family: "IBM Plex Mono", monospace; font-size: 8pt; font-weight: 500; letter-spacing: 0.22em; text-transform: uppercase; color: ${t.dim}; text-align: left; padding: 6pt 8pt; border-bottom: 1px solid ${t.rule}; background: ${t.bg}; }
  table.captures tbody tr { break-inside: avoid; page-break-inside: avoid; }
  table.captures tbody td { padding: 5pt 8pt; border-bottom: 1px solid ${t.rule}; vertical-align: top; font-size: 9.5pt; }
  td.cap-name { font-weight: 500; color: ${t.fg}; white-space: nowrap; }
  .chan { display: inline-block; font-family: "IBM Plex Mono", monospace; font-size: 8pt; color: ${t.accent}; border: 1px solid ${t.rule}; padding: 1pt 5pt; letter-spacing: 0.08em; }
  .settings { font-family: "IBM Plex Mono", monospace; font-size: 9pt; color: ${t.fg}; }
  .settings .k { color: ${t.accent}; font-weight: 500; }
  .settings .v { color: ${t.fg}; margin-left: 2pt; }
  .settings .sep { color: ${t.dimmer}; }
  .dim { color: ${t.dim}; }
  .em-dash { color: ${t.dimmer}; }
  .tone { font-family: "IBM Plex Mono", monospace; font-size: 7.5pt; letter-spacing: 0.14em; text-transform: uppercase; }
  .tone.clean { color: ${t.cool}; }
  .tone.crunch, .tone.overdrive { color: ${t.accent}; }
  .tone.hi_gain, .tone.distortion, .tone.fuzz { color: #e08b6e; }

  /* KV (Equipment / Pedals / Glossary) */
  .kv { border-top: 1px solid ${t.rule}; }
  .kv-row { display: grid; grid-template-columns: 180px 1fr; align-items: baseline; gap: 18pt; padding: 8pt 0; border-bottom: 1px solid ${t.rule}; break-inside: avoid; }
  .kv-row .k { font-family: "IBM Plex Mono", monospace; font-size: 9pt; letter-spacing: 0.18em; text-transform: uppercase; color: ${t.accent}; }
  .kv-row .v { font-size: 10pt; color: ${t.fg}; line-height: 1.5; }
  .kv.two-col { display: grid; grid-template-columns: 1fr 1fr; column-gap: 24pt; border-top: 1px solid ${t.rule}; }
  .kv.two-col .kv-row { grid-template-columns: 90px 1fr; border-top: none; }

  /* Switches */
  .switches-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10pt 14pt; margin-top: 4pt; }
  .switch-card { border: 1px solid ${t.rule}; padding: 12pt 14pt; display: flex; flex-direction: column; gap: 6pt; break-inside: avoid; }
  .switch-card .row { display: flex; justify-content: space-between; align-items: baseline; }
  .switch-card .name { font-family: "IBM Plex Mono", monospace; font-size: 14pt; color: ${t.fg}; font-weight: 500; }
  .switch-card .num  { font-family: "IBM Plex Mono", monospace; font-size: 8pt; letter-spacing: 0.18em; color: ${t.accent}; }
  .switch-card .desc { font-size: 9.5pt; color: ${t.dim}; line-height: 1.55; }
  .switch-card hr { border: 0; border-top: 1px solid ${t.rule}; }

  /* Footer colophon (last page only — distinct from @page footer chrome) */
  .colophon { margin-top: 24pt; padding-top: 14pt; border-top: 1px solid ${t.rule}; display: flex; justify-content: space-between; align-items: flex-end; gap: 18pt; break-inside: avoid; }
  .colophon .body { font-size: 9.5pt; color: ${t.dim}; max-width: 480px; line-height: 1.55; }
  .colophon img.logo { height: 36px; }

  .section-head, .kv-row, .switch-card .row { break-after: avoid; }

  /* Stats bar */
  .stats-bar { display: flex; gap: 0; margin-top: 20pt; border-top: 1px solid ${t.rule}; border-bottom: 1px solid ${t.rule}; break-inside: avoid; }
  .stat { flex: 1; padding: 12pt 0 12pt 0; padding-right: 16pt; }
  .stat + .stat { border-left: 1px solid ${t.rule}; padding-left: 16pt; }
  .stat-label { font-family: "IBM Plex Mono", monospace; font-size: 8pt; letter-spacing: 0.28em; text-transform: uppercase; color: ${t.dim}; margin-bottom: 5pt; }
  .stat-value { font-family: "IBM Plex Mono", monospace; font-size: 18pt; font-weight: 600; color: ${t.fg}; line-height: 1.1; letter-spacing: -0.02em; }
  .stat-sub { font-size: 8.5pt; color: ${t.dim}; margin-top: 4pt; letter-spacing: 0.04em; }

  /* Contents */
  .contents { display: flex; gap: 0; margin-top: 20pt; break-inside: avoid; }
  .contents-item { flex: 1; padding-top: 10pt; border-top: 1px solid ${t.rule}; }
  .contents-num { font-family: "IBM Plex Mono", monospace; font-size: 9pt; color: ${t.accent}; margin-bottom: 3pt; }
  .contents-title { font-size: 11pt; font-weight: 600; color: ${t.fg}; }
</style>
</head>
<body>

<div class="cover-header">
  ${logo ? `<img class="logo" src="${logo}" alt="Core Tone Captures"/>` : `<div class="micro">Core Tone Captures</div>`}
  ${info.versionInfo ? `<div class="micro" style="text-align:right; letter-spacing:0.12em">${esc(info.versionInfo)}</div>` : ''}
</div>

<div class="cover-title">
  <div class="eyebrow">╱╱  Capture Pack</div>
  <h1 class="wordmark">${esc(info.title || folderName)}</h1>
  ${info.subtitle ? `<div class="basedon">${esc(info.subtitle)}</div>` : ''}
</div>

${hasDesc ? `<div class="desc" style="margin-top:16pt">${parseDescription(info.description, dark)}</div>` : ''}

${statsBarHtml}

${contentsHtml}


${hasCaptures ? `<div class="section break">
  <div class="section-head">
    <div>
      <h2><span class="section-num">·</span> The Captures</h2>
      <div class="section-sub">Settings are listed in dial-position notation, exactly as logged at capture time. Switches indicate engaged positions; blank means default.</div>
    </div>
    <div class="micro">${captures.length} captures</div>
  </div>
  <table class="captures">
    <thead><tr>${captureHeaderCells}</tr></thead>
    <tbody>${captureRows}</tbody>
  </table>
</div>` : ''}

${hasEquip ? `<div class="section break">
  <div class="section-head"><div><h2><span class="section-num">·</span> Equipment</h2></div></div>
  <div class="kv">${kvRows(info.equipment)}</div>
</div>` : ''}

${hasPedals ? `<div class="section">
  <div class="section-head"><div><h2><span class="section-num">·</span> Drive Pedals</h2></div></div>
  <div class="kv two-col">${kvRows(info.pedals)}</div>
</div>` : ''}

${hasSwitches ? `<div class="section break">
  <div class="section-head">
    <div>
      <h2><span class="section-num">·</span> Switches &amp; Modes</h2>
      <div class="section-sub">Front-panel and back-panel toggles referenced in the capture list, and what each one shapes about the sound.</div>
    </div>
  </div>
  <div class="switches-grid">${switchCards}</div>
</div>` : ''}

${hasGlossary ? `<div class="section break">
  <div class="section-head">
    <div>
      <h2><span class="section-num">·</span> Glossary</h2>
      <div class="section-sub">Capture-name shorthand, cabinet and mic conventions, and gain-structure abbreviations used throughout the pack.</div>
    </div>
  </div>
  <div class="kv">${kvRows(info.glossary)}</div>
</div>` : ''}

${hasFooter ? `<div class="colophon">
  <div class="body">${parseDescription(info.footer, dark)}</div>
  ${logo ? `<img class="logo" src="${logo}" alt="Core Tone Captures"/>` : ''}
</div>` : ''}

</body>
</html>`
}
