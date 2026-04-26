import { useState, useEffect, useRef, useCallback } from 'react'
import type { NamFile } from '../types/nam'
import type { PackInfo } from './PackInfoEditor'
import { generatePackHtml } from '../utils/packExport'

export interface BundleLinkedPack {
  folderPath: string  // relative to root folder
  overrideName: string
  included: boolean
}

export interface BundleData {
  title: string
  subtitle: string
  description: string
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

export function BundleEditor({ folderPath, rootFolder, dark, logoLight, logoDark, defaultCapturedBy, onSaved, onDeleted }: Props) {
  const [bundle, setBundle] = useState<BundleData>(EMPTY_BUNDLE)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [showPicker, setShowPicker] = useState(false)
  const [packOptions, setPackOptions] = useState<{ folderPath: string; title: string }[]>([])
  const [pickerSearch, setPickerSearch] = useState('')
  const pickerRef = useRef<HTMLDivElement>(null)
  const dragIndexRef = useRef<number | null>(null)

  // Load existing bundle on mount
  useEffect(() => {
    setLoading(true)
    window.api.readBundle(folderPath).then((res) => {
      if (res.success && res.data) {
        const d = res.data as BundleData
        setBundle({
          title: d.title ?? '',
          subtitle: d.subtitle ?? '',
          description: d.description ?? '',
          linkedPacks: Array.isArray(d.linkedPacks) ? d.linkedPacks : [],
        })
      } else {
        setBundle(EMPTY_BUNDLE)
      }
      setLoading(false)
      setDirty(false)
    })
  }, [folderPath])

  // Close picker on outside click
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
    if (!window.confirm(`Remove the Marketing Bundle from this folder?\n\nThe folder and its contents are untouched — only the bundle config is removed.`)) return
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
    const next = bundle.linkedPacks.filter((_, i) => i !== idx)
    update({ linkedPacks: next })
  }

  const toggleIncluded = (idx: number) => {
    const next = bundle.linkedPacks.map((p, i) => i === idx ? { ...p, included: !p.included } : p)
    update({ linkedPacks: next })
  }

  const setOverrideName = (idx: number, name: string) => {
    const next = bundle.linkedPacks.map((p, i) => i === idx ? { ...p, overrideName: name } : p)
    update({ linkedPacks: next })
  }

  const movePack = (from: number, to: number) => {
    if (to < 0 || to >= bundle.linkedPacks.length) return
    const next = [...bundle.linkedPacks]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    update({ linkedPacks: next })
  }

