import ampDark from './amp.dark.png'
import ampLight from './amp.light.png'
import ampCabDark from './amp_cab.dark.png'
import ampCabLight from './amp_cab.light.png'
import pedalDark from './pedal.dark.png'
import pedalLight from './pedal.light.png'
import pedalAmpDark from './pedal_amp.dark.png'
import pedalAmpLight from './pedal_amp.light.png'
import ampPedalCabDark from './amp_pedal_cab.dark.png'
import ampPedalCabLight from './amp_pedal_cab.light.png'
import preampDark from './preamp.dark.png'
import preampLight from './preamp.light.png'
import studioDark from './studio.dark.png'
import studioLight from './studio.light.png'

export const gearImages: Record<string, { dark: string; light?: string }> = {
  amp:           { dark: ampDark,         light: ampLight },
  amp_cab:       { dark: ampCabDark,      light: ampCabLight },
  pedal:         { dark: pedalDark,       light: pedalLight },
  pedal_amp:     { dark: pedalAmpDark,    light: pedalAmpLight },
  amp_pedal_cab: { dark: ampPedalCabDark, light: ampPedalCabLight },
  preamp:        { dark: preampDark,      light: preampLight },
  studio:        { dark: studioDark,      light: studioLight },
}

/** Returns the correct src URL for the current theme */
export function getGearImageSrc(gearType: string): string | null {
  const imgs = gearImages[gearType]
  if (!imgs) return null
  const isDark = document.documentElement.classList.contains('dark')
  return isDark ? imgs.dark : (imgs.light ?? imgs.dark)
}

// ---- Gear type chip classes ----

const GEAR_SUBTLE: Record<string, string> = {
  amp:           'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400',
  amp_cab:       'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400',
  pedal:         'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400',
  pedal_amp:     'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400',
  amp_pedal_cab: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400',
  preamp:        'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400',
  studio:        'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400',
}

const GEAR_SOLID: Record<string, string> = {
  amp:           'bg-orange-500 text-white',
  amp_cab:       'bg-blue-500 text-white',
  pedal:         'bg-green-500 text-white',
  pedal_amp:     'bg-yellow-500 text-white',
  amp_pedal_cab: 'bg-purple-500 text-white',
  preamp:        'bg-rose-500 text-white',
  studio:        'bg-teal-500 text-white',
}

export function gearChipClass(gearType: string, solid = false): string {
  if (solid) return GEAR_SOLID[gearType] ?? 'bg-gray-500 text-white'
  return GEAR_SUBTLE[gearType] ?? 'bg-gray-200 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
}

// ---- Tone type chip classes ----

const TONE_SUBTLE: Record<string, string> = {
  clean:      'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400',
  crunch:     'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400',
  hi_gain:    'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400',
  fuzz:       'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400',
  overdrive:  'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400',
  distortion: 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400',
  other:      'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400',
}

const TONE_SOLID: Record<string, string> = {
  clean:      'bg-sky-500 text-white',
  crunch:     'bg-amber-500 text-white',
  hi_gain:    'bg-red-600 text-white',
  fuzz:       'bg-purple-600 text-white',
  overdrive:  'bg-green-600 text-white',
  distortion: 'bg-rose-500 text-white',
  other:      'bg-gray-500 text-white',
}

export function toneChipClass(toneType: string, solid = false): string {
  if (solid) return TONE_SOLID[toneType] ?? 'bg-gray-500 text-white'
  return TONE_SUBTLE[toneType] ?? 'bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-400'
}
