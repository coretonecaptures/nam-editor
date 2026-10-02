import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { planPublish, executePublish, keepBothName, pruneOldGroupManifests, PUBLISH_SUBFOLDER } from './irLabPublish'

let root: string
let namFolder: string
let trained: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'irlab-publish-'))
  namFolder = join(root, 'IR Lab NAM')
  trained = join(root, 'trainer-out')
  fs.mkdirSync(namFolder)
  fs.mkdirSync(trained)
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

const write = (path: string, text: string): string => {
  fs.writeFileSync(path, text)
  return path
}

describe('irLabPublish', () => {
  it('copies a model from outside IR Lab\'s NAM folder and verifies it', () => {
    const model = write(join(trained, 'Amp.nam'), 'model-a')
    const plan = planPublish([model], namFolder)
    expect(plan.entries[0].action).toBe('copy')
    const out = executePublish(plan, false)
    const dest = join(namFolder, PUBLISH_SUBFOLDER, 'Amp.nam')
    expect(out).toEqual({ published: [dest], copied: 1, reused: 0 })
    expect(fs.readFileSync(dest, 'utf8')).toBe('model-a')
    expect(fs.readdirSync(join(namFolder, PUBLISH_SUBFOLDER))).toEqual(['Amp.nam'])
  })

  it('re-publishing identical bytes is idempotent', () => {
    const model = write(join(trained, 'Amp.nam'), 'model-a')
    executePublish(planPublish([model], namFolder), false)
    const again = planPublish([model], namFolder)
    expect(again.entries[0].action).toBe('identical')
    expect(executePublish(again, false)).toMatchObject({ copied: 0, reused: 1 })
  })

  it('never overwrites a different model with the same name', () => {
    fs.mkdirSync(join(namFolder, PUBLISH_SUBFOLDER))
    const existing = write(join(namFolder, PUBLISH_SUBFOLDER, 'Amp.nam'), 'older')
    const model = write(join(trained, 'Amp.nam'), 'newer')
    const plan = planPublish([model], namFolder)
    expect(plan.entries[0].action).toBe('conflict')
    expect(() => executePublish(plan, false)).toThrow()
    expect(fs.readFileSync(existing, 'utf8')).toBe('older')
    const out = executePublish(plan, true)
    expect(out.published[0]).toBe(join(namFolder, PUBLISH_SUBFOLDER, 'Amp (2).nam'))
    expect(fs.readFileSync(existing, 'utf8')).toBe('older')
  })

  it('leaves a model already inside the NAM folder where it is', () => {
    const inside = write(join(namFolder, 'Mine.nam'), 'x')
    const plan = planPublish([inside], namFolder)
    expect(plan.entries[0]).toMatchObject({ action: 'alreadyInLibrary', dest: inside })
  })

  it('publishes a group from different source folders, renaming a same-name pair', () => {
    fs.mkdirSync(join(trained, 'b'))
    const a = write(join(trained, 'Amp.nam'), 'one')
    const b = write(join(trained, 'b', 'Amp.nam'), 'two')
    const plan = planPublish([a, b], namFolder)
    expect(plan.entries.map((e) => e.action)).toEqual(['copy', 'conflict'])
    const out = executePublish(plan, true)
    expect(out.published.map((p) => fs.readFileSync(p, 'utf8'))).toEqual(['one', 'two'])
  })

  it('a failed copy leaves no partial file behind', () => {
    const model = write(join(trained, 'Amp.nam'), 'model')
    const plan = planPublish([model], namFolder)
    fs.rmSync(model)
    expect(() => executePublish(plan, false)).toThrow()
    const dir = join(namFolder, PUBLISH_SUBFOLDER)
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('keepBothName picks the first free numbered name', () => {
    const taken = new Set(['/x/Amp (2).nam'])
    expect(keepBothName('/x/Amp.nam', (p) => taken.has(p))).toBe('/x/Amp (3).nam')
  })

  it('prunes only stale namgroup manifests', () => {
    const old = write(join(namFolder, 'nam-lab-group-1.json'), '{}')
    const fresh = write(join(namFolder, 'nam-lab-group-2.json'), '{}')
    const other = write(join(namFolder, 'notes.json'), '{}')
    const now = Date.now()
    fs.utimesSync(old, new Date(now - 2 * 86400000), new Date(now - 2 * 86400000))
    pruneOldGroupManifests(namFolder, 86400000, now)
    expect([fs.existsSync(old), fs.existsSync(fresh), fs.existsSync(other)]).toEqual([false, true, true])
  })
})
