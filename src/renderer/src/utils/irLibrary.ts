/**
 * Favourites and recents for the cabinet IR picker.
 *
 * A bought IR library is hundreds of thousands of files, of which any one player uses perhaps a
 * dozen. Search finds anything; these two lists are what stop you having to search for the same
 * cab every single time. Stored in localStorage next to the chosen IR path (see diSelection.ts)
 * so the player and the Tone Map agree on them.
 */

const FAVORITES_KEY = 'nam-player-ir-favorites'
const RECENTS_KEY = 'nam-player-ir-recents'

/** Kept short deliberately — a recents list you have to scroll is just a worse search. */
export const MAX_RECENTS = 12

export interface IrRef {
  /** Absolute path, the thing that actually gets loaded. */
  path: string
  /** Path relative to the library root, which is what the user recognises. */
  rel: string
}

function read(key: string): IrRef[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    // Entries are only useful if they can still be loaded and labelled.
    return parsed.filter(
      (e): e is IrRef =>
        typeof e === 'object' && e !== null &&
        typeof (e as IrRef).path === 'string' && typeof (e as IrRef).rel === 'string'
    )
  } catch {
    return []
  }
}

function write(key: string, refs: IrRef[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(refs))
  } catch {
    // Non-fatal: a full or unavailable store shouldn't break picking an IR.
  }
}

export function loadIrFavorites(): IrRef[] {
  return read(FAVORITES_KEY)
}

export function isIrFavorite(path: string, favorites = loadIrFavorites()): boolean {
  return favorites.some((f) => f.path === path)
}

/** Add or remove a favourite, returning the new list so callers can set state from it. */
export function toggleIrFavorite(ref: IrRef): IrRef[] {
  const current = loadIrFavorites()
  const next = current.some((f) => f.path === ref.path)
    ? current.filter((f) => f.path !== ref.path)
    : [...current, ref].sort((a, b) => a.rel.localeCompare(b.rel))
  write(FAVORITES_KEY, next)
  return next
}

export function loadIrRecents(): IrRef[] {
  return read(RECENTS_KEY)
}

/**
 * Record a use, most-recent first.
 *
 * Re-picking an IR moves it to the top rather than adding a duplicate, so the list reflects what
 * you reach for rather than how many times you happened to click it.
 */
export function pushIrRecent(ref: IrRef): IrRef[] {
  const next = [ref, ...loadIrRecents().filter((r) => r.path !== ref.path)].slice(0, MAX_RECENTS)
  write(RECENTS_KEY, next)
  return next
}

/**
 * Split a relative path into the folder trail and the file name, for two-line display.
 *
 * Handles both separators: the index is built with the platform's, but a list persisted on one
 * machine can be read on another.
 */
export function splitIrRel(rel: string): { folder: string; name: string } {
  const parts = rel.split(/[\\/]/)
  const name = parts.pop() ?? rel
  return { folder: parts.join(' / '), name: name.replace(/\.wav$/i, '') }
}
