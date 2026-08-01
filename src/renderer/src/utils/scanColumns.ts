/**
 * Which metadata columns the scan list shows at a given width.
 *
 * The list sits in a resizable panel, so "what fits" is a runtime question, not a breakpoint one —
 * Tailwind's responsive prefixes key off the viewport, which is the wrong axis here. The panel is
 * measured instead and columns are dropped from the right as it narrows, so a wide panel earns
 * real information and a narrow one degrades to a name and nothing else rather than to six
 * truncated ellipses.
 *
 * Order below IS the priority order: earlier columns survive longer.
 */

import type { NamFile } from '../types/nam'

export type ScanColumnId =
  | 'gear'
  | 'tone'
  | 'gearType'
  | 'cab'
  | 'settings'
  | 'mics'
  | 'esr'

export interface ScanColumnSpec {
  id: ScanColumnId
  label: string
  /** Width in px when shown. */
  width: number
  /** Right-aligned columns are numeric; the rest read as text. */
  numeric?: boolean
}

/**
 * Ranked by how much each one helps you tell two captures apart by eye.
 *
 * Gear first because it is the thing you are usually scanning for. Settings is wide but sparse —
 * most captures have no `nl_amp_settings` — so it sits behind the fields that are nearly always
 * populated, or narrow panels would spend their space on blanks.
 */
export const SCAN_COLUMNS: ScanColumnSpec[] = [
  { id: 'gear', label: 'Gear', width: 150 },
  { id: 'tone', label: 'Tone', width: 82 },
  { id: 'gearType', label: 'Type', width: 104 },
  { id: 'cab', label: 'Cabinet', width: 148 },
  { id: 'esr', label: 'ESR', width: 66, numeric: true },
  { id: 'settings', label: 'Settings', width: 172 },
  { id: 'mics', label: 'Mics', width: 124 }
]

/** Space the name column keeps for itself before any other column may appear. */
export const NAME_MIN_WIDTH = 190
/** Ready dot, row padding and the inter-column gaps. */
const ROW_CHROME_WIDTH = 46

/**
 * The columns that fit, in priority order.
 *
 * Always returns a (possibly empty) list; the name column is not included because it is never
 * dropped — it is what identifies the row.
 */
export function visibleScanColumns(panelWidth: number): ScanColumnId[] {
  if (!Number.isFinite(panelWidth) || panelWidth <= 0) return []
  let used = NAME_MIN_WIDTH + ROW_CHROME_WIDTH
  const visible: ScanColumnId[] = []
  for (const column of SCAN_COLUMNS) {
    if (used + column.width > panelWidth) break
    used += column.width
    visible.push(column.id)
  }
  return visible
}

/** CSS grid template for a row: the name takes the slack, each column its fixed width. */
export function scanGridTemplate(visible: ScanColumnId[]): string {
  const widths = visible.map((id) => {
    const spec = SCAN_COLUMNS.find((c) => c.id === id)
    return `${spec ? spec.width : 100}px`
  })
  return ['minmax(0, 1fr)', ...widths].join(' ')
}

const TONE_LABELS: Record<string, string> = {
  clean: 'Clean',
  crunch: 'Crunch',
  overdrive: 'Overdrive',
  distortion: 'Distortion',
  hi_gain: 'Hi Gain',
  fuzz: 'Fuzz',
  other: 'Other'
}

/**
 * Short gear labels.
 *
 * Deliberately not the Tone Map facet labels, which append "(needs cab)" — useful when choosing
 * what to audition, far too long for a 104px column.
 */
const GEAR_LABELS: Record<string, string> = {
  amp: 'Amp',
  preamp: 'Preamp',
  pedal: 'Pedal',
  pedal_amp: 'Pedal + Amp',
  amp_cab: 'Amp + Cab',
  amp_pedal_cab: 'Amp + Pedal + Cab',
  studio: 'Studio'
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** The displayed value for one column, or '' when the capture has nothing for it. */
export function scanColumnValue(file: NamFile, id: ScanColumnId): string {
  const m = file.metadata as Record<string, unknown>
  switch (id) {
    case 'gear': {
      const make = text(m.gear_make)
      const model = text(m.gear_model)
      return [make, model].filter(Boolean).join(' ')
    }
    case 'tone': {
      const tone = text(m.tone_type)
      return tone ? (TONE_LABELS[tone] ?? tone.replace(/_/g, ' ')) : ''
    }
    case 'gearType': {
      const gear = text(m.gear_type)
      return gear ? (GEAR_LABELS[gear] ?? gear.replace(/_/g, ' ')) : ''
    }
    case 'cab': {
      // The config ("2x12 open back") is meaningless without the cab it describes, so it only
      // ever appears alongside it.
      const cab = text(m.nl_cabinet)
      const config = text(m.nl_cabinet_config)
      if (cab && config) return `${cab} · ${config}`
      return cab || config
    }
    case 'settings':
      return text(m.nl_amp_settings)
    case 'mics':
      return text(m.nl_mics)
    case 'esr':
      return ''
    default:
      return ''
  }
}
