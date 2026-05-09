import { useCallback, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import type { NamFile, NamMetadata } from '../types/nam'
import { DEFAULT_EXPORT_COLUMNS, PACK_CAPTURE_COLUMNS, generatePackHtml } from '../utils/packExport'
import {
  type DeliveryMatrixRow,
  type PackInfo,
  createDeliveryRowId,
  normalizeDeliveryMatrixData,
  normalizeDeliveryMatrixRow,
  normalizeDeliveryTargetsData,
} from './PackInfoEditor'

type TargetKey = 'tonex' | 'proxy' | 'qc'

interface Props {
  folderPath: string
  folderName: string
  onPackSaved?: (folderPath: string, hasData: boolean) => void
  logoLight?: string
  logoDark?: string
  darkAccentColor?: string
}

const TARGET_ORDER: TargetKey[] = ['tonex', 'proxy', 'qc']
const TARGET_LABELS: Record<TargetKey, string> = {
  tonex: 'ToneX',
  proxy: 'Proxy',
  qc: 'QC',
}

const SEARCH_FIELDS: Array<keyof DeliveryMatrixRow> = [
  'captureName',
  'altProxyName',
  'altQcName',
  'modeledBy',
  'manufacturer',
  'model',
  'comments',
]

const HEADER_MAP: Record<string, keyof DeliveryMatrixRow> = {
  'Capture Name': 'captureName',
  'Alt Proxy Name': 'altProxyName',
  'Alt QC Name': 'altQcName',
  'Modeled By': 'modeledBy',
  Manufacturer: 'manufacturer',
  Model: 'model',
  'Gear Type': 'gearType',
  'Tone Type': 'toneType',
  'Amp Channel': 'ampChannel',
  'Amp Settings': 'ampSettings',
  'Amp Switches': 'ampSwitches',
  'Boost Pedal(s)': 'boostPedals',
  'Pedal Settings': 'pedalSettings',
  Cabinet: 'cabinet',
  'Cab Config': 'cabConfig',
  'Reamp Send (dBu)': 'reampSendDbu',
  'Reamp Return (dBu)': 'reampReturnDbu',
  'Trained Epochs': 'trainedEpochs',
  'NAM-BOT Preset': 'namBotPreset',
  'Mic(s)': 'mics',
  Comments: 'comments',
}

function targetIncludes(row: DeliveryMatrixRow, target: TargetKey): boolean {
  return target === 'tonex' ? row.includeToneX : target === 'proxy' ? row.includeProxy : row.includeQc
}

function setTargetIncluded(row: DeliveryMatrixRow, target: TargetKey, included: boolean): DeliveryMatrixRow {
  return target === 'tonex'
    ? { ...row, includeToneX: included }
    : target === 'proxy'
      ? { ...row, includeProxy: included }
      : { ...row, includeQc: included }
}

function targetAltName(row: DeliveryMatrixRow, target: TargetKey): string {
  return target === 'proxy' ? row.altProxyName : target === 'qc' ? row.altQcName : ''
}

function setTargetAltName(row: DeliveryMatrixRow, target: TargetKey, value: string): DeliveryMatrixRow {
  return target === 'proxy'
    ? { ...row, altProxyName: value }
    : target === 'qc'
      ? { ...row, altQcName: value }
      : row
}

function targetEffectiveName(row: DeliveryMatrixRow, target: TargetKey): string {
  const alt = targetAltName(row, target).trim()
  return alt || row.captureName
}

function rowHasAnyValues(row: Record<string, unknown>): boolean {
  return Object.values(row).some((value) => String(value ?? '').trim() !== '')
}

function normalizePackData(raw: unknown): PackInfo {
  const source = raw && typeof raw === 'object' ? (raw as Partial<PackInfo>) : {}
  return {
    title: typeof source.title === 'string' ? source.title : '',
    subtitle: typeof source.subtitle === 'string' ? source.subtitle : '',
    capturedBy: typeof source.capturedBy === 'string' ? source.capturedBy : '',
    description: typeof source.description === 'string' ? source.description : '',
    equipment: Array.isArray(source.equipment) ? source.equipment : [],
    pedals: Array.isArray(source.pedals) ? source.pedals : [],
    switches: Array.isArray(source.switches) ? source.switches : [],
    glossary: Array.isArray(source.glossary) ? source.glossary : [],
    footer: typeof source.footer === 'string' ? source.footer : '',
    exportExcludedSubfolders: Array.isArray(source.exportExcludedSubfolders) ? source.exportExcludedSubfolders : [],
    exportExcludedCaptures: Array.isArray(source.exportExcludedCaptures) ? source.exportExcludedCaptures : [],
    exportColumns: Array.isArray(source.exportColumns) ? source.exportColumns : DEFAULT_EXPORT_COLUMNS,
    recommendedInputGain: typeof source.recommendedInputGain === 'string' ? source.recommendedInputGain : '',
    checklistItems: Array.isArray(source.checklistItems) ? source.checklistItems : [],
    checklistNotes: typeof source.checklistNotes === 'string' ? source.checklistNotes : '',
    targetDate: typeof source.targetDate === 'string' ? source.targetDate : '',
    liveDate: typeof source.liveDate === 'string' ? source.liveDate : '',
    versionInfo: typeof source.versionInfo === 'string' ? source.versionInfo : '',
    deliveryMatrix: normalizeDeliveryMatrixData(source.deliveryMatrix),
    deliveryTargets: normalizeDeliveryTargetsData(source.deliveryTargets),
  }
}

function parseMatrixRows(rows: Record<string, unknown>[]): { rows: DeliveryMatrixRow[]; error?: string } {
  const seen = new Map<string, number>()
  const parsed: DeliveryMatrixRow[] = []
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    const rowNum = i + 2
    const captureName = String(row['Capture Name'] ?? '').trim()
    if (!captureName) {
      if (rowHasAnyValues(row)) return { rows: [], error: `Row ${rowNum} is missing Capture Name.` }
      continue
    }
    const key = captureName.toLowerCase()
    if (seen.has(key)) {
      return { rows: [], error: `Duplicate Capture Name "${captureName}" found on rows ${seen.get(key)} and ${rowNum}.` }
    }
    seen.set(key, rowNum)
    parsed.push(normalizeDeliveryMatrixRow({
      id: createDeliveryRowId(),
      captureName,
      includeToneX: String(row.ToneX ?? '').trim().toUpperCase() === 'X',
      includeNam: String(row.NAM ?? '').trim().toUpperCase() === 'X',
      includeProxy: String(row.Proxy ?? '').trim().toUpperCase() === 'X',
      includeQc: String(row.QC ?? '').trim().toUpperCase() === 'X',
      ...Object.fromEntries(
        Object.entries(HEADER_MAP).map(([header, field]) => [field, String(row[header] ?? '').trim()])
      ),
    }))
  }
  return { rows: parsed }
}

