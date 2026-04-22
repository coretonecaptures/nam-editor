import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { NamFile } from '../types/nam'
import { AppSettings } from '../types/settings'

export type CatalogItem = AppSettings['packGearCatalog'][number]

export interface PackInfo {
  title: string
  subtitle: string
  capturedBy: string
  description: string
  equipment: { label: string; value: string }[]
  pedals: { label: string; value: string }[]
  switches: { label: string; value: string }[]
  glossary: { term: string; description: string }[]
  footer: string
  exportExcludedSubfolders: string[]
  exportExcludedCaptures: string[]
  exportColumns: string[]
}

// Available columns for the captures table — name is always first and fixed.
// width is a percentage integer; name gets 100 - sum(active widths), min 20%.
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

const DEFAULT_EXPORT_COLUMNS = ['nl_amp_channel', 'nl_amp_settings', 'nl_amp_switches']

const EMPTY_PACK: PackInfo = {
  title: '',
  subtitle: '',
  capturedBy: '',
  description: '',
  equipment: [],
  pedals: [],
  switches: [],
  glossary: [],
  footer: '',
  exportExcludedSubfolders: [],
  exportExcludedCaptures: [],
  exportColumns: DEFAULT_EXPORT_COLUMNS
}

// Named theme color tokens for [color] tags — values injected at render time
const COLOR_TOKENS: Record<string, { light: string; dark: string }> = {
  orange:  { light: '#e07020', dark: '#f97316' },
  teal:    { light: '#0d9488', dark: '#2dd4bf' },
  red:     { light: '#dc2626', dark: '#f87171' },
  blue:    { light: '#2563eb', dark: '#60a5fa' },
  green:   { light: '#16a34a', dark: '#4ade80' },
  dim:     { light: '#94a3b8', dark: '#6b7280' },
  white:   { light: '#1e2235', dark: '#f0f0f0' },
}

function parseDescription(raw: string, dark: boolean): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const lines = raw.split('\n')
  const out: string[] = []
  let inList = false

  const inlineFormat = (s: string) => {
    // Escape HTML entities first so subsequent replacers don't double-escape
    s = esc(s)
    // BBCode color: [orange]text[/orange] etc. — content already escaped
    s = s.replace(/\[(\w+)\](.*?)\[\/\1\]/g, (_m, tag, content) => {
      const token = COLOR_TOKENS[tag.toLowerCase()]
      if (!token) return content
      return `<span style="color:${dark ? token.dark : token.light}">${content}</span>`
    })
    // **bold** — content may already contain span tags from color pass, don't re-escape
    s = s.replace(/\*\*(.*?)\*\*/g, (_m, t) => `<strong>${t}</strong>`)
    // *italic*
    s = s.replace(/\*(.*?)\*/g, (_m, t) => `<em>${t}</em>`)
    // __underline__
    s = s.replace(/__(.*?)__/g, (_m, t) => `<u>${t}</u>`)
    return s
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    // Heading: # text
    if (/^#{1,3}\s+/.test(line)) {
      if (inList) { out.push('</ul>'); inList = false }
      const text = line.replace(/^#+\s+/, '')
      out.push(`<p style="font-size:13px;font-weight:700;margin:10px 0 4px">${inlineFormat(text)}</p>`)
      continue
    }
    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      if (inList) { out.push('</ul>'); inList = false }
      out.push(`<hr style="border:none;border-top:1px solid currentColor;opacity:0.2;margin:10px 0">`)
      continue
    }
    // Bullet
    if (/^[-*]\s+/.test(line)) {
      if (!inList) { out.push('<ul style="margin:4px 0 4px 16px;padding:0">'); inList = true }
      const text = line.replace(/^[-*]\s+/, '')
      out.push(`<li style="margin-bottom:2px">${inlineFormat(text)}</li>`)
      continue
    }
    // Close list if needed
    if (inList) { out.push('</ul>'); inList = false }
    // Empty line → paragraph break
    if (line.trim() === '') {
      out.push('<br>')
    } else {
      out.push(`<span>${inlineFormat(line)}</span><br>`)
    }
  }
  if (inList) out.push('</ul>')
  return out.join('\n')
}

