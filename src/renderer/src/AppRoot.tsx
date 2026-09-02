import { useEffect, useState } from 'react'
import App from './App'
import { IrModeShell } from './components/ir/IrModeShell'
import { NamProjectsShell } from './components/ir/NamProjectsShell'
import { ModeBar, type AppMode } from './components/ModeBar'
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
 * NAM / IR / NAM Projects top-level switcher. The three shells each assume they own the viewport,
 * so rather than wrap them we hand NAM mode a `headerAccessory` (the `ModeBar` renders just below
 * its toolbar) and, for the other two, stack the `ModeBar` above the shell in a flex column.
 * Either way the skinny bar is a horizontal strip under the top menu, never a vertical rail, and
 * the NAM Lab wordmark keeps its existing spot in the toolbar.
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
      // Non-fatal — worst case the bar doesn't remember across restarts.
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

  // isMac only matters when the bar is the topmost element (IR / NAM Projects) and has to clear
  // the macOS traffic lights; under NAM mode's toolbar it never does.
  const bar = (
    <ModeBar mode={mode} onChange={setMode} isMac={mode === 'nam' ? false : isMac} />
  )

  if (mode === 'nam') return <App headerAccessory={bar} />

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {bar}
      <div className="flex-1 min-h-0 overflow-hidden">
        {mode === 'ir' ? <IrModeShell /> : <NamProjectsShell />}
      </div>
    </div>
  )
}
