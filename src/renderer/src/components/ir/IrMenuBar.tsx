import { useEffect, useRef, useState } from 'react'

interface MenuItem {
  label: string
  onClick?: () => void
  disabled?: boolean
}

function Menu({ label, items }: { label: string; items: MenuItem[] }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const dismiss = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', dismiss)
    return () => window.removeEventListener('mousedown', dismiss)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`px-2 py-0.5 text-xs rounded ${open ? 'bg-hov text-nm-text' : 'text-nm-text-2 hover:bg-hov hover:text-nm-text'}`}
      >
        {label}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-0.5 min-w-[180px] py-1 rounded border border-nm-border bg-panel shadow-lg z-50">
          {items.map((item) => (
            <button
              key={item.label}
              disabled={item.disabled}
              onClick={() => {
                item.onClick?.()
                setOpen(false)
              }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-hov text-nm-text disabled:text-nm-text-3 disabled:hover:bg-transparent disabled:cursor-default"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * IR mode's top menu bar — File/Settings/Help, matching NAM Lab's own toolbar in spirit but not
 * yet sharing its component: NAM Lab's Settings panel is local state inside App.tsx (a ~6,000-
 * line file), and lifting it up to be shared across both modes is a real refactor, not something
 * to do as a side effect of adding a menu bar. Settings/Help are honest stubs here for now
 * (disabled items, not fake working buttons) rather than pretending this is finished —
 * docs/ir-lab-manager-build-plan.md tracks the shared-settings-panel work as a follow-up.
 */
export function IrMenuBar({ onAddLibraryFolder, scanning }: { onAddLibraryFolder: () => void; scanning: boolean }): React.ReactElement {
  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-nm-border-s bg-panel-2 flex-shrink-0">
      <Menu label="File" items={[{ label: 'Add Library Folder…', onClick: onAddLibraryFolder, disabled: scanning }]} />
      <Menu
        label="Settings"
        items={[
          { label: 'IR Library settings (coming soon)', disabled: true },
          { label: 'Uses NAM Lab’s theme/accent settings for now', disabled: true }
        ]}
      />
      <Menu
        label="Help"
        items={[
          { label: 'About IR Lab Manager (coming soon)', disabled: true },
          { label: 'Report an issue (coming soon)', disabled: true }
        ]}
      />
    </div>
  )
}
