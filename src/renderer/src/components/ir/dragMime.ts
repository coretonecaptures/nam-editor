/** Drag payload MIME for dragging an IR row (IrModeShell.tsx) onto a folder in the tree
 * (IrFolderTree.tsx) — parity backlog item 4. Its own file rather than exported from either of
 * those so neither has to import from the other (a real circular import risk: IrModeShell already
 * imports IrFolderTree as a component). */
export const IR_ITEM_DRAG_MIME = 'application/x-nam-lab-ir-item-ids'

export interface IrItemDragPayload {
  itemIds: string[]
  libraryRootId: number
}
