import { useMemo } from 'react'
import { NamFile } from '../types/nam'
import { detectPreset } from '../utils/detectPreset'
import * as XLSX from 'xlsx'

interface Props {
  files: NamFile[]
  folderPath: string
  prefixSuffixes: string  // e.g. "DI" from settings.importPrefixSuffixes
  onClose: () => void
}

interface CoverageCell {
  fileName: string
  variant: string        // capture name suffix after the base (e.g. "Mars2", "DI HYPER", "")
  epochs: number | null
}

interface CoverageRow {
  baseName: string
  gearTypes: string[]
  subfolders: string[]
  cells: Record<string, CoverageCell[]>  // array: multiple captures can share same base+preset
}

const DI_GEAR_TYPES = new Set(['amp', 'pedal_amp'])
const CAB_GEAR_TYPES = new Set(['amp_cab', 'amp_pedal_cab'])

function relativeSubfolder(filePath: string, rootPath: string): string {
  const fp = filePath.replace(/\\/g, '/')
  const rp = rootPath.replace(/\\/g, '/').replace(/\/$/, '')
  const dir = fp.includes('/') ? fp.substring(0, fp.lastIndexOf('/')) : fp
  if (dir.toLowerCase().startsWith(rp.toLowerCase())) {
    const rel = dir.slice(rp.length).replace(/^\//, '')
    return rel || '/'
  }
  return dir
}

function buildRows(
  files: NamFile[],
  folderPath: string,
  prefixSuffixSet: Set<string>
): { diRows: CoverageRow[]; cabRows: CoverageRow[]; presets: string[] } {
  const norm = folderPath.replace(/\\/g, '/')
  const scoped = files.filter((f) => {
    const fp = f.filePath.replace(/\\/g, '/')
    return fp.startsWith(norm + '/') || fp.startsWith(norm + '\\')
  })

  const presetSet = new Set<string>()
  let hasUnknown = false

  // Strip suffix from name if present
  function stripSuffix(raw: string): string | null {
    const words = raw.split(/\s+/)
    const last = words[words.length - 1]?.toUpperCase() ?? ''
    return prefixSuffixSet.has(last) ? words.slice(0, -1).join(' ') : null
  }

  // Resolve base name: suffix-strip wins; else longest known-base prefix wins; else full name
  function resolveBaseName(f: NamFile, knownBases: string[]): string {
    const raw = (f.metadata.name || f.fileName || '').trim()
    const stripped = stripSuffix(raw)
    if (stripped !== null) return stripped
    const rawLower = raw.toLowerCase()
    for (const base of knownBases) {  // sorted longest-first
      const bl = base.toLowerCase()
      if (rawLower === bl || rawLower.startsWith(bl + ' ')) return base
    }
    return raw
  }

  function getCabBaseName(f: NamFile, diBaseNames: string[]): string | null {
    const raw = (f.metadata.name || f.fileName || '').trim().toLowerCase()
    for (const base of diBaseNames) {
      const bl = base.toLowerCase()
      if (raw === bl || raw.startsWith(bl + ' ')) return base
    }
    return null
  }

  // Pass 1: collect base names from suffix-bearing DI files only
  const diFiles = scoped.filter((f) => DI_GEAR_TYPES.has(f.metadata.gear_type ?? ''))
  const diBaseNameSet = new Set<string>()
  for (const f of diFiles) {
    const raw = (f.metadata.name || f.fileName || '').trim()
    const stripped = stripSuffix(raw)
    if (stripped !== null) diBaseNameSet.add(stripped)
  }
  // Pass 2: resolve all DI files (including non-suffix variants like "DI HYPER")
  const diBaseNames = [...diBaseNameSet].sort((a, b) => b.length - a.length)

  function getVariant(f: NamFile, base: string): string {
    const raw = (f.metadata.name || f.fileName || '').trim()
    const baseLower = base.toLowerCase()
    const rawLower = raw.toLowerCase()
    if (rawLower === baseLower) return ''
    if (rawLower.startsWith(baseLower + ' ')) return raw.slice(base.length + 1).trim()
    return raw
  }

  // Accumulator maps: base → { cells, gearTypes, subfolders }
  type RowAccum = { cells: Map<string, CoverageCell[]>; gearTypes: Set<string>; subfolders: Set<string> }
  const diAccum = new Map<string, RowAccum>()
  const cabAccum = new Map<string, RowAccum>()

  function getOrCreate(map: Map<string, RowAccum>, key: string): RowAccum {
    if (!map.has(key)) map.set(key, { cells: new Map(), gearTypes: new Set(), subfolders: new Set() })
    return map.get(key)!
  }

  for (const f of diFiles) {
    const base = resolveBaseName(f, diBaseNames)
    const preset = detectPreset(f.config)
    const key = preset ?? '(Unknown)'
    if (preset) presetSet.add(preset)
    else hasUnknown = true

    const accum = getOrCreate(diAccum, base)
    const entry: CoverageCell = {
      fileName: f.fileName,
      variant: getVariant(f, base),
      epochs: typeof f.metadata.nb_trained_epochs === 'number' ? f.metadata.nb_trained_epochs : null,
    }
    const existing = accum.cells.get(key) ?? []
    accum.cells.set(key, [...existing, entry])
    if (f.metadata.gear_type) accum.gearTypes.add(f.metadata.gear_type)
    accum.subfolders.add(relativeSubfolder(f.filePath, folderPath))
  }

  const cabFiles = scoped.filter((f) => CAB_GEAR_TYPES.has(f.metadata.gear_type ?? ''))
  for (const f of cabFiles) {
    const base = getCabBaseName(f, diBaseNames)
    if (!base) continue
    const preset = detectPreset(f.config)
    const key = preset ?? '(Unknown)'
    if (preset) presetSet.add(preset)
    else hasUnknown = true

    const accum = getOrCreate(cabAccum, base)
    const entry: CoverageCell = {
      fileName: f.fileName,
      variant: getVariant(f, base),
      epochs: typeof f.metadata.nb_trained_epochs === 'number' ? f.metadata.nb_trained_epochs : null,
    }
    const existing = accum.cells.get(key) ?? []
    accum.cells.set(key, [...existing, entry])
    if (f.metadata.gear_type) accum.gearTypes.add(f.metadata.gear_type)
    accum.subfolders.add(relativeSubfolder(f.filePath, folderPath))
  }

  // Sorted preset columns (canonical order + Unknown last)
  const PRESET_ORDER = ['Standard', 'REVxSTD', 'Complex', 'Lite', 'Feather', 'Nano', 'REVySTD', 'REVyHI']
  const sortedPresets = [
    ...PRESET_ORDER.filter((p) => presetSet.has(p)),
    ...[...presetSet].filter((p) => !PRESET_ORDER.includes(p)).sort(),
  ]
  if (hasUnknown) sortedPresets.push('(Unknown)')

  const makeRows = (map: Map<string, RowAccum>): CoverageRow[] =>
    [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([baseName, { cells, gearTypes, subfolders }]) => ({
        baseName,
        gearTypes: [...gearTypes].sort(),
        subfolders: [...subfolders].sort(),
        cells: Object.fromEntries(sortedPresets.map((p) => [p, cells.get(p) ?? []])),
      }))

  return { diRows: makeRows(diAccum), cabRows: makeRows(cabAccum), presets: sortedPresets }
}

function exportToSheet(
  rows: CoverageRow[],
  presets: string[],
  label: string,
  format: 'csv' | 'xlsx',
  folderName: string
) {
  const header = ['Base Name', 'Type', 'Folder', ...presets]
  const data = [header, ...rows.map((r) => [
    r.baseName,
    r.gearTypes.join(', '),
    r.subfolders.join(', '),
    ...presets.map((p) => {
      const arr = r.cells[p]
      if (!arr || arr.length === 0) return ''
      return arr.map((c) => {
        const label = c.variant || '✓'
        return c.epochs != null ? `${label} (${c.epochs})` : label
      }).join(' / ')
    }),
  ])]

  const ws = XLSX.utils.aoa_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, label)

  const fileName = `${folderName}_coverage_${label.toLowerCase().replace(/\s+/g, '_')}`
  if (format === 'csv') {
    XLSX.writeFile(wb, fileName + '.csv')
  } else {
    XLSX.writeFile(wb, fileName + '.xlsx')
  }
}

