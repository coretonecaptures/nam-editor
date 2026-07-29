import { useEffect, useMemo, useRef, useState } from 'react'
import {
  METADATA_SUGGEST_FIELD_OPTIONS,
  METADATA_SUGGEST_LOOKUP_VALUES,
  MetadataSuggestField,
  MetadataSuggestMatchIn,
  MetadataSuggestMatchType,
  MetadataSuggestRule,
} from '../types/settings'

type MappingMode = 'ignore' | 'exact' | 'prefix_value'

interface SegmentMappingDraft {
  id: string
  mode: MappingMode
  field: MetadataSuggestField
  token: string
  value: string
  matchIn: MetadataSuggestMatchIn
}

interface SegmentDraft {
  index: number
  raw: string
  mappings: SegmentMappingDraft[]
}

interface FilenameRecipeBuilderModalProps {
  title?: string
  initialExample?: string
  onConfirm: (rules: MetadataSuggestRule[]) => void
  onClose: () => void
}

const FIELD_OPTIONS = METADATA_SUGGEST_FIELD_OPTIONS

const AMP_SETTING_PREFIX_LABELS: Record<string, string> = {
  p: 'Presence {value}',
  b: 'Bass {value}',
  m: 'Middle {value}',
  t: 'Treble {value}',
  g: 'Gain {value}',
  v: 'Volume {value}',
  d: 'Depth {value}',
  r: 'Resonance {value}',
}

