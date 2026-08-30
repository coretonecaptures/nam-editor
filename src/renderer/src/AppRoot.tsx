import { useEffect, useState } from 'react'
import App from './App'
import { IrModeShell } from './components/ir/IrModeShell'
import { NamProjectsShell } from './components/ir/NamProjectsShell'
import { onGoToTrainingBatches } from './appNav'

type Mode = 'nam' | 'ir' | 'nam-projects'
const MODE_KEY = 'nam-lab-app-mode'

function readMode(): Mode {
  try {
    const stored = localStorage.getItem(MODE_KEY)
    if (stored === 'ir' || stored === 'nam-projects') return stored
    return 'nam'
  } catch {
    return 'nam'
  }
}

/**
 * NAM / IR / NAM Projects top-level mode switcher (docs/ir-lab-manager-build-plan.md section 10,
 * docs/nam-capture-import-plan-2026-08-29.md §1). Deliberately a thin wrapper rather than folding
 * the toggle into App.tsx's own layout: App's root uses `h-screen` assuming it IS the viewport
 * root, and both other shells do the same — nesting any under a shared header/flex container would
 * shrink its available height incorrectly. The toggle is a floating overlay instead, so each mode
 * keeps its own full-height root untouched.
 */
export default function AppRoot(): React.ReactElement {
  const [mode, setMode] = useState<Mode>(readMode)

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode)
    } catch {
      // Non-fatal — worst case the toggle doesn't remember across restarts.
    }
  }, [mode])

  // NamProjectsShell -> "create training batch" -> flip to NAM mode; App picks up the pending
  // intent on mount (appNav.consumePendingBatchNav) and opens the trainer on Batches.
  useEffect(() => onGoToTrainingBatches(() => setMode('nam')), [])

  const tab = (value: Mode, label: string): React.ReactElement => (
    <button
      onClick={() => setMode(value)}
      className={`px-2.5 py-1 ${mode === value ? 'bg-nm-accent text-accent-fg' : 'bg-field-bg text-nm-text-2 hover:bg-hov'}`}
    >
      {label}
    </button>
  )

  return (
    <>
      {mode === 'nam' ? <App /> : mode === 'ir' ? <IrModeShell /> : <NamProjectsShell />}
      {/*
        Windows: BrowserWindow uses titleBarStyle 'hidden' + a titleBarOverlay (src/main/index.ts
        createWindow) -- Electron draws the real minimize/maximize/close buttons as OS-composited
        chrome in the top-right ~32px, on top of any web content there, invisibly. macOS uses
        'hiddenInset' instead, which puts traffic-light buttons top-LEFT. top-10 clears the
        Windows overlay height (32px) with margin and is nowhere near the Mac traffic lights.
      */}
      <div className="fixed top-10 right-3 z-[100] flex rounded-md overflow-hidden border border-field-bd shadow-sm text-xs">
        {tab('nam', 'NAM')}
        {tab('ir', 'IR')}
        {tab('nam-projects', 'NAM Projects')}
      </div>
    </>
  )
}
