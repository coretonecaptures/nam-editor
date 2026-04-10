import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

interface ComboInputProps {
  value: string
  onChange: (v: string) => void
  suggestions: string[]
  placeholder?: string
  disabled?: boolean
  className?: string
}

export function ComboInput({ value, onChange, suggestions, placeholder, disabled, className }: ComboInputProps) {
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = value
    ? suggestions.filter((s) => s.toLowerCase().includes(value.toLowerCase()) && s !== value)
    : suggestions

  const updateDropdownPosition = () => {
    if (!inputRef.current) return
    const rect = inputRef.current.getBoundingClientRect()
    setDropdownStyle({
      position: 'fixed',
      top: rect.bottom + 2,
      left: rect.left,
      width: rect.width,
      zIndex: 9999,
    })
  }

  useEffect(() => {
    if (!open) return
    updateDropdownPosition()
    const handler = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', handler)
    window.addEventListener('scroll', updateDropdownPosition, true)
    window.addEventListener('resize', updateDropdownPosition)
    return () => {
      window.removeEventListener('mousedown', handler)
      window.removeEventListener('scroll', updateDropdownPosition, true)
      window.removeEventListener('resize', updateDropdownPosition)
    }
  }, [open])

  const select = (s: string) => {
    onChange(s)
    setOpen(false)
    setActiveIdx(-1)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || filtered.length === 0) {
      if (e.key === 'ArrowDown' && filtered.length > 0) { setOpen(true); setActiveIdx(0); e.preventDefault() }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault()
      select(filtered[activeIdx])
    } else if (e.key === 'Escape') {
      setOpen(false)
      setActiveIdx(-1)
    }
  }

  const dropdown = open && filtered.length > 0 ? createPortal(
    <ul
      style={{ ...dropdownStyle, maxHeight: 200, overflowY: 'auto' }}
      className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl"
    >
      {filtered.map((s, i) => (
        <li
          key={s}
          onMouseDown={(e) => { e.preventDefault(); select(s) }}
          className={`px-3 py-1.5 text-sm cursor-pointer ${
            i === activeIdx
              ? 'bg-indigo-600 text-white'
              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
        >
          {s}
        </li>
      ))}
    </ul>,
    document.body
  ) : null

  return (
    <div className="relative w-full">
      <input
        ref={inputRef}
        type="text"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActiveIdx(-1) }}
        onFocus={() => { if (filtered.length > 0) { updateDropdownPosition(); setOpen(true) } }}
        onKeyDown={handleKeyDown}
        className={className}
      />
      {dropdown}
    </div>
  )
}
