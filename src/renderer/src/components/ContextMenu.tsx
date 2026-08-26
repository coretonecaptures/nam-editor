/**
 * Shared right-click context menu shell — one component instead of every screen building its own
 * inline popup. Extracted after finding NAM mode's own (FileList.tsx) and IR mode's own
 * (IrModeShell.tsx) had quietly diverged: different font size (text-sm vs text-xs), IR mode had
 * no icon slot, and NAM mode's colors were raw Tailwind grays while IR mode's were design tokens
 * — two feature areas of the same app reading as visually different products. This is the single
 * popup shell both should build on: design-token colors (theme-consistent in both modes), NAM's
 * text-sm sizing (the more established, already-shipped spec), an optional icon slot, dividers,
 * and a destructive variant — self-contained dismiss-on-outside-click/Escape handling so callers
 * don't each need their own copy of that effect either.
 */
import { useEffect } from 'react'

export interface ContextMenuItem {
  /** A divider line instead of a button — pass `{ divider: true }` with no other fields. */
  divider?: boolean
  label?: string
  icon?: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  /** Red/destructive styling (delete, remove, trash) instead of the normal text color. */
  destructive?: boolean
}

export function ContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}): React.ReactElement {
  useEffect(() => {
    const dismiss = (): void => onClose()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('click', dismiss)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', dismiss)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      className="fixed z-50 bg-panel border border-nm-border rounded-lg shadow-xl py-1 min-w-[180px]"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item, i) =>
        item.divider ? (
          <div key={i} className="border-t border-nm-border-s my-1" />
        ) : (
          <button
            key={i}
            disabled={item.disabled}
            onClick={() => {
              item.onClick?.()
              onClose()
            }}
            className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors disabled:opacity-40 disabled:cursor-default ${
              item.destructive ? 'text-red-600 dark:text-red-400 hover:bg-red-500/10' : 'text-nm-text hover:bg-hov'
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        )
      )}
    </div>
  )
}
