import { describe, it, expect } from 'vitest'
import { parseIrLabAllowedRoots, isUnderAnyRoot, checkBlendAllowlist } from './irLabRoots'

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

describe('isUnderAnyRoot', () => {
  const roots = ['C:\\IRs\\Cab', 'C:\\IRs\\DI']

  it('matches a direct child path', () => {
    expect(isUnderAnyRoot('C:\\IRs\\Cab\\Marshall412.wav', roots)).toBe(true)
  })

  it('matches a nested descendant path', () => {
    expect(isUnderAnyRoot('C:\\IRs\\Cab\\Ownhammer\\412\\sm57.wav', roots)).toBe(true)
  })

  it('rejects a path outside every root', () => {
    expect(isUnderAnyRoot('C:\\Users\\me\\Downloads\\random.wav', roots)).toBe(false)
  })

  it('does not treat a sibling folder with a matching prefix as a child', () => {
    // "C:\IRs\Cabinet2" starts with the string "C:\IRs\Cab" but is not inside it.
    expect(isUnderAnyRoot('C:\\IRs\\Cabinet2\\file.wav', ['C:\\IRs\\Cab'])).toBe(false)
  })

  it('rejects when no roots are configured', () => {
    expect(isUnderAnyRoot('C:\\IRs\\Cab\\a.wav', [])).toBe(false)
  })
})

describe('checkBlendAllowlist', () => {
  const roots = ['C:\\IRs\\Cab']

  it('flags noRootsConfigured distinctly from ordinary rejection', () => {
    const result = checkBlendAllowlist(['C:\\IRs\\Cab\\a.wav'], [])
    expect(result.noRootsConfigured).toBe(true)
    expect(result.rejected).toEqual(['C:\\IRs\\Cab\\a.wav'])
    expect(result.allowed).toEqual([])
  })

  it('splits allowed vs rejected against configured roots', () => {
    const result = checkBlendAllowlist(['C:\\IRs\\Cab\\a.wav', 'C:\\Elsewhere\\b.wav'], roots)
    expect(result.noRootsConfigured).toBe(false)
    expect(result.allowed).toEqual(['C:\\IRs\\Cab\\a.wav'])
    expect(result.rejected).toEqual(['C:\\Elsewhere\\b.wav'])
  })

  it('everything allowed when every path is under a configured root', () => {
    const result = checkBlendAllowlist(['C:\\IRs\\Cab\\a.wav', 'C:\\IRs\\Cab\\sub\\b.wav'], roots)
    expect(result.rejected).toEqual([])
    expect(result.allowed).toHaveLength(2)
  })
})
