import type { NamFile } from '../types/nam'
import type { PackInfo } from '../components/PackInfoEditor'

export const PACK_CAPTURE_COLUMNS: { id: string; label: string; accessor: (f: NamFile) => string; width: number }[] = [
  { id: 'nl_amp_channel',  label: 'Channel',   accessor: (f) => f.metadata.nl_amp_channel  || '', width: 11 },
  { id: 'nl_amp_settings', label: 'Settings',  accessor: (f) => f.metadata.nl_amp_settings || '', width: 30 },
  { id: 'nl_amp_switches', label: 'Switches',  accessor: (f) => f.metadata.nl_amp_switches || '', width: 22 },
  { id: 'nl_boost_pedal',  label: 'Boost/OD',  accessor: (f) => f.metadata.nl_boost_pedal  || '', width: 13 },
  { id: 'nl_cabinet',      label: 'Cabinet',   accessor: (f) => f.metadata.nl_cabinet      || '', width: 14 },
  { id: 'nl_mics',         label: 'Mic(s)',    accessor: (f) => f.metadata.nl_mics         || '', width: 12 },
  { id: 'tone_type',       label: 'Tone Type', accessor: (f) => f.metadata.tone_type        || '', width: 10 },
  { id: 'nl_comments',     label: 'Comments',  accessor: (f) => f.metadata.nl_comments     || '', width: 22 },
]

export const DEFAULT_EXPORT_COLUMNS = ['nl_amp_channel', 'nl_amp_settings', 'nl_amp_switches']

const COLOR_TOKENS: Record<string, { light: string; dark: string }> = {
  orange:  { light: '#e07020', dark: '#f97316' },
  teal:    { light: '#0d9488', dark: '#2dd4bf' },
  red:     { light: '#dc2626', dark: '#f87171' },
  blue:    { light: '#2563eb', dark: '#60a5fa' },
  green:   { light: '#16a34a', dark: '#4ade80' },
  dim:     { light: '#94a3b8', dark: '#6b7280' },
  white:   { light: '#1e2235', dark: '#f0f0f0' },
}

export function parseDescription(raw: string, dark: boolean): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const lines = raw.split('\n')
  const out: string[] = []
  let inList = false

  const inlineFormat = (s: string) => {
    s = esc(s)
    s = s.replace(/\[(\w+)\](.*?)\[\/\1\]/g, (_m, tag, content) => {
      const token = COLOR_TOKENS[tag.toLowerCase()]
      if (!token) return content
      return `<span style="color:${dark ? token.dark : token.light}">${content}</span>`
    })
    s = s.replace(/\*\*(.*?)\*\*/g, (_m, t) => `<strong>${t}</strong>`)
    s = s.replace(/\*(.*?)\*/g, (_m, t) => `<em>${t}</em>`)
    s = s.replace(/__(.*?)__/g, (_m, t) => `<u>${t}</u>`)
    return s
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (/^#{1,3}\s+/.test(line)) {
      if (inList) { out.push('</ul>'); inList = false }
      const text = line.replace(/^#+\s+/, '')
      out.push(`<p style="font-size:13px;font-weight:700;margin:10px 0 4px">${inlineFormat(text)}</p>`)
      continue
    }
    if (/^---+$/.test(line.trim())) {
      if (inList) { out.push('</ul>'); inList = false }
      out.push(`<hr style="border:none;border-top:1px solid currentColor;opacity:0.2;margin:10px 0">`)
      continue
    }
    if (/^[-*]\s+/.test(line)) {
      if (!inList) { out.push('<ul style="margin:4px 0 4px 16px;padding:0">'); inList = true }
      const text = line.replace(/^[-*]\s+/, '')
      out.push(`<li style="margin-bottom:2px">${inlineFormat(text)}</li>`)
      continue
    }
    if (inList) { out.push('</ul>'); inList = false }
    if (line.trim() === '') {
      out.push('<br>')
    } else {
      out.push(`<span>${inlineFormat(line)}</span><br>`)
    }
  }
  if (inList) out.push('</ul>')
  return out.join('\n')
}

