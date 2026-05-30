import { useEffect, useRef, useState } from 'react'

interface HelpPopoverProps {
  title?: string
  children: React.ReactNode
  side?: 'left' | 'right'
}

export function HelpPopover({ title, children, side = 'right' }: HelpPopoverProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onMouseDown)
    return () => window.removeEventListener('mousedown', onMouseDown)
  }, [open])

  return (
    <div ref={ref} className="relative inline-flex items-center">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        className="w-4 h-4 rounded-full border border-gray-300 dark:border-gray-600 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 hover:border-gray-400 dark:hover:border-gray-400 flex items-center justify-center text-[9px] font-bold leading-none transition-colors select-none"
        tabIndex={-1}
      >
        ?
      </button>
      {open && (
        <div
          className={`absolute z-50 w-64 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl p-3 text-xs text-gray-700 dark:text-gray-300 space-y-1.5 ${side === 'left' ? 'right-5 top-0' : 'left-5 top-0'}`}
        >
          {title && <div className="font-semibold text-gray-900 dark:text-gray-100">{title}</div>}
          <div className="leading-relaxed">{children}</div>
        </div>
      )}
    </div>
  )
}
