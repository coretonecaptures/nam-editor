/**
 * Gear-vocabulary dictionary for the generic filename-inference parser (genericVocabulary.ts).
 * Plain data, deliberately — docs/ir-lab-manager-build-plan.md section 6: "the dictionary should
 * be a plain data file from day one," so user-added terms later (not v1) are additive, not a
 * rewrite. Terms are matched as whole tokens (word-boundary, case-insensitive) against a
 * filename or path segment — see genericVocabulary.ts for the matching logic itself.
 *
 * Not exhaustive — covers the mics/speakers/brands actually common in real third-party IR packs
 * (cross-checked against Ownhammer/RedWirez pack names on a real library during Phase 3
 * development). Extend as new terms are found in the wild, not from a spec.
 */

/** Mic model numbers/names. Matched first and treated as the strongest single-token signal —
 * a mic model number essentially never collides with a cabinet or speaker name. */
export const MICROPHONE_TERMS: string[] = [
  'SM57', 'SM7B', 'SM7', 'MD421', 'MD 421', 'MD-421', 'MD441', 'E906', 'E609', 'RE20',
  'KM184', 'C414', 'U87', 'R121', '121', 'R-121', 'D112', 'AKG D112', 'RE320',
  'MD160', 'M160', 'M88', 'AT4050',
  // Found live against a real RedWirez bass-cab pack during Phase 3 validation — D12 (no "1")
  // is AKG/Audix's distinct kick/bass mic, not the same model as D112.
  'D12', 'D6', 'M380', 'TC30', 'e602', 'PR40'
]

/** Speaker models — distinct from cabinet/amp brand; a cab can carry any of these speakers. */
export const SPEAKER_TERMS: string[] = [
  'Greenback', 'G12M', 'G12H', 'G12T-75', 'G12T75', 'G12-65', 'G1265', 'V30', 'V-30',
  'Vintage 30', 'G12K-100', 'G12K100', 'V-Type', 'VType', 'Creamback', 'C90', 'C12K',
  'Legend', 'Eminence'
]

/** Cabinet/amp manufacturer brands. */
export const MANUFACTURER_TERMS: string[] = [
  'Marshall', 'Mesa', 'Mesa Boogie', 'Bogner', 'Friedman', 'Orange', 'Fender', 'Vox',
  'Peavey', 'EVH', 'Diezel', 'Engl', 'ENGL', 'Ampeg', 'Hiwatt', 'Soldano', 'Rivera',
  'Dr. Z', 'Dr Z', 'Two-Rock', 'Suhr', 'Victory', 'Laney', 'Cornford', 'Splawn',
  'Hartke' // found live against a real RedWirez bass-cab pack during Phase 3 validation
]
