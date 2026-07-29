import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import * as XLSX from 'xlsx'
import type { NamFile, NamMetadata } from '../types/nam'
import type { ChecklistTemplateItem, TargetChecklistTemplates } from '../types/settings'
import { DEFAULT_EXPORT_COLUMNS, PACK_CAPTURE_COLUMNS, generatePackHtml } from '../utils/packExport'
import {
  checklistTemplateSignature,
  type DeliveryTargetChecklistData,
  type DeliveryMatrixRow,
  type PackInfo,
  type PackChecklistItem,
  createDeliveryRowId,
  normalizeDeliveryMatrixData,
  normalizeDeliveryMatrixRow,
  normalizeDeliveryTargetChecklistsData,
  normalizeDeliveryTargetsData,
} from './PackInfoEditor'

type TargetKey = 'tonex' | 'proxy' | 'qc'

interface Props {
  folderPath: string
  folderName: string
  targetChecklistTemplates: TargetChecklistTemplates
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

function createChecklistId(): string {
  return `target-check-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function normalizeChecklistLabel(value: string): string {
  return value.trim().toLowerCase()
}

function normalizeChecklistItem(value: Partial<PackChecklistItem>): PackChecklistItem {
  return {
    id: value.id ?? createChecklistId(),
    label: value.label ?? '',
    completed: value.completed === true,
    completedDate: value.completedDate ?? '',
    notes: value.notes ?? '',
  }
}

function createChecklistItemsFromTemplate(items: ChecklistTemplateItem[]): PackChecklistItem[] {
  return items.map((item) => ({
    id: createChecklistId(),
    label: item.label,
    completed: false,
    completedDate: '',
    notes: '',
  }))
}

function createChecklistItemsFromBase(items: PackChecklistItem[]): PackChecklistItem[] {
  return items
    .filter((item) => item.label.trim())
    .map((item) => ({
      id: createChecklistId(),
      label: item.label,
      completed: false,
      completedDate: '',
      notes: '',
    }))
}

function createTargetChecklistFromTemplate(template: ChecklistTemplateItem[]): DeliveryTargetChecklistData {
  return {
    items: createChecklistItemsFromTemplate(template),
    notes: '',
    targetDate: '',
    liveDate: '',
    templateSignature: checklistTemplateSignature(template),
  }
}

function mergeMissingTemplateSteps(items: PackChecklistItem[], template: ChecklistTemplateItem[]): PackChecklistItem[] {
  const existingLabels = new Set(items.map((item) => normalizeChecklistLabel(item.label)).filter(Boolean))
  const missing = template
    .filter((item) => item.label.trim() && !existingLabels.has(normalizeChecklistLabel(item.label)))
    .map((item) => ({
      id: createChecklistId(),
      label: item.label,
      completed: false,
      completedDate: '',
      notes: '',
    }))
  return [...items, ...missing]
}

function SortableTargetChecklistRow({
  item,
  onToggleCompleted,
  onLabelChange,
  onNotesChange,
  onDateChange,
  onRemove,
}: {
  item: PackChecklistItem
  onToggleCompleted: (completed: boolean) => void
  onLabelChange: (value: string) => void
  onNotesChange: (value: string) => void
  onDateChange: (value: string) => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded p-2.5 transition-colors ${
        isDragging
          ? 'bg-teal-50 dark:bg-teal-900/20 border border-teal-300 dark:border-teal-700'
          : 'bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700'
      }`}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded border border-gray-200 bg-gray-50 text-gray-400 transition-colors hover:border-teal-400 hover:text-teal-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-500 dark:hover:border-teal-500 dark:hover:text-teal-300 cursor-grab active:cursor-grabbing"
          title="Drag to reorder"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01" />
          </svg>
        </button>
        <input type="checkbox" checked={item.completed} onChange={(e) => onToggleCompleted(e.target.checked)} className="w-4 h-4 rounded accent-teal-600 flex-shrink-0" />
        <div className="min-w-0 flex-[1.4]">
          <input
            value={item.label}
            onChange={(e) => onLabelChange(e.target.value)}
            placeholder="Checklist step"
            className="w-full px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-teal-500"
          />
        </div>
        <div className="min-w-0 flex-1">
          <input
            value={item.notes}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder="Notes"
            className="w-full px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-teal-500"
          />
        </div>
        <input
          type="date"
          value={item.completedDate}
          onChange={(e) => onDateChange(e.target.value)}
          className="w-[136px] flex-shrink-0 px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-teal-500"
        />
        <button onClick={onRemove} className="text-gray-400 hover:text-red-500 transition-colors" title="Remove step">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
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

const MATRIX_TEXT_FIELDS: Array<{ key: keyof DeliveryMatrixRow; label: string; minWidth: string }> = [
  { key: 'modeledBy', label: 'Modeled By', minWidth: '180px' },
  { key: 'manufacturer', label: 'Manufacturer', minWidth: '160px' },
  { key: 'model', label: 'Model', minWidth: '160px' },
  { key: 'gearType', label: 'Gear Type', minWidth: '120px' },
  { key: 'toneType', label: 'Tone Type', minWidth: '120px' },
  { key: 'ampChannel', label: 'Amp Channel', minWidth: '120px' },
  { key: 'ampSettings', label: 'Amp Settings', minWidth: '220px' },
  { key: 'ampSwitches', label: 'Amp Switches', minWidth: '180px' },
  { key: 'boostPedals', label: 'Boost Pedal(s)', minWidth: '180px' },
  { key: 'pedalSettings', label: 'Pedal Settings', minWidth: '220px' },
  { key: 'cabinet', label: 'Cabinet', minWidth: '160px' },
  { key: 'cabConfig', label: 'Cab Config', minWidth: '160px' },
  { key: 'reampSendDbu', label: 'Reamp Send (dBu)', minWidth: '140px' },
  { key: 'reampReturnDbu', label: 'Reamp Return (dBu)', minWidth: '140px' },
  { key: 'trainedEpochs', label: 'Trained Epochs', minWidth: '120px' },
  { key: 'namBotPreset', label: 'NAM-BOT Preset', minWidth: '160px' },
  { key: 'mics', label: 'Mic(s)', minWidth: '180px' },
  { key: 'comments', label: 'Comments', minWidth: '240px' },
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
    deliveryTargetChecklists: normalizeDeliveryTargetChecklistsData(source.deliveryTargetChecklists),
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

export function PackTargetsEditor({ folderPath, folderName, targetChecklistTemplates, onPackSaved, logoLight, logoDark, darkAccentColor = '#f97316' }: Props) {
  const [pack, setPack] = useState<PackInfo | null>(null)
  const [savedPack, setSavedPack] = useState<PackInfo | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [selectedTarget, setSelectedTarget] = useState<TargetKey>('proxy')
  const [checklistPanelOpenByTarget, setChecklistPanelOpenByTarget] = useState<Partial<Record<TargetKey, boolean>>>({})
  const [search, setSearch] = useState('')
  const [showAlternateOnly, setShowAlternateOnly] = useState(false)
  const [nameSortDir, setNameSortDir] = useState<'asc' | 'desc'>('asc')
  const [exporting, setExporting] = useState(false)
  const checklistSensors = useSensors(useSensor(PointerSensor))

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

  const currentTargetTemplate = targetChecklistTemplates[selectedTarget]
  const currentTargetTemplateSignature = useMemo(
    () => checklistTemplateSignature(currentTargetTemplate),
    [currentTargetTemplate]
  )

  const activeTargetChecklist = pack?.deliveryTargetChecklists[selectedTarget] ?? null
  const targetChecklistDrifted = Boolean(
    activeTargetChecklist && activeTargetChecklist.templateSignature !== currentTargetTemplateSignature
  )
  const checklistPanelOpen = checklistPanelOpenByTarget[selectedTarget] ?? Boolean(activeTargetChecklist)

  const setChecklistPanelOpen = useCallback((target: TargetKey, open: boolean) => {
    setChecklistPanelOpenByTarget((current) => ({ ...current, [target]: open }))
  }, [])

  const updateTargetChecklist = useCallback((target: TargetKey, updater: (current: DeliveryTargetChecklistData) => DeliveryTargetChecklistData) => {
    updatePack((current) => {
      const existing = current.deliveryTargetChecklists[target]
      if (!existing) return current
      return {
        ...current,
        deliveryTargetChecklists: {
          ...current.deliveryTargetChecklists,
          [target]: updater(existing),
        },
      }
    })
  }, [updatePack])

  const createChecklistFromTemplateForTarget = useCallback((target: TargetKey) => {
    updatePack((current) => ({
      ...current,
      deliveryTargetChecklists: {
        ...current.deliveryTargetChecklists,
        [target]: createTargetChecklistFromTemplate(targetChecklistTemplates[target]),
      },
    }))
    setChecklistPanelOpen(target, true)
    setStatus(`${TARGET_LABELS[target]} checklist created from template`)
  }, [setChecklistPanelOpen, targetChecklistTemplates, updatePack])

  const copyStepsFromBaseForTarget = useCallback((target: TargetKey) => {
    updatePack((current) => ({
      ...current,
      deliveryTargetChecklists: {
        ...current.deliveryTargetChecklists,
        [target]: {
          items: createChecklistItemsFromBase(current.checklistItems),
          notes: '',
          targetDate: '',
          liveDate: '',
          templateSignature: checklistTemplateSignature(targetChecklistTemplates[target]),
        },
      },
    }))
    setChecklistPanelOpen(target, true)
    setStatus(`${TARGET_LABELS[target]} checklist copied from NAM/base checklist`)
  }, [setChecklistPanelOpen, targetChecklistTemplates, updatePack])

  const resetChecklistToTemplateForTarget = useCallback((target: TargetKey) => {
    createChecklistFromTemplateForTarget(target)
  }, [createChecklistFromTemplateForTarget])

  const addMissingTemplateStepsForTarget = useCallback((target: TargetKey) => {
    updateTargetChecklist(target, (current) => ({
      ...current,
      items: mergeMissingTemplateSteps(current.items, targetChecklistTemplates[target]),
      templateSignature: checklistTemplateSignature(targetChecklistTemplates[target]),
    }))
    setStatus(`Added missing ${TARGET_LABELS[target]} template steps`)
  }, [targetChecklistTemplates, updateTargetChecklist])

  const setChecklistItemCompleted = useCallback((target: TargetKey, id: string, completed: boolean) => {
    updateTargetChecklist(target, (current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === id
          ? { ...item, completed, completedDate: completed ? (item.completedDate || todayIso()) : '' }
          : item
      ),
    }))
  }, [updateTargetChecklist])

