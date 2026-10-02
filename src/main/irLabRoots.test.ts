import { describe, it, expect } from 'vitest'
import { join, resolve, sep } from 'node:path'
import { parseIrLabAllowedRoots, parseIrLabNamFolder, isUnderAnyRoot, checkBlendAllowlist, checkNamAllowlist } from './irLabRoots'

describe('parseIrLabAllowedRoots', () => {
  it('reads the three folder keys IR Lab itself writes', () => {
    const json = JSON.stringify({
      defaultCabIrFolder: 'C:\\IRs\\Cab',
      defaultReverbIrFolder: 'C:\\IRs\\Reverb',
      defaultDiFolder: 'C:\\IRs\\DI',
      lastNamFile: 'ignored — not a folder key'
    })
    expect(parseIrLabAllowedRoots(json)).toEqual(['C:\\IRs\\Cab', 'C:\\IRs\\Reverb', 'C:\\IRs\\DI'])
  })

  it('skips unset (empty string) folders — IR Lab writes the key even when never configured', () => {
    const json = JSON.stringify({ defaultCabIrFolder: 'C:\\IRs\\Cab', defaultReverbIrFolder: '', defaultDiFolder: '' })
    expect(parseIrLabAllowedRoots(json)).toEqual(['C:\\IRs\\Cab'])
  })

  it('returns empty for malformed JSON rather than throwing', () => {
    expect(parseIrLabAllowedRoots('{not json')).toEqual([])
  })

  it('returns empty for valid JSON that is not an object', () => {
    expect(parseIrLabAllowedRoots('42')).toEqual([])
    expect(parseIrLabAllowedRoots('null')).toEqual([])
  })

  it('returns empty when the file has none of the three keys', () => {
    expect(parseIrLabAllowedRoots(JSON.stringify({ somethingElse: 'x' }))).toEqual([])
  })
})

describe('parseIrLabNamFolder', () => {
  it('reads the single defaultNamFolder key', () => {
    expect(parseIrLabNamFolder(JSON.stringify({ defaultNamFolder: 'C:\\NAM' }))).toBe('C:\\NAM')
  })

  it('returns null when unset (empty string)', () => {
    expect(parseIrLabNamFolder(JSON.stringify({ defaultNamFolder: '' }))).toBeNull()
  })

  it('returns null for malformed JSON rather than throwing', () => {
    expect(parseIrLabNamFolder('{not json')).toBeNull()
  })

  it('returns null when the key is absent', () => {
    expect(parseIrLabNamFolder(JSON.stringify({ defaultCabIrFolder: 'C:\\IRs\\Cab' }))).toBeNull()
  })
})

// Absolute paths in the running platform's own form (C:\IRs\Cab on Windows, /IRs/Cab elsewhere):
// isUnderAnyRoot resolves with the host's path rules, so hard-coded Windows paths only ever passed
// on Windows and silently failed everywhere else.
const P = (...parts: string[]): string => join(resolve(sep), ...parts)

describe('isUnderAnyRoot', () => {
  const roots = [P('IRs', 'Cab'), P('IRs', 'DI')]

  it('matches a direct child path', () => {
    expect(isUnderAnyRoot(P('IRs', 'Cab', 'Marshall412.wav'), roots)).toBe(true)
  })

  it('matches a nested descendant path', () => {
    expect(isUnderAnyRoot(P('IRs', 'Cab', 'Ownhammer', '412', 'sm57.wav'), roots)).toBe(true)
  })

  it('rejects a path outside every root', () => {
    expect(isUnderAnyRoot(P('Users', 'me', 'Downloads', 'random.wav'), roots)).toBe(false)
  })

  it('does not treat a sibling folder with a matching prefix as a child', () => {
    // ".../IRs/Cabinet2" starts with the string ".../IRs/Cab" but is not inside it.
    expect(isUnderAnyRoot(P('IRs', 'Cabinet2', 'file.wav'), [P('IRs', 'Cab')])).toBe(false)
  })

  it('rejects when no roots are configured', () => {
    expect(isUnderAnyRoot(P('IRs', 'Cab', 'a.wav'), [])).toBe(false)
  })
})

describe('checkBlendAllowlist', () => {
  const roots = [P('IRs', 'Cab')]

  it('flags noRootsConfigured distinctly from ordinary rejection', () => {
    const result = checkBlendAllowlist([P('IRs', 'Cab', 'a.wav')], [])
    expect(result.noRootsConfigured).toBe(true)
    expect(result.rejected).toEqual([P('IRs', 'Cab', 'a.wav')])
    expect(result.allowed).toEqual([])
  })

  it('splits allowed vs rejected against configured roots', () => {
    const result = checkBlendAllowlist([P('IRs', 'Cab', 'a.wav'), P('Elsewhere', 'b.wav')], roots)
    expect(result.noRootsConfigured).toBe(false)
    expect(result.allowed).toEqual([P('IRs', 'Cab', 'a.wav')])
    expect(result.rejected).toEqual([P('Elsewhere', 'b.wav')])
  })

  it('everything allowed when every path is under a configured root', () => {
    const result = checkBlendAllowlist([P('IRs', 'Cab', 'a.wav'), P('IRs', 'Cab', 'sub', 'b.wav')], roots)
    expect(result.rejected).toEqual([])
    expect(result.allowed).toHaveLength(2)
  })
})

describe('checkNamAllowlist', () => {
  it('flags noRootsConfigured when defaultNamFolder is unset', () => {
    const result = checkNamAllowlist([P('NAM', 'Amp.nam')], null)
    expect(result.noRootsConfigured).toBe(true)
    expect(result.rejected).toEqual([P('NAM', 'Amp.nam')])
  })

  it('splits allowed vs rejected against the one configured NAM folder', () => {
    const result = checkNamAllowlist([P('NAM', 'Amp.nam'), P('Elsewhere', 'Other.nam')], P('NAM'))
    expect(result.allowed).toEqual([P('NAM', 'Amp.nam')])
    expect(result.rejected).toEqual([P('Elsewhere', 'Other.nam')])
  })
})
