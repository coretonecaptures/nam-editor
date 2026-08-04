/**
 * Favourites and recents for any short, user-facing pick list — presets and the pedal-capture
 * picker. Same idea as irLibrary.ts's IR favourites/recents, generalized: there, a library is
 * hundreds of thousands of files and these two lists are what stop you searching for the same
 * cab every time; here the list itself is short (a handful of saved presets), so the value is
 * "surface what I actually reach for" rather than "avoid a search."
 *
 * Deliberately its own localStorage side-table rather than a field on the preset objects
 * themselves (ChorusPreset/DelayPreset/etc.): favouriting is a per-device convenience, not
 * something that belongs in the exported/shared settings, and keeping it separate means adding
 * favourites never touches the preset data model or its persistence path.
 */

export interface FavRef {
  id: string
  label: string
}

/** Kept short deliberately — a recents list you have to scroll is just a worse "pick from all". */
export const MAX_RECENTS = 6

function favKey(kind: string): string {
  return `nam-player-favorites-${kind}`
}
function recentKey(kind: string): string {
  return `nam-player-recents-${kind}`
}

function read(key: string): FavRef[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (e): e is FavRef =>
        typeof e === 'object' && e !== null &&
        typeof (e as FavRef).id === 'string' && typeof (e as FavRef).label === 'string'
    )
  } catch {
    return []
  }
}

function write(key: string, refs: FavRef[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(refs))
  } catch {
    // Non-fatal: a full or unavailable store shouldn't break picking a preset.
  }
}

export function loadFavorites(kind: string): FavRef[] {
  return read(favKey(kind))
}

export function isFavorite(kind: string, id: string, favorites = loadFavorites(kind)): boolean {
  return favorites.some((f) => f.id === id)
}

/** Add or remove a favourite, returning the new list so callers can set state from it. */
export function toggleFavorite(kind: string, ref: FavRef): FavRef[] {
  const current = loadFavorites(kind)
  const next = current.some((f) => f.id === ref.id)
    ? current.filter((f) => f.id !== ref.id)
    : [...current, ref].sort((a, b) => a.label.localeCompare(b.label))
  write(favKey(kind), next)
  return next
}

/** Drop a favourite whose underlying item no longer exists (a preset that got deleted). */
export function pruneFavorites(kind: string, liveIds: Set<string>): FavRef[] {
  const next = loadFavorites(kind).filter((f) => liveIds.has(f.id))
  write(favKey(kind), next)
  return next
}

export function loadRecents(kind: string): FavRef[] {
  return read(recentKey(kind))
}

/**
 * Record a use, most-recent first.
 *
 * Re-picking something moves it to the top rather than adding a duplicate, so the list reflects
 * what you reach for rather than how many times you happened to click it.
 */
export function pushRecent(kind: string, ref: FavRef): FavRef[] {
  const next = [ref, ...loadRecents(kind).filter((r) => r.id !== ref.id)].slice(0, MAX_RECENTS)
  write(recentKey(kind), next)
  return next
}

export function pruneRecents(kind: string, liveIds: Set<string>): FavRef[] {
  const next = loadRecents(kind).filter((f) => liveIds.has(f.id))
  write(recentKey(kind), next)
  return next
}