  const addChecklistItem = useCallback((target: TargetKey) => {
    updateTargetChecklist(target, (current) => ({
      ...current,
      items: [...current.items, { id: createChecklistId(), label: '', completed: false, completedDate: '', notes: '' }],
    }))
  }, [updateTargetChecklist])

  const handleChecklistDragEnd = useCallback((target: TargetKey, event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    updateTargetChecklist(target, (current) => {
      const oldIndex = current.items.findIndex((item) => item.id === active.id)
      const newIndex = current.items.findIndex((item) => item.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return current
      return { ...current, items: arrayMove(current.items, oldIndex, newIndex) }
    })
  }, [updateTargetChecklist])

  const showNativeTextContextMenu = useCallback((event: React.MouseEvent<HTMLElement>) => {
    const selection = window.getSelection()?.toString().trim()
    const activeEl = document.activeElement as HTMLElement | null
    const target = event.target as HTMLElement | null
    const editableTarget = target?.closest('input, textarea, [contenteditable="true"]') as HTMLElement | null
    const isEditable = !!editableTarget || !!activeEl?.closest?.('input, textarea, [contenteditable="true"]')
    if (!selection && !isEditable) return
    event.preventDefault()
    void window.api.showTextContextMenu({ hasSelection: !!selection, isEditable })
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
    const exportRows = [...pack.deliveryMatrix.rows.filter((row) => targetIncludes(row, selectedTarget))]
      .sort((a, b) => {
        const cmp = a.captureName.localeCompare(b.captureName, undefined, { sensitivity: 'base', numeric: true })
        return nameSortDir === 'asc' ? cmp : -cmp
      })
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
  }, [darkAccentColor, folderName, folderPath, logoDark, logoLight, nameSortDir, pack, selectedTarget])

  const rows = pack?.deliveryMatrix.rows ?? []
  const targetRows = useMemo(() => {
    const included = rows.filter((row) => targetIncludes(row, selectedTarget))
    return [...included].sort((a, b) => {
      const cmp = a.captureName.localeCompare(b.captureName, undefined, { sensitivity: 'base', numeric: true })
      return nameSortDir === 'asc' ? cmp : -cmp
    })
  }, [nameSortDir, rows, selectedTarget])
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
    visibleRows: filteredRows.length,
    alternateRows: targetRows.filter((row) => !!targetAltName(row, selectedTarget).trim()).length,
  }), [filteredRows.length, rows.length, selectedTarget, targetRows])

  const targetMeta = pack?.deliveryTargets[selectedTarget]
  const checklistCompletedCount = activeTargetChecklist?.items.filter((item) => item.completed).length ?? 0
  const checklistTotalCount = activeTargetChecklist?.items.length ?? 0
  const checklistPercent = checklistTotalCount > 0 ? Math.round((checklistCompletedCount / checklistTotalCount) * 100) : 0
  const targetChecklistReleased = !!activeTargetChecklist?.liveDate
  const targetChecklistOverdue = !targetChecklistReleased && !!activeTargetChecklist?.targetDate && activeTargetChecklist.targetDate < todayIso()
  const exportColumns = useMemo(
    () => PACK_CAPTURE_COLUMNS.filter((column) => (pack?.exportColumns ?? DEFAULT_EXPORT_COLUMNS).includes(column.id)).map((column) => column.label),
    [pack?.exportColumns]
  )
  const isDirty = pack && savedPack ? JSON.stringify(pack) !== JSON.stringify(savedPack) : false

  if (!pack || !targetMeta) {
    return <div className="h-full flex items-center justify-center text-sm text-gray-400">Loading targets...</div>
  }

  return (
    <div className="h-full flex flex-col overflow-hidden" onContextMenu={showNativeTextContextMenu}>
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

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {([
              ['Matrix Rows', summary.totalRows, 'border-indigo-200 dark:border-indigo-700/40 bg-indigo-50 dark:bg-indigo-500/[0.06]', 'text-indigo-700 dark:text-indigo-400'],
              [`${TARGET_LABELS[selectedTarget]} Rows`, summary.targetRows, 'border-teal-200 dark:border-teal-700/40 bg-teal-50 dark:bg-teal-500/[0.06]', 'text-teal-700 dark:text-teal-400'],
              ['Visible Rows', summary.visibleRows, 'border-sky-200 dark:border-sky-700/40 bg-sky-50 dark:bg-sky-500/[0.06]', 'text-sky-700 dark:text-sky-400'],
              ['Alt Names', summary.alternateRows, 'border-amber-200 dark:border-amber-700/40 bg-amber-50 dark:bg-amber-500/[0.06]', 'text-amber-700 dark:text-amber-400'],
              ['Export Columns', exportColumns.length, 'border-violet-200 dark:border-violet-700/40 bg-violet-50 dark:bg-violet-500/[0.06]', 'text-violet-700 dark:text-violet-400'],
            ] as [string, number, string, string][]).map(([label, value, cardCls, numCls]) => (
              <div key={label} className={`rounded-lg border ${cardCls} px-3 py-2.5`}>
                <div className={`text-lg font-semibold ${numCls}`}>{value}</div>
                <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{label}</div>
              </div>
            ))}
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30 overflow-hidden">
          <button
            type="button"
            onClick={() => setChecklistPanelOpen(selectedTarget, !checklistPanelOpen)}
            className="w-full px-3 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/40"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-600 dark:text-gray-300">{TARGET_LABELS[selectedTarget]} Checklist</h4>
                  {targetChecklistDrifted && (
                    <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                      Template changed
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                  Separate release steps, dates, and notes for this target only.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 text-gray-400 dark:text-gray-500">
                <span className="text-[10px] uppercase tracking-wide">{checklistPanelOpen ? 'Hide' : 'Show'}</span>
                <svg className={`h-4 w-4 transition-transform ${checklistPanelOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-3 py-2">
                <div className={`text-sm font-semibold truncate ${
                  checklistTotalCount === 0 ? 'text-gray-500 dark:text-gray-400'
                  : checklistCompletedCount === checklistTotalCount ? 'text-emerald-600 dark:text-emerald-400'
                  : checklistCompletedCount > 0 ? 'text-amber-600 dark:text-amber-400'
                  : 'text-gray-800 dark:text-gray-100'
                }`}>{checklistCompletedCount} / {checklistTotalCount}</div>
                <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">Completed</div>
              </div>
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-3 py-2">
                <div className={`text-sm font-semibold truncate ${activeTargetChecklist?.targetDate ? 'text-sky-600 dark:text-sky-400' : 'text-gray-400 dark:text-gray-500'}`}>
                  {activeTargetChecklist?.targetDate || 'Not set'}
                </div>
                <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">Target Date</div>
              </div>
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-3 py-2">
                <div className={`text-sm font-semibold truncate ${activeTargetChecklist?.liveDate ? 'text-teal-600 dark:text-teal-400' : 'text-gray-400 dark:text-gray-500'}`}>
                  {activeTargetChecklist?.liveDate || 'Not set'}
                </div>
                <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">Live Date</div>
              </div>
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 px-3 py-2">
                <div className={`text-sm font-semibold truncate ${
                  !activeTargetChecklist ? 'text-gray-400 dark:text-gray-500'
                  : targetChecklistReleased ? 'text-emerald-600 dark:text-emerald-400'
                  : targetChecklistOverdue ? 'text-red-600 dark:text-red-400'
                  : activeTargetChecklist.targetDate ? 'text-amber-600 dark:text-amber-400'
                  : 'text-gray-500 dark:text-gray-400'
                }`}>
                  {activeTargetChecklist ? (targetChecklistReleased ? 'Released' : targetChecklistOverdue ? 'Overdue' : activeTargetChecklist.targetDate ? 'Scheduled' : 'No target date') : 'No checklist'}
                </div>
                <div className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">Status</div>
              </div>
            </div>
          </button>

          {checklistPanelOpen && (
            <div className="border-t border-gray-200 dark:border-gray-700 px-3 py-3 space-y-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="text-[11px] text-gray-500 dark:text-gray-400">
                  Template: {currentTargetTemplate.length > 0 ? `${currentTargetTemplate.length} steps` : 'Empty'}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {!activeTargetChecklist ? (
                    <>
                      <button
                        onClick={() => createChecklistFromTemplateForTarget(selectedTarget)}
                        className="text-xs px-2.5 py-1 rounded bg-teal-600 text-white hover:bg-teal-700 transition-colors"
                      >
                        Create checklist from template
                      </button>
                      <button
                        onClick={() => copyStepsFromBaseForTarget(selectedTarget)}
                        className="text-xs px-2.5 py-1 rounded bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-900/40 transition-colors"
                      >
                        Copy steps from NAM checklist
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => resetChecklistToTemplateForTarget(selectedTarget)}
                        className="text-xs px-2.5 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                      >
                        Reset from template
                      </button>
                      <button
                        onClick={() => copyStepsFromBaseForTarget(selectedTarget)}
                        className="text-xs px-2.5 py-1 rounded bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-900/40 transition-colors"
                      >
                        Copy steps from NAM checklist
                      </button>
                    </>
                  )}
                </div>
              </div>

              {!activeTargetChecklist ? (
                <div className="rounded border border-dashed border-gray-300 dark:border-gray-700 px-3 py-5 text-xs text-gray-400 dark:text-gray-500">
                  No {TARGET_LABELS[selectedTarget]} checklist yet. Start from the {TARGET_LABELS[selectedTarget]} template, or copy the current NAM/base checklist labels into a new target checklist.
                </div>
              ) : (
                <>
                  {targetChecklistDrifted && (
                    <div className="rounded-lg border border-amber-300/70 dark:border-amber-700/70 bg-amber-50/40 dark:bg-amber-900/10 px-3 py-2.5 space-y-2">
                      <p className="text-xs text-amber-800 dark:text-amber-300">
                        This {TARGET_LABELS[selectedTarget]} checklist no longer matches the current {TARGET_LABELS[selectedTarget]} template.
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => updateTargetChecklist(selectedTarget, (current) => ({ ...current, templateSignature: currentTargetTemplateSignature }))}
                          className="text-xs px-2.5 py-1 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
                        >
                          Keep current checklist
                        </button>
                        <button
                          onClick={() => resetChecklistToTemplateForTarget(selectedTarget)}
                          className="text-xs px-2.5 py-1 rounded bg-amber-600 text-white hover:bg-amber-700 transition-colors"
                        >
                          Reset from template
                        </button>
                        <button
                          onClick={() => addMissingTemplateStepsForTarget(selectedTarget)}
                          className="text-xs px-2.5 py-1 rounded bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-900/40 transition-colors"
                        >
                          Copy in missing template steps only
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Target Date</label>
                      <input
                        type="date"
                        value={activeTargetChecklist.targetDate}
                        onChange={(e) => updateTargetChecklist(selectedTarget, (current) => ({ ...current, targetDate: e.target.value }))}
                        className="w-full text-xs px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-teal-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Live Date</label>
                      <input
                        type="date"
                        value={activeTargetChecklist.liveDate}
                        onChange={(e) => updateTargetChecklist(selectedTarget, (current) => ({ ...current, liveDate: e.target.value }))}
                        className="w-full text-xs px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-teal-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Notes</label>
                    <textarea
                      value={activeTargetChecklist.notes}
                      onChange={(e) => updateTargetChecklist(selectedTarget, (current) => ({ ...current, notes: e.target.value }))}
                      rows={4}
                      className="w-full min-h-[110px] text-xs px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-teal-500 resize-y"
                    />
                  </div>

                  <div className="space-y-2">
                    {activeTargetChecklist.items.length === 0 ? (
                      <div className="rounded border border-dashed border-gray-300 dark:border-gray-700 px-3 py-3 text-xs text-gray-400 dark:text-gray-500">
                        No checklist steps yet for this target.
                      </div>
                    ) : (
                      <DndContext sensors={checklistSensors} collisionDetection={closestCenter} onDragEnd={(event) => handleChecklistDragEnd(selectedTarget, event)}>
                        <SortableContext items={activeTargetChecklist.items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                          {activeTargetChecklist.items.map((item) => (
                            <SortableTargetChecklistRow
                              key={item.id}
                              item={item}
                              onToggleCompleted={(completed) => setChecklistItemCompleted(selectedTarget, item.id, completed)}
                              onLabelChange={(value) => updateTargetChecklist(selectedTarget, (current) => ({
                                ...current,
                                items: current.items.map((step) => step.id === item.id ? { ...step, label: value } : step),
                              }))}
                              onNotesChange={(value) => updateTargetChecklist(selectedTarget, (current) => ({
                                ...current,
                                items: current.items.map((step) => step.id === item.id ? { ...step, notes: value } : step),
                              }))}
                              onDateChange={(value) => updateTargetChecklist(selectedTarget, (current) => ({
                                ...current,
                                items: current.items.map((step) => step.id === item.id ? { ...step, completedDate: value, completed: value ? true : step.completed } : step),
                              }))}
                              onRemove={() => updateTargetChecklist(selectedTarget, (current) => ({
                                ...current,
                                items: current.items.filter((step) => step.id !== item.id),
                              }))}
                            />
                          ))}
                        </SortableContext>
                      </DndContext>
                    )}

                    <div className="flex items-center gap-3 flex-wrap">
                      <button
                        onClick={() => addChecklistItem(selectedTarget)}
                        className="text-xs text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 font-medium transition-colors"
                      >
                        + Add step
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
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
              onClick={() => setNameSortDir((dir) => dir === 'asc' ? 'desc' : 'asc')}
              className="px-2.5 py-1 rounded text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              title="Sort target rows by Capture Name"
            >
              Name {nameSortDir === 'asc' ? 'A-Z' : 'Z-A'}
            </button>
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
                    {MATRIX_TEXT_FIELDS.map((field) => (
                      <th
                        key={field.key}
                        className="sticky top-0 bg-gray-50 dark:bg-gray-900 px-2 py-2 border-b border-gray-200 dark:border-gray-700 font-semibold text-gray-500 dark:text-gray-400"
                        style={{ minWidth: field.minWidth }}
                      >
                        {field.label}
                      </th>
                    ))}
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
                      {MATRIX_TEXT_FIELDS.map((fieldDef) => (
                        <td key={fieldDef.key} className="px-2 py-2 border-b border-gray-100 dark:border-gray-800">
                          <input
                            value={String(row[fieldDef.key] ?? '')}
                            onChange={(e) => updatePack((current) => ({
                              ...current,
                              deliveryMatrix: {
                                ...current.deliveryMatrix,
                                rows: current.deliveryMatrix.rows.map((candidate) => candidate.id === row.id ? { ...candidate, [fieldDef.key]: e.target.value } : candidate),
                              },
                            }))}
                            className="w-full text-xs px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-teal-500"
                            style={{ minWidth: fieldDef.minWidth }}
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
