import { describe, it, expect } from 'vitest'
import { parseNamLabUrl } from './namLabUrl'

describe('parseNamLabUrl', () => {
  it('parses a real project deep link from IR Lab', () => {
    expect(parseNamLabUrl('namlab://project?id=abc-123')).toEqual({ route: 'project', id: 'abc-123' })
  })

  it('rejects a non-namlab protocol', () => {
    expect(parseNamLabUrl('irlab://project?id=abc-123')).toBeNull()
  })

  it('rejects an unrecognized route', () => {
    expect(parseNamLabUrl('namlab://blend?id=abc-123')).toBeNull()
  })

  it('rejects a project link with no id', () => {
    expect(parseNamLabUrl('namlab://project')).toBeNull()
  })

  it('returns null for malformed input rather than throwing', () => {
    expect(parseNamLabUrl('not a url')).toBeNull()
  })
})
