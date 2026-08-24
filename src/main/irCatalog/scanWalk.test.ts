import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import { join } from 'node:path'
import { walkWavLibrary } from './scanWalk'

const tmpDirs: string[] = []

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'ir-scanwalk-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

async function collect(root: string) {
  const folders: string[] = []
  const files: string[] = []
  for await (const event of walkWavLibrary(root)) {
    if (event.type === 'folder') folders.push(event.folder!.relPath)
    else files.push(event.file!.relPath)
  }
  return { folders, files }
}

describe('walkWavLibrary', () => {
  it('yields the root folder and nested wav files, skipping non-wav files', async () => {
    const root = makeTmpDir()
    fs.mkdirSync(join(root, 'Ownhammer', 'Mesa V30'), { recursive: true })
    fs.writeFileSync(join(root, 'Ownhammer', 'Mesa V30', 'SM57.wav'), 'data')
    fs.writeFileSync(join(root, 'Ownhammer', 'Mesa V30', 'readme.txt'), 'not audio')
    fs.writeFileSync(join(root, 'top-level.wav'), 'data')

    const { folders, files } = await collect(root)

    expect(folders).toContain('')
    expect(folders).toContain(join('Ownhammer', 'Mesa V30'))
    expect(files.sort()).toEqual(
      [join('Ownhammer', 'Mesa V30', 'SM57.wav'), 'top-level.wav'].sort()
    )
  })

  it('yields a folder event before any of its descendants', async () => {
    const root = makeTmpDir()
    fs.mkdirSync(join(root, 'a', 'b', 'c'), { recursive: true })
    fs.writeFileSync(join(root, 'a', 'b', 'c', 'deep.wav'), 'data')

    const seenFolders: string[] = []
    for await (const event of walkWavLibrary(root)) {
      if (event.type === 'folder') seenFolders.push(event.folder!.relPath)
    }

    const idxRoot = seenFolders.indexOf('')
    const idxA = seenFolders.indexOf('a')
    const idxB = seenFolders.indexOf(join('a', 'b'))
    const idxC = seenFolders.indexOf(join('a', 'b', 'c'))
    expect(idxRoot).toBeLessThan(idxA)
    expect(idxA).toBeLessThan(idxB)
    expect(idxB).toBeLessThan(idxC)
  })

  it('skips dotfiles, __MACOSX, and ._ resource forks', async () => {
    const root = makeTmpDir()
    fs.mkdirSync(join(root, '.git'), { recursive: true })
    fs.mkdirSync(join(root, '__MACOSX'), { recursive: true })
    fs.writeFileSync(join(root, '.git', 'hidden.wav'), 'data')
    fs.writeFileSync(join(root, '__MACOSX', 'resource.wav'), 'data')
    fs.writeFileSync(join(root, '._SM57.wav'), 'data')
    fs.writeFileSync(join(root, 'real.wav'), 'data')

    const { files } = await collect(root)
    expect(files).toEqual(['real.wav'])
  })
})
