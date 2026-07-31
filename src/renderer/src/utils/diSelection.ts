/**
 * Which DI clip captures are auditioned through.
 *
 * The player owns the picker, but the Tone Map needs to hear captures through the *same* clip —
 * otherwise the two parts of the app would disagree about what a capture sounds like. Both read
 * this one localStorage key rather than passing the choice down through props, so a clip picked
 * in the player is immediately what the map auditions with.
 */

export const DI_PREFS_KEY = 'nam-player-di-prefs'

export interface DiPrefs {
  /** Chosen clip per folder, so switching folders and back keeps your pick. */
  byCategory: Record<string, string>
  activeCategory: string | null
}

export interface DiCategoryLike {
  name: string
  files: Array<{ name: string; path: string }>
}

export function loadDiPrefs(): DiPrefs {
  try {
    const raw = localStorage.getItem(DI_PREFS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DiPrefs>
      return { byCategory: parsed.byCategory ?? {}, activeCategory: parsed.activeCategory ?? null }
    }
  } catch {
    // Corrupt or unavailable storage shouldn't stop playback from working.
  }
  return { byCategory: {}, activeCategory: null }
}

export function saveDiPrefs(prefs: DiPrefs): void {
  try {
    localStorage.setItem(DI_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // Non-fatal.
  }
}

/** The remembered clip for a folder, falling back to its first clip. */
export function clipForCategory(category: DiCategoryLike, prefs: DiPrefs): string | null {
  const remembered = prefs.byCategory[category.name]
  if (remembered && category.files.some((f) => f.path === remembered)) return remembered
  return category.files[0]?.path ?? null
}

/**
 * The clip currently selected, or null when no DI library is configured.
 *
 * Falls back to the first folder when the remembered one has gone away, so a renamed or deleted
 * DI folder degrades to "something plays" rather than silence with no explanation.
 */
export function resolveActiveDiClip(
  categories: DiCategoryLike[],
  prefs: DiPrefs = loadDiPrefs()
): string | null {
  if (categories.length === 0) return null
  const active = categories.find((c) => c.name === prefs.activeCategory) ?? categories[0]
  return clipForCategory(active, prefs)
}
