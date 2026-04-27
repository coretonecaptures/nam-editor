import { useState, useEffect, useRef, useCallback } from 'react'
import type { NamFile } from '../types/nam'
import type { PackInfo } from './PackInfoEditor'
import { generatePackHtml, parseDescription } from '../utils/packExport'

export interface BundleLinkedPack {
  folderPath: string  // relative to root folder
  overrideName: string
  included: boolean
}

export interface BundleData {
  title: string
  subtitle: string
  description: string
  footer: string
  linkedPacks: BundleLinkedPack[]
}

interface Props {
  folderPath: string    // absolute path of the bundle folder
  rootFolder: string    // absolute path of the open root folder
  dark: boolean
  logoLight?: string
  logoDark?: string
  defaultCapturedBy?: string
  onSaved: () => void
  onDeleted: () => void
}

const EMPTY_BUNDLE: BundleData = {
  title: '',
  subtitle: '',
  description: '',
  footer: '',
  linkedPacks: [],
}

function relPath(absFolder: string, rootFolder: string): string {
  const norm = (p: string) => p.replace(/\\/g, '/')
  const a = norm(absFolder)
  const r = norm(rootFolder)
  return a.startsWith(r + '/') ? a.slice(r.length + 1) : a
}

function absPath(rel: string, rootFolder: string): string {
  const norm = (p: string) => p.replace(/\\/g, '/')
  const r = norm(rootFolder)
  return rel.startsWith('/') ? rel : `${r}/${rel}`
}