  const handleExport = async () => {
    if (dirty) await handleSave()
    setExporting(true)
    try {
      const logo = dark ? (logoDark || undefined) : (logoLight || undefined)
      const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const included = bundle.linkedPacks.filter((p) => p.included)
      const sections: string[] = []

      for (const lp of included) {
        const absFolder = absPath(lp.folderPath, rootFolder)
        const packRes = await window.api.readPackInfo(absFolder)
        if (!packRes.success || !packRes.data) continue
        const pack = packRes.data as PackInfo
        const filesRaw = await window.api.scanFolder(absFolder)
        const files: NamFile[] = (Array.isArray(filesRaw) ? filesRaw : []) as NamFile[]
        const folderName = absFolder.replace(/\\/g, '/').split('/').pop() ?? absFolder
        const packHtml = generatePackHtml(pack, absFolder, folderName, files, dark, logo)
        const bodyMatch = /<body>([\s\S]*)<\/body>/.exec(packHtml)
        if (bodyMatch) sections.push(bodyMatch[1])
      }

      const t = dark
        ? { bg: '#0d0d0d', fg: '#e8e8e8', headerBg: '#000', sub: '#888', accent: '#f97316', border: '#2a2a2a' }
        : { bg: '#fff', fg: '#1e2235', headerBg: '#1a1f35', sub: '#94a3b8', accent: '#f97316', border: '#e2e8f0' }

      const tocRows = included.map((p, i) => {
        const display = p.overrideName || p.folderPath.replace(/\\/g, '/').split('/').pop() || p.folderPath
        return `<div style="display:flex;gap:12px;padding:5px 0;border-bottom:1px solid ${t.border}">
          <span style="color:${t.sub};font-size:10px;min-width:1.5em">${i + 1}</span>
          <span>${esc(display)}</span>
        </div>`
      }).join('')

      const coverHtml = `<div style="background:${t.headerBg};color:#fff;padding:40px 52px 36px;page-break-after:always;break-after:page">
        ${logo ? `<div style="margin-bottom:20px"><img src="${logo}" style="max-height:56px;max-width:180px;object-fit:contain"></div>` : ''}
        <div style="font-size:32px;font-weight:700;letter-spacing:-0.02em">${esc(bundle.title || 'NAM Bundle')}</div>
        ${bundle.subtitle ? `<div style="font-size:16px;color:${t.sub};margin-top:8px">${esc(bundle.subtitle)}</div>` : ''}
        ${bundle.description ? `<div style="font-size:12px;color:#aaa;margin-top:16px;line-height:1.6;max-width:600px">${esc(bundle.description)}</div>` : ''}
        ${defaultCapturedBy ? `<div style="font-size:11px;color:${t.sub};margin-top:24px">Captured by ${esc(defaultCapturedBy)}</div>` : ''}
      </div>
      <div style="padding:32px 52px;background:${t.bg};color:${t.fg};page-break-after:always;break-after:page">
        <div style="font-size:10px;font-weight:700;color:${t.accent};text-transform:uppercase;letter-spacing:0.1em;margin-bottom:16px">Contents</div>
        ${tocRows}
      </div>`

      const pageBreakStyle = `<style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family: Inter, Arial, sans-serif; background:${t.bg}; color:${t.fg}; font-size:10.5px; }
        .pack-section { page-break-before: always; break-before: page; }
        @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
      </style>`

      const packSections = sections.map((s) => `<div class="pack-section">${s}</div>`).join('\n')
      const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${esc(bundle.title || 'NAM Bundle')}</title>${pageBreakStyle}</head><body>${coverHtml}${packSections}</body></html>`

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

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Marketing Bundle</span>
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
            disabled={exporting || bundle.linkedPacks.filter((p) => p.included).length === 0}
            className="px-3 py-1 text-xs rounded bg-indigo-600 hover:bg-indigo-700 text-white transition-colors disabled:opacity-50"
          >
            {exporting ? 'Exporting…' : 'Export PDF'}
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
            className="w-full px-3 py-1.5 text-sm rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:border-teal-500"
          />
          <input
            type="text"
            value={bundle.subtitle}
            onChange={(e) => update({ subtitle: e.target.value })}
            placeholder="Subtitle (optional)…"
            className="w-full px-3 py-1.5 text-sm rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:border-teal-500"
          />
          <textarea
            value={bundle.description}
            onChange={(e) => update({ description: e.target.value })}
            placeholder="Description / marketing copy (optional)…"
            rows={3}
            className="w-full px-3 py-1.5 text-sm rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:border-teal-500 resize-none"
          />
        </div>

        {/* Linked Packs */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Linked Packs</span>
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
                const displayPath = lp.folderPath.replace(/\\/g, '/').split('/').pop() ?? lp.folderPath
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
                    />
                    {/* Pack name / path */}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{displayPath}</div>
                      <div className="text-[10px] text-gray-400 truncate">{lp.folderPath}</div>
                    </div>
                    {/* Override name */}
                    <input
                      type="text"
                      value={lp.overrideName}
                      onChange={(e) => setOverrideName(idx, e.target.value)}
                      placeholder="Override name…"
                      className="w-32 flex-shrink-0 px-1.5 py-0.5 text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:border-teal-500"
                    />
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

        {/* Delete */}
        <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
          <button
            onClick={() => void handleDelete()}
            className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400 transition-colors"
          >
            Remove Marketing Bundle…
          </button>
        </div>
      </div>
    </div>
  )
}