function toNumber(value: string): number | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

function buildVirtualFile(row: DeliveryMatrixRow, target: TargetKey, folderPath: string): NamFile {
  const effectiveName = targetEffectiveName(row, target)
  const metadata: NamMetadata = {
    name: effectiveName,
    modeled_by: row.modeledBy || null,
    gear_make: row.manufacturer || null,
    gear_model: row.model || null,
    gear_type: row.gearType || null,
    tone_type: row.toneType || null,
    input_level_dbu: toNumber(row.reampSendDbu),
    output_level_dbu: toNumber(row.reampReturnDbu),
    nb_trained_epochs: toNumber(row.trainedEpochs),
    nb_preset_name: row.namBotPreset || null,
    nl_amp_channel: row.ampChannel || null,
    nl_amp_settings: row.ampSettings || null,
    nl_amp_switches: row.ampSwitches || null,
    nl_boost_pedal: row.boostPedals || null,
    nl_pedal_settings: row.pedalSettings || null,
    nl_cabinet: row.cabinet || null,
    nl_cabinet_config: row.cabConfig || null,
    nl_mics: row.mics || null,
    nl_comments: row.comments || null,
  }
  return {
    filePath: `${folderPath.replace(/\\/g, '/')}/${effectiveName}.virtual.nam`,
    fileName: `${effectiveName}.virtual.nam`,
    version: 'virtual-target',
    metadata,
    originalMetadata: metadata,
    autoFilledFields: [],
    architecture: 'virtual',
    config: null,
    isDirty: false,
  }
}

