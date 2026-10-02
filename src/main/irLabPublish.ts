/**
 * "Publish to IR Lab Library" (NAML-3, docs/nam-lab-ir-lab-integration-build-plan.md): copies
 * trained .nam files into IR Lab's configured NAM folder so its nam/namgroup routes -- which only
 * accept files under that folder -- can load them into Live Audition.
 *
 * Copies land in `<IR Lab NAM folder>/NAM Lab Published/`. nam-lab-result.json keeps pointing at
 * the canonical trainer output; a published file is a delivery copy, never the training record.
 * Nothing is ever overwritten: identical bytes are reused, different bytes under the same name
 * need an explicit "keep both" (renamed copy) or the publish is cancelled. Each copy goes through
 * a temp file in the destination folder, is hash-verified, then renamed into place, so a failed
 * copy never leaves a half-written .nam that IR Lab could load.
 */
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import { basename, extname, join, resolve, sep } from 'node:path'

export const PUBLISH_SUBFOLDER = 'NAM Lab Published'

export type PublishAction = 'copy' | 'identical' | 'alreadyInLibrary' | 'conflict' | 'missing'

export interface PublishEntry {
  source: string
  /** Where IR Lab will load it from once published (for 'conflict', the name that is taken). */
  dest: string
  action: PublishAction
}

export interface PublishPlan {
  namFolder: string
  destFolder: string
  entries: PublishEntry[]
}

export function sha256File(path: string): string {
  return createHash('sha256').update(fs.readFileSync(path)).digest('hex')
}

function isInside(child: string, parent: string): boolean {
  const c = resolve(child)
  const p = resolve(parent)
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep)
}

export function planPublish(sources: string[], namFolder: string): PublishPlan {
  const destFolder = join(namFolder, PUBLISH_SUBFOLDER)
  const taken = new Set<string>()
  const entries = sources.map((source): PublishEntry => {
    if (!fs.existsSync(source)) return { source, dest: source, action: 'missing' }
    if (isInside(source, namFolder)) return { source, dest: source, action: 'alreadyInLibrary' }
    const dest = join(destFolder, basename(source))
    // Two selected models with the same file name would land on one path.
    if (taken.has(dest)) return { source, dest, action: 'conflict' }
    taken.add(dest)
    if (!fs.existsSync(dest)) return { source, dest, action: 'copy' }
    return { source, dest, action: sha256File(dest) === sha256File(source) ? 'identical' : 'conflict' }
  })
  return { namFolder, destFolder, entries }
}

/** First free "<name> (n).nam" beside `dest`. */
export function keepBothName(dest: string, isTaken: (path: string) => boolean = fs.existsSync): string {
  const ext = extname(dest)
  const stem = dest.slice(0, dest.length - ext.length)
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`
    if (!isTaken(candidate)) return candidate
  }
}

export interface PublishOutcome {
  /** Every model's loadable path inside IR Lab's NAM folder, in input order (missing ones omitted). */
  published: string[]
  copied: number
  reused: number
}

/** Executes a plan. 'conflict' entries are written as a renamed copy only when keepBoth is true;
 * callers must not reach here with conflicts and keepBoth false. Throws on any copy failure after
 * removing that file's temp copy -- files already placed by earlier entries stay (each is
 * complete and verified). */
export function executePublish(plan: PublishPlan, keepBoth: boolean): PublishOutcome {
  if (!keepBoth && plan.entries.some((e) => e.action === 'conflict'))
    throw new Error('Publish has name conflicts; choose keep both or cancel.')
  fs.mkdirSync(plan.destFolder, { recursive: true })
  const reserved = new Set<string>()
  const outcome: PublishOutcome = { published: [], copied: 0, reused: 0 }
  for (const entry of plan.entries) {
    if (entry.action === 'missing') continue
    if (entry.action === 'alreadyInLibrary' || entry.action === 'identical') {
      outcome.published.push(entry.dest)
      outcome.reused++
      continue
    }
    const target =
      entry.action === 'conflict' ? keepBothName(entry.dest, (p) => reserved.has(p) || fs.existsSync(p)) : entry.dest
    reserved.add(target)
    const temp = `${target}.partial-${process.pid}`
    try {
      fs.copyFileSync(entry.source, temp)
      if (sha256File(temp) !== sha256File(entry.source)) throw new Error(`Copy of ${basename(entry.source)} did not verify.`)
      fs.renameSync(temp, target)
    } catch (err) {
      fs.rmSync(temp, { force: true })
      throw err
    }
    outcome.published.push(target)
    outcome.copied++
  }
  return outcome
}

/** Group manifests written for irlab://namgroup are only needed until IR Lab reads them. */
export function pruneOldGroupManifests(namFolder: string, maxAgeMs = 24 * 60 * 60 * 1000, now = Date.now()): void {
  let names: string[] = []
  try {
    names = fs.readdirSync(namFolder)
  } catch {
    return
  }
  for (const name of names) {
    if (!/^nam-lab-group-\d+\.json$/.test(name)) continue
    const path = join(namFolder, name)
    try {
      if (now - fs.statSync(path).mtimeMs > maxAgeMs) fs.rmSync(path, { force: true })
    } catch {
      // Best effort; a manifest that can't be removed is harmless.
    }
  }
}