function splitExampleSegments(example: string): string[] {
  return example
    .trim()
    .split(/\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function randomId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function createEmptyMapping(segment: string, suggestedField: MetadataSuggestField = 'gear_make'): SegmentMappingDraft {
  const prefixMatch = segment.match(/^([A-Za-z]+)([0-9]+(?:\.[0-9]+)?)$/)
  const lowerPrefix = prefixMatch?.[1]?.toLowerCase() ?? ''
  const canSuggestPrefixValue = !!prefixMatch && suggestedField === 'nl_amp_settings'
  return {
    id: randomId('recipe-map'),
    mode: canSuggestPrefixValue ? 'prefix_value' : 'exact',
    field: suggestedField,
    token: canSuggestPrefixValue ? prefixMatch![1] : segment,
    value: canSuggestPrefixValue ? (AMP_SETTING_PREFIX_LABELS[lowerPrefix] ?? '{match}') : segment,
    matchIn: 'filename',
  }
}

function buildSuggestedSegmentDrafts(example: string): SegmentDraft[] {
  const segments = splitExampleSegments(example)
  return segments.map((raw, idx) => {
    const lower = raw.toLowerCase()
    const prefixMatch = raw.match(/^([A-Za-z]+)([0-9]+(?:\.[0-9]+)?)$/)

    let mappings: SegmentMappingDraft[]
    if (idx === 0) {
      mappings = [createEmptyMapping(raw, 'gear_model')]
    } else if (lower === 'lo' || lower === 'hi') {
      mappings = [createEmptyMapping(raw, 'nl_amp_switches')]
    } else if (prefixMatch) {
      mappings = [createEmptyMapping(raw, 'nl_amp_settings')]
    } else {
      mappings = [createEmptyMapping(raw, 'nl_comments')]
    }

    return {
      index: idx + 1,
      raw,
      mappings,
    }
  })
}

function mappingToRule(segment: SegmentDraft, mapping: SegmentMappingDraft): MetadataSuggestRule | null {
  if (mapping.mode === 'ignore') return null
  if (!mapping.value.trim()) return null
  if (mapping.mode !== 'prefix_value' && !mapping.token.trim()) return null
  return {
    id: randomId('recipe-rule'),
    token: mapping.token,
    segmentIndex: segment.index,
    field: mapping.field,
    value: mapping.value.trim(),
    matchIn: mapping.matchIn,
    matchType: mapping.mode === 'prefix_value' ? 'prefix_value' : 'exact',
    enabled: true,
    overwriteExisting: false,
    overwriteOnlyValues: '',
  }
}

function renderMappingExample(segmentRaw: string, mapping: SegmentMappingDraft): string {
  if (mapping.mode === 'ignore') return 'Ignored'
  if (mapping.mode === 'exact') {
    return mapping.value.trim() || segmentRaw
  }

  const prefix = mapping.token.trim()
  const raw = segmentRaw.trim()
  if (!prefix) return mapping.value.trim() || raw

  const matchesPrefix = raw.toLowerCase().startsWith(prefix.toLowerCase())
  const extracted = matchesPrefix ? raw.slice(prefix.length) : ''
  return (mapping.value || '{match}')
    .replaceAll('{match}', raw)
    .replaceAll('{value}', extracted)
}

export function FilenameRecipeBuilderModal({
  title = 'Build Rules From Example Filename',
  initialExample = '',
  onConfirm,
  onClose,
}: FilenameRecipeBuilderModalProps) {
  const [example, setExample] = useState(initialExample)
  const [segments, setSegments] = useState<SegmentDraft[]>(() => buildSuggestedSegmentDrafts(initialExample))
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const dragStateRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)

  useEffect(() => {
    setExample(initialExample)
  }, [initialExample])

  useEffect(() => {
    setSegments(buildSuggestedSegmentDrafts(example))
  }, [example])

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const dragState = dragStateRef.current
      if (!dragState) return
      setDragOffset({
        x: dragState.originX + (event.clientX - dragState.startX),
        y: dragState.originY + (event.clientY - dragState.startY),
      })
    }

    const handleMouseUp = () => {
      dragStateRef.current = null
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  const generatedRules = useMemo(
    () => segments.flatMap((segment) => segment.mappings.map((mapping) => mappingToRule(segment, mapping)).filter((rule): rule is MetadataSuggestRule => !!rule)),
    [segments]
  )

  const beginDrag = (event: React.MouseEvent<HTMLDivElement>) => {
    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: dragOffset.x,
      originY: dragOffset.y,
    }
  }

  const updateMapping = (segmentIndex: number, mappingId: string, patch: Partial<SegmentMappingDraft>) => {
    setSegments((prev) => prev.map((segment) => {
      if (segment.index !== segmentIndex) return segment
      return {
        ...segment,
        mappings: segment.mappings.map((mapping) => {
          if (mapping.id !== mappingId) return mapping
          const next = { ...mapping, ...patch }
          if (patch.mode === 'prefix_value' && !next.token.trim()) {
            const prefix = segment.raw.match(/^([A-Za-z]+)/)?.[1] ?? ''
            next.token = prefix
          }
          return next
        }),
      }
    }))
  }

  const addMapping = (segmentIndex: number, raw: string) => {
    setSegments((prev) => prev.map((segment) => (
      segment.index === segmentIndex
        ? { ...segment, mappings: [...segment.mappings, createEmptyMapping(raw, 'nl_comments')] }
        : segment
    )))
  }

  const removeMapping = (segmentIndex: number, mappingId: string) => {
    setSegments((prev) => prev.map((segment) => (
      segment.index === segmentIndex
        ? { ...segment, mappings: segment.mappings.filter((mapping) => mapping.id !== mappingId) }
        : segment
    )))
  }

  const duplicateMapping = (segmentIndex: number, mappingId: string) => {
    setSegments((prev) => prev.map((segment) => {
      if (segment.index !== segmentIndex) return segment
      const source = segment.mappings.find((mapping) => mapping.id === mappingId)
      if (!source) return segment
      const clone: SegmentMappingDraft = {
        ...source,
        id: randomId('recipe-map'),
      }
      const sourceIndex = segment.mappings.findIndex((mapping) => mapping.id === mappingId)
      const nextMappings = [...segment.mappings]
      nextMappings.splice(sourceIndex + 1, 0, clone)
      return { ...segment, mappings: nextMappings }
    }))
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70">
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-5xl mx-4 flex flex-col max-h-[88vh] fixed left-1/2 top-1/2"
        style={{ transform: `translate(calc(-50% + ${dragOffset.x}px), calc(-50% + ${dragOffset.y}px))` }}
      >
        <div
          className="px-5 pt-5 pb-3 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 cursor-move select-none"
          onMouseDown={beginDrag}
        >
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">{title}</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Paste one example filename, then label what each segment means. NAM Lab will turn that into normal suggestion rules for you.
          </p>
        </div>

        <div className="px-5 py-4 flex-shrink-0 space-y-3 border-b border-gray-200 dark:border-gray-700">
          <div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">Example filename</div>
            <input
              value={example}
              onChange={(e) => setExample(e.target.value)}
              className="w-full px-3 py-2 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100"
              placeholder="Paste a real filename, e.g. JCM800 Lo P6 B8 M4 T7 G10"
            />
          </div>
          <div className="rounded border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/60 dark:bg-indigo-900/10 px-3 py-2 text-[11px] text-indigo-800 dark:text-indigo-200 space-y-1">
            <div><strong>How this works:</strong> segments are split on spaces. One segment can drive multiple metadata fields by adding more than one mapping row.</div>
            <div><strong>Prefix + value</strong> means match the letter part, then reuse the number part. Example: <code>B8</code> with token <code>B</code> and value <code>Bass {'{value}'}</code> becomes <code>Bass 8</code>.</div>
            <div><strong>Good fit:</strong> organized filename styles where each segment means something consistent across many captures.</div>
          </div>
        </div>

        <div className="px-5 py-4 flex-1 overflow-y-auto space-y-3">
          {segments.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-700 px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-500">
              Enter an example filename to start splitting it into segments.
            </div>
          ) : (
            segments.map((segment) => (
              <div key={segment.index} className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50/60 dark:bg-gray-900/30 p-3">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300">
                      Segment {segment.index}
                    </span>
                    <span className="font-medium text-sm text-gray-900 dark:text-gray-100">{segment.raw}</span>
                  </div>
                  <button
                    onClick={() => addMapping(segment.index, segment.raw)}
                    className="text-xs px-2.5 py-1 rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    Add mapping
                  </button>
                </div>

                {segment.index === 1 && (
                  <div className="grid grid-cols-1 md:grid-cols-[110px_minmax(0,0.95fr)_90px_minmax(0,1fr)_120px_auto_auto] gap-2 mb-1 px-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-600 select-none">
                    <span>Mode</span>
                    <span>Field</span>
                    <span>Token</span>
                    <span>Value</span>
                    <span>Look in</span>
                    <span />
                    <span />
                  </div>
                )}

                <div className="space-y-2">
                  {segment.mappings.map((mapping) => (
                    <div key={mapping.id} className="space-y-1.5">
                      <div className="grid grid-cols-1 md:grid-cols-[110px_minmax(0,0.95fr)_90px_minmax(0,1fr)_120px_auto_auto] gap-2 items-center">
                        <select
                          value={mapping.mode}
                          onChange={(e) => {
                            const mode = e.target.value as MappingMode
                            const patch: Partial<SegmentMappingDraft> = { mode }
                            if (mode === 'prefix_value') {
                              const prefix = segment.raw.match(/^([A-Za-z]+)/)?.[1] ?? mapping.token
                              patch.token = prefix
                              if (!mapping.value.trim() || mapping.value === mapping.token) {
                                patch.value = AMP_SETTING_PREFIX_LABELS[prefix.toLowerCase()] ?? '{match}'
                              }
                            } else if (mode === 'exact' && !mapping.token.trim()) {
                              patch.token = segment.raw
                            }
                            updateMapping(segment.index, mapping.id, patch)
                          }}
                          className="px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                        >
                          <option value="ignore">Ignore</option>
                          <option value="exact">Exact token</option>
                          <option value="prefix_value">Prefix + value</option>
                        </select>

                        <select
                          value={mapping.field}
                          onChange={(e) => updateMapping(segment.index, mapping.id, { field: e.target.value as MetadataSuggestField, value: METADATA_SUGGEST_LOOKUP_VALUES[e.target.value as MetadataSuggestField] ? '' : mapping.value })}
                          className="px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                        >
                          {FIELD_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>

                        <input
                          value={mapping.token}
                          onChange={(e) => updateMapping(segment.index, mapping.id, { token: e.target.value })}
                          disabled={mapping.mode === 'ignore'}
                          placeholder={mapping.mode === 'prefix_value' ? 'Prefix' : 'Token'}
                          className="px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 disabled:opacity-50"
                        />

                        {METADATA_SUGGEST_LOOKUP_VALUES[mapping.field] ? (
                          <select
                            value={mapping.value}
                            onChange={(e) => updateMapping(segment.index, mapping.id, { value: e.target.value })}
                            disabled={mapping.mode === 'ignore'}
                            className="px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 disabled:opacity-50"
                          >
                            <option value="">Pick value...</option>
                            {METADATA_SUGGEST_LOOKUP_VALUES[mapping.field]!.map((option) => (
                              <option key={option} value={option}>{option}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            value={mapping.value}
                            onChange={(e) => updateMapping(segment.index, mapping.id, { value: e.target.value })}
                            disabled={mapping.mode === 'ignore'}
                            placeholder={mapping.mode === 'prefix_value' ? 'Template, e.g. Gain {value}' : 'Value to write'}
                            className="px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 disabled:opacity-50"
                          />
                        )}

                        <select
                          value={mapping.matchIn}
                          onChange={(e) => updateMapping(segment.index, mapping.id, { matchIn: e.target.value as MetadataSuggestMatchIn })}
                          disabled={mapping.mode === 'ignore'}
                          className="px-2 py-1.5 text-xs rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 disabled:opacity-50"
                        >
                          <option value="filename">Filename only</option>
                          <option value="either">Filename or folder</option>
                          <option value="folder">Folder only</option>
                        </select>

                        <button
                          onClick={() => duplicateMapping(segment.index, mapping.id)}
                          className="text-gray-400 hover:text-indigo-500 transition-colors justify-self-center"
                          title="Duplicate mapping"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <rect x="9" y="9" width="10" height="10" rx="2" strokeWidth="1.8" />
                            <rect x="5" y="5" width="10" height="10" rx="2" strokeWidth="1.8" />
                          </svg>
                        </button>

                        <button
                          onClick={() => removeMapping(segment.index, mapping.id)}
                          className="text-gray-400 hover:text-red-500 transition-colors justify-self-center"
                          title="Remove mapping"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      {mapping.mode !== 'ignore' && mapping.value.trim() ? (
                        <div className="text-[11px] text-gray-500 dark:text-gray-400 pl-1">
                          Example output: <span className="text-indigo-700 dark:text-indigo-300 font-medium">{renderMappingExample(segment.raw, mapping)}</span>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between gap-3 flex-shrink-0">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {generatedRules.length} rule{generatedRules.length !== 1 ? 's' : ''} will be added.
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-4 py-1.5 text-sm rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm(generatedRules)}
              disabled={generatedRules.length === 0}
              className="px-4 py-1.5 text-sm rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Add rules
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