function CoverageTable({ rows, presets, emptyMsg }: { rows: CoverageRow[]; presets: string[]; emptyMsg: string }) {
  if (rows.length === 0) {
    return <p className="text-xs text-gray-500 py-4 text-center">{emptyMsg}</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="text-xs w-full border-collapse">
        <thead>
          <tr>
            <th className="text-left px-3 py-2 bg-gray-800 text-gray-400 font-medium border border-gray-700 whitespace-nowrap sticky left-0">
              Base Name
            </th>
            <th className="text-left px-3 py-2 bg-gray-800 text-gray-400 font-medium border border-gray-700 whitespace-nowrap">
              Type
            </th>
            <th className="text-left px-3 py-2 bg-gray-800 text-gray-400 font-medium border border-gray-700 whitespace-nowrap">
              Folder
            </th>
            {presets.map((p) => (
              <th key={p} className="px-3 py-2 bg-gray-800 text-gray-400 font-medium border border-gray-700 whitespace-nowrap text-center">
                {p}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.baseName} className="hover:bg-gray-800/50">
              <td className="px-3 py-1.5 border border-gray-700 text-gray-200 whitespace-nowrap sticky left-0 bg-gray-900">
                {row.baseName}
              </td>
              <td className="px-3 py-1.5 border border-gray-700 text-gray-400 whitespace-nowrap">
                {row.gearTypes.join(', ')}
              </td>
              <td className="px-3 py-1.5 border border-gray-700 text-gray-400 whitespace-nowrap max-w-[200px] truncate" title={row.subfolders.join(', ')}>
                {row.subfolders.join(', ')}
              </td>
              {presets.map((p) => {
                const arr = row.cells[p]
                return (
                  <td key={p} className="px-3 py-1.5 border border-gray-700 text-center whitespace-nowrap">
                    {arr && arr.length > 0 ? (
                      <div className="flex flex-col gap-0.5 items-center">
                        {arr.map((c, i) => (
                          <span key={i} className="text-green-400 font-medium" title={c.fileName}>
                            {c.variant || '✓'}{c.epochs != null ? ` (${c.epochs})` : ''}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-gray-700">—</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function TrainingCoverageModal({ files, folderPath, prefixSuffixes, onClose }: Props) {
  const prefixSuffixSet = useMemo(
    () => new Set(prefixSuffixes.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)),
    [prefixSuffixes]
  )

  const folderName = folderPath.replace(/\\/g, '/').split('/').pop() ?? 'folder'

  const { diRows, cabRows, presets } = useMemo(
    () => buildRows(files, folderPath, prefixSuffixSet),
    [files, folderPath, prefixSuffixSet]
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl flex flex-col w-[90vw] max-w-5xl max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800 flex-shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-gray-100">Training Version Report</h2>
            <p className="text-xs text-gray-500 mt-0.5 truncate max-w-lg">{folderPath}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-300 transition-colors ml-4 flex-shrink-0"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* DI table */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                DI Captures (amp / pedal_amp) — {diRows.length} base{diRows.length !== 1 ? 's' : ''}
              </h3>
              {diRows.length > 0 && (
                <div className="flex gap-2">
                  <button
                    onClick={() => exportToSheet(diRows, presets, 'DI', 'csv', folderName)}
                    className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2.5 py-1 rounded transition-colors"
                  >
                    Export CSV
                  </button>
                  <button
                    onClick={() => exportToSheet(diRows, presets, 'DI', 'xlsx', folderName)}
                    className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2.5 py-1 rounded transition-colors"
                  >
                    Export Excel
                  </button>
                </div>
              )}
            </div>
            <CoverageTable rows={diRows} presets={presets} emptyMsg="No DI captures (amp / pedal_amp) found in this folder." />
          </section>

          <div className="border-t border-gray-800" />

          {/* Amp+Cab table */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Amp+Cab Captures (amp_cab / amp_pedal_cab) — {cabRows.length} base{cabRows.length !== 1 ? 's' : ''}
              </h3>
              {cabRows.length > 0 && (
                <div className="flex gap-2">
                  <button
                    onClick={() => exportToSheet(cabRows, presets, 'Amp+Cab', 'csv', folderName)}
                    className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2.5 py-1 rounded transition-colors"
                  >
                    Export CSV
                  </button>
                  <button
                    onClick={() => exportToSheet(cabRows, presets, 'Amp+Cab', 'xlsx', folderName)}
                    className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2.5 py-1 rounded transition-colors"
                  >
                    Export Excel
                  </button>
                </div>
              )}
            </div>
            <CoverageTable rows={cabRows} presets={presets} emptyMsg="No Amp+Cab captures (amp_cab / amp_pedal_cab) found in this folder." />
          </section>
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-5 py-3 border-t border-gray-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
