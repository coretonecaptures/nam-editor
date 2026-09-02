import { useEffect, useState } from 'react'
import App from './App'
import { IrModeShell } from './components/ir/IrModeShell'
import { NamProjectsShell } from './components/ir/NamProjectsShell'
import { ModeRail, type AppMode } from './components/ModeRail'
import { onGoToTrainingBatches } from './appNav'

const MODE_KEY = 'nam-lab-app-mode'

function readMode(): AppMode {
  try {
    const stored = localStorage.getItem(MODE_KEY)
    if (stored === 'ir' || stored === 'nam-projects') return stored
    return 'nam'
  } catch {
    return 'nam'
  }
}

/**
 * NAM / IR / NAM Projects top-level switcher. The three shells each assume they own the viewport
 * (`h-screen` roots), so instead of nesting them under a shared header we sit them in a flex row
 * next to a fixed-width `ModeRail` on the left — the rail is a real sibling, the shell fills the
 * rest at full height, and nothing about a shell's own layout changes.
 *
 * Keyboard: Cmd/Ctrl+1/2/3 jump between modes.
 */
export default function AppRoot(): React.ReactElement {
  const [mode, setMode] = useState<AppMode>(readMode)
  const isMac = window.api?.platform === 'darwin'

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode)
    } catch {
      // Non-fatal — worst case the rail doesn't remember across restarts.
    }
  }, [mode])

  // NamProjectsShell -> "create training batch" -> flip to NAM mode; App picks up the pending
  // intent on mount (appNav.consumePendingBatchNav) and opens the trainer on Batches.
  useEffect(() => onGoToTrainingBatches(() => setMode('nam')), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      if (e.key === '1') setMode('nam')
      else if (e.key === '2') setMode('ir')
      else if (e.key === '3') setMode('nam-projects')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-screen overflow-hidden">
      <ModeRail mode={mode} onChange={setMode} isMac={isMac} />
      <div className="flex-1 min-w-0 h-screen overflow-hidden">
        {mode === 'nam' ? <App /> : mode === 'ir' ? <IrModeShell /> : <NamProjectsShell />}
      </div>
    </div>
  )
}
