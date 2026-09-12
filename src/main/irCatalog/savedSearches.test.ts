import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { createCoreSchema } from './schema'
import { listSavedSearches, createSavedSearch, renameSavedSearch, deleteSavedSearch } from './savedSearches'

describe('savedSearches', () => {
  it('creates and lists a saved search, ordered by position', () => {
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)

    createSavedSearch(db, 'Untagged Cabs', JSON.stringify({ cabinet: undefined }))
    createSavedSearch(db, 'High-res 96k', JSON.stringify({ sampleRate: 96000 }))

    const rows = listSavedSearches(db)
    expect(rows.map((r) => r.name)).toEqual(['Untagged Cabs', 'High-res 96k'])
    expect(JSON.parse(rows[1].filterJson)).toEqual({ sampleRate: 96000 })

    db.close()
  })

  it('renames a saved search', () => {
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)

    const created = createSavedSearch(db, 'Draft name', '{}')
    renameSavedSearch(db, created.id, 'Final name')
    expect(listSavedSearches(db)[0].name).toBe('Final name')

    db.close()
  })

  it('deletes a saved search', () => {
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)

    const created = createSavedSearch(db, 'Temp', '{}')
    deleteSavedSearch(db, created.id)
    expect(listSavedSearches(db)).toHaveLength(0)

    db.close()
  })

  it('trims whitespace from the name', () => {
    const db = new DatabaseSync(':memory:')
    createCoreSchema(db)

    createSavedSearch(db, '  Padded  ', '{}')
    expect(listSavedSearches(db)[0].name).toBe('Padded')

    db.close()
  })
})
