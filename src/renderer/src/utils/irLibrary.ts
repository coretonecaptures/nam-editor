/**
 * Favourites and recents for the IR pickers — Cab, Delay convolution, and Reverb convolution.
 *
 * A bought IR library is hundreds of thousands of files, of which any one player uses perhaps a
 * dozen. Search finds anything; these two lists are what stop you having to search for the same
 * cab every single time.
 *
 * Namespaced per picker `kind` ('cab' | 'delay' | 'reverb') — these used to share one global key
 * regardless of which picker was open, so favouriting a delay impulse made it show up in the Cab
 * IR picker's favourites too. The one-time migration below moves whatever was in that shared list
 * into 'cab' specifically, since Cab IR was the original and by far the most-used of the three;
 * it is an imperfect guess for anyone who had favourited delay/reverb impulses before this fix,
 * but there is no way to know after the fact which of the mixed-together entries were "for" which
 * picker, and losing them silently would be worse than a one-time, mostly-right guess.
 */

const FAVORITES_KEY = 'nam-player-ir-favorites'
const RECENTS_KEY = 'nam-player-ir-recents'
const LEGACY_MIGRATED_KEY = 'nam-player-ir-favorites-migrated'

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

/** Runs once ever: if the old shared list has anything and 'cab' hasn't been seeded yet, move it. */
function migrateLegacyOnce(): void {
  try {
    if (localStorage.getItem(LEGACY_MIGRATED_KEY)) return
    const legacyFavorites = read(FAVORITES_KEY)
    const legacyRecents = read(RECENTS_KEY)
    if (legacyFavorites.length > 0 && read(`${FAVORITES_KEY}-cab`).length === 0) {
      write(`${FAVORITES_KEY}-cab`, legacyFavorites)
    }
    if (legacyRecents.length > 0 && read(`${RECENTS_KEY}-cab`).length === 0) {
      write(`${RECENTS_KEY}-cab`, legacyRecents)
    }
    localStorage.setItem(LEGACY_MIGRATED_KEY, '1')
  } catch {
    // Non-fatal — worst case, pre-fix favourites are simply gone rather than misplaced.
  }
}

export function loadIrFavorites(kind: string): IrRef[] {
  migrateLegacyOnce()
  return read(`${FAVORITES_KEY}-${kind}`)
}

export function isIrFavorite(kind: string, path: string, favorites = loadIrFavorites(kind)): boolean {
  return favorites.some((f) => f.path === path)
}

/** Add or remove a favourite, returning the new list so callers can set state from it. */
export function toggleIrFavorite(kind: string, ref: IrRef): IrRef[] {
  const current = loadIrFavorites(kind)
  const next = current.some((f) => f.path === ref.path)
    ? current.filter((f) => f.path !== ref.path)
    : [...current, ref].sort((a, b) => a.rel.localeCompare(b.rel))
  write(`${FAVORITES_KEY}-${kind}`, next)
  return next
}

export function loadIrRecents(kind: string): IrRef[] {
  migrateLegacyOnce()
  return read(`${RECENTS_KEY}-${kind}`)
}

/**
 * Record a use, most-recent first.
 *
 * Re-picking an IR moves it to the top rather than adding a duplicate, so the list reflects what
 * you reach for rather than how many times you happened to click it.
 */
export function pushIrRecent(kind: string, ref: IrRef): IrRef[] {
  const next = [ref, ...loadIrRecents(kind).filter((r) => r.path !== ref.path)].slice(0, MAX_RECENTS)
  write(`${RECENTS_KEY}-${kind}`, next)
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
