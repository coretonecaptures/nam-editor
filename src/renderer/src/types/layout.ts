// Persisted UI layout state — separate from settings so it doesn't
// require a Save button and updates automatically as the user resizes.

export interface LayoutState {
  treeWidth: number
  listWidthList: number
  listWidthGrid: number
}

const LAYOUT_KEY = 'nam-editor-layout'

const DEFAULTS: LayoutState = {
  treeWidth:     310,
  listWidthList: 320,
  listWidthGrid: 700,
}

export function loadLayout(): LayoutState {
  try {
    const stored = localStorage.getItem(LAYOUT_KEY)
    return stored ? { ...DEFAULTS, ...JSON.parse(stored) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

export function saveLayout(layout: LayoutState): void {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout))
}