export function generatePackHtml(info: PackInfo, folderPath: string, folderName: string, allCaptures: NamFile[], dark: boolean, logo?: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const normBase = folderPath.replace(/\\/g, '/') + '/'
  const captures = allCaptures.filter((f) => {
    const captureKey = f.metadata.name || f.fileName
    if (info.exportExcludedCaptures?.includes(captureKey)) return false
    if (info.exportExcludedSubfolders.length === 0) return true
    const fp = f.filePath.replace(/\\/g, '/')
    if (!fp.startsWith(normBase)) return true
    const relFolder = fp.slice(normBase.length).split('/').slice(0, -1).join('/')
    return !info.exportExcludedSubfolders.includes(relFolder)
  })

  const activeCols = PACK_CAPTURE_COLUMNS.filter((c) => (info.exportColumns ?? DEFAULT_EXPORT_COLUMNS).includes(c.id))
  const colSum = activeCols.reduce((s, c) => s + c.width, 0)
  const nameMinPct = 20
  const totalAvail = 100 - nameMinPct
  const scale = colSum > totalAvail ? totalAvail / colSum : 1
  const namePct = Math.round(100 - colSum * scale)

  const captureHeaderCells = [
    `<th style="width:${namePct}%">Capture Name</th>`,
    ...activeCols.map((c) => `<th style="width:${Math.round(c.width * scale)}%">${esc(c.label)}</th>`)
  ].join('')
  const captureFooterCells = `<td colspan="${activeCols.length + 1}"></td>`

  const captureRows = captures.map((f) => {
    const cells = [
      `<td class="col-name">${esc(f.metadata.name || f.fileName)}</td>`,
      ...activeCols.map((c) => `<td>${esc(c.accessor(f))}</td>`)
    ].join('')
    return `<tr>${cells}</tr>`
  }).join('')

  const equipRows = info.equipment.map((e) =>
    `<tr><td class="kv-label">${esc(e.label)}</td><td>${esc(e.value)}</td></tr>`
  ).join('')
  const pedalRows = info.pedals.map((e) =>
    `<tr><td class="kv-label">${esc(e.label)}</td><td>${esc(e.value)}</td></tr>`
  ).join('')
  const switchRows = info.switches.map((e) =>
    `<tr><td class="kv-label">${esc(e.label)}</td><td>${esc(e.value)}</td></tr>`
  ).join('')
  const glossaryRows = info.glossary.map((g) =>
    `<tr><td class="kv-label">${esc(g.term)}</td><td>${esc(g.description)}</td></tr>`
  ).join('')

  const hasCaptures = captures.length > 0
  const hasEquipment = info.equipment.length > 0
  const hasPedals = info.pedals.length > 0
  const hasSwitches = info.switches.length > 0
  const hasGlossary = info.glossary.length > 0
  const hasDesc = info.description.trim().length > 0
  const captureSectionClass = hasDesc ? 'section capture-section capture-section-page' : 'section capture-section'
  const kvTable = (rows: string) => `<table class="kv-table"><tbody>${rows}</tbody></table>`

  const t = dark ? {
    bodyBg: '#0d0d0d', bodyColor: '#e8e8e8',
    headerBg: '#000000', headerSub: '#888888',
    descColor: '#c0c0c0',
    sectionBorder: '#2a2a2a', sectionTitleColor: '#f97316',
    thBg: '#1a1a1a', thColor: '#f97316', thBorder: '#2a2a2a',
    tdBorder: '#1e1e1e', tdEvenBg: '#141414',
    kvLabelColor: '#f97316',
    footerBorder: '#2a2a2a', footerColor: '#555',
  } : {
    bodyBg: '#ffffff', bodyColor: '#1e2235',
    headerBg: '#1a1f35', headerSub: '#94a3b8',
    descColor: '#475569',
    sectionBorder: '#e2e8f0', sectionTitleColor: '#64748b',
    thBg: '#f8fafc', thColor: '#64748b', thBorder: '#e2e8f0',
    tdBorder: '#f1f5f9', tdEvenBg: '#fafbfc',
    kvLabelColor: '#334155',
    footerBorder: '#e2e8f0', footerColor: '#94a3b8',
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(info.title || folderName)} — NAM Pack</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { background: ${t.bodyBg}; }
  body { font-family: Inter, Arial, sans-serif; color: ${t.bodyColor}; background: ${t.bodyBg}; font-size: 10.5px; line-height: 1.45; }
  .header { background: ${t.headerBg}; color: #fff; padding: 18px 32px 16px; display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
  .header-left { flex: 1; min-width: 0; }
  .header-title { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
  .header-meta { display: flex; justify-content: space-between; align-items: baseline; margin-top: 6px; gap: 16px; }
  .header-sub { font-size: 14px; color: ${t.headerSub}; }
  .header-logo { flex-shrink: 0; display: flex; align-items: center; }
  .content { padding: 18px 44px; }
  .description { color: ${t.descColor}; margin-bottom: 16px; line-height: 1.7; width: 100%; font-size: 14px; }
  .section { margin-bottom: 20px; }
  .section-title { font-size: 10px; font-weight: 700; color: ${t.sectionTitleColor}; text-transform: uppercase; letter-spacing: 0.1em; text-align: center; margin-bottom: 8px; }
  .section-title::after { content: ''; display: block; width: 28px; height: 2px; background: ${t.sectionTitleColor}; border-radius: 1px; margin: 5px auto 0; opacity: 0.7; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; break-inside: auto; page-break-inside: auto; }
  thead { display: table-header-group; }
  tfoot { display: none; }
  thead th { background: ${t.thBg}; text-align: left; padding: 5px 8px; font-size: 9.5px; font-weight: 600; color: ${t.thColor}; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid ${t.thBorder}; white-space: nowrap; overflow: hidden; }
  tbody tr { break-inside: avoid; page-break-inside: avoid; }
  tbody td { padding: 4px 8px; border-bottom: 1px solid ${t.tdBorder}; vertical-align: top; word-break: break-word; }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:nth-child(even) { background: ${t.tdEvenBg}; }
  .col-name { overflow: hidden; }
  .kv-label { font-weight: 600; color: ${t.kvLabelColor}; width: 110px; white-space: nowrap; }
  .footer { margin-top: 24px; padding-top: 8px; border-top: 1px solid ${t.footerBorder}; font-size: 9.5px; color: ${t.footerColor}; }
  @page { margin: 0; }
  @media print {
    html, body { background: ${t.bodyBg}; }
    body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    .header, thead th, tbody tr:nth-child(even) { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .header { padding: 20px 52px 17px; break-inside: avoid; page-break-inside: avoid; }
    .content { padding: 18px 52px 24px; }
    .capture-section-page { break-before: page; page-break-before: always; padding-top: 12mm; }
    .keep-together { break-inside: avoid; page-break-inside: avoid; padding-top: 10mm; }
    .keep-together table, .keep-together tbody, .keep-together tr { break-inside: avoid; page-break-inside: avoid; }
    .section-title { break-after: avoid; page-break-after: avoid; }
    thead th { border-top: 9mm solid ${t.bodyBg}; }
    tfoot { display: table-footer-group; }
    tfoot td { height: 10mm; padding: 0; border: 0; background: ${t.bodyBg}; }
    .footer { break-inside: avoid; page-break-inside: avoid; margin-top: 10mm; padding-top: 6mm; padding-bottom: 12mm; }
  }
</style>
</head>
<body>
<div class="header">
  <div class="header-left">
    <div class="header-title">${esc(info.title || folderName)}</div>
    ${info.subtitle ? `<div class="header-meta"><div class="header-sub">${esc(info.subtitle)}</div></div>` : ''}
  </div>
  ${logo ? `<div class="header-logo"><img src="${logo}" style="max-height:56px;max-width:180px;object-fit:contain" /></div>` : ''}
</div>
<div class="content">
  ${hasDesc ? `<div class="description">${parseDescription(info.description, dark)}</div>` : ''}

  ${hasCaptures ? `<div class="${captureSectionClass}">
    <div class="section-title">Captures</div>
    <table>
      <thead><tr>${captureHeaderCells}</tr></thead>
      <tfoot><tr>${captureFooterCells}</tr></tfoot>
      <tbody>${captureRows}</tbody>
    </table>
  </div>` : ''}

  ${hasEquipment ? `<div class="section keep-together"><div class="section-title">Equipment</div>${kvTable(equipRows)}</div>` : ''}
  ${hasPedals ? `<div class="section keep-together"><div class="section-title">Pedals</div>${kvTable(pedalRows)}</div>` : ''}
  ${hasSwitches ? `<div class="section keep-together"><div class="section-title">Switches &amp; Modes</div>${kvTable(switchRows)}</div>` : ''}
  ${hasGlossary ? `<div class="section keep-together"><div class="section-title">Glossary</div>${kvTable(glossaryRows)}</div>` : ''}

  <div class="footer">${info.footer.trim() ? parseDescription(info.footer, dark) : 'Generated by NAM Lab'}</div>
</div>
</body>
</html>`
}
