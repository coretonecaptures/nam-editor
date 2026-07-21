import { useState, useEffect, useCallback, useRef, useMemo, type MouseEvent } from 'react'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { NamFile } from '../types/nam'
import { AppSettings, MetadataSuggestField, MetadataSuggestRule } from '../types/settings'
import { PACK_CAPTURE_COLUMNS, DEFAULT_EXPORT_COLUMNS, generatePackHtml } from '../utils/packExport'
import { generatePackHtmlAdvanced } from '../utils/packExportAdvanced'
import { metadataSuggestRuleSignature } from '../utils/metadataSuggestRuleLibrary'
import { scanOwnAndInheritedImages, type FolderImagesData } from '../utils/folderImages'

export type CatalogItem = AppSettings['packGearCatalog'][number]
export type ChecklistTemplateItem = AppSettings['packChecklistTemplate'][number]

export interface PackChecklistItem {
  id: string
  label: string
  completed: boolean
  completedDate: string
  notes: string
}

export interface DeliveryMatrixRow {
  id: string
  captureName: string
  includeToneX: boolean
  includeNam: boolean
  includeProxy: boolean
  includeQc: boolean
  altProxyName: string
  altQcName: string
  modeledBy: string
  manufacturer: string
  model: string
  gearType: string
  toneType: string
  ampChannel: string
  ampSettings: string
  ampSwitches: string
  boostPedals: string
  pedalSettings: string
  cabinet: string
  cabConfig: string
  reampSendDbu: string
  reampReturnDbu: string
  trainedEpochs: string
  namBotPreset: string
  mics: string
  comments: string
}

export interface DeliveryTargetInfo {
  label: string
  title: string
  subtitle: string
  description: string
}

export interface DeliveryMatrixData {
  sourceWorkbookPath: string
  lastImportedAt: string
  rows: DeliveryMatrixRow[]
}

export interface DeliveryTargetsData {
  tonex: DeliveryTargetInfo
  nam: DeliveryTargetInfo
  proxy: DeliveryTargetInfo
  qc: DeliveryTargetInfo
}

export interface DeliveryTargetChecklistData {
  items: PackChecklistItem[]
  notes: string
  targetDate: string
  liveDate: string
  templateSignature: string
}

export interface DeliveryTargetChecklistsData {
  tonex: DeliveryTargetChecklistData | null
  proxy: DeliveryTargetChecklistData | null
  qc: DeliveryTargetChecklistData | null
}

export interface PackInfo {
  title: string
  subtitle: string
  capturedBy: string
  about: string
  description: string
  equipment: { label: string; value: string }[]
  pedals: { label: string; value: string }[]
  switches: { label: string; value: string }[]
  glossary: { term: string; description: string }[]
  footer: string
  exportExcludedSubfolders: string[]
  exportExcludedCaptures: string[]
  exportColumns: string[]
  exportIncludeGallery: boolean
  exportExcludedGalleryImages: string[]
  recommendedInputGain: string
  checklistItems: PackChecklistItem[]
  checklistNotes: string
  targetDate: string
  liveDate: string
  versionInfo: string
  deliveryMatrix: DeliveryMatrixData
  deliveryTargets: DeliveryTargetsData
  deliveryTargetChecklists: DeliveryTargetChecklistsData
}

export const EMPTY_DELIVERY_TARGET: DeliveryTargetInfo = {
  label: '',
  title: '',
  subtitle: '',
  description: '',
}

export const EMPTY_DELIVERY_MATRIX: DeliveryMatrixData = {
  sourceWorkbookPath: '',
  lastImportedAt: '',
  rows: [],
}

export const DEFAULT_DELIVERY_TARGETS: DeliveryTargetsData = {
  tonex: { ...EMPTY_DELIVERY_TARGET, label: 'ToneX' },
  nam: { ...EMPTY_DELIVERY_TARGET, label: 'NAM' },
  proxy: { ...EMPTY_DELIVERY_TARGET, label: 'Proxy' },
  qc: { ...EMPTY_DELIVERY_TARGET, label: 'QC' },
}

export const EMPTY_DELIVERY_TARGET_CHECKLISTS: DeliveryTargetChecklistsData = {
  tonex: null,
  proxy: null,
  qc: null,
}

const EMPTY_PACK: PackInfo = {
  title: '',
  subtitle: '',
  capturedBy: '',
  about: '',
  description: '',
  equipment: [],
  pedals: [],
  switches: [],
  glossary: [],
  footer: '',
  exportExcludedSubfolders: [],
  exportExcludedCaptures: [],
  exportColumns: DEFAULT_EXPORT_COLUMNS,
  exportIncludeGallery: false,
  exportExcludedGalleryImages: [],
  recommendedInputGain: '',
  checklistItems: [],
  checklistNotes: '',
  targetDate: '',
  liveDate: '',
  versionInfo: '',
  deliveryMatrix: EMPTY_DELIVERY_MATRIX,
  deliveryTargets: DEFAULT_DELIVERY_TARGETS,
  deliveryTargetChecklists: EMPTY_DELIVERY_TARGET_CHECKLISTS,
}

function hasMeaningfulPackInfoData(pack: PackInfo): boolean {
  return Boolean(
    pack.title.trim() ||
    pack.subtitle.trim() ||
    pack.capturedBy.trim() ||
    pack.about.trim() ||
    pack.description.trim() ||
    pack.footer.trim() ||
    pack.recommendedInputGain.trim() ||
    pack.checklistNotes.trim() ||
    pack.targetDate.trim() ||
    pack.liveDate.trim() ||
    pack.versionInfo.trim() ||
    pack.equipment.some((item) => item.label.trim() || item.value.trim()) ||
    pack.pedals.some((item) => item.label.trim() || item.value.trim()) ||
    pack.switches.some((item) => item.label.trim() || item.value.trim()) ||
    pack.glossary.some((item) => item.term.trim() || item.description.trim()) ||
    pack.checklistItems.some((item) => item.label.trim() || item.notes.trim() || item.completed || item.completedDate.trim()) ||
    pack.deliveryMatrix.rows.length > 0 ||
    Object.values(pack.deliveryTargetChecklists).some((checklist) =>
      checklist
        ? Boolean(
            checklist.notes.trim() ||
            checklist.targetDate.trim() ||
            checklist.liveDate.trim() ||
            checklist.items.some((item) => item.label.trim() || item.notes.trim() || item.completed || item.completedDate.trim())
          )
        : false
    )
  )
}

