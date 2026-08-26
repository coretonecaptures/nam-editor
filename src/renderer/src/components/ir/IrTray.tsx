import { useState } from 'react'
import { createPortal } from 'react-dom'

export interface IrTrayRow {
  id: string
  display_name: string
  abs_path: string
}

const TRAY_CAPACITY = 8

/**
 * Selection tray — a floating pill badge that opens a slide-out drawer, directly modelled on the
 * card-locker/poke-locker app's own `SelectionTray` ("look at the card locker/pokemon app for the
 * tray collection builder...and if it works, copy that for the IR lab tray"). That app is a
 * separate codebase, so this is a deliberate re-implementation of its INTERACTION — pill, drawer,
 * quick-action row, scrollable list with per-row remove — rather than an import; what's copied is
 * the pattern, and it's rewritten here in this app's own design tokens and Tailwind conventions
 * rather than its inline styles, so it looks like NAM Lab rather than like a transplant.
 *
 * Replaces a flat horizontal strip of text chips that couldn't show more than a few names before
 * scrolling sideways and had nowhere to put actions.
 *
 * Capacity is 8, matching IR Lab's own `LiveAuditionEngine::blendPreviewSlotCount` (confirmed
 * against that repo, not guessed) — the tray exists to feed its Blender.
 */
export function IrTray({
  rows,
  onRemove,
  onClear,
  onPlay,
  onSendToIrLab,
  connectorAvailable,
  sending,
  error
}: {
  rows: IrTrayRow[]
  onRemove: (id: string) => void
  onClear: () => void
  onPlay?: (row: IrTrayRow) => void
  onSendToIrLab: () => void
  connectorAvailable: boolean
  sending: boolean
  error: string | null
}): React.ReactElement | null {
  const [open, setOpen] = useState(false)
  if (rows.length === 0) return null
  const count = rows.length

  return createPortal(
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-[7500] flex items-center gap-2 pl-4 pr-5 py-2.5 rounded-full bg-nm-accent text-accent-fg font-semibold text-sm shadow-lg hover:opacity-90 transition-opacity"
        title="Open the selection tray"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
          <line x1="3" y1="6" x2="21" y2="6" />
          <path d="M16 10a4 4 0 0 1-8 0" />
        </svg>
        Tray · {count}
      </button>

      {open && (
        <div onClick={() => setOpen(false)} className="fixed inset-0 z-[7600] bg-black/50">
          <div
            onClick={(e) => e.stopPropagation()}
            className="fixed bottom-0 right-0 w-[400px] max-h-[80vh] flex flex-col bg-panel border-t border-l border-nm-border rounded-tl-2xl shadow-2xl"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-nm-border flex-shrink-0">
              <div>
                <div className="text-sm font-semibold text-nm-text">Selection Tray</div>
                <div className="text-xs text-nm-text-3 mt-0.5">
                  {count} of {TRAY_CAPACITY} slots · matches IR Lab&apos;s blender
                </div>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="w-7 h-7 rounded-full border border-nm-border text-nm-text-3 hover:text-nm-text flex items-center justify-center"
                title="Close"
              >
                ×
              </button>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap px-3 py-2.5 border-b border-nm-border flex-shrink-0">
              <button
                onClick={onSendToIrLab}
                disabled={!connectorAvailable || sending}
                title={connectorAvailable ? 'Send this tray to IR Lab’s Blender' : 'IR Lab connector not configured in this build'}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-nm-accent text-accent-fg hover:opacity-90 disabled:opacity-40"
              >
                {sending ? 'Sending…' : 'Send to IR Lab'}
              </button>
              <button
                onClick={onClear}
                className="ml-auto px-3 py-1.5 text-xs rounded-lg border border-field-bd text-nm-text-2 hover:bg-hov"
              >
                Clear tray
              </button>
            </div>

            {error && <div className="px-4 py-1.5 text-xs text-red-600 dark:text-red-400 flex-shrink-0">{error}</div>}

            <div className="flex-1 overflow-y-auto">
              {rows.map((row, i) => (
                <div key={row.id} className="flex items-center gap-2.5 px-4 py-2 border-b border-nm-border-s">
                  <span className="w-5 flex-shrink-0 text-[11px] font-mono text-nm-text-3 text-right">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-nm-text truncate" title={row.abs_path}>
                      {row.display_name.replace(/\.wav$/i, '')}
                    </div>
                  </div>
                  {onPlay && (
                    <button
                      onClick={() => onPlay(row)}
                      title="Play this IR"
                      className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-green-500 dark:text-green-400 hover:bg-green-500 hover:text-white transition-colors"
                    >
                      <svg className="w-3.5 h-3.5 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M8 5.14v14l11-7-11-7z" />
                      </svg>
                    </button>
                  )}
                  <button
                    onClick={() => onRemove(row.id)}
                    title="Remove from tray"
                    className="flex-shrink-0 w-6 h-6 rounded-full border border-nm-border text-nm-text-3 hover:text-red-500 flex items-center justify-center"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>,
    document.body
  )
}
