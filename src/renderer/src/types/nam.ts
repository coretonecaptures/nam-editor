export interface NamDate {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

export interface NamMetadata {
  date?: NamDate
  loudness?: number | null
  gain?: number | null
  name?: string | null
  modeled_by?: string | null
  gear_type?: string | null
  gear_make?: string | null
  gear_model?: string | null
  tone_type?: string | null
  input_level_dbu?: number | null
  output_level_dbu?: number | null
  training?: unknown
}

export interface NamFile {
  filePath: string
  fileName: string
  version: string
  metadata: NamMetadata
  originalMetadata: NamMetadata  // raw values from file before any defaults applied
  architecture: string
  config: unknown
  isDirty: boolean
  loadError?: string
}

export const GEAR_TYPES = ['amp', 'pedal', 'cab', 'preamp', 'di', 'other'] as const
export const TONE_TYPES = [
  'clean',
  'crunch',
  'hi_gain',
  'fuzz',
  'overdrive',
  'distortion',
  'other'
] as const