function createChecklistId(): string {
  return `check-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
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

function normalizeChecklistItem(value: Partial<PackChecklistItem>): PackChecklistItem {
  return {
    id: value.id ?? createChecklistId(),
    label: value.label ?? '',
    completed: value.completed === true,
    completedDate: value.completedDate ?? '',
    notes: value.notes ?? '',
  }
}

function normalizeChecklistLabel(value: string): string {
  return value.trim().toLowerCase()
}

export function checklistTemplateSignature(items: ChecklistTemplateItem[] | PackChecklistItem[]): string {
  return items
    .map((item) => normalizeChecklistLabel(item.label))
    .filter(Boolean)
    .join('||')
}

export function createDeliveryRowId(): string {
  return `delivery-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function normalizeDeliveryTargetInfo(value: unknown, fallbackLabel: string): DeliveryTargetInfo {
  const source = value && typeof value === 'object' ? (value as Partial<DeliveryTargetInfo>) : {}
  return {
    label: normalizeText(source.label, fallbackLabel) || fallbackLabel,
    title: normalizeText(source.title),
    subtitle: normalizeText(source.subtitle),
    description: normalizeText(source.description),
  }
}

export function normalizeDeliveryMatrixRow(value: unknown): DeliveryMatrixRow {
  const row = value && typeof value === 'object' ? (value as Partial<DeliveryMatrixRow>) : {}
  return {
    id: typeof row.id === 'string' && row.id ? row.id : createDeliveryRowId(),
    captureName: normalizeText(row.captureName),
    includeToneX: row.includeToneX === true,
    includeNam: row.includeNam === true,
    includeProxy: row.includeProxy === true,
    includeQc: row.includeQc === true,
    altProxyName: normalizeText(row.altProxyName),
    altQcName: normalizeText(row.altQcName),
    modeledBy: normalizeText(row.modeledBy),
    manufacturer: normalizeText(row.manufacturer),
    model: normalizeText(row.model),
    gearType: normalizeText(row.gearType),
    toneType: normalizeText(row.toneType),
    ampChannel: normalizeText(row.ampChannel),
    ampSettings: normalizeText(row.ampSettings),
    ampSwitches: normalizeText(row.ampSwitches),
    boostPedals: normalizeText(row.boostPedals),
    pedalSettings: normalizeText(row.pedalSettings),
    cabinet: normalizeText(row.cabinet),
    cabConfig: normalizeText(row.cabConfig),
    reampSendDbu: normalizeText(row.reampSendDbu),
    reampReturnDbu: normalizeText(row.reampReturnDbu),
    trainedEpochs: normalizeText(row.trainedEpochs),
    namBotPreset: normalizeText(row.namBotPreset),
    mics: normalizeText(row.mics),
    comments: normalizeText(row.comments),
  }
}

export function normalizeDeliveryMatrixData(value: unknown): DeliveryMatrixData {
  const source = value && typeof value === 'object' ? (value as Partial<DeliveryMatrixData>) : {}
  return {
    sourceWorkbookPath: normalizeText(source.sourceWorkbookPath),
    lastImportedAt: normalizeText(source.lastImportedAt),
    rows: Array.isArray(source.rows) ? source.rows.map((row) => normalizeDeliveryMatrixRow(row)) : [],
  }
}

export function normalizeDeliveryTargetsData(value: unknown): DeliveryTargetsData {
  const source = value && typeof value === 'object' ? (value as Partial<DeliveryTargetsData>) : {}
  return {
    tonex: normalizeDeliveryTargetInfo(source.tonex, 'ToneX'),
    nam: normalizeDeliveryTargetInfo(source.nam, 'NAM'),
    proxy: normalizeDeliveryTargetInfo(source.proxy, 'Proxy'),
    qc: normalizeDeliveryTargetInfo(source.qc, 'QC'),
  }
}

function repairMojibake(value: string): string {
  if (!/[ÃÂâ]/.test(value)) return value
  try {
    const bytes = Uint8Array.from(Array.from(value, (char) => char.charCodeAt(0) & 0xff))
    const repaired = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
    return repaired && repaired.includes('\uFFFD') ? value : repaired
  } catch {
    return value
  }
}

function normalizeText(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? repairMojibake(value) : fallback
}

export function normalizeDeliveryTargetChecklistData(value: unknown): DeliveryTargetChecklistData | null {
  if (!value || typeof value !== 'object') return null
  const source = value as Partial<DeliveryTargetChecklistData>
  return {
    items: Array.isArray(source.items) ? source.items.map((item) => normalizeChecklistItem(item)) : [],
    notes: normalizeText(source.notes),
    targetDate: normalizeText(source.targetDate),
    liveDate: normalizeText(source.liveDate),
    templateSignature: normalizeText(source.templateSignature),
  }
}

export function normalizeDeliveryTargetChecklistsData(value: unknown): DeliveryTargetChecklistsData {
  const source = value && typeof value === 'object' ? (value as Partial<DeliveryTargetChecklistsData>) : {}
  return {
    tonex: normalizeDeliveryTargetChecklistData(source.tonex),
    proxy: normalizeDeliveryTargetChecklistData(source.proxy),
    qc: normalizeDeliveryTargetChecklistData(source.qc),
  }
}

function showNativeTextContextMenu(event: MouseEvent<HTMLElement>) {
  const selection = window.getSelection()?.toString().trim() ?? ''
  const target = event.target as HTMLElement | null
  const isEditable = !!target?.closest('input, textarea, [contenteditable="true"]')
  if (!selection && !isEditable) return
  event.preventDefault()
  void window.api.showTextContextMenu({ hasSelection: !!selection, isEditable })
}

type PackGlossaryEntry = { term: string; description: string }

interface PackNotesParseResult {
  description: string
  glossary: PackGlossaryEntry[]
  sections: string[]
}

const PACK_NOTES_SECTION_LABELS = new Map<string, string>([
  ['AMP SETTINGS', 'Amp Settings'],
  ['CAB', 'Cab'],
  ['MICS', 'Mics'],
  ['TECHNICAL DETAILS', 'Technical Details'],
  ['PACK DETAILS', 'Pack Details'],
  ['SIGNAL CHAIN', 'Signal Chain'],
  ['AMP SETTINGS', 'Amp Settings'],
  ['AVALON EQ SETTINGS', 'Avalon EQ Settings'],
  ['RHYTHM', 'Rhythm'],
  ['LEAD', 'Lead'],
  ['CHANNELS', 'Channels'],
  ['MODES', 'Modes'],
])

function toSectionKey(value: string): string {
  return value.trim().replace(/:+$/, '').replace(/\s+/g, ' ').toUpperCase()
}

function prettifySectionHeading(value: string): string {
  const trimmed = value.trim().replace(/:+$/, '')
  return PACK_NOTES_SECTION_LABELS.get(toSectionKey(trimmed)) ?? trimmed
}

function isLikelySectionHeading(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed) return false
  const key = toSectionKey(trimmed)
  if (PACK_NOTES_SECTION_LABELS.has(key)) return true
  if (!trimmed.endsWith(':')) return false
  const noColon = trimmed.slice(0, -1).trim()
  if (!noColon) return false
  return /^[A-Z0-9][A-Z0-9\s/&@.+-]{1,40}$/.test(noColon)
}

function parsePackNotes(rawText: string): PackNotesParseResult {
  const normalized = rawText.replace(/\r\n/g, '\n').trim()
  if (!normalized) return { description: '', glossary: [], sections: [] }

  const lines = normalized.split('\n')
  const glossary: PackGlossaryEntry[] = []
  const seenGlossary = new Set<string>()
  const sections = new Set<string>()
  const descriptionLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      if (descriptionLines.length > 0 && descriptionLines[descriptionLines.length - 1] !== '') {
        descriptionLines.push('')
      }
      continue
    }

    const glossaryMatch = trimmed.match(/^(?:[-*•]\s*)?([A-Za-z0-9@.+/\-# ]{1,40})\s*(?:=|:)\s*(.+)$/)
    if (glossaryMatch) {
      const term = glossaryMatch[1].trim()
      const description = glossaryMatch[2].trim()
      if (term && description) {
        const key = `${term.toLowerCase()}::${description.toLowerCase()}`
        if (!seenGlossary.has(key)) {
          glossary.push({ term, description })
          seenGlossary.add(key)
        }
      }
      descriptionLines.push(`- ${term} = ${description}`)
      continue
    }

    if (isLikelySectionHeading(trimmed)) {
      const heading = prettifySectionHeading(trimmed)
      sections.add(heading)
      if (descriptionLines.length > 0 && descriptionLines[descriptionLines.length - 1] !== '') {
        descriptionLines.push('')
      }
      descriptionLines.push(`## ${heading}`)
      continue
    }

    descriptionLines.push(trimmed)
  }

  while (descriptionLines[descriptionLines.length - 1] === '') descriptionLines.pop()

  return {
    description: descriptionLines.join('\n'),
    glossary,
    sections: [...sections],
  }
}

function createPackRuleSeedId(): string {
  return `pack-rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function guessRuleSeed(entry: PackGlossaryEntry): Pick<MetadataSuggestRule, 'field' | 'value'> {
  const text = entry.description.trim()
  const lower = text.toLowerCase()

  if (lower.includes('high gain')) return { field: 'tone_type', value: 'hi_gain' }
  if (lower.includes('overdrive')) return { field: 'tone_type', value: 'overdrive' }
  if (lower.includes('distortion')) return { field: 'tone_type', value: 'distortion' }
  if (lower.includes('crunch')) return { field: 'tone_type', value: 'crunch' }
  if (/\bclean\b/.test(lower)) return { field: 'tone_type', value: 'clean' }
  if (lower.includes('fuzz')) return { field: 'tone_type', value: 'fuzz' }
  if (lower.includes('tube screamer') || lower.includes('klon') || lower.includes('pedal') || lower.includes('boost') || lower.includes('fortin')) {
    return { field: 'nl_boost_pedal', value: text }
  }
  if (
    lower.includes('channel') ||
    lower.includes('mode') ||
    lower.includes('input') ||
    lower.includes('graphic eq') ||
    lower.includes('eq enabled') ||
    lower.includes('eq disabled') ||
    lower.includes('bright') ||
    lower.includes('fat') ||
    lower.includes('voltage')
  ) {
    return { field: 'nl_amp_switches', value: text }
  }
  return { field: 'nl_comments', value: text }
}

function buildRuleSeedsFromText(rawText: string): MetadataSuggestRule[] {
  return parsePackNotes(rawText).glossary
    .filter((entry) => entry.term.trim() && entry.description.trim())
    .map((entry) => {
      const guessed = guessRuleSeed(entry)
      return {
        id: createPackRuleSeedId(),
        token: entry.term.trim(),
        segmentIndex: null,
        field: guessed.field,
        value: guessed.value,
        matchIn: 'filename',
        matchType: 'exact',
        enabled: true,
        overwriteExisting: false,
        overwriteOnlyValues: '',
      } satisfies MetadataSuggestRule
    })
}

type PackRuleSeedTarget = MetadataSuggestField | 'auto_guess'

const PACK_RULE_TARGET_OPTIONS: Array<{ value: PackRuleSeedTarget; label: string }> = [
  { value: 'auto_guess', label: 'Auto-guess field' },
  { value: 'nl_amp_channel', label: 'Amp Channel' },
  { value: 'nl_amp_switches', label: 'Amp Switches' },
  { value: 'tone_type', label: 'Tone Type' },
  { value: 'nl_boost_pedal', label: 'Boost Pedal(s)' },
  { value: 'nl_comments', label: 'Comments' },
]

function buildRuleFromGlossaryEntry(entry: PackGlossaryEntry, targetField: PackRuleSeedTarget): MetadataSuggestRule {
  const guessed = guessRuleSeed(entry)
  return {
    id: createPackRuleSeedId(),
    token: entry.term.trim(),
    segmentIndex: null,
    field: targetField === 'auto_guess' ? guessed.field : targetField,
    value: targetField === 'auto_guess' ? guessed.value : entry.description.trim(),
    matchIn: 'filename',
    matchType: 'exact',
    enabled: true,
    overwriteExisting: false,
    overwriteOnlyValues: '',
  }
}

function buildRuleFromSwitchEntry(entry: { label: string; value: string }, targetField: MetadataSuggestField): MetadataSuggestRule {
  return {
    id: createPackRuleSeedId(),
    token: entry.label.trim(),
    segmentIndex: null,
    field: targetField,
    value: entry.value.trim(),
    matchIn: 'filename',
    matchType: 'exact',
    enabled: true,
    overwriteExisting: false,
    overwriteOnlyValues: '',
  }
}

interface Props {
  folderPath: string
  folderName: string
  rootFolder?: string
  captures: NamFile[]
  defaultCapturedBy?: string
  catalog?: CatalogItem[]
  onCatalogChange?: (catalog: CatalogItem[]) => void
  checklistTemplate?: ChecklistTemplateItem[]
  onChecklistTemplateChange?: (items: ChecklistTemplateItem[]) => void
  onPackSaved?: (folderPath: string, hasData: boolean) => void
  logoLight?: string
  logoDark?: string
  darkAccentColor?: string
  allFolderPaths?: string[]
  parentPackPath?: string | null
  mode?: 'info' | 'checklist'
  currentFolderSuggestRules?: MetadataSuggestRule[]
  onCurrentFolderSuggestRulesChange?: (rules: MetadataSuggestRule[]) => void
  onOpenCurrentFolderSuggestRulesEditor?: () => void
  hasAiKey?: boolean
  onGenerateAbout?: (ctx: { existingDescription: string; capturedBy: string }) => Promise<string | null>
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
        Copy pack info to...
      </div>
      <div className="px-2 py-1.5 border-b border-gray-200 dark:border-gray-700">
        <input
          autoFocus
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter folders..."
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

function SortableChecklistRow({
  item,
  index,
  totalCount,
  inTemplate,
  rowChanged,
  parentPackPath,
  onToggleCompleted,
  onLabelChange,
  onDateChange,
  onNotesChange,
  onSync,
  onAddToTemplate,
  onRemove,
}: {
  item: PackChecklistItem
  index: number
  totalCount: number
  inTemplate: boolean
  rowChanged: boolean
  parentPackPath?: string | null
  onToggleCompleted: (completed: boolean) => void
  onLabelChange: (value: string) => void
  onDateChange: (value: string) => void
  onNotesChange: (value: string) => void
  onSync: () => void
  onAddToTemplate: () => void
  onRemove: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded p-2.5 transition-colors ${
        rowChanged
          ? 'border border-amber-400/80 dark:border-amber-500/70 bg-amber-50/70 dark:bg-amber-900/10 shadow-[0_0_0_1px_rgba(251,191,36,0.18)]'
          : 'border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800/40'
      } ${isDragging ? 'opacity-80 shadow-xl ring-1 ring-teal-400/50 z-10' : ''}`}
    >
      <div className="flex items-center gap-2">
        <button
          ref={setActivatorNodeRef}
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
            type="text"
            value={item.label}
            onChange={(e) => onLabelChange(e.target.value)}
            placeholder="Checklist step"
            className="w-full px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-teal-500"
          />
        </div>
        <div className="min-w-0 flex-1">
          <input
            type="text"
            value={item.notes}
            onChange={(e) => onNotesChange(e.target.value)}
            placeholder="Note"
            className="w-full px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-teal-500"
          />
        </div>
        <input
          type="date"
          value={item.completedDate}
          onChange={(e) => onDateChange(e.target.value)}
          className="w-[136px] flex-shrink-0 px-2 py-1.5 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded text-gray-900 dark:text-gray-100 focus:outline-none focus:border-teal-500"
        />
        <div className="flex items-center gap-1 flex-shrink-0">
          {parentPackPath && (
            <button
              onClick={onSync}
              className="text-xs px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-teal-500 hover:text-teal-600 dark:hover:text-teal-300 transition-colors"
              title="Sync this row with Parent Pack"
            >
              Sync
            </button>
          )}
          {!inTemplate && item.label.trim() && (
            <button onClick={onAddToTemplate} className="text-[10px] text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300" title="Add this step to the global checklist template">
              Template
            </button>
          )}
          <button onClick={onRemove} className="text-gray-400 hover:text-red-500 transition-colors" title="Remove step">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
      </div>
    </div>
  )
}

