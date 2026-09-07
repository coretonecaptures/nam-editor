import { describe, expect, it } from 'vitest'
import { isAllowedLocalFilePath, localFileExtension } from './localFileGuard'

describe('localFileExtension', () => {
  it('reads a lowercase extension off a plain path', () => {
    expect(localFileExtension('/Users/x/rig-photo.JPG')).toBe('.jpg')
    expect(localFileExtension('/Users/x/cover.png')).toBe('.png')
  })

  it('strips a query string / hash before looking for the extension', () => {
    expect(localFileExtension('/Users/x/cover.png?t=123')).toBe('.png')
    expect(localFileExtension('/Users/x/cover.png#frag')).toBe('.png')
  })

  it('an extensionless path is "" (not the last character -- the -1 bug)', () => {
    expect(localFileExtension('/Users/x/README')).toBe('')
    // Regression guard: lastIndexOf('.') === -1 must not fall through to slice(-1), which would
    // silently return the path's last character instead of "no extension".
    expect(localFileExtension('/Users/x/README')).not.toBe('D')
  })

  it('a dot in a directory name, none in the filename, still reads as no real extension', () => {
    // The last '.' in the whole string sits inside "some.folder", not the filename -- the
    // resulting "extension" spans a '/' and matches nothing in the allowlist either way.
    expect(isAllowedLocalFilePath('/Users/x/some.folder/image')).toBe(false)
  })
})

describe('isAllowedLocalFilePath', () => {
  it('allows every real image extension this app actually serves', () => {
    for (const ext of ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif']) {
      expect(isAllowedLocalFilePath(`/Users/x/cover${ext}`)).toBe(true)
      expect(isAllowedLocalFilePath(`/Users/x/COVER${ext.toUpperCase()}`)).toBe(true)
    }
  })

  it('refuses a non-image extension -- the actual S1 file-disclosure fix', () => {
    expect(isAllowedLocalFilePath('/Users/x/secrets.env')).toBe(false)
    expect(isAllowedLocalFilePath('/Users/x/config.json')).toBe(false)
    expect(isAllowedLocalFilePath('/Users/x/id_rsa')).toBe(false)
    expect(isAllowedLocalFilePath('/Users/x/notes.txt')).toBe(false)
  })
})