export function BundleEditor({ folderPath, rootFolder, dark, logoLight, logoDark, onSaved, onDeleted }: Props) {
  const [bundle, setBundle] = useState<BundleData>(EMPTY_BUNDLE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportingPack, setExportingPack] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [packOptions, setPackOptions] = useState<{ folderPath: string; title: string }[]>([])
  const [pickerSearch, setPickerSearch] = useState('')
  const pickerRef = useRef<HTMLDivElement>(null)
  const dragIndexRef = useRef<number | null>(null)

  useEffect(() => {
    setLoading(true)
    window.api.readBundle(folderPath).then((res) => {
      if (res.success && res.data) {
        const d = res.data as BundleData
        setBundle({
          title: d.title ?? '',
          subtitle: d.subtitle ?? '',
          description: d.description ?? '',
          footer: d.footer ?? '',
          linkedPacks: Array.isArray(d.linkedPacks) ? d.linkedPacks : [],
        })
      } else {
        setBundle(EMPTY_BUNDLE)
      }
      setLoading(false)
      setDirty(false)
    })
  }, [folderPath])

  useEffect(() => {
    if (!showPicker) return
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowPicker(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [showPicker])

  const update = useCallback((patch: Partial<BundleData>) => {
    setBundle((prev) => ({ ...prev, ...patch }))
    setDirty(true)
  }, [])

  const handleSave = async () => {
    setSaving(true)
    const res = await window.api.writeBundle(folderPath, bundle as unknown as Record<string, unknown>)
    setSaving(false)
    if (res.success) {
      setDirty(false)
      onSaved()
    }
  }

  const handleDelete = async () => {
    if (!window.confirm(`Remove the Multi-Amp Bundle from this folder?\n\nThe folder and its contents are untouched — only the bundle config is removed.`)) return
    await window.api.deleteBundle(folderPath)
    onDeleted()
  }

  const openPicker = async () => {
    setPickerSearch('')
    setShowPicker(true)
    const options = await window.api.findBundlePackFolders(rootFolder)
    const linked = new Set(bundle.linkedPacks.map((p) => absPath(p.folderPath, rootFolder).replace(/\\/g, '/')))
    setPackOptions(options.filter((o) => !linked.has(o.folderPath.replace(/\\/g, '/'))))
  }

  const addPack = (opt: { folderPath: string; title: string }) => {
    const rel = relPath(opt.folderPath, rootFolder)
    update({
      linkedPacks: [
        ...bundle.linkedPacks,
        { folderPath: rel, overrideName: '', included: true },
      ],
    })
    setShowPicker(false)
  }

  const removePack = (idx: number) => {
    update({ linkedPacks: bundle.linkedPacks.filter((_, i) => i !== idx) })
  }

  const toggleIncluded = (idx: number) => {
    update({ linkedPacks: bundle.linkedPacks.map((p, i) => i === idx ? { ...p, included: !p.included } : p) })
  }

  const setOverrideName = (idx: number, name: string) => {
    update({ linkedPacks: bundle.linkedPacks.map((p, i) => i === idx ? { ...p, overrideName: name } : p) })
  }

  const movePack = (from: number, to: number) => {
    if (to < 0 || to >= bundle.linkedPacks.length) return
    const next = [...bundle.linkedPacks]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    update({ linkedPacks: next })
  }

  // Export a single pack — identical to clicking Export PDF from its Pack Info editor
  const handleExportPack = async (lp: BundleLinkedPack) => {
    const key = lp.folderPath
    setExportingPack(key)
    try {
      const absFolder = absPath(lp.folderPath, rootFolder)
      const packRes = await window.api.readPackInfo(absFolder)
      if (!packRes.success || !packRes.data) return
      const pack = packRes.data as PackInfo
      const filesRaw = await window.api.scanFolder(absFolder)
      const files: NamFile[] = (Array.isArray(filesRaw) ? filesRaw : []) as NamFile[]
      const folderName = absFolder.replace(/\\/g, '/').split('/').pop() ?? absFolder
      const logo = dark ? (logoDark || undefined) : (logoLight || undefined)
      const html = generatePackHtml(pack, absFolder, folderName, files, dark, logo)
      await window.api.exportPackSheet(html)
    } finally {
      setExportingPack(null)
    }
  }

  // Export the bundle cover sheet: description + contents list + footer
  const handleExport = async () => {
    if (dirty) await handleSave()
    setExporting(true)
    try {
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const logo = dark ? (logoDark || undefined) : (logoLight || undefined)
      const included = bundle.linkedPacks.filter((p) => p.included)

      const t = dark ? {
        bodyBg: '#0d0d0d', bodyColor: '#e8e8e8',
        headerBg: '#000000', headerSub: '#888888',
        descColor: '#c0c0c0',
        sectionBorder: '#2a2a2a', sectionTitleColor: '#f97316',
        thBg: '#1a1a1a', thColor: '#f97316', thBorder: '#2a2a2a',
        tdBorder: '#1e1e1e', tdEvenBg: '#141414',
        footerBorder: '#2a2a2a', footerColor: '#555',
      } : {
        bodyBg: '#ffffff', bodyColor: '#1e2235',
        headerBg: '#1a1f35', headerSub: '#94a3b8',
        descColor: '#475569',
        sectionBorder: '#e2e8f0', sectionTitleColor: '#64748b',
        thBg: '#f8fafc', thColor: '#64748b', thBorder: '#e2e8f0',
        tdBorder: '#f1f5f9', tdEvenBg: '#fafbfc',
        footerBorder: '#e2e8f0', footerColor: '#94a3b8',
      }

      const tocRows = included.map((p, i) => {
        const display = p.overrideName || p.folderPath.replace(/\\/g, '/').split('/').pop() || p.folderPath
        return `<tr>
          <td style="padding:5px 8px;border-bottom:1px solid ${t.tdBorder};color:${t.sectionTitleColor};width:32px;font-size:10px;white-space:nowrap">${i + 1}</td>
          <td style="padding:5px 8px;border-bottom:1px solid ${t.tdBorder};word-break:break-word">${esc(display)}</td>
        </tr>`
      }).join('')

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(bundle.title || 'Multi-Amp Bundle')}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  html { background:${t.bodyBg}; }
  body { font-family:Inter,Arial,sans-serif; color:${t.bodyColor}; background:${t.bodyBg}; font-size:10.5px; line-height:1.45; }
  .header { background:${t.headerBg}; color:#fff; padding:18px 32px 16px; display:flex; justify-content:space-between; align-items:flex-start; gap:24px; }
  .header-left { flex:1; min-width:0; }
  .header-title { font-size:26px; font-weight:700; letter-spacing:-0.02em; }
  .header-sub { font-size:14px; color:${t.headerSub}; margin-top:6px; }
  .header-logo { flex-shrink:0; display:flex; align-items:center; }
  .content { padding:18px 44px; }
  .description { color:${t.descColor}; margin-bottom:16px; line-height:1.7; width:100%; font-size:14px; }
  .section { margin-bottom:20px; }
  .section-title { font-size:10px; font-weight:700; color:${t.sectionTitleColor}; text-transform:uppercase; letter-spacing:0.1em; text-align:center; margin-bottom:8px; }
  .section-title::after { content:''; display:block; width:28px; height:2px; background:${t.sectionTitleColor}; border-radius:1px; margin:5px auto 0; opacity:0.7; }
  table { width:100%; border-collapse:collapse; table-layout:fixed; }
  thead th { background:${t.thBg}; text-align:left; padding:5px 8px; font-size:9.5px; font-weight:600; color:${t.thColor}; text-transform:uppercase; letter-spacing:0.06em; border-bottom:1px solid ${t.thBorder}; }
  tbody td { padding:4px 8px; border-bottom:1px solid ${t.tdBorder}; vertical-align:top; }
  tbody tr:last-child td { border-bottom:none; }
  tbody tr:nth-child(even) { background:${t.tdEvenBg}; }
  .footer { margin-top:24px; padding-top:8px; border-top:1px solid ${t.footerBorder}; font-size:9.5px; color:${t.footerColor}; }
  @page { margin:0; }
  @media print {
    html, body { background:${t.bodyBg}; }
    body { print-color-adjust:exact; -webkit-print-color-adjust:exact; }
    .header { padding:20px 52px 17px; break-inside:avoid; }
    .content { padding:18px 52px 24px; }
    .footer { break-inside:avoid; margin-top:10mm; padding-top:6mm; padding-bottom:12mm; }
  }
</style>
</head>
<body>
<div class="header">
  <div class="header-left">
    <div class="header-title">${esc(bundle.title || 'Multi-Amp Bundle')}</div>
    ${bundle.subtitle ? `<div class="header-sub">${esc(bundle.subtitle)}</div>` : ''}
  </div>
  ${logo ? `<div class="header-logo"><img src="${logo}" style="max-height:56px;max-width:180px;object-fit:contain" /></div>` : ''}
</div>
<div class="content">
  ${bundle.description.trim() ? `<div class="description">${parseDescription(bundle.description, dark)}</div>` : ''}

  ${included.length > 0 ? `<div class="section">
    <div class="section-title">Contents</div>
    <table>
      <thead><tr><th style="width:32px">#</th><th>Pack</th></tr></thead>
      <tbody>${tocRows}</tbody>
    </table>
  </div>` : ''}

  <div class="footer">${bundle.footer.trim() ? parseDescription(bundle.footer, dark) : 'Generated by NAM Lab'}</div>
</div>
</body>
</html>`

      await window.api.exportPackSheet(html)
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 dark:text-gray-600 text-sm">
        Loading…
      </div>
    )
  }

  const folderName = folderPath.replace(/\\/g, '/').split('/').pop() ?? folderPath
  const filteredOptions = packOptions.filter((o) => {
    if (!pickerSearch.trim()) return true
    const name = o.title || o.folderPath.replace(/\\/g, '/').split('/').pop() || ''
    return name.toLowerCase().includes(pickerSearch.toLowerCase())
  })

  const inputCls = 'w-full px-3 py-1.5 text-sm rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:border-teal-500'
  const labelCls = 'block text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1'

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Multi-Amp Bundle</span>
          <span className="text-xs text-gray-400 dark:text-gray-600 truncate max-w-32">{folderName}</span>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="px-3 py-1 text-xs rounded bg-teal-600 hover:bg-teal-700 text-white transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
          <button
            onClick={() => void handleExport()}
            disabled={exporting}
            className="px-3 py-1 text-xs rounded bg-indigo-600 hover:bg-indigo-700 text-white transition-colors disabled:opacity-50"
            title="Export bundle cover sheet to PDF"
          >
            {exporting ? 'Exporting…' : 'Export Cover PDF'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Title / Subtitle */}
        <div className="space-y-2">
          <input
            type="text"
            value={bundle.title}
            onChange={(e) => update({ title: e.target.value })}
            placeholder="Bundle title…"
            className={inputCls}
          />
          <input
            type="text"
            value={bundle.subtitle}
            onChange={(e) => update({ subtitle: e.target.value })}
            placeholder="Subtitle (optional)…"
            className={inputCls}
          />
        </div>

        {/* Description */}
        <div>
          <label className={labelCls}>Description</label>
          <textarea
            value={bundle.description}
            onChange={(e) => update({ description: e.target.value })}
            placeholder="Describe this collection of amp captures…"
            rows={7}
            className={`${inputCls} resize-y leading-relaxed min-h-[80px] font-mono text-xs`}
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

        {/* Linked Packs */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className={labelCls}>Linked Packs</span>
            <div className="relative">
              <button
                onClick={() => void openPicker()}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Pack
              </button>
              {showPicker && (
                <div
                  ref={pickerRef}
                  className="absolute right-0 top-full mt-1 w-72 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl overflow-hidden"
                >
                  <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 text-xs font-semibold text-gray-500 dark:text-gray-400">
                    Add Pack from Library
                  </div>
                  <div className="px-2 py-1.5 border-b border-gray-200 dark:border-gray-700">
                    <input
                      autoFocus
                      type="text"
                      value={pickerSearch}
                      onChange={(e) => setPickerSearch(e.target.value)}
                      placeholder="Filter packs…"
                      className="w-full px-2 py-1 text-xs rounded bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:border-teal-500"
                    />
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    {filteredOptions.length === 0 ? (
                      <div className="px-3 py-3 text-xs text-gray-400 dark:text-gray-500">
                        {packOptions.length === 0 ? 'No Pack Info folders found in library' : 'No matches'}
                      </div>
                    ) : filteredOptions.map((opt) => (
                      <button
                        key={opt.folderPath}
                        onClick={() => addPack(opt)}
                        className="w-full text-left px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      >
                        <div className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{opt.title}</div>
                        <div className="text-[10px] text-gray-400 truncate">{relPath(opt.folderPath, rootFolder)}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {bundle.linkedPacks.length === 0 ? (
            <div className="text-center py-8 text-xs text-gray-400 dark:text-gray-600 border border-dashed border-gray-200 dark:border-gray-800 rounded-lg">
              No packs linked yet — click Add Pack to link Pack Info folders
            </div>
          ) : (
            <div className="space-y-1">
              {bundle.linkedPacks.map((lp, idx) => {
                const displayPath = lp.overrideName || lp.folderPath.replace(/\\/g, '/').split('/').pop() || lp.folderPath
                const isExportingThis = exportingPack === lp.folderPath
                return (
                  <div
                    key={idx}
                    draggable
                    onDragStart={() => { dragIndexRef.current = idx }}
                    onDragOver={(e) => { e.preventDefault() }}
                    onDrop={() => {
                      if (dragIndexRef.current !== null && dragIndexRef.current !== idx) {
                        movePack(dragIndexRef.current, idx)
                      }
                      dragIndexRef.current = null
                    }}
                    className="flex items-center gap-2 px-2 py-1.5 rounded bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-800 group"
                  >
                    {/* Drag handle */}
                    <svg className="w-3 h-3 text-gray-300 dark:text-gray-700 cursor-grab flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                      <circle cx="9" cy="7" r="1.5"/><circle cx="15" cy="7" r="1.5"/>
                      <circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>
                      <circle cx="9" cy="17" r="1.5"/><circle cx="15" cy="17" r="1.5"/>
                    </svg>
                    {/* Include toggle */}
                    <input
                      type="checkbox"
                      checked={lp.included}
                      onChange={() => toggleIncluded(idx)}
                      className="flex-shrink-0 accent-teal-600"
                      title="Include in cover sheet contents"
                    />
                    {/* Pack name */}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{displayPath}</div>
                      <div className="text-[10px] text-gray-400 truncate">{lp.folderPath}</div>
                    </div>
                    {/* Override name */}
                    <input
                      type="text"
                      value={lp.overrideName}
                      onChange={(e) => setOverrideName(idx, e.target.value)}
                      placeholder="Display name…"
                      className="w-28 flex-shrink-0 px-1.5 py-0.5 text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:border-teal-500"
                    />
                    {/* Export this pack PDF */}
                    <button
                      onClick={() => void handleExportPack(lp)}
                      disabled={isExportingThis}
                      title="Export this pack's PDF (same as Pack Info export)"
                      className="flex-shrink-0 flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 transition-colors disabled:opacity-40"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                      </svg>
                      {isExportingThis ? '…' : 'PDF'}
                    </button>
                    {/* Up/Down */}
                    <div className="flex flex-col gap-0.5 flex-shrink-0">
                      <button
                        onClick={() => movePack(idx, idx - 1)}
                        disabled={idx === 0}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 disabled:opacity-20"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                        </svg>
                      </button>
                      <button
                        onClick={() => movePack(idx, idx + 1)}
                        disabled={idx === bundle.linkedPacks.length - 1}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 disabled:opacity-20"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                    {/* Remove */}
                    <button
                      onClick={() => removePack(idx)}
                      className="flex-shrink-0 text-gray-300 dark:text-gray-700 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div>
          <label className={labelCls}>Footer</label>
          <textarea
            value={bundle.footer}
            onChange={(e) => update({ footer: e.target.value })}
            placeholder="© 2025 Your Name · yoursite.com"
            rows={2}
            className={`${inputCls} resize-none font-mono text-xs`}
          />
          <div className="mt-1 px-1 text-[10px] text-gray-400 dark:text-gray-500">
            Supports same formatting — <code className="bg-gray-100 dark:bg-gray-800 px-0.5 rounded">**bold**</code>, <code className="bg-gray-100 dark:bg-gray-800 px-0.5 rounded">[orange]color[/orange]</code>, etc.
          </div>
        </div>

        {/* Delete */}
        <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
          <button
            onClick={() => void handleDelete()}
            className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400 transition-colors"
          >
            Remove Multi-Amp Bundle…
          </button>
        </div>
      </div>
    </div>
  )
}