function SortableRowEditorRow({
  id, row, index, keys, placeholders, firstColWidth,
  onChange, onRemove, catalogItems, onSaveToCatalog, selectedIndices, onToggleSelected,
}: {
  id: string
  row: Record<string, string>
  index: number
  keys: string[]
  placeholders: string[]
  firstColWidth: string
  onChange: (index: number, key: string, value: string) => void
  onRemove: (index: number) => void
  catalogItems?: { label: string; value: string }[]
  onSaveToCatalog?: (label: string, value: string) => void
  selectedIndices?: Set<number>
  onToggleSelected?: (index: number, checked: boolean) => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <div ref={setNodeRef} style={style} className={`flex gap-1.5 items-start ${isDragging ? 'opacity-0' : ''}`}>
      {onToggleSelected && (
        <input
          type="checkbox"
          checked={selectedIndices?.has(index) ?? false}
          onChange={(e) => onToggleSelected(index, e.target.checked)}
          className="mt-2 w-3.5 h-3.5 rounded accent-teal-600 flex-shrink-0"
          title="Select row"
        />
      )}
      <button
        ref={setActivatorNodeRef}
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
      {keys.map((k, ki) => (
        <input
          key={k}
          value={row[k] ?? ''}
          placeholder={placeholders[ki]}
          onChange={(e) => onChange(index, k, e.target.value)}
          className={`flex-1 text-xs px-2 py-1.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-teal-500 ${ki === 0 ? firstColWidth : ''}`}
        />
      ))}
      {onSaveToCatalog && (() => {
        const rowLabel = String(row[keys[0]] ?? '').trim()
        const rowValue = String(row[keys[1] ?? keys[0]] ?? '').trim()
        const alreadyInCatalog = !!catalogItems?.some(
          (c) => c.label.trim() === rowLabel && c.value.trim() === rowValue
        )
        if (alreadyInCatalog) return null
        return (
          <button
            onClick={() => onSaveToCatalog(rowLabel, rowValue)}
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
        onClick={() => onRemove(index)}
        className="text-gray-400 hover:text-red-500 transition-colors mt-1 flex-shrink-0"
        title="Remove"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}

function RowEditor<T extends Record<string, string>>({
  rows, onChange, keys, addLabel, placeholders, firstColWidth = 'max-w-[120px]',
  catalogItems, onSaveToCatalog, selectedIndices, onToggleSelected
}: {
  rows: T[]
  onChange: (rows: T[]) => void
  keys: (keyof T)[]
  addLabel: string
  placeholders: string[]
  firstColWidth?: string
  catalogItems?: { label: string; value: string }[]
  onSaveToCatalog?: (label: string, value: string) => void
  selectedIndices?: Set<number>
  onToggleSelected?: (index: number, checked: boolean) => void
}) {
  const [showPicker, setShowPicker] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  const rowIdsRef = useRef<string[]>([])
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  // Keep stable IDs in sync with rows length
  while (rowIdsRef.current.length < rows.length) rowIdsRef.current.push(crypto.randomUUID())
  if (rowIdsRef.current.length > rows.length) rowIdsRef.current = rowIdsRef.current.slice(0, rows.length)

  const activeRow = activeId ? rows[rowIdsRef.current.indexOf(activeId)] ?? null : null

  const emptyRow = () => Object.fromEntries(keys.map((k) => [k, ''])) as T

  useEffect(() => {
    if (!showPicker) return
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowPicker(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showPicker])

  const handleDragStart = ({ active }: DragStartEvent) => setActiveId(String(active.id))

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = rowIdsRef.current.indexOf(String(active.id))
    const newIndex = rowIdsRef.current.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return
    rowIdsRef.current = arrayMove(rowIdsRef.current, oldIndex, newIndex)
    onChange(arrayMove(rows, oldIndex, newIndex))
  }

  const handleRowChange = (index: number, key: string, value: string) => {
    const next = [...rows]
    next[index] = { ...next[index], [key]: value }
    onChange(next)
  }

  const handleRowRemove = (index: number) => {
    rowIdsRef.current = rowIdsRef.current.filter((_, i) => i !== index)
    onChange(rows.filter((_, j) => j !== index))
  }

  return (
    <div className="space-y-1.5">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveId(null)}>
        <SortableContext items={rowIdsRef.current} strategy={verticalListSortingStrategy}>
          {rows.map((row, i) => (
            <SortableRowEditorRow
              key={rowIdsRef.current[i]}
              id={rowIdsRef.current[i]}
              row={row as Record<string, string>}
              index={i}
              keys={keys.map(String)}
              placeholders={placeholders}
              firstColWidth={firstColWidth}
              onChange={handleRowChange}
              onRemove={handleRowRemove}
              catalogItems={catalogItems}
              onSaveToCatalog={onSaveToCatalog}
              selectedIndices={selectedIndices}
              onToggleSelected={onToggleSelected}
            />
          ))}
        </SortableContext>
        <DragOverlay dropAnimation={null}>
          {activeRow ? (
            <div className="flex items-center gap-2 px-2 py-1.5 rounded border border-teal-400 dark:border-teal-500 bg-white dark:bg-gray-800 shadow-lg text-xs text-gray-700 dark:text-gray-200 opacity-95">
              <svg className="h-3.5 w-3.5 flex-shrink-0 text-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 6h.01M8 12h.01M8 18h.01M16 6h.01M16 12h.01M16 18h.01" />
              </svg>
              <span className="truncate">{keys.map((k) => String(activeRow[k] ?? '')).filter(Boolean).join(' \u2014 ')}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
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
              From catalog ({catalogItems.length})...
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

export function PackInfoEditor({
  folderPath,
  folderName,
  rootFolder,
  captures,
  defaultCapturedBy = '',
  catalog = [],
  onCatalogChange,
  checklistTemplate = [],
  onChecklistTemplateChange,
  onPackSaved,
  logoLight,
  logoDark,
  darkAccentColor = '#f9b966',
  allFolderPaths = [],
  parentPackPath = null,
  mode = 'info',
  currentFolderSuggestRules = [],
  onCurrentFolderSuggestRulesChange,
  onOpenCurrentFolderSuggestRulesEditor,
  hasAiKey = false,
  onGenerateAbout,
}: Props) {
  const [pack, setPack] = useState<PackInfo>(EMPTY_PACK)
  const savedPackRef = useRef<PackInfo>(EMPTY_PACK)
  const [saved, setSaved] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [subfoldersOpen, setSubfoldersOpen] = useState(false)
  const subfoldersRef = useRef<HTMLDivElement>(null)
  const [colsOpen, setColsOpen] = useState(false)
  const colsRef = useRef<HTMLDivElement>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const galleryRef = useRef<HTMLDivElement>(null)
  const [folderImages, setFolderImages] = useState<FolderImagesData>({ own: [], inherited: [] })
  const [darkExport, setDarkExport] = useState(() => {
    try {
      const stored = localStorage.getItem('nam-pack-dark-export')
      return stored === null ? true : stored === '1'
    } catch {
      return true
    }
  })
  const [copyPickerOpen, setCopyPickerOpen] = useState(false)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const [parentChecklistItems, setParentChecklistItems] = useState<PackChecklistItem[]>([])
  const [parentAbout, setParentAbout] = useState<string>('')
  const [parseNotesOpen, setParseNotesOpen] = useState(false)
  const [parseNotesText, setParseNotesText] = useState('')
  const [parseToDescription, setParseToDescription] = useState(true)
  const [parseToGlossary, setParseToGlossary] = useState(true)
  const [selectedDescriptionText, setSelectedDescriptionText] = useState('')
  const [selectedGlossaryIndices, setSelectedGlossaryIndices] = useState<Set<number>>(new Set())
  const [selectedSwitchIndices, setSelectedSwitchIndices] = useState<Set<number>>(new Set())
  const [glossaryRuleTarget, setGlossaryRuleTarget] = useState<PackRuleSeedTarget>('auto_guess')
  const [switchRuleTarget, setSwitchRuleTarget] = useState<MetadataSuggestField>('nl_amp_switches')
  const [aboutGenerating, setAboutGenerating] = useState(false)
  const [aboutError, setAboutError] = useState<string | null>(null)
  const descriptionRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let cancelled = false
    window.api.readPackInfo(folderPath).then((res) => {
      if (cancelled) return
      const loaded: PackInfo = res.success && res.data
        ? (() => {
            const d = res.data as Partial<PackInfo>
            return {
              title: normalizeText(d.title),
              subtitle: normalizeText(d.subtitle),
              capturedBy: normalizeText(d.capturedBy, defaultCapturedBy),
              about: normalizeText(d.about),
              description: normalizeText(d.description),
              equipment: Array.isArray(d.equipment)
                ? d.equipment.map((item) => ({
                    label: normalizeText(item?.label),
                    value: normalizeText(item?.value),
                  }))
                : [],
              pedals: Array.isArray(d.pedals)
                ? d.pedals.map((item) => ({
                    label: normalizeText(item?.label),
                    value: normalizeText(item?.value),
                  }))
                : [],
              switches: Array.isArray(d.switches)
                ? d.switches.map((item) => ({
                    label: normalizeText(item?.label),
                    value: normalizeText(item?.value),
                  }))
                : [],
              glossary: Array.isArray(d.glossary)
                ? d.glossary.map((item) => ({
                    term: normalizeText(item?.term),
                    description: normalizeText(item?.description),
                  }))
                : [],
              footer: normalizeText(d.footer),
              exportExcludedSubfolders: d.exportExcludedSubfolders ?? [],
              exportExcludedCaptures: d.exportExcludedCaptures ?? [],
              exportColumns: (d.exportColumns ?? DEFAULT_EXPORT_COLUMNS).filter((id) => PACK_CAPTURE_COLUMNS.some((c) => c.id === id)),
              exportIncludeGallery: d.exportIncludeGallery ?? false,
              exportExcludedGalleryImages: d.exportExcludedGalleryImages ?? [],
              recommendedInputGain: d.recommendedInputGain ?? '',
              checklistItems: Array.isArray(d.checklistItems)
                ? d.checklistItems.map((item) => normalizeChecklistItem(item))
                : createChecklistItemsFromTemplate(checklistTemplate),
              checklistNotes: normalizeText(d.checklistNotes ?? d.notes),
              targetDate: d.targetDate ?? '',
              liveDate: d.liveDate ?? '',
              versionInfo: normalizeText(d.versionInfo),
              deliveryMatrix: normalizeDeliveryMatrixData(d.deliveryMatrix),
              deliveryTargets: normalizeDeliveryTargetsData(d.deliveryTargets),
              deliveryTargetChecklists: normalizeDeliveryTargetChecklistsData(d.deliveryTargetChecklists),
            }
          })()
        : {
            ...EMPTY_PACK,
            capturedBy: defaultCapturedBy,
            checklistItems: createChecklistItemsFromTemplate(checklistTemplate),
            deliveryMatrix: normalizeDeliveryMatrixData(null),
            deliveryTargets: normalizeDeliveryTargetsData(null),
            deliveryTargetChecklists: normalizeDeliveryTargetChecklistsData(null),
          }
      setPack(loaded)
      savedPackRef.current = loaded
      setSaved(true)
    })
    return () => { cancelled = true }
  }, [folderPath])

  useEffect(() => {
    if (!parentPackPath) {
      setParentChecklistItems([])
      setParentAbout('')
      return
    }
    let cancelled = false
    window.api.readPackInfo(parentPackPath).then((res) => {
      if (cancelled) return
      const data = res.success && res.data ? (res.data as Partial<PackInfo>) : null
      const items = Array.isArray(data?.checklistItems)
        ? data.checklistItems.map((item) => normalizeChecklistItem(item))
        : []
      setParentChecklistItems(items)
      setParentAbout(normalizeText(data?.about))
    }).catch(() => {
      if (!cancelled) { setParentChecklistItems([]); setParentAbout('') }
    })
    return () => { cancelled = true }
  }, [parentPackPath])

  const update = useCallback(<K extends keyof PackInfo>(key: K, val: PackInfo[K]) => {
    setPack((prev) => ({ ...prev, [key]: val }))
    setSaved(false)
    setStatus(null)
  }, [])

  const updateChecklistItems = useCallback((items: PackChecklistItem[]) => {
    setPack((prev) => ({ ...prev, checklistItems: items }))
    setSaved(false)
    setStatus(null)
  }, [])

  const setChecklistItemCompleted = useCallback((id: string, completed: boolean) => {
    updateChecklistItems(pack.checklistItems.map((item) =>
      item.id === id
        ? {
            ...item,
            completed,
            completedDate: completed ? (item.completedDate || todayIso()) : '',
          }
        : item
    ))
  }, [pack.checklistItems, updateChecklistItems])

  const addChecklistItem = useCallback(() => {
    updateChecklistItems([...pack.checklistItems, {
      id: createChecklistId(),
      label: '',
      completed: false,
      completedDate: '',
      notes: '',
    }])
  }, [pack.checklistItems, updateChecklistItems])

  const addChecklistItemToTemplate = useCallback((item: PackChecklistItem) => {
    const label = item.label.trim()
    if (!label || !onChecklistTemplateChange) return
    if (checklistTemplate.some((step) => step.label.trim().toLowerCase() === label.toLowerCase())) return
    onChecklistTemplateChange([...checklistTemplate, { id: `step-${Date.now()}`, label }])
  }, [checklistTemplate, onChecklistTemplateChange])

  const syncChecklistItemFromParent = useCallback((item: PackChecklistItem) => {
    const label = normalizeChecklistLabel(item.label)
    if (!label) {
      setStatus('Checklist item needs a name before it can sync')
      return
    }
    const parentItem = parentChecklistItems.find((candidate) => normalizeChecklistLabel(candidate.label) === label)
    if (!parentItem) {
      setStatus('Parent Pack does not contain this checklist item.')
      return
    }
    updateChecklistItems(
      pack.checklistItems.map((step) =>
        step.id === item.id
          ? {
              ...step,
              completed: parentItem.completed,
              completedDate: parentItem.completedDate,
              notes: parentItem.notes,
            }
          : step
      )
    )
    setStatus(`Synced "${item.label}" from Parent Pack`)
    setTimeout(() => setStatus(null), 2000)
  }, [pack.checklistItems, parentChecklistItems, updateChecklistItems])

  const syncAllChecklistFromParent = useCallback(() => {
    if (parentChecklistItems.length === 0) {
      setStatus('Parent Pack has no checklist items to sync from.')
      return
    }
    let synced = 0
    const updated = pack.checklistItems.map((item) => {
      const label = normalizeChecklistLabel(item.label)
      if (!label) return item
      const parentItem = parentChecklistItems.find((c) => normalizeChecklistLabel(c.label) === label)
      if (!parentItem) return item
      synced++
      return { ...item, completed: parentItem.completed, completedDate: parentItem.completedDate, notes: parentItem.notes }
    })
    updateChecklistItems(updated)
    setStatus(synced > 0 ? `Synced ${synced} item${synced !== 1 ? 's' : ''} from Parent Pack` : 'No matching items found in Parent Pack')
    setTimeout(() => setStatus(null), 2000)
  }, [pack.checklistItems, parentChecklistItems, updateChecklistItems])

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

  // Close gallery popup on outside click
  useEffect(() => {
    if (!galleryOpen) return
    const handler = (e: MouseEvent) => {
      if (galleryRef.current && !galleryRef.current.contains(e.target as Node)) {
        setGalleryOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [galleryOpen])

  // Scan the export folder's own + inherited (parent) images, for the Rig Photos gallery option
  useEffect(() => {
    let cancelled = false
    scanOwnAndInheritedImages(folderPath, rootFolder, window.api.scanImages).then((data) => {
      if (!cancelled) setFolderImages(data)
    })
    return () => { cancelled = true }
  }, [folderPath, rootFolder])

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

  const parsedPackNotes = useMemo(() => parsePackNotes(parseNotesText), [parseNotesText])
  const hasDescriptionSelection = selectedDescriptionText.trim().length > 0

  const handleSave = async () => {
    const res = await window.api.writePackInfo(folderPath, pack)
    if (res.success) {
      savedPackRef.current = pack
      setSaved(true)
      setStatus('Saved')
      setTimeout(() => setStatus(null), 2000)
      onPackSaved?.(folderPath.replace(/\\/g, '/'), hasMeaningfulPackInfoData(pack))
    } else {
      setStatus(`Save failed: ${res.error ?? 'unknown error'}`)
    }
  }

  const imageDataUri = async (filePath: string): Promise<string | null> => {
    const result = await window.api.readFileBinary(filePath)
    if (!result.data) return null
    const ext = filePath.split('.').pop()?.toLowerCase() ?? 'jpg'
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : ext === 'avif' ? 'image/avif' : 'image/jpeg'
    return `data:${mime};base64,${result.data}`
  }

  const buildExportGallery = async (): Promise<{ label: string | null; images: string[] }[] | undefined> => {
    if (!pack.exportIncludeGallery) return undefined
    const groups: { label: string | null; paths: string[] }[] = [
      { label: null, paths: folderImages.own },
      ...folderImages.inherited.map((g) => ({ label: g.folderName, paths: g.paths })),
    ]
    const result: { label: string | null; images: string[] }[] = []
    for (const group of groups) {
      const paths = group.paths.filter((p) => !pack.exportExcludedGalleryImages.includes(p))
      if (paths.length === 0) continue
      const dataUris = (await Promise.all(paths.map(imageDataUri))).filter((d): d is string => Boolean(d))
      if (dataUris.length > 0) result.push({ label: group.label, images: dataUris })
    }
    return result
  }

  const handleExport = async () => {
    setExporting(true)
    if (!saved) await handleSave()
    const logo = darkExport ? (logoDark || undefined) : (logoLight || undefined)
    const gallery = await buildExportGallery()
    const html = generatePackHtml(pack, folderPath, folderName, captures, darkExport, logo, darkAccentColor, gallery)
    const res = await window.api.exportPackSheet(html)
    setExporting(false)
    if (!res.success) setStatus(`Export failed: ${res.error ?? 'unknown error'}`)
  }

  const handleExportAdvanced = async () => {
    setExporting(true)
    if (!saved) await handleSave()
    const logo = darkExport ? (logoDark || undefined) : (logoLight || undefined)
    const gallery = await buildExportGallery()
    const html = generatePackHtmlAdvanced(pack, folderPath, folderName, captures, darkExport, logo, darkAccentColor, gallery)
    const res = await window.api.exportPackSheet(html)
    setExporting(false)
    if (!res.success) setStatus(`Export failed: ${res.error ?? 'unknown error'}`)
  }

  const captureDescriptionSelection = useCallback(() => {
    const el = descriptionRef.current
    if (!el) {
      setSelectedDescriptionText('')
      return
    }
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    if (end > start) setSelectedDescriptionText(el.value.slice(start, end))
    else setSelectedDescriptionText('')
  }, [])

  const handleApplyParsedNotes = useCallback(() => {
    const normalizedInput = parseNotesText.trim()
    if (!normalizedInput) {
      setStatus('Paste some pack notes first')
      return
    }
    if (!parseToDescription && !parseToGlossary) {
      setStatus('Choose Description, Glossary, or both')
      return
    }

    const glossaryByKey = new Set(
      pack.glossary.map((item) => `${item.term.trim().toLowerCase()}::${item.description.trim().toLowerCase()}`)
    )
    const mergedGlossary = [...pack.glossary]
    let addedGlossaryCount = 0
    for (const item of parsedPackNotes.glossary) {
      const key = `${item.term.trim().toLowerCase()}::${item.description.trim().toLowerCase()}`
      if (!glossaryByKey.has(key)) {
        glossaryByKey.add(key)
        mergedGlossary.push(item)
        addedGlossaryCount += 1
      }
    }

    setPack((prev) => ({
      ...prev,
      description: parseToDescription ? parsedPackNotes.description : prev.description,
      glossary: parseToGlossary ? mergedGlossary : prev.glossary,
    }))
    setSaved(false)
    setStatus(
      `Parsed pack notes${parseToDescription ? ' into description' : ''}${parseToDescription && parseToGlossary ? ' and' : ''}${parseToGlossary ? ` with ${addedGlossaryCount} glossary entr${addedGlossaryCount === 1 ? 'y' : 'ies'}` : ''}`
    )
    setTimeout(() => setStatus(null), 3000)
  }, [pack.glossary, parseNotesText, parseToDescription, parseToGlossary, parsedPackNotes])

  const openPackNotesParser = useCallback(() => {
    const preferredSource = selectedDescriptionText.trim() || pack.description.trim()
    if (preferredSource) setParseNotesText(preferredSource)
    setParseNotesOpen((prev) => !prev)
  }, [pack.description, selectedDescriptionText])

  const handleAddSelectionToGlossary = useCallback(() => {
    const selection = selectedDescriptionText.trim()
    if (!selection) {
      setStatus('Select some description text first')
      return
    }
    const parsed = parsePackNotes(selection)
    if (parsed.glossary.length === 0) {
      setStatus('No TOKEN = meaning lines found in the selected text')
      return
    }
    const glossaryByKey = new Set(
      pack.glossary.map((item) => `${item.term.trim().toLowerCase()}::${item.description.trim().toLowerCase()}`)
    )
    const mergedGlossary = [...pack.glossary]
    let addedCount = 0
    for (const item of parsed.glossary) {
      const key = `${item.term.trim().toLowerCase()}::${item.description.trim().toLowerCase()}`
      if (!glossaryByKey.has(key)) {
        glossaryByKey.add(key)
        mergedGlossary.push(item)
        addedCount += 1
      }
    }
    setPack((prev) => ({ ...prev, glossary: mergedGlossary }))
    setSaved(false)
    setStatus(addedCount > 0 ? `Added ${addedCount} glossary entr${addedCount === 1 ? 'y' : 'ies'} from selection` : 'Selected glossary lines were already present')
    setTimeout(() => setStatus(null), 3000)
  }, [pack.glossary, selectedDescriptionText])

  const handleCreateRuleSeedsFromSelection = useCallback(() => {
    const selection = selectedDescriptionText.trim()
    if (!selection) {
      setStatus('Select some description text first')
      return
    }
    if (!onCurrentFolderSuggestRulesChange) {
      setStatus('Folder suggestion rules are not available here')
      return
    }
    const seeds = buildRuleSeedsFromText(selection)
    if (seeds.length === 0) {
      setStatus('No TOKEN = meaning lines found for rule seeds')
      return
    }
    const existing = new Set(currentFolderSuggestRules.map(metadataSuggestRuleSignature))
    const additions = seeds.filter((rule) => !existing.has(metadataSuggestRuleSignature(rule)))
    if (additions.length === 0) {
      setStatus('Those rule seeds are already in this folder\'s suggestion rules')
      return
    }
    onCurrentFolderSuggestRulesChange([...currentFolderSuggestRules, ...additions])
    onOpenCurrentFolderSuggestRulesEditor?.()
    setStatus(`Added ${additions.length} rule seed${additions.length === 1 ? '' : 's'} to this folder's suggestion rules`)
    setTimeout(() => setStatus(null), 3000)
  }, [currentFolderSuggestRules, onCurrentFolderSuggestRulesChange, onOpenCurrentFolderSuggestRulesEditor, selectedDescriptionText])

  const addRulesToCurrentFolder = useCallback((
    rules: MetadataSuggestRule[],
    emptyMessage: string,
    duplicateMessage: string,
    successLabel: string
  ) => {
    if (!onCurrentFolderSuggestRulesChange) {
      setStatus('Folder suggestion rules are not available here')
      return
    }
    const cleaned = rules.filter((rule) => rule.token.trim() && rule.value.trim())
    if (cleaned.length === 0) {
      setStatus(emptyMessage)
      return
    }
    const existing = new Set(currentFolderSuggestRules.map(metadataSuggestRuleSignature))
    const additions = cleaned.filter((rule) => !existing.has(metadataSuggestRuleSignature(rule)))
    if (additions.length === 0) {
      setStatus(duplicateMessage)
      return
    }
    onCurrentFolderSuggestRulesChange([...currentFolderSuggestRules, ...additions])
    onOpenCurrentFolderSuggestRulesEditor?.()
    setStatus(`Added ${additions.length} ${successLabel}${additions.length === 1 ? '' : 's'} to this folder's suggestion rules`)
    setTimeout(() => setStatus(null), 3000)
  }, [currentFolderSuggestRules, onCurrentFolderSuggestRulesChange, onOpenCurrentFolderSuggestRulesEditor])

  const handleCreateGlossaryRules = useCallback((mode: 'selected' | 'all') => {
    const sourceEntries = pack.glossary
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry, index }) => {
        if (!entry.term.trim() || !entry.description.trim()) return false
        return mode === 'all' || selectedGlossaryIndices.has(index)
      })
      .map(({ entry }) => entry)

    const rules = sourceEntries.map((entry) => buildRuleFromGlossaryEntry(entry, glossaryRuleTarget))
    addRulesToCurrentFolder(
      rules,
      mode === 'all' ? 'No glossary entries are ready to become rules' : 'Select one or more glossary rows first',
      'Those glossary rules are already in this folder\'s suggestion rules',
      'glossary rule seed'
    )
  }, [addRulesToCurrentFolder, glossaryRuleTarget, pack.glossary, selectedGlossaryIndices])

  const handleCreateSwitchRules = useCallback((mode: 'selected' | 'all') => {
    const sourceEntries = pack.switches
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry, index }) => {
        if (!entry.label.trim() || !entry.value.trim()) return false
        return mode === 'all' || selectedSwitchIndices.has(index)
      })
      .map(({ entry }) => entry)

    const rules = sourceEntries.map((entry) => buildRuleFromSwitchEntry(entry, switchRuleTarget))
    addRulesToCurrentFolder(
      rules,
      mode === 'all' ? 'No switch rows are ready to become rules' : 'Select one or more switch rows first',
      'Those switch rules are already in this folder\'s suggestion rules',
      'switch rule seed'
    )
  }, [addRulesToCurrentFolder, pack.switches, selectedSwitchIndices, switchRuleTarget])

  const handleCopyTo = async (targetPath: string) => {
    setCopyPickerOpen(false)
    const res = await window.api.writePackInfo(targetPath, pack)
      if (res.success) {
        const targetName = targetPath.replace(/\\/g, '/').split('/').pop() ?? targetPath
        onPackSaved?.(targetPath.replace(/\\/g, '/'), !!pack.title.trim())
        setCopyStatus(`Copied to "${targetName}"`)
        setTimeout(() => setCopyStatus(null), 3000)
      } else {
        setCopyStatus(`Copy failed: ${res.error ?? 'unknown error'}`)
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
  const checklistItemChanged = (item: PackChecklistItem) => {
    const savedItem = savedPackRef.current.checklistItems.find((candidate) => candidate.id === item.id)
    if (!savedItem) return true
    return JSON.stringify(item) !== JSON.stringify(savedItem)
  }
  const checklistSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  )
  const handleChecklistDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = pack.checklistItems.findIndex((item) => item.id === active.id)
    const newIndex = pack.checklistItems.findIndex((item) => item.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    updateChecklistItems(arrayMove(pack.checklistItems, oldIndex, newIndex))
  }, [pack.checklistItems, updateChecklistItems])
  const labelCls = 'text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block'
  const checklistCompletedCount = pack.checklistItems.filter((item) => item.completed).length
  const checklistTotalCount = pack.checklistItems.length
  const checklistPercent = checklistTotalCount > 0 ? Math.round((checklistCompletedCount / checklistTotalCount) * 100) : 0
  const today = todayIso()
  const isReleased = !!pack.liveDate
  const isOverdue = !isReleased && !!pack.targetDate && pack.targetDate < today
  const releasedLate = !!pack.liveDate && !!pack.targetDate && pack.liveDate > pack.targetDate
  const releasedOnTime = !!pack.liveDate && !!pack.targetDate && pack.liveDate <= pack.targetDate
  const isPositiveStatus = !!status && (/^saved$/i.test(status) || /^synced\b/i.test(status))

  return (
    <div className="h-full flex flex-col overflow-hidden" onContextMenu={showNativeTextContextMenu}>
        {/* Header */}
        <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between flex-shrink-0">
          <div>
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{mode === 'checklist' ? 'Pack Checklist' : 'Pack Info'}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">{folderName}</p>
          </div>
          <div className="flex items-center gap-2 relative">
          {(status || copyStatus) && (
            <span className={`text-xs ${copyStatus ? 'text-teal-600 dark:text-teal-400' : isPositiveStatus ? 'text-teal-600 dark:text-teal-400' : 'text-red-500'}`}>
              {copyStatus ?? status}
            </span>
          )}
            {mode === 'info' && (
              <>
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
                  Simple PDF...
                </button>
                <button
                  onClick={handleExportAdvanced}
                  disabled={exporting}
                  className="text-xs px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50"
                >
                  Advanced PDF...
                </button>
              </>
            )}
          {/* Copy to... deferred: NAM Lab's nested folder structure makes target
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
              Copy to...
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
        {mode === 'checklist' ? (
          <>
            <div className="space-y-3 pb-3">
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">Progress</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {checklistCompletedCount} of {checklistTotalCount} steps complete
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold text-gray-800 dark:text-gray-100">{checklistPercent}%</p>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500">
                      {isReleased ? 'Released' : isOverdue ? 'Overdue' : pack.targetDate ? 'Scheduled' : 'No target date'}
                    </p>
                  </div>
                </div>
                <div className="w-full h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                  <div className="h-full bg-teal-500 transition-all" style={{ width: `${checklistPercent}%` }} />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {releasedOnTime && <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300">Released on time</span>}
                  {releasedLate && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">Released late</span>}
                  {isOverdue && <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">Target date passed</span>}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div>
                  <label className={labelCls}>Target Date</label>
                  <input type="date" value={pack.targetDate} onChange={(e) => update('targetDate', e.target.value)} className={inputCls('targetDate')} />
                </div>
                <div>
                  <label className={labelCls}>Live Date</label>
                  <input type="date" value={pack.liveDate} onChange={(e) => update('liveDate', e.target.value)} className={inputCls('liveDate')} />
                </div>
                <div>
                  <label className={labelCls}>Version</label>
                  <input type="text" value={pack.versionInfo} onChange={(e) => update('versionInfo', e.target.value)} placeholder="v1.0" className={inputCls('versionInfo')} />
                </div>
              </div>
            </div>

            <SectionHeader label="Release Notes" hint="Internal notes, release notes, and handoff details" />
            <div className="pb-4">
              <textarea
                value={pack.checklistNotes}
                onChange={(e) => update('checklistNotes', e.target.value)}
                placeholder="Release notes, blockers, known issues, launch reminders..."
                rows={6}
                className={`${inputCls('checklistNotes')} resize-y min-h-[110px]`}
              />
            </div>

            <SectionHeader label="Checklist" hint="Track the release steps needed to ship this pack" />
            <div className="space-y-2 pb-4">
              {pack.checklistItems.length === 0 ? (
                <div className="rounded border border-dashed border-gray-300 dark:border-gray-700 px-3 py-3 text-xs text-gray-400 dark:text-gray-500">
                  No checklist steps yet.
                </div>
              ) : (
                <DndContext sensors={checklistSensors} collisionDetection={closestCenter} onDragEnd={handleChecklistDragEnd}>
                  <SortableContext items={pack.checklistItems.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                    {pack.checklistItems.map((item, index) => {
                      const inTemplate = checklistTemplate.some((step) => step.label.trim().toLowerCase() === item.label.trim().toLowerCase())
                      const rowChanged = checklistItemChanged(item)
                      return (
                        <SortableChecklistRow
                          key={item.id}
                          item={item}
                          index={index}
                          totalCount={pack.checklistItems.length}
                          inTemplate={inTemplate}
                          rowChanged={rowChanged}
                          parentPackPath={parentPackPath}
                          onToggleCompleted={(completed) => setChecklistItemCompleted(item.id, completed)}
                          onLabelChange={(value) => updateChecklistItems(pack.checklistItems.map((step) => step.id === item.id ? { ...step, label: value } : step))}
                          onDateChange={(value) => updateChecklistItems(pack.checklistItems.map((step) => step.id === item.id ? { ...step, completedDate: value, completed: value ? true : step.completed } : step))}
                          onNotesChange={(value) => updateChecklistItems(pack.checklistItems.map((step) => step.id === item.id ? { ...step, notes: value } : step))}
                          onSync={() => syncChecklistItemFromParent(item)}
                          onAddToTemplate={() => addChecklistItemToTemplate(item)}
                          onRemove={() => updateChecklistItems(pack.checklistItems.filter((step) => step.id !== item.id))}
                        />
                      )
                    })}
                  </SortableContext>
                </DndContext>
              )}
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={addChecklistItem} className="text-xs text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 font-medium transition-colors">+ Add step</button>
                {parentPackPath && pack.checklistItems.length > 0 && (
                  <button
                    onClick={syncAllChecklistFromParent}
                    className="text-xs px-2 py-0.5 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-teal-500 hover:text-teal-600 dark:hover:text-teal-300 font-medium transition-colors"
                  >
                    Sync All from Parent
                  </button>
                )}
                {checklistTemplate.length > 0 && (
                  <button
                    onClick={() => {
                      if (!window.confirm('Do you really want to clear all current checklist rows and reset them from the template?')) return
                      updateChecklistItems(createChecklistItemsFromTemplate(checklistTemplate))
                    }}
                    className="text-xs text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 font-medium transition-colors"
                  >
                    Reset from template
                  </button>
                )}
              </div>
            </div>
          </>
        ) : (
          <>

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

        {/* About this gear */}
        <div className="pb-1">
          <div className="flex items-center justify-between gap-3 mb-1">
            <label className={labelCls}>About this gear</label>
            <div className="flex items-center gap-2">
            {parentAbout && parentAbout !== pack.about && (
              <button
                type="button"
                onClick={() => update('about', parentAbout)}
                title="Copy from parent pack"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border border-gray-400/30 text-gray-400 hover:text-gray-200 hover:border-gray-400/60 transition-colors"
              >
                ↓ Sync from parent
              </button>
            )}
            {hasAiKey && onGenerateAbout && (
              <button
                type="button"
                disabled={aboutGenerating}
                onClick={async () => {
                  setAboutGenerating(true)
                  setAboutError(null)
                  try {
                    const text = await onGenerateAbout({ existingDescription: pack.description, capturedBy: pack.capturedBy })
                    if (text) update('about', text)
                    else setAboutError('No content returned')
                  } catch (e) {
                    setAboutError(e instanceof Error ? e.message : 'Error')
                  } finally {
                    setAboutGenerating(false)
                  }
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border border-violet-500/40 text-violet-400 hover:bg-violet-500/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {aboutGenerating
                  ? <><svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg> Generating&hellip;</>
                  : <>✨ Generate</>
                }
              </button>
            )}
            </div>
          </div>
          {aboutError && <p className="mb-1 text-xs text-red-400">{aboutError}</p>}
          <textarea
            value={pack.about}
            onChange={(e) => { update('about', e.target.value); setAboutError(null) }}
            placeholder={hasAiKey ? 'Click ✨ Generate to fill with AI, or type manually\u2026' : 'A short description of what this gear is and its tonal character\u2026'}
            rows={4}
            maxLength={1000}
            className={`${inputCls('about')} resize-y leading-relaxed font-mono text-xs`}
          />
          <p className="mt-1 px-1 text-[10px] text-gray-400 dark:text-gray-500">
            Saved with this pack &mdash; not included in the exported pack sheet.
          </p>
        </div>

        {/* Description */}
        <div className="pb-1">
          <div className="flex items-center justify-between gap-3">
            <label className={labelCls}>Description</label>
            <div className="flex items-center gap-3 flex-wrap justify-end">
              <button
                type="button"
                onClick={handleAddSelectionToGlossary}
                disabled={!hasDescriptionSelection}
                className={`text-[11px] font-medium transition-colors ${
                  hasDescriptionSelection
                    ? 'text-teal-500 dark:text-teal-400 hover:text-teal-600 dark:hover:text-teal-300'
                    : 'text-gray-400 dark:text-gray-600 cursor-default'
                }`}
                title={hasDescriptionSelection ? 'Turn selected TOKEN = meaning lines into glossary entries' : 'Select text in Description first'}
              >
                Parse selection as glossary
              </button>
              <button
                type="button"
                onClick={handleCreateRuleSeedsFromSelection}
                disabled={!hasDescriptionSelection}
                className={`text-[11px] font-medium transition-colors ${
                  hasDescriptionSelection
                    ? 'text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300'
                    : 'text-gray-400 dark:text-gray-600 cursor-default'
                }`}
                title={hasDescriptionSelection ? 'Turn selected TOKEN = meaning lines into metadata rule seeds' : 'Select text in Description first'}
              >
                Build rule seeds from selection
              </button>
              <button
                type="button"
                onClick={openPackNotesParser}
                className="text-[11px] font-medium text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 transition-colors"
              >
                {parseNotesOpen ? 'Hide pack notes parser' : 'Parse pack notes...'}
              </button>
            </div>
          </div>
          <textarea
            ref={descriptionRef}
            value={pack.description}
            placeholder="Describe the amp, the tones, how it was captured..."
            onChange={(e) => update('description', e.target.value)}
            onSelect={captureDescriptionSelection}
            onKeyUp={captureDescriptionSelection}
            onMouseUp={captureDescriptionSelection}
            rows={pack.description.trim() ? 12 : 7}
            className={`${inputCls('description')} resize-y leading-relaxed ${pack.description.trim() ? 'min-h-[220px]' : 'min-h-[80px]'} font-mono text-xs`}
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
          {hasDescriptionSelection && (
            <div className="mt-1 px-1 text-[10px] text-gray-500 dark:text-gray-400">
              Using selected description text: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">{selectedDescriptionText.trim().slice(0, 120)}{selectedDescriptionText.trim().length > 120 ? '...' : ''}</code>
            </div>
          )}
          {parseNotesOpen && (
            <div className="mt-3 rounded-lg border border-indigo-500/30 bg-indigo-500/5 dark:bg-indigo-500/10 p-3 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">Parse Pack Notes</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                    Paste creator notes, token legends, or technical details here. We can send the cleaned text to Description and pull
                    <code className="mx-1 bg-gray-100 dark:bg-gray-800 px-0.5 rounded">TOKEN = meaning</code>
                    lines into Glossary.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setParseNotesText('')}
                  className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  title="Clear pasted notes"
                >
                  Clear
                </button>
              </div>

              <textarea
                value={parseNotesText}
                onChange={(e) => setParseNotesText(e.target.value)}
                placeholder={'Paste pack notes here...\n\nExample:\nAMP SETTINGS:\nD3 G6 T6 M4 B0 P6.5 M6\n\nSTD = standard quality architecture'}
                rows={7}
                className="w-full px-3 py-2 text-xs rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-indigo-500 resize-y font-mono leading-relaxed"
              />

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <label className="inline-flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={parseToDescription}
                    onChange={(e) => setParseToDescription(e.target.checked)}
                    className="w-3.5 h-3.5 rounded accent-indigo-600"
                  />
                  Replace Description with cleaned notes
                </label>
                <label className="inline-flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={parseToGlossary}
                    onChange={(e) => setParseToGlossary(e.target.checked)}
                    className="w-3.5 h-3.5 rounded accent-indigo-600"
                  />
                  Add TOKEN = meaning lines to Glossary
                </label>
              </div>

              {parseNotesText.trim() && (
                <div className="rounded border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-900/70 p-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400">
                    <span>
                      Cleaned description: <span className="font-semibold text-gray-700 dark:text-gray-200">{parsedPackNotes.description ? 'ready' : 'empty'}</span>
                    </span>
                    <span>
                      Glossary entries found: <span className="font-semibold text-gray-700 dark:text-gray-200">{parsedPackNotes.glossary.length}</span>
                    </span>
                    {parsedPackNotes.sections.length > 0 && (
                      <span>
                        Sections: <span className="font-semibold text-gray-700 dark:text-gray-200">{parsedPackNotes.sections.join(', ')}</span>
                      </span>
                    )}
                  </div>
                  {parsedPackNotes.glossary.length > 0 && (
                    <div className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
                      First glossary hit:{' '}
                      <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">
                        {parsedPackNotes.glossary[0].term} = {parsedPackNotes.glossary[0].description}
                      </code>
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleApplyParsedNotes}
                  className="px-3 py-1.5 text-xs font-medium rounded bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
                >
                  Apply parsed notes
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Captures */}
        <SectionHeader label="Captures" hint={`${captures.length} loaded from files - check/uncheck to include in export`} />
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
                {/* Inactive columns - click to add at end */}
                {PACK_CAPTURE_COLUMNS.filter((c) => !pack.exportColumns.includes(c.id)).map((col) => {
                  const validCount = pack.exportColumns.filter((id) => PACK_CAPTURE_COLUMNS.some((c) => c.id === id)).length
                  const atMax = validCount >= 6
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
        {/* Rig photos gallery chooser */}
        {(folderImages.own.length > 0 || folderImages.inherited.some((g) => g.paths.length > 0)) && (() => {
          const allImages: { label: string | null; paths: string[] }[] = [
            { label: null, paths: folderImages.own },
            ...folderImages.inherited.map((g) => ({ label: g.folderName, paths: g.paths })),
          ]
          const totalCount = allImages.reduce((n, g) => n + g.paths.length, 0)
          const includedCount = totalCount - pack.exportExcludedGalleryImages.length
          return (
            <div className="relative" ref={galleryRef}>
              <button
                onClick={() => setGalleryOpen((v) => !v)}
                className="flex items-center gap-1.5 px-2 py-1 text-xs rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:border-teal-500 dark:hover:border-teal-500 transition-colors"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14M14 8h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <input
                  type="checkbox"
                  checked={pack.exportIncludeGallery}
                  onChange={(e) => update('exportIncludeGallery', e.target.checked)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-3 h-3 rounded accent-teal-600"
                />
                Rig photos
                <span className="text-gray-400 dark:text-gray-500 text-[10px]">({totalCount})</span>
                <svg className={`w-2.5 h-2.5 transition-transform ${galleryOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {galleryOpen && (
                <div className="absolute top-full left-0 mt-1 z-30 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl">
                  <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700">
                    <span className="text-xs font-semibold text-gray-600 dark:text-gray-300">
                      {includedCount} of {totalCount} photos in export
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => update('exportExcludedGalleryImages', [])}
                        className="text-[10px] text-teal-600 dark:text-teal-400 hover:underline"
                      >All</button>
                      <button
                        onClick={() => update('exportExcludedGalleryImages', allImages.flatMap((g) => g.paths))}
                        className="text-[10px] text-gray-400 hover:underline"
                      >None</button>
                    </div>
                  </div>
                  <div className="overflow-y-auto max-h-72 py-1">
                    {allImages.filter((g) => g.paths.length > 0).map((group) => (
                      <div key={group.label ?? '__own__'}>
                        {group.label && (
                          <div className="px-3 pt-2 pb-1 text-[10px] text-gray-400 dark:text-gray-500">From {group.label}</div>
                        )}
                        <div className="grid grid-cols-4 gap-1.5 px-3 py-1">
                          {group.paths.map((p) => {
                            const excluded = pack.exportExcludedGalleryImages.includes(p)
                            return (
                              <label key={p} className="relative cursor-pointer select-none group">
                                <img
                                  src={`local-file://${p.startsWith('/') ? '' : '/'}${p}`}
                                  alt=""
                                  className={`w-full aspect-square object-cover rounded ${excluded ? 'opacity-30' : ''}`}
                                />
                                <input
                                  type="checkbox"
                                  checked={!excluded}
                                  onChange={(e) => {
                                    const next = e.target.checked
                                      ? pack.exportExcludedGalleryImages.filter((x) => x !== p)
                                      : [...pack.exportExcludedGalleryImages, p]
                                    update('exportExcludedGalleryImages', next)
                                  }}
                                  className="absolute top-1 right-1 w-3 h-3 rounded accent-teal-600"
                                />
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })()}
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
                                title={excluded ? 'Excluded from export - click to include' : 'Included in export - click to exclude'}
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
                      <span className="text-gray-400 dark:text-gray-600"> | {captures.length - subfoldVisible.length} hidden by folder filter</span>
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
        <SectionHeader label="Equipment" hint="Amp | Cabinet | Mic(s) | Preamp | Interface" />
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
        <SectionHeader label="Pedals" hint="Boost | Drive | EQ | Effects in chain" />
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

        {/* Switches - no catalog (per-amp) */}
        <SectionHeader label="Switches & Modes" hint="Channel modes | Tone stack | Voice switches" />
        <div className={sectionChanged('switches')}>
          <div className="mb-2 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={switchRuleTarget}
                onChange={(e) => setSwitchRuleTarget(e.target.value as MetadataSuggestField)}
                className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-teal-500"
              >
                {PACK_RULE_TARGET_OPTIONS.filter((option) => option.value !== 'auto_guess').map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => handleCreateSwitchRules('selected')}
                className="text-xs text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 font-medium transition-colors"
              >
                Create selected rules
              </button>
              <button
                type="button"
                onClick={() => handleCreateSwitchRules('all')}
                className="text-xs text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 font-medium transition-colors"
              >
                Create all rules
              </button>
            </div>
            {selectedSwitchIndices.size > 0 && (
              <span className="text-[11px] text-gray-500 dark:text-gray-400">{selectedSwitchIndices.size} selected</span>
            )}
          </div>
          <RowEditor
            rows={pack.switches}
            onChange={(rows) => {
              update('switches', rows)
              setSelectedSwitchIndices((prev) => new Set([...prev].filter((index) => index < rows.length)))
            }}
            keys={['label', 'value']}
            addLabel="Add switch"
            placeholders={['Tight switch', 'Engaged on all BE channels']}
            firstColWidth="max-w-[140px]"
            selectedIndices={selectedSwitchIndices}
            onToggleSelected={(index, checked) => {
              setSelectedSwitchIndices((prev) => {
                const next = new Set(prev)
                if (checked) next.add(index)
                else next.delete(index)
                return next
              })
            }}
          />
        </div>

        {/* Glossary */}
        <SectionHeader label="Glossary" hint="Define terms used in capture names" />
        <div className={`pb-4 ${sectionChanged('glossary')}`}>
          <div className="mb-2 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={glossaryRuleTarget}
                onChange={(e) => setGlossaryRuleTarget(e.target.value as PackRuleSeedTarget)}
                className="text-xs px-2 py-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:border-teal-500"
              >
                {PACK_RULE_TARGET_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => handleCreateGlossaryRules('selected')}
                className="text-xs text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 font-medium transition-colors"
              >
                Create selected rules
              </button>
              <button
                type="button"
                onClick={() => handleCreateGlossaryRules('all')}
                className="text-xs text-indigo-500 dark:text-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-300 font-medium transition-colors"
              >
                Create all rules
              </button>
            </div>
            {selectedGlossaryIndices.size > 0 && (
              <span className="text-[11px] text-gray-500 dark:text-gray-400">{selectedGlossaryIndices.size} selected</span>
            )}
          </div>
          <RowEditor
            rows={pack.glossary}
            onChange={(rows) => {
              update('glossary', rows)
              setSelectedGlossaryIndices((prev) => new Set([...prev].filter((index) => index < rows.length)))
            }}
            keys={['term', 'description']}
            addLabel="Add entry"
            placeholders={['DI', 'Direct Inject - no cabinet']}
            catalogItems={catalogFor('glossary')}
            onSaveToCatalog={(label, value) => addToCatalog('glossary', label, value)}
            selectedIndices={selectedGlossaryIndices}
            onToggleSelected={(index, checked) => {
              setSelectedGlossaryIndices((prev) => {
                const next = new Set(prev)
                if (checked) next.add(index)
                else next.delete(index)
                return next
              })
            }}
          />
        </div>

        {/* Release Prep */}
        <SectionHeader label="Release Prep" hint="Customer-facing input guidance that stays with Pack Info" />
        <div className="pb-4 space-y-2">
          <div>
            <label className={labelCls}>Recommended Input Gain</label>
            <input
              type="text"
              value={pack.recommendedInputGain}
              onChange={(e) => update('recommendedInputGain', e.target.value)}
              placeholder="e.g. -18 dBu, unity, +12.5 dBu"
              className={inputCls('recommendedInputGain')}
            />
          </div>
        </div>

        {/* Footer */}
        <SectionHeader label="Footer" hint="Contact info, copyright, links..." />
        <div className="pb-4">
          <textarea
            value={pack.footer}
            placeholder="Copyright 2025 Core Tone Captures | cortonecaptures.com"
            onChange={(e) => update('footer', e.target.value)}
            rows={2}
            className={`${inputCls('footer')} resize-none font-mono text-xs`}
          />
          <p className="mt-1 px-1 text-[10px] text-gray-400 dark:text-gray-500">
            Supports same formatting as description - <code className="bg-gray-100 dark:bg-gray-800 px-0.5 rounded">**bold**</code>, <code className="bg-gray-100 dark:bg-gray-800 px-0.5 rounded">[orange]color[/orange]</code>, etc.
          </p>
        </div>

        {/* Print tips */}
        <div className="mt-2 mb-4 px-3 py-2.5 rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <p className="text-[10px] italic text-gray-400 dark:text-gray-500 leading-relaxed">
            * <span className="font-semibold not-italic text-gray-500 dark:text-gray-400">Printing to PDF from browser:</span> recommend <span className="font-semibold not-italic">landscape</span> orientation for best results.
            For dark mode exports, set margins to <span className="font-semibold not-italic">None</span> and enable <span className="font-semibold not-italic">Background Graphics</span> in the print dialog to preserve background colours.
          </p>
        </div>
          </>
        )}
      </div>
    </div>
  )
}
