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
  nb_trained_epochs?: number | null
  nb_preset_name?: string | null
  // NAM Lab extended capture details (stored in metadata.nam_lab.*)
  nl_mics?: string | null
  nl_cabinet?: string | null
  nl_cabinet_config?: string | null
  nl_amp_channel?: string | null
  nl_boost_pedal?: string | null
  nl_amp_settings?: string | null
  nl_pedal_settings?: string | null
  nl_amp_switches?: string | null
  nl_comments?: string | null
  nl_rating?: number | null
}

export interface NamFile {
  filePath: string
  fileName: string
  version: string
  metadata: NamMetadata
  originalMetadata: NamMetadata  // raw values from file before any defaults applied
  autoFilledFields: (keyof NamMetadata)[]  // fields set by settings rules at load time
  architecture: string
  config: unknown
  isDirty: boolean
  mtimeMs?: number
  loadError?: string
}

export const GEAR_TYPES = ['amp', 'pedal', 'pedal_amp', 'amp_cab', 'amp_pedal_cab', 'preamp', 'studio'] as const
export const TONE_TYPES = [
  'clean',
  'crunch',
  'hi_gain',
  'fuzz',
  'overdrive',
  'distortion',
  'other'
] as const