function generateExportHtml(info: PackInfo, folderPath: string, folderName: string, allCaptures: NamFile[], dark: boolean, logo?: string): string {
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
  // Name gets the remainder, minimum 20%. If active cols alone exceed 80%, scale everything down proportionally.
  const nameMinPct = 20
  const totalAvail = 100 - nameMinPct // 80% max for active cols
  const scale = colSum > totalAvail ? totalAvail / colSum : 1
  const namePct = Math.round(100 - colSum * scale)
  const nameWidth = `${namePct}%`

  const captureHeaderCells = [
    `<th style="width:${nameWidth}">Capture Name</th>`,
    ...activeCols.map((c) => `<th style="width:${Math.round(c.width * scale)}%">${esc(c.label)}</th>`)
  ].join('')

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

  const glossaryItems = info.glossary.map((g) =>
    `<div class="glossary-item"><span class="g-term">${esc(g.term)}</span><span class="g-sep"> — </span><span class="g-desc">${esc(g.description)}</span></div>`
  ).join('')

  const hasCaptures = captures.length > 0
  const hasEquipment = info.equipment.length > 0
  const hasPedals = info.pedals.length > 0
  const hasSwitches = info.switches.length > 0
  const hasGlossary = info.glossary.length > 0
  const hasDesc = info.description.trim().length > 0

  const kvTable = (rows: string) => `<table><tbody>${rows}</tbody></table>`

  const t = dark ? {
    bodyBg: '#0d0d0d', bodyColor: '#e8e8e8',
    headerBg: '#000000', headerSub: '#888888', headerCapturedBy: '#aaaaaa',
    descColor: '#c0c0c0',
    sectionBorder: '#2a2a2a', sectionTitleColor: '#f97316',
    thBg: '#1a1a1a', thColor: '#f97316', thBorder: '#2a2a2a',
    tdBorder: '#1e1e1e', tdEvenBg: '#141414',
    kvLabelColor: '#f97316',
    glossItemBorder: '#1e1e1e', gTermColor: '#f97316', gSepColor: '#555', gDescColor: '#aaa',
    footerBorder: '#2a2a2a', footerColor: '#555',
  } : {
    bodyBg: '#ffffff', bodyColor: '#1e2235',
    headerBg: '#1a1f35', headerSub: '#94a3b8', headerCapturedBy: '#b0bec5',
    descColor: '#475569',
    sectionBorder: '#e2e8f0', sectionTitleColor: '#64748b',
    thBg: '#f8fafc', thColor: '#64748b', thBorder: '#e2e8f0',
    tdBorder: '#f1f5f9', tdEvenBg: '#fafbfc',
    kvLabelColor: '#334155',
    glossItemBorder: '#f1f5f9', gTermColor: '#1e2235', gSepColor: '#94a3b8', gDescColor: '#475569',
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
  body { font-family: Inter, Arial, sans-serif; color: ${t.bodyColor}; background: ${t.bodyBg}; font-size: 10.5px; line-height: 1.45; }
  .header { background: ${t.headerBg}; color: #fff; padding: 18px 32px 16px; display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
  .header-left { flex: 1; min-width: 0; }
  .header-title { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
  .header-meta { display: flex; justify-content: space-between; align-items: baseline; margin-top: 6px; gap: 16px; }
  .header-sub { font-size: 14px; color: ${t.headerSub}; }
  .header-logo { flex-shrink: 0; display: flex; align-items: center; }
  .content { padding: 18px 32px; }
  .description { color: ${t.descColor}; margin-bottom: 16px; line-height: 1.7; width: 100%; font-size: 14px; }
  .section { margin-bottom: 20px; }
  .section-title { font-size: 10px; font-weight: 700; color: ${t.sectionTitleColor}; text-transform: uppercase; letter-spacing: 0.1em; text-align: center; margin-bottom: 8px; padding-bottom: 0; }
  .section-title::after { content: ''; display: block; width: 28px; height: 2px; background: ${t.sectionTitleColor}; border-radius: 1px; margin: 5px auto 0; opacity: 0.7; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead th { background: ${t.thBg}; text-align: left; padding: 5px 8px; font-size: 9.5px; font-weight: 600; color: ${t.thColor}; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid ${t.thBorder}; white-space: nowrap; overflow: hidden; }
  tbody td { padding: 4px 8px; border-bottom: 1px solid ${t.tdBorder}; vertical-align: top; word-break: break-word; }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:nth-child(even) { background: ${t.tdEvenBg}; }
  .col-name { overflow: hidden; }
  .kv-label { font-weight: 600; color: ${t.kvLabelColor}; width: 110px; white-space: nowrap; }
  .glossary-item { padding: 4px 8px; border-bottom: 1px solid ${t.glossItemBorder}; }
  .glossary-item:last-child { border-bottom: none; }
  .g-term { font-weight: 600; color: ${t.gTermColor}; }
  .g-sep { color: ${t.gSepColor}; }
  .g-desc { color: ${t.gDescColor}; }
  .footer { margin-top: 24px; padding-top: 8px; border-top: 1px solid ${t.footerBorder}; font-size: 9.5px; color: ${t.footerColor}; }
  @page { margin: 0; }
  @media print {
    body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    .header, thead th, tbody tr:nth-child(even) { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .content { padding: 14px 28px; }
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

  ${hasCaptures ? `<div class="section">
    <div class="section-title">Captures</div>
    <table>
      <thead><tr>${captureHeaderCells}</tr></thead>
      <tbody>${captureRows}</tbody>
    </table>
  </div>` : ''}

  ${hasEquipment ? `<div class="section"><div class="section-title">Equipment</div>${kvTable(equipRows)}</div>` : ''}
  ${hasPedals ? `<div class="section"><div class="section-title">Pedals</div>${kvTable(pedalRows)}</div>` : ''}
  ${hasSwitches ? `<div class="section"><div class="section-title">Switches &amp; Modes</div>${kvTable(switchRows)}</div>` : ''}

  ${hasGlossary ? `<div class="section">
    <div class="section-title">Glossary</div>
    <div>${glossaryItems}</div>
  </div>` : ''}

  <div class="footer">${info.footer.trim() ? parseDescription(info.footer, dark) : 'Generated by NAM Lab'}</div>
</div>
</body>
</html>`
}

interface Props {
  folderPath: string
  folderName: string
  captures: NamFile[]
  defaultCapturedBy?: string
  catalog?: CatalogItem[]
  onCatalogChange?: (catalog: CatalogItem[]) => void
  onPackSaved?: (folderPath: string, hasData: boolean) => void
  logoLight?: string
  logoDark?: string
  allFolderPaths?: string[]
}

function CopyFolderPicker({
  currentPath,
  allFolderPaths,
  onSelect,
  onClose,
}: {
  currentPath: string
  allFolderPaths: string[]
  onSelect: (path: string) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const normCurrent = currentPath.replace(/\\/g, '/')
  const filtered = allFolderPaths
    .filter((p) => p.replace(/\\/g, '/') !== normCurrent)
    .filter((p) => {
      if (!search.trim()) return true
      const name = p.replace(/\\/g, '/').split('/').pop() ?? p
      return name.toLowerCase().includes(search.toLowerCase())
    })
    .sort((a, b) => {
      const na = a.replace(/\\/g, '/').split('/').pop() ?? a
      const nb = b.replace(/\\/g, '/').split('/').pop() ?? b
      return na.localeCompare(nb)
    })

  return (
    <div
      ref={ref}
      className="absolute z-50 top-full right-0 mt-1 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl overflow-hidden"
    >
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-600 dark:text-gray-300">
        Copy pack info to…
      </div>
      <div className="px-2 py-1.5 border-b border-gray-200 dark:border-gray-700">
        <input
          autoFocus
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter folders…"
          className="w-full px-2 py-1 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:border-teal-500"
        />
      </div>
      <div className="max-h-56 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-3 text-xs text-gray-400 dark:text-gray-500">No folders found</div>
        ) : (
          filtered.map((p) => {
            const name = p.replace(/\\/g, '/').split('/').pop() ?? p
            return (
              <button
                key={p}
                onClick={() => onSelect(p)}
                className="w-full text-left px-3 py-2 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white transition-colors truncate"
                title={p}
              >
                {name}
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}

function SectionHeader({ label, hint }: { label: string; hint?: string }) {
  return (
    <div className="flex flex-col items-start pt-3 pb-2">
      <span className="text-xs font-bold text-gray-600 dark:text-gray-300 uppercase tracking-widest">{label}</span>
      {hint && <span className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{hint}</span>}
      <div className="mt-1.5 w-8 h-0.5 bg-teal-500 rounded-full" />
    </div>
  )
}

function RowEditor<T extends Record<string, string>>({
  rows, onChange, keys, addLabel, placeholders, firstColWidth = 'max-w-[120px]',
  catalogItems, onSaveToCatalog
}: {
  rows: T[]
  onChange: (rows: T[]) => void
  keys: (keyof T)[]
  addLabel: string
  placeholders: string[]
  firstColWidth?: string
  catalogItems?: { label: string; value: string }[]
  onSaveToCatalog?: (label: string, value: string) => void
}) {
  const [showPicker, setShowPicker] = useState(false)
  const pickerRef = useRef<HTMLDivElement>(null)
  const emptyRow = () => Object.fromEntries(keys.map((k) => [k, ''])) as T

  // Close picker on outside click
  useEffect(() => {
    if (!showPicker) return
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowPicker(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPicker])

  return (
    <div className="space-y-1.5">
      {rows.map((row, i) => (
        <div key={i} className="flex gap-1.5 items-start">
          {/* Up/down reorder */}
          <div className="flex flex-col mt-0.5 flex-shrink-0">
            <button
              onClick={() => { const n = [...rows]; [n[i-1], n[i]] = [n[i], n[i-1]]; onChange(n) }}
              disabled={i === 0}
              className="text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 disabled:opacity-20 disabled:pointer-events-none transition-colors leading-none"
              title="Move up"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
              </svg>
            </button>
            <button
              onClick={() => { const n = [...rows]; [n[i], n[i+1]] = [n[i+1], n[i]]; onChange(n) }}
              disabled={i === rows.length - 1}
              className="text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 disabled:opacity-20 disabled:pointer-events-none transition-colors leading-none"
              title="Move down"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
          {keys.map((k, ki) => (
            <input
              key={String(k)}
              value={row[k]}
              placeholder={placeholders[ki]}
              onChange={(e) => {
                const next = [...rows]
                next[i] = { ...next[i], [k]: e.target.value }
                onChange(next)
              }}
              className={`flex-1 text-xs px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-teal-500 ${ki === 0 ? firstColWidth : ''}`}
            />
          ))}
          {onSaveToCatalog && (() => {
            const rowLabel = String(row[keys[0]]).trim()
            const rowValue = String(row[keys[1] ?? keys[0]]).trim()
            const alreadyInCatalog = !!catalogItems?.some(
              (c) => c.label.trim() === rowLabel && c.value.trim() === rowValue
            )
            if (alreadyInCatalog) return null
            return (
            <button
              onClick={() => onSaveToCatalog(String(row[keys[0]]), String(row[keys[1] ?? keys[0]]))}
              className="text-gray-300 dark:text-gray-600 hover:text-teal-500 dark:hover:text-teal-400 transition-colors mt-1 flex-shrink-0"
              title="Save to catalog"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
              </svg>
            </button>
            )
          })()}
          <button
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
            className="text-gray-400 hover:text-red-500 transition-colors mt-1 flex-shrink-0"
            title="Remove"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => onChange([...rows, emptyRow()])}
          className="text-xs text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 font-medium transition-colors"
        >
          + {addLabel}
        </button>
        {catalogItems && catalogItems.length > 0 && (
          <div className="relative" ref={pickerRef}>
            <button
              onClick={() => setShowPicker((v) => !v)}
              className="text-xs text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 font-medium transition-colors"
            >
              From catalog ({catalogItems.length})…
            </button>
            {showPicker && (
              <div className="absolute left-0 top-5 z-30 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg min-w-[200px] max-w-[280px]">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-100 dark:border-gray-800">
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">{catalogItems.length} items</span>
                  <button
                    onClick={() => {
                      const newRows = catalogItems.map((item) =>
                        Object.fromEntries(keys.map((k, ki) => [k, ki === 0 ? item.label : item.value])) as T
                      )
                      onChange([...rows, ...newRows])
                      setShowPicker(false)
                    }}
                    className="text-[10px] font-medium text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300"
                  >
                    Add all
                  </button>
                </div>
                <div className="max-h-48 overflow-y-auto py-1">
                {catalogItems.map((item, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      const newRow = Object.fromEntries(keys.map((k, ki) =>
                        [k, ki === 0 ? item.label : item.value]
                      )) as T
                      onChange([...rows, newRow])
                      setShowPicker(false)
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{item.label}</span>
                    {item.value && (
                      <span className="text-xs text-gray-400 dark:text-gray-500 ml-1.5 truncate">{item.value}</span>
                    )}
                  </button>
                ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function PackInfoEditor({ folderPath, folderName, captures, defaultCapturedBy = '', catalog = [], onCatalogChange, onPackSaved, logoLight, logoDark, allFolderPaths = [] }: Props) {
  const [pack, setPack] = useState<PackInfo>(EMPTY_PACK)
  const savedPackRef = useRef<PackInfo>(EMPTY_PACK)
  const [saved, setSaved] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [subfoldersOpen, setSubfoldersOpen] = useState(false)
  const subfoldersRef = useRef<HTMLDivElement>(null)
  const [colsOpen, setColsOpen] = useState(false)
  const colsRef = useRef<HTMLDivElement>(null)
  const [darkExport, setDarkExport] = useState(() => {
    try { return localStorage.getItem('nam-pack-dark-export') === '1' } catch { return false }
  })
  const [copyPickerOpen, setCopyPickerOpen] = useState(false)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api.readPackInfo(folderPath).then((res) => {
      if (cancelled) return
      const loaded: PackInfo = res.success && res.data
        ? (() => {
            const d = res.data as Partial<PackInfo>
            return {
              title: d.title ?? '',
              subtitle: d.subtitle ?? '',
              capturedBy: d.capturedBy ?? defaultCapturedBy,
              description: d.description ?? '',
              equipment: d.equipment ?? [],
              pedals: d.pedals ?? [],
              switches: d.switches ?? [],
              glossary: d.glossary ?? [],
              footer: d.footer ?? '',
              exportExcludedSubfolders: d.exportExcludedSubfolders ?? [],
              exportExcludedCaptures: d.exportExcludedCaptures ?? [],
              exportColumns: d.exportColumns ?? DEFAULT_EXPORT_COLUMNS
            }
          })()
        : { ...EMPTY_PACK, capturedBy: defaultCapturedBy }
      setPack(loaded)
      savedPackRef.current = loaded
      setSaved(true)
    })
    return () => { cancelled = true }
  }, [folderPath])

  const update = useCallback(<K extends keyof PackInfo>(key: K, val: PackInfo[K]) => {
    setPack((prev) => ({ ...prev, [key]: val }))
    setSaved(false)
    setStatus(null)
  }, [])

  const addToCatalog = useCallback((category: CatalogItem['category'], label: string, value: string) => {
    if (!label.trim() || !onCatalogChange) return
    onCatalogChange([...catalog, { category, label: label.trim(), value: value.trim() }])
  }, [catalog, onCatalogChange])

  const catalogFor = (cat: CatalogItem['category']) => catalog.filter((i) => i.category === cat)

  const toggleDarkExport = (val: boolean) => {
    setDarkExport(val)
    try { localStorage.setItem('nam-pack-dark-export', val ? '1' : '0') } catch { /* */ }
  }

  // Close subfolder popup on outside click
  useEffect(() => {
    if (!subfoldersOpen) return
    const handler = (e: MouseEvent) => {
      if (subfoldersRef.current && !subfoldersRef.current.contains(e.target as Node)) {
        setSubfoldersOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [subfoldersOpen])

  // Close columns popup on outside click
  useEffect(() => {
    if (!colsOpen) return
    const handler = (e: MouseEvent) => {
      if (colsRef.current && !colsRef.current.contains(e.target as Node)) {
        setColsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [colsOpen])

  // Derive all distinct relative folder paths containing captures (e.g. "V1/DI", "V2/HyperAccurate/DI").
  // Each entry is the full relative path of the folder, not just a name segment.
  const subfolders = useMemo(() => {
    const base = folderPath.replace(/\\/g, '/') + '/'
    const seen = new Set<string>()
    for (const f of captures) {
      const fp = f.filePath.replace(/\\/g, '/')
      if (!fp.startsWith(base)) continue
      const rel = fp.slice(base.length)
      const parts = rel.split('/').slice(0, -1)
      if (parts.length > 0) seen.add(parts.join('/'))
    }
    return [...seen].sort()
  }, [captures, folderPath])

  // Returns true if the file should be included — excluded if its folder path matches any excluded entry exactly
  const isNotExcluded = useCallback((f: NamFile) => {
    const captureKey = f.metadata.name || f.fileName
    if (pack.exportExcludedCaptures.includes(captureKey)) return false
    if (pack.exportExcludedSubfolders.length === 0) return true
    const base = folderPath.replace(/\\/g, '/') + '/'
    const fp = f.filePath.replace(/\\/g, '/')
    if (!fp.startsWith(base)) return true
    const relFolder = fp.slice(base.length).split('/').slice(0, -1).join('/')
    return !pack.exportExcludedSubfolders.includes(relFolder)
  }, [pack.exportExcludedCaptures, pack.exportExcludedSubfolders, folderPath])

  const handleSave = async () => {
    const res = await window.api.writePackInfo(folderPath, pack)
    if (res.success) {
      savedPackRef.current = pack
      setSaved(true)
      setStatus('Saved')
      setTimeout(() => setStatus(null), 2000)
      onPackSaved?.(folderPath.replace(/\\/g, '/'), !!pack.title.trim())
    } else {
      setStatus('Save failed')
    }
  }

  const handleExport = async () => {
    setExporting(true)
    if (!saved) await handleSave()
    const logo = darkExport ? (logoDark || undefined) : (logoLight || undefined)
    const html = generateExportHtml(pack, folderPath, folderName, captures, darkExport, logo)
    const res = await window.api.exportPackSheet(html)
    setExporting(false)
    if (!res.success) setStatus('Export failed')
  }

  const handleCopyTo = async (targetPath: string) => {
    setCopyPickerOpen(false)
    const res = await window.api.writePackInfo(targetPath, pack)
    if (res.success) {
      const targetName = targetPath.replace(/\\/g, '/').split('/').pop() ?? targetPath
      onPackSaved?.(targetPath.replace(/\\/g, '/'), !!pack.title.trim())
      setCopyStatus(`Copied to "${targetName}"`)
      setTimeout(() => setCopyStatus(null), 3000)
    } else {
      setCopyStatus('Copy failed')
      setTimeout(() => setCopyStatus(null), 3000)
    }
  }

  const isChanged = (key: keyof PackInfo) =>
    JSON.stringify(pack[key]) !== JSON.stringify(savedPackRef.current[key])

  const baseInputCls = 'w-full text-xs px-2.5 py-1.5 rounded border bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none'
  const inputCls = (key?: keyof PackInfo) =>
    key && isChanged(key)
      ? `${baseInputCls} border-amber-500/60 bg-amber-50 dark:bg-amber-900/10 focus:border-amber-400`
      : `${baseInputCls} border-gray-200 dark:border-gray-700 focus:border-teal-500`
  const sectionChanged = (key: keyof PackInfo) =>
    isChanged(key) ? 'ring-1 ring-amber-500/40 rounded' : ''
  const labelCls = 'text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block'

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between flex-shrink-0">
        <div>
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Pack Info</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">{folderName}</p>
        </div>
        <div className="flex items-center gap-2 relative">
          {(status || copyStatus) && (
            <span className={`text-xs ${copyStatus ? 'text-teal-600 dark:text-teal-400' : status === 'Saved' ? 'text-teal-600 dark:text-teal-400' : 'text-red-500'}`}>
              {copyStatus ?? status}
            </span>
          )}
          <label className="flex items-center gap-1.5 cursor-pointer select-none" title="Dark mode export">
            <span className="text-xs text-gray-500 dark:text-gray-400">Dark</span>
            <div
              onClick={() => toggleDarkExport(!darkExport)}
              className={`relative w-7 h-4 rounded-full transition-colors ${darkExport ? 'bg-orange-500' : 'bg-gray-300 dark:bg-gray-600'}`}
            >
              <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${darkExport ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
            </div>
          </label>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="text-xs px-2.5 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            Export PDF…
          </button>
          {/* Copy to… — deferred: NAM Lab's nested folder structure makes target
              selection non-trivial; capture-lab has flat folders so its picker
              worked out of the box. Needs UX design before enabling. */}
          {false && allFolderPaths.length > 1 && (
            <button
              onClick={() => setCopyPickerOpen((v) => !v)}
              title="Copy pack info to another folder"
              className="text-xs px-2.5 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Copy to…
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saved}
            className={`text-xs px-2.5 py-1 rounded text-white transition-colors ${saved ? 'bg-teal-600 opacity-40' : 'bg-teal-600 hover:bg-teal-700'}`}
          >
            Save
          </button>
          {copyPickerOpen && (
            <CopyFolderPicker
              currentPath={folderPath}
              allFolderPaths={allFolderPaths}
              onSelect={handleCopyTo}
              onClose={() => setCopyPickerOpen(false)}
            />
          )}
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">

        {/* Identity */}
        <div className="space-y-2 pb-1">
          <div>
            <label className={labelCls}>Pack Title</label>
            <input
              value={pack.title}
              placeholder="e.g. FMAN 100 Deluxe V2 NAM Pack"
              onChange={(e) => update('title', e.target.value)}
              className={inputCls('title')}
            />
          </div>
          <div>
            <label className={labelCls}>Subtitle</label>
            <input
              value={pack.subtitle}
              placeholder="e.g. Based on a Friedman BE100 Deluxe"
              onChange={(e) => update('subtitle', e.target.value)}
              className={inputCls('subtitle')}
            />
          </div>
          <div>
            <label className={labelCls}>Captured By</label>
            <input
              value={pack.capturedBy}
              placeholder="e.g. Core Tone Captures"
              onChange={(e) => update('capturedBy', e.target.value)}
              className={inputCls('capturedBy')}
            />
          </div>
        </div>

        {/* Description */}
        <div className="pb-1">
          <label className={labelCls}>Description</label>
          <textarea
            value={pack.description}
            placeholder="Describe the amp, the tones, how it was captured…"
            onChange={(e) => update('description', e.target.value)}
            rows={7}
            className={`${inputCls('description')} resize-y leading-relaxed min-h-[80px] font-mono text-xs`}
          />
          <div className="mt-1 px-1 text-[10px] text-gray-400 dark:text-gray-500 leading-relaxed">
            <span className="font-semibold text-gray-500 dark:text-gray-400">Formatting (export only):</span>
            {' '}<code className="bg-gray-100 dark:bg-gray-800 px-0.5 rounded">**bold**</code>
            {' '}<code className="bg-gray-100 dark:bg-gray-800 px-0.5 rounded">*italic*</code>
            {' '}<code className="bg-gray-100 dark:bg-gray-800 px-0.5 rounded">__underline__</code>
            {' '}<code className="bg-gray-100 dark:bg-gray-800 px-0.5 rounded"># Heading</code>
            {' '}<code className="bg-gray-100 dark:bg-gray-800 px-0.5 rounded">- bullet</code>
            {' '}<code className="bg-gray-100 dark:bg-gray-800 px-0.5 rounded">---</code>
            {' '}Color: <code className="bg-gray-100 dark:bg-gray-800 px-0.5 rounded">[orange]text[/orange]</code>
            {' — '}available: orange, teal, red, blue, green, dim, white
          </div>
        </div>

        {/* Captures */}
        <SectionHeader label="Captures" hint={`${captures.length} loaded from files — check/uncheck to include in export`} />
        {/* Subfolder filter + column chooser row */}
        <div className="mb-2 flex items-center gap-2">
        {subfolders.length > 0 && (
          <div className="flex items-center gap-2 relative" ref={subfoldersRef}>
            <button
              onClick={() => setSubfoldersOpen((v) => !v)}
              className="flex items-center gap-1.5 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-teal-500 dark:hover:border-teal-500 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h4l2 2h10a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V4z" />
              </svg>
              Filter subfolders
              {pack.exportExcludedSubfolders.length > 0 && (
                <span className="ml-0.5 px-1 rounded-full bg-amber-500 text-white text-[10px] leading-4">
                  {pack.exportExcludedSubfolders.length} hidden
                </span>
              )}
              <svg className={`w-2.5 h-2.5 transition-transform ${subfoldersOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {subfoldersOpen && (
              <div className="absolute top-full left-0 mt-1 z-30 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl">
                <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
                  <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">Include subfolders in export</span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => update('exportExcludedSubfolders', [])}
                      className="text-[10px] text-teal-600 dark:text-teal-400 hover:underline"
                    >All</button>
                    <button
                      onClick={() => update('exportExcludedSubfolders', [...subfolders])}
                      className="text-[10px] text-gray-400 hover:underline"
                    >None</button>
                  </div>
                </div>
                <div className="overflow-y-auto max-h-64 py-1">
                  {subfolders.map((sub) => {
                    const excluded = pack.exportExcludedSubfolders.includes(sub)
                    const base = folderPath.replace(/\\/g, '/') + '/'
                    const count = captures.filter((f) => {
                      const fp = f.filePath.replace(/\\/g, '/')
                      if (!fp.startsWith(base)) return false
                      const relFolder = fp.slice(base.length).split('/').slice(0, -1).join('/')
                      return relFolder === sub
                    }).length
                    return (
                      <label key={sub} className="flex items-center gap-2 px-3 py-1 hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={!excluded}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? pack.exportExcludedSubfolders.filter((s) => s !== sub)
                              : [...pack.exportExcludedSubfolders, sub]
                            update('exportExcludedSubfolders', next)
                          }}
                          className="w-3 h-3 rounded accent-teal-600 flex-shrink-0"
                        />
                        <span className="text-xs text-gray-700 dark:text-gray-300 flex-1 truncate font-mono">{sub}</span>
                        <span className="text-xs text-gray-400 flex-shrink-0">{count}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
        {/* Column chooser */}
        <div className="relative" ref={colsRef}>
          <button
            onClick={() => setColsOpen((v) => !v)}
            className="flex items-center gap-1.5 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-teal-500 dark:hover:border-teal-500 transition-colors"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            Columns
            <span className="text-gray-400 dark:text-gray-500 text-[10px]">{pack.exportColumns.length + 1} shown</span>
            <svg className={`w-2.5 h-2.5 transition-transform ${colsOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {colsOpen && (
            <div className="absolute top-full left-0 mt-1 z-30 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl">
              <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-600 dark:text-gray-300">
                Capture columns (max 6)
              </div>
              <div className="py-1">
                {/* Fixed: Capture Name always first */}
                <div className="flex items-center gap-2 px-3 py-1 opacity-50 select-none">
                  <div className="w-3.5 flex-shrink-0" />
                  <input type="checkbox" checked readOnly className="w-3 h-3 rounded flex-shrink-0" />
                  <span className="text-xs text-gray-700 dark:text-gray-300 flex-1">Capture Name</span>
                  <span className="text-[10px] text-gray-400">always</span>
                </div>
                {/* Active columns in order with reorder arrows */}
                {pack.exportColumns.map((id, idx) => {
                  const col = PACK_CAPTURE_COLUMNS.find((c) => c.id === id)
                  if (!col) return null
                  return (
                    <div key={id} className="flex items-center gap-1 px-2 py-0.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 group">
                      <div className="flex flex-col flex-shrink-0">
                        <button
                          onClick={() => {
                            if (idx === 0) return
                            const next = [...pack.exportColumns]
                            ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
                            update('exportColumns', next)
                          }}
                          disabled={idx === 0}
                          className="text-gray-300 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-20 disabled:pointer-events-none leading-none"
                        >
                          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
                          </svg>
                        </button>
                        <button
                          onClick={() => {
                            if (idx === pack.exportColumns.length - 1) return
                            const next = [...pack.exportColumns]
                            ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
                            update('exportColumns', next)
                          }}
                          disabled={idx === pack.exportColumns.length - 1}
                          className="text-gray-300 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-20 disabled:pointer-events-none leading-none"
                        >
                          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                          </svg>
                        </button>
                      </div>
                      <input
                        type="checkbox"
                        checked
                        onChange={() => update('exportColumns', pack.exportColumns.filter((c) => c !== id))}
                        className="w-3 h-3 rounded accent-teal-600 flex-shrink-0 cursor-pointer"
                      />
                      <span className="text-xs text-gray-700 dark:text-gray-300 flex-1 select-none">{col.label}</span>
                    </div>
                  )
                })}
                {/* Inactive columns — click to add at end */}
                {PACK_CAPTURE_COLUMNS.filter((c) => !pack.exportColumns.includes(c.id)).map((col) => {
                  const atMax = pack.exportColumns.length >= 6
                  return (
                    <label key={col.id} className={`flex items-center gap-1 px-2 py-0.5 cursor-pointer select-none hover:bg-gray-50 dark:hover:bg-gray-700/50 ${atMax ? 'opacity-40 pointer-events-none' : ''}`}>
                      <div className="w-3.5 flex-shrink-0" />
                      <input
                        type="checkbox"
                        checked={false}
                        onChange={() => { if (!atMax) update('exportColumns', [...pack.exportColumns, col.id]) }}
                        className="w-3 h-3 rounded accent-teal-600 flex-shrink-0"
                      />
                      <span className="text-xs text-gray-400 dark:text-gray-500 flex-1">{col.label}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </div>
        </div>{/* end filter+columns row */}

        <div>
          {captures.length === 0 ? (
            <p className="text-xs text-gray-400 dark:text-gray-500 italic text-center py-2">No captures loaded for this folder</p>
          ) : (() => {
            const activeCols = pack.exportColumns
              .map((id) => PACK_CAPTURE_COLUMNS.find((c) => c.id === id))
              .filter((c): c is typeof PACK_CAPTURE_COLUMNS[number] => !!c)
            // Only show captures that pass the subfolder filter
            const base = folderPath.replace(/\\/g, '/') + '/'
            const subfoldVisible = captures.filter((f) => {
              if (pack.exportExcludedSubfolders.length === 0) return true
              const fp = f.filePath.replace(/\\/g, '/')
              if (!fp.startsWith(base)) return true
              const relFolder = fp.slice(base.length).split('/').slice(0, -1).join('/')
              return !pack.exportExcludedSubfolders.includes(relFolder)
            })
            const includedCount = subfoldVisible.filter((f) => !pack.exportExcludedCaptures.includes(f.metadata.name || f.fileName)).length
            return (
              <div className="rounded border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-xs table-fixed">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                        <th className="w-6 px-1 py-1" title="Include in export" />
                        <th className="text-left px-2 py-1 font-medium">Name</th>
                        {activeCols.map((c) => (
                          <th key={c.id} className="text-left px-2 py-1 font-medium">{c.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {subfoldVisible.map((f) => {
                        const key = f.metadata.name || f.fileName
                        const excluded = pack.exportExcludedCaptures.includes(key)
                        return (
                          <tr key={f.filePath} className={`border-t border-gray-100 dark:border-gray-800 ${excluded ? 'opacity-40' : ''}`}>
                            <td className="px-1 py-0.5 text-center">
                              <input
                                type="checkbox"
                                checked={!excluded}
                                onChange={(e) => {
                                  const next = e.target.checked
                                    ? pack.exportExcludedCaptures.filter((k) => k !== key)
                                    : [...pack.exportExcludedCaptures, key]
                                  update('exportExcludedCaptures', next)
                                }}
                                className="w-3 h-3 rounded accent-teal-600 cursor-pointer"
                                title={excluded ? 'Excluded from export — click to include' : 'Included in export — click to exclude'}
                              />
                            </td>
                            <td className="px-2 py-0.5 text-gray-800 dark:text-gray-200 truncate">{key}</td>
                            {activeCols.map((c) => (
                              <td key={c.id} className="px-2 py-0.5 text-gray-600 dark:text-gray-400 truncate">{c.accessor(f)}</td>
                            ))}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="px-3 py-1.5 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between bg-gray-50 dark:bg-gray-800/50">
                  <span className="text-[10px] text-gray-500 dark:text-gray-400">
                    <span className="font-medium text-gray-700 dark:text-gray-300">{includedCount}</span>
                    {' of '}
                    <span className="font-medium text-gray-700 dark:text-gray-300">{subfoldVisible.length}</span>
                    {' captures in export'}
                    {captures.length !== subfoldVisible.length && (
                      <span className="text-gray-400 dark:text-gray-600"> · {captures.length - subfoldVisible.length} hidden by folder filter</span>
                    )}
                  </span>
                  {pack.exportExcludedCaptures.length > 0 && (
                    <button
                      onClick={() => update('exportExcludedCaptures', [])}
                      className="text-[10px] text-teal-600 dark:text-teal-400 hover:underline"
                    >
                      Include all
                    </button>
                  )}
                </div>
              </div>
            )
          })()}
        </div>

        {/* Equipment */}
        <SectionHeader label="Equipment" hint="Amp · Cabinet · Mic(s) · Preamp · Interface" />
        <div className={sectionChanged('equipment')}>
          <RowEditor
            rows={pack.equipment}
            onChange={(rows) => update('equipment', rows)}
            keys={['label', 'value']}
            addLabel="Add item"
            placeholders={['Amp', 'Friedman BE-100 Deluxe V2']}
            catalogItems={catalogFor('equipment')}
            onSaveToCatalog={(label, value) => addToCatalog('equipment', label, value)}
          />
        </div>

        {/* Pedals */}
        <SectionHeader label="Pedals" hint="Boost · Drive · EQ · Effects in chain" />
        <div className={sectionChanged('pedals')}>
          <RowEditor
            rows={pack.pedals}
            onChange={(rows) => update('pedals', rows)}
            keys={['label', 'value']}
            addLabel="Add pedal"
            placeholders={['Boost', 'Klon Centaur (unity gain)']}
            catalogItems={catalogFor('pedals')}
            onSaveToCatalog={(label, value) => addToCatalog('pedals', label, value)}
          />
        </div>

        {/* Switches — no catalog (per-amp) */}
        <SectionHeader label="Switches & Modes" hint="Channel modes · Tone stack · Voice switches" />
        <div className={sectionChanged('switches')}>
          <RowEditor
            rows={pack.switches}
            onChange={(rows) => update('switches', rows)}
            keys={['label', 'value']}
            addLabel="Add switch"
            placeholders={['Tight switch', 'Engaged on all BE channels']}
            firstColWidth="max-w-[140px]"
          />
        </div>

        {/* Glossary */}
        <SectionHeader label="Glossary" hint="Define terms used in capture names" />
        <div className={`pb-4 ${sectionChanged('glossary')}`}>
          <RowEditor
            rows={pack.glossary}
            onChange={(rows) => update('glossary', rows)}
            keys={['term', 'description']}
            addLabel="Add entry"
            placeholders={['DI', 'Direct Inject — no cabinet']}
            catalogItems={catalogFor('glossary')}
            onSaveToCatalog={(label, value) => addToCatalog('glossary', label, value)}
          />
        </div>

        {/* Footer */}
        <SectionHeader label="Footer" hint="Contact info, copyright, links…" />
        <div className="pb-4">
          <textarea
            value={pack.footer}
            placeholder="© 2025 Core Tone Captures · cortonecaptures.com"
            onChange={(e) => update('footer', e.target.value)}
            rows={2}
            className={`${inputCls('footer')} resize-none font-mono text-xs`}
          />
          <p className="mt-1 px-1 text-[10px] text-gray-400 dark:text-gray-500">
            Supports same formatting as description — <code className="bg-gray-100 dark:bg-gray-800 px-0.5 rounded">**bold**</code>, <code className="bg-gray-100 dark:bg-gray-800 px-0.5 rounded">[orange]color[/orange]</code>, etc.
          </p>
        </div>

        {/* Print tips */}
        <div className="mt-2 mb-4 px-3 py-2.5 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <p className="text-[10px] italic text-gray-400 dark:text-gray-500 leading-relaxed">
            * <span className="font-semibold not-italic text-gray-500 dark:text-gray-400">Printing to PDF from browser:</span> recommend <span className="font-semibold not-italic">landscape</span> orientation for best results.
            For dark mode exports, set margins to <span className="font-semibold not-italic">None</span> and enable <span className="font-semibold not-italic">Background Graphics</span> in the print dialog to preserve background colours.
          </p>
        </div>
      </div>
    </div>
  )
}
