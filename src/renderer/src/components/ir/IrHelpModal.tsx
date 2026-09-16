import { useState } from 'react'
import { MarkdownViewer } from '../HelpModal'
import irHelpDoc from '../../../../../docs/ir-help.md?raw'
import namProjectsHelpDoc from '../../../../../docs/nam-projects-help.md?raw'

/**
 * Help for the IR and NAM Projects shells — each owns its whole viewport (AppRoot.tsx's "each
 * shell owns its whole viewport" split), so neither could reach NAM mode's own `HelpModal.tsx`
 * (App.tsx-only, wired through Toolbar.tsx's help dropdown). Reuses that file's `MarkdownViewer`
 * for the actual markdown rendering — same parser, not a second one — but wraps it in this app's
 * own IR-mode chrome (bg-panel/border-nm-border/tb-menu-btn) rather than HelpModal's raw
 * Tailwind grays, matching the modal convention IrDuplicatesModal.tsx etc. already established for
 * this shell (CLAUDE.md: match what already exists, don't invent a second visual language).
 */

export type IrHelpTab = 'ir' | 'projects'

const DOCS: Record<IrHelpTab, string> = {
  ir: irHelpDoc,
  projects: namProjectsHelpDoc
}

const NAV_ITEMS: { id: IrHelpTab; label: string }[] = [
  { id: 'ir', label: 'IR Library Guide' },
  { id: 'projects', label: 'NAM Projects Guide' }
]

export function IrHelpModal({ initialTab, onClose }: { initialTab: IrHelpTab; onClose: () => void }): React.ReactElement {
  const [tab, setTab] = useState<IrHelpTab>(initialTab)

  return (
    <div className="fixed inset-0 z-[9990] bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-panel border border-nm-border rounded-xl w-full max-w-5xl mx-4 flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-nm-border flex items-start justify-between gap-4 flex-shrink-0">
          <div>
            <div className="text-sm font-semibold text-nm-text">Help</div>
            <div className="text-xs text-nm-text-3 mt-0.5">Guides for the IR and NAM Projects sections.</div>
          </div>
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded border border-field-bd text-nm-text-2 hover:bg-hov flex-shrink-0">
            Close
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          <aside className="w-52 border-r border-nm-border-s p-3 space-y-1 flex-shrink-0 overflow-y-auto">
            {NAV_ITEMS.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                  tab === id ? 'bg-nm-accent text-accent-fg' : 'text-nm-text-2 hover:bg-hov'
                }`}
              >
                {label}
              </button>
            ))}
          </aside>

          <div className="flex-1 overflow-y-auto px-6 py-5 select-text cursor-text">
            <MarkdownViewer markdown={DOCS[tab]} />
          </div>
        </div>
      </div>
    </div>
  )
}
