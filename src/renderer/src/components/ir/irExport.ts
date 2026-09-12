import * as XLSX from 'xlsx'

/**
 * IR catalog spreadsheet export (audit finding B6) — same client-side Blob+anchor approach
 * FileList.tsx already uses for NAM mode's export, just against the row shape
 * `irLibrary:queryForExport` returns instead of `NamFile`.
 */
export interface IrExportRow {
  display_name: string
  manufacturer: string | null
  cabinet: string | null
  speaker: string | null
  microphone: string | null
  sample_rate: number | null
  bit_depth: number | null
  channels: number | null
  duration_seconds: number | null
  is_favorite: number
  rating: number | null
  abs_path: string
}

const COLUMNS: Array<{ label: string; get: (row: IrExportRow) => string }> = [
  { label: 'Name', get: (r) => r.display_name.replace(/\.wav$/i, '') },
  { label: 'Manufacturer', get: (r) => r.manufacturer ?? '' },
  { label: 'Cabinet', get: (r) => r.cabinet ?? '' },
  { label: 'Speaker', get: (r) => r.speaker ?? '' },
  { label: 'Microphone', get: (r) => r.microphone ?? '' },
  { label: 'Sample Rate', get: (r) => (r.sample_rate != null ? String(r.sample_rate) : '') },
  { label: 'Bit Depth', get: (r) => (r.bit_depth != null ? String(r.bit_depth) : '') },
  { label: 'Channels', get: (r) => (r.channels != null ? String(r.channels) : '') },
  { label: 'Duration (s)', get: (r) => (r.duration_seconds != null ? r.duration_seconds.toFixed(2) : '') },
  { label: 'Favorite', get: (r) => (r.is_favorite ? 'Yes' : '') },
  { label: 'Rating', get: (r) => (r.rating != null ? String(r.rating) : '') },
  { label: 'Path', get: (r) => r.abs_path }
]

function buildRows(items: IrExportRow[]): Record<string, string>[] {
  return items.map((item) => {
    const row: Record<string, string> = {}
    for (const col of COLUMNS) row[col.label] = col.get(item)
    return row
  })
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function exportIrCatalogCSV(items: IrExportRow[], filename: string): void {
  const headers = COLUMNS.map((c) => c.label)
  const rows = buildRows(items)
  const lines = [
    headers.map((h) => `"${h.replace(/"/g, '""')}"`).join(','),
    ...rows.map((r) =>
      headers
        .map((h) => {
          const v = r[h] ?? ''
          return v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v.replace(/"/g, '""')}"` : v
        })
        .join(',')
    )
  ]
  download(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' }), filename)
}

export function exportIrCatalogXLSX(items: IrExportRow[], filename: string): void {
  const rows = buildRows(items)
  const ws = XLSX.utils.json_to_sheet(rows, { header: COLUMNS.map((c) => c.label) })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'IR Library')
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer
  download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename)
}