export function PackTargetsEditor({ folderPath, folderName, onPackSaved, logoLight, logoDark, darkAccentColor = '#f97316' }: Props) {
  const [pack, setPack] = useState<PackInfo | null>(null)
  const [savedPack, setSavedPack] = useState<PackInfo | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [selectedTarget, setSelectedTarget] = useState<TargetKey>('proxy')
  const [search, setSearch] = useState('')
  const [showAlternateOnly, setShowAlternateOnly] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.api.readPackInfo(folderPath).then((res) => {
      if (cancelled) return
      const next = normalizePackData(res.success ? res.data : null)
      setPack(next)
      setSavedPack(next)
      setStatus(null)
    })
    return () => { cancelled = true }
  }, [folderPath])

  const updatePack = useCallback((updater: (current: PackInfo) => PackInfo) => {
    setPack((prev) => {
      if (!prev) return prev
      return updater(prev)
    })
    setStatus(null)
  }, [])

  const handleImport = useCallback(async () => {
    const importPath = await window.api.openImportFile()
    if (!importPath) return
    const binary = await window.api.readFileBinary(importPath)
    if (binary.error || !binary.data) {
      setStatus(`Could not read file: ${binary.error ?? 'unknown error'}`)
      return
    }
    try {
      const workbook = XLSX.read(binary.data, { type: 'base64' })
      const worksheet = workbook.Sheets.Sheet1 ?? workbook.Sheets[workbook.SheetNames[0]]
      if (!worksheet) {
        setStatus('Spreadsheet did not contain Sheet1.')
        return
      }
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: '' })
      const parsed = parseMatrixRows(rawRows)
      if (parsed.error) {
        setStatus(parsed.error)
        return
      }
      updatePack((current) => ({
        ...current,
        deliveryMatrix: {
          sourceWorkbookPath: importPath,
          lastImportedAt: new Date().toISOString(),
          rows: parsed.rows,
        },
      }))
      setStatus(`Imported ${parsed.rows.length} matrix row${parsed.rows.length !== 1 ? 's' : ''} from Excel`)
    } catch (error) {
      setStatus(`Failed to parse spreadsheet: ${String(error)}`)
    }
  }, [updatePack])

  const handleSave = useCallback(async () => {
    if (!pack) return
    const result = await window.api.writePackInfo(folderPath, pack)
    if (result.success) {
      setSavedPack(pack)
      setStatus('Saved')
      setTimeout(() => setStatus(null), 2000)
      onPackSaved?.(folderPath.replace(/\\/g, '/'), !!pack.title.trim())
    } else {
      setStatus(`Save failed: ${result.error ?? 'unknown error'}`)
    }
  }, [folderPath, onPackSaved, pack])

  const handleExport = useCallback(async () => {
    if (!pack) return
    const exportRows = pack.deliveryMatrix.rows.filter((row) => targetIncludes(row, selectedTarget))
    if (exportRows.length === 0) {
      setStatus(`No ${TARGET_LABELS[selectedTarget]} rows to export`)
      return
    }
    setExporting(true)
    const dark = (() => {
      try {
        const stored = localStorage.getItem('nam-pack-dark-export')
        return stored === null ? true : stored === '1'
      } catch {
        return true
      }
    })()
    const logo = dark ? (logoDark || undefined) : (logoLight || undefined)
    const targetMeta = pack.deliveryTargets[selectedTarget]
    const exportInfo: PackInfo = {
      ...pack,
      title: targetMeta.title.trim() || pack.title,
      subtitle: targetMeta.subtitle.trim() || pack.subtitle,
      description: targetMeta.description.trim() || pack.description,
      exportExcludedCaptures: [],
      exportExcludedSubfolders: [],
    }
    const html = generatePackHtml(
      exportInfo,
      folderPath,
      `${folderName} ${TARGET_LABELS[selectedTarget]}`,
      exportRows.map((row) => buildVirtualFile(row, selectedTarget, folderPath)),
      dark,
      logo,
      darkAccentColor
    )
    const result = await window.api.exportPackSheet(html)
    setExporting(false)
    if (result.success) setStatus(`Exported ${TARGET_LABELS[selectedTarget]} PDF`)
    else setStatus(`Export failed: ${result.error ?? 'unknown error'}`)
  }, [darkAccentColor, folderName, folderPath, logoDark, logoLight, pack, selectedTarget])

  const rows = pack?.deliveryMatrix.rows ?? []
  const targetRows = useMemo(
    () => rows.filter((row) => targetIncludes(row, selectedTarget)),
    [rows, selectedTarget]
  )
  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return targetRows.filter((row) => {
      if (showAlternateOnly && !targetAltName(row, selectedTarget).trim()) return false
      if (!term) return true
      return SEARCH_FIELDS
        .map((field) => String(row[field] ?? '').toLowerCase())
        .some((value) => value.includes(term))
    })
  }, [search, selectedTarget, showAlternateOnly, targetRows])

  const summary = useMemo(() => ({
    totalRows: rows.length,
    targetRows: targetRows.length,
    alternateRows: targetRows.filter((row) => !!targetAltName(row, selectedTarget).trim()).length,
  }), [rows.length, selectedTarget, targetRows])

  const targetMeta = pack?.deliveryTargets[selectedTarget]
  const exportColumns = useMemo(
    () => PACK_CAPTURE_COLUMNS.filter((column) => (pack?.exportColumns ?? DEFAULT_EXPORT_COLUMNS).includes(column.id)).map((column) => column.label),
    [pack?.exportColumns]
  )
  const isDirty = pack && savedPack ? JSON.stringify(pack) !== JSON.stringify(savedPack) : false

  if (!pack || !targetMeta) {
    return <div className="h-full flex items-center justify-center text-sm text-gray-400">Loading targets...</div>
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Delivery Targets</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">{folderName}</p>
        </div>
        <div className="flex items-center gap-2">
          {status && <span className={`text-xs ${/^saved|^imported|^exported/i.test(status) ? 'text-teal-600 dark:text-teal-400' : 'text-red-500'}`}>{status}</span>}
          <button onClick={handleImport} className="text-xs px-2.5 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
            {rows.length > 0 ? 'Re-import Matrix' : 'Import Matrix from Excel'}
          </button>
          <button onClick={handleExport} disabled={exporting || targetRows.length === 0} className={`text-xs px-2.5 py-1 rounded transition-colors ${exporting || targetRows.length === 0 ? 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}>
            Export PDF...
          </button>
          <button onClick={handleSave} disabled={!isDirty} className={`text-xs px-2.5 py-1 rounded text-white transition-colors ${!isDirty ? 'bg-teal-600 opacity-40' : 'bg-teal-600 hover:bg-teal-700'}`}>
            Save
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          {TARGET_ORDER.map((target) => (
            <button
              key={target}
              onClick={() => setSelectedTarget(target)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                selectedTarget === target
                  ? 'bg-teal-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              {TARGET_LABELS[target]}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            ['Matrix Rows', summary.totalRows],
            [`${TARGET_LABELS[selectedTarget]} Rows`, summary.targetRows],
            ['Alt Names', summary.alternateRows],
            ['Export Columns', exportColumns.length],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-3 py-2.5">
              <div className="text-lg font-semibold text-gray-800 dark:text-gray-100">{value}</div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{label}</div>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30 p-3 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300">{TARGET_LABELS[selectedTarget]} Details</h4>
              <p className="text-[11px] text-gray-400 dark:text-gray-500">
                {pack.deliveryMatrix.sourceWorkbookPath ? `Imported from ${pack.deliveryMatrix.sourceWorkbookPath}` : 'No matrix imported yet'}
              </p>
            </div>
            <div className="text-right">
              {pack.deliveryMatrix.lastImportedAt && (
                <div className="text-[11px] text-gray-500 dark:text-gray-400">
                  Imported {new Date(pack.deliveryMatrix.lastImportedAt).toLocaleString()}
                </div>
              )}
              <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-1">
                Export uses base pack capture columns: {exportColumns.join(', ') || 'default columns'}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">Title</label>
                <button
                  onClick={() => updatePack((current) => ({
                    ...current,
                    deliveryTargets: {
                      ...current.deliveryTargets,
                      [selectedTarget]: {
                        ...current.deliveryTargets[selectedTarget],
                        title: current.title,
                      },
                    },
                  }))}
                  className="text-[11px] text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 font-medium"
                >
                  Sync
                </button>
              </div>
              <input
                value={targetMeta.title}
                onChange={(e) => updatePack((current) => ({
                  ...current,
                  deliveryTargets: { ...current.deliveryTargets, [selectedTarget]: { ...current.deliveryTargets[selectedTarget], title: e.target.value } },
                }))}
                className="w-full text-xs px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-teal-500"
              />
            </div>
            <div>
              <div className="flex items-center justify-between gap-2 mb-1">
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">Subtitle</label>
                <button
                  onClick={() => updatePack((current) => ({
                    ...current,
                    deliveryTargets: {
                      ...current.deliveryTargets,
                      [selectedTarget]: {
                        ...current.deliveryTargets[selectedTarget],
                        subtitle: current.subtitle,
                      },
                    },
                  }))}
                  className="text-[11px] text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 font-medium"
                >
                  Sync
                </button>
              </div>
              <input
                value={targetMeta.subtitle}
                onChange={(e) => updatePack((current) => ({
                  ...current,
                  deliveryTargets: { ...current.deliveryTargets, [selectedTarget]: { ...current.deliveryTargets[selectedTarget], subtitle: e.target.value } },
                }))}
                className="w-full text-xs px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-teal-500"
              />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400">Description</label>
              <button
                onClick={() => updatePack((current) => ({
                  ...current,
                  deliveryTargets: {
                    ...current.deliveryTargets,
                    [selectedTarget]: {
                      ...current.deliveryTargets[selectedTarget],
                      description: current.description,
                    },
                  },
                }))}
                className="text-[11px] text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 font-medium"
              >
                Sync
              </button>
            </div>
            <textarea
              value={targetMeta.description}
              onChange={(e) => updatePack((current) => ({
                ...current,
                deliveryTargets: { ...current.deliveryTargets, [selectedTarget]: { ...current.deliveryTargets[selectedTarget], description: e.target.value } },
              }))}
              rows={4}
              className="w-full min-h-[120px] text-xs px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-teal-500 resize-y leading-relaxed"
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
              {' - '}available: orange, teal, red, blue, green, dim, white
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30 p-3 space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${TARGET_LABELS[selectedTarget]} rows by name, maker, model...`}
              className="min-w-[280px] flex-1 text-xs px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-teal-500"
            />
            {(selectedTarget === 'proxy' || selectedTarget === 'qc') && (
              <button
                onClick={() => setShowAlternateOnly((value) => !value)}
                className={`px-2.5 py-1 rounded text-xs transition-colors ${
                  showAlternateOnly
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                {showAlternateOnly ? 'Showing Alt Names' : 'Alt Names Only'}
              </button>
            )}
            <button
              onClick={() => updatePack((current) => ({
                ...current,
                deliveryMatrix: {
                  ...current.deliveryMatrix,
                  rows: [...current.deliveryMatrix.rows, setTargetIncluded(normalizeDeliveryMatrixRow({ id: createDeliveryRowId() }), selectedTarget, true)],
                },
              }))}
              className="ml-auto px-2.5 py-1 rounded text-xs bg-teal-600 text-white hover:bg-teal-700 transition-colors"
            >
              + Add row
            </button>
          </div>

          {targetRows.length === 0 ? (
            <div className="rounded border border-dashed border-gray-300 dark:border-gray-700 px-3 py-5 text-xs text-gray-400 dark:text-gray-500">
              No {TARGET_LABELS[selectedTarget]} rows yet. Import a matrix, or add rows manually for one-off targets.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs border-separate border-spacing-0">
                <thead>
                  <tr className="text-left">
                    <th className="sticky top-0 bg-gray-50 dark:bg-gray-900 px-2 py-2 border-b border-gray-200 dark:border-gray-700 font-semibold text-gray-500 dark:text-gray-400">Included</th>
                    <th className="sticky top-0 bg-gray-50 dark:bg-gray-900 px-2 py-2 border-b border-gray-200 dark:border-gray-700 font-semibold text-gray-500 dark:text-gray-400 min-w-[260px]">Capture Name</th>
                    {(selectedTarget === 'proxy' || selectedTarget === 'qc') && (
                      <>
                        <th className="sticky top-0 bg-gray-50 dark:bg-gray-900 px-2 py-2 border-b border-gray-200 dark:border-gray-700 font-semibold text-gray-500 dark:text-gray-400 min-w-[220px]">
                          {selectedTarget === 'proxy' ? 'Alt Proxy Name' : 'Alt QC Name'}
                        </th>
                        <th className="sticky top-0 bg-gray-50 dark:bg-gray-900 px-2 py-2 border-b border-gray-200 dark:border-gray-700 font-semibold text-gray-500 dark:text-gray-400 min-w-[240px]">Effective Name</th>
                      </>
                    )}
                    <th className="sticky top-0 bg-gray-50 dark:bg-gray-900 px-2 py-2 border-b border-gray-200 dark:border-gray-700 font-semibold text-gray-500 dark:text-gray-400 min-w-[180px]">Modeled By</th>
                    <th className="sticky top-0 bg-gray-50 dark:bg-gray-900 px-2 py-2 border-b border-gray-200 dark:border-gray-700 font-semibold text-gray-500 dark:text-gray-400 min-w-[160px]">Manufacturer</th>
                    <th className="sticky top-0 bg-gray-50 dark:bg-gray-900 px-2 py-2 border-b border-gray-200 dark:border-gray-700 font-semibold text-gray-500 dark:text-gray-400 min-w-[160px]">Model</th>
                    <th className="sticky top-0 bg-gray-50 dark:bg-gray-900 px-2 py-2 border-b border-gray-200 dark:border-gray-700 font-semibold text-gray-500 dark:text-gray-400 min-w-[120px]">Gear Type</th>
                    <th className="sticky top-0 bg-gray-50 dark:bg-gray-900 px-2 py-2 border-b border-gray-200 dark:border-gray-700 font-semibold text-gray-500 dark:text-gray-400 min-w-[120px]">Tone Type</th>
                    <th className="sticky top-0 bg-gray-50 dark:bg-gray-900 px-2 py-2 border-b border-gray-200 dark:border-gray-700 font-semibold text-gray-500 dark:text-gray-400 min-w-[220px]">Comments</th>
                    <th className="sticky top-0 bg-gray-50 dark:bg-gray-900 px-2 py-2 border-b border-gray-200 dark:border-gray-700" />
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.id} className="align-top">
                      <td className="px-2 py-2 border-b border-gray-100 dark:border-gray-800">
                        <input
                          type="checkbox"
                          checked={targetIncludes(row, selectedTarget)}
                          onChange={(e) => updatePack((current) => ({
                            ...current,
                            deliveryMatrix: {
                              ...current.deliveryMatrix,
                              rows: current.deliveryMatrix.rows.map((candidate) =>
                                candidate.id === row.id ? setTargetIncluded(candidate, selectedTarget, e.target.checked) : candidate
                              ),
                            },
                          }))}
                          className="w-4 h-4 rounded accent-teal-600"
                        />
                      </td>
                      <td className="px-2 py-2 border-b border-gray-100 dark:border-gray-800">
                        <input
                          value={row.captureName}
                          onChange={(e) => updatePack((current) => ({
                            ...current,
                            deliveryMatrix: {
                              ...current.deliveryMatrix,
                              rows: current.deliveryMatrix.rows.map((candidate) => candidate.id === row.id ? { ...candidate, captureName: e.target.value } : candidate),
                            },
                          }))}
                          className="w-full min-w-[260px] text-xs px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-teal-500"
                        />
                      </td>
                      {(selectedTarget === 'proxy' || selectedTarget === 'qc') && (
                        <>
                          <td className="px-2 py-2 border-b border-gray-100 dark:border-gray-800">
                            <input
                              value={targetAltName(row, selectedTarget)}
                              onChange={(e) => updatePack((current) => ({
                                ...current,
                                deliveryMatrix: {
                                  ...current.deliveryMatrix,
                                  rows: current.deliveryMatrix.rows.map((candidate) =>
                                    candidate.id === row.id ? setTargetAltName(candidate, selectedTarget, e.target.value) : candidate
                                  ),
                                },
                              }))}
                              className="w-full min-w-[220px] text-xs px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-teal-500"
                            />
                          </td>
                          <td className="px-2 py-2 border-b border-gray-100 dark:border-gray-800 text-gray-500 dark:text-gray-300 min-w-[240px] font-medium">
                            {targetEffectiveName(row, selectedTarget)}
                          </td>
                        </>
                      )}
                      {(['modeledBy', 'manufacturer', 'model', 'gearType', 'toneType', 'comments'] as const).map((field) => (
                        <td key={field} className="px-2 py-2 border-b border-gray-100 dark:border-gray-800">
                          <input
                            value={String(row[field] ?? '')}
                            onChange={(e) => updatePack((current) => ({
                              ...current,
                              deliveryMatrix: {
                                ...current.deliveryMatrix,
                                rows: current.deliveryMatrix.rows.map((candidate) => candidate.id === row.id ? { ...candidate, [field]: e.target.value } : candidate),
                              },
                            }))}
                            className={`w-full text-xs px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-teal-500 ${
                              field === 'comments' ? 'min-w-[220px]' : field === 'modeledBy' ? 'min-w-[180px]' : field === 'manufacturer' || field === 'model' ? 'min-w-[160px]' : 'min-w-[120px]'
                            }`}
                          />
                        </td>
                      ))}
                      <td className="px-2 py-2 border-b border-gray-100 dark:border-gray-800">
                        <button
                          onClick={() => updatePack((current) => ({
                            ...current,
                            deliveryMatrix: {
                              ...current.deliveryMatrix,
                              rows: current.deliveryMatrix.rows.filter((candidate) => candidate.id !== row.id),
                            },
                          }))}
                          className="text-gray-400 hover:text-red-500 transition-colors"
                          title="Remove row"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
