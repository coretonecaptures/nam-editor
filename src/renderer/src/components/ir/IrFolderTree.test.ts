import { describe, it, expect } from 'vitest'
import { buildTree } from './IrFolderTree'

type FolderRow = {
  id: number
  parent_id: number | null
  relative_path: string
  direct_item_count: number
  is_lab_project: number
  library_root_id: number
  library_root_label: string
}

function row(overrides: Partial<FolderRow> & Pick<FolderRow, 'id' | 'library_root_id' | 'relative_path'>): FolderRow {
  return { parent_id: null, direct_item_count: 0, is_lab_project: 0, library_root_label: `root-${overrides.library_root_id}`, ...overrides }
}

describe('buildTree', () => {
  it('allIds includes the virtual "Library" wrapper node when there are multiple roots', () => {
    // "Expand all folders seems broken": the wrapper node's own id must be in allIds too, or
    // "Expand all" can never re-open it once it's been collapsed (by "Collapse all" or the user
    // closing it directly) — a collapsed parent hides every descendant regardless of their own
    // expandedIds membership, which is exactly what made this look totally broken.
    const rows: FolderRow[] = [
      row({ id: 1, library_root_id: 1, relative_path: '' }),
      row({ id: 2, library_root_id: 1, relative_path: 'Sub', parent_id: 1, direct_item_count: 3 }),
      row({ id: 3, library_root_id: 2, relative_path: '' })
    ]
    // Root 2 needs a non-zero total to survive the single-root-node collapse rule; give it a
    // direct item too so both roots actually render as distinct top-level nodes.
    rows[2] = row({ id: 3, library_root_id: 2, relative_path: '', direct_item_count: 5 })

    const { roots, allIds } = buildTree(rows)
    expect(roots).toHaveLength(1)
    expect(roots[0].isVirtual).toBe(true)
    expect(roots[0].id).toBe(-1)
    expect(allIds).toContain(-1)
    expect(allIds).toContain(1)
    expect(allIds).toContain(2)
    expect(allIds).toContain(3)
  })

  it('a single root skips the virtual wrapper entirely — nothing to add to allIds for it', () => {
    const rows: FolderRow[] = [
      row({ id: 1, library_root_id: 1, relative_path: '' }),
      row({ id: 2, library_root_id: 1, relative_path: 'Sub', parent_id: 1, direct_item_count: 3 })
    ]
    const { roots, allIds } = buildTree(rows)
    expect(roots.every((r) => !r.isVirtual)).toBe(true)
    expect(allIds).not.toContain(-1)
  })
})
