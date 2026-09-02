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
 * NAM / IR / NAM Projects top-level switcher. Each shell owns the whole viewport including its own
 * top bar, so the mode switcher can't wrap them and can't sit above them. Instead every shell
 * takes a `leftRail` node and renders it as the left column of its working area — below its top
 * bar, never over the top-left corner or the NAM Lab wordmark.
 *
 * Keyboard: Cmd/Ctrl+1/2/3 jump between modes.
 */
export default function AppRoot(): React.ReactElement {
  const [mode, setMode] = useState<AppMode>(readMode)

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

  const rail = <ModeRail mode={mode} onChange={setMode} />

  if (mode === 'ir') return <IrModeShell leftRail={rail} />
  if (mode === 'nam-projects') return <NamProjectsShell leftRail={rail} />
  return <App leftRail={rail} />
}
