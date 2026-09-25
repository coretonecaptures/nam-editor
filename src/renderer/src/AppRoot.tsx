import { useEffect, useState } from 'react'
import App from './App'
import { IrModeShell } from './components/ir/IrModeShell'
import { NamProjectsShell } from './components/ir/NamProjectsShell'
import { ModeRail, type AppMode } from './components/ModeRail'
import { onGoToTrainingBatches, onGoToNamProject, goToNamProject } from './appNav'

const MODE_KEY = 'nam-lab-app-mode'

// Read once at module load, same "settings.json is loaded synchronously in preload, before any
// shell's own live appSettings state exists yet" pattern IrModeShell.tsx already establishes for
// exactly this kind of pre-mount decision. Deliberately session-scoped, not live-reactive: a
// change made via Settings → Workspace Modes takes effect the next time the app launches or a
// mode is switched into, not mid-session in whichever shell the user happens to be sitting in —
// see the plan doc's own "known, deliberate limitation" note for why that tradeoff was made
// rather than threading a live-update callback through all three shells' separate SettingsPanel
// instances for a setting this infrequently changed.
function readEnabledModes(): { ir: boolean; namProjects: boolean } {
  const settings = (window.api.initialSettings ?? {}) as { enableIrMode?: boolean; enableNamProjectsMode?: boolean }
  return {
    ir: settings.enableIrMode !== false,
    namProjects: settings.enableNamProjectsMode !== false
  }
}

function readMode(enabled: { ir: boolean; namProjects: boolean }): AppMode {
  try {
    const stored = localStorage.getItem(MODE_KEY)
    if (stored === 'ir' && enabled.ir) return stored
    if (stored === 'nam-projects' && enabled.namProjects) return stored
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
  const [enabledModes] = useState(readEnabledModes)
  const [mode, setMode] = useState<AppMode>(() => readMode(enabledModes))
  const hiddenModes = new Set<AppMode>()
  if (!enabledModes.ir) hiddenModes.add('ir')
  if (!enabledModes.namProjects) hiddenModes.add('nam-projects')

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

  // IR Lab's "Manage in NAM Lab..." button -> namlab://project?id=<x> -> main process resolves
  // it and either pushes namlab:openProject (already running) or we pull it once on mount
  // (cold launch, avoids the did-finish-load subscribe race). Either way it lands in appNav's
  // pending-nav slot and flips this shell to NAM Projects mode — unless the user has hidden that
  // mode, in which case a deep link shouldn't silently re-open it behind their back.
  useEffect(() => onGoToNamProject(() => { if (enabledModes.namProjects) setMode('nam-projects') }), [enabledModes.namProjects])
  useEffect(() => {
    const unsubscribe = window.api.onNamLabOpenProject((projectId) => goToNamProject(projectId))
    window.api.getPendingNamLabProject().then((projectId) => {
      if (projectId) goToNamProject(projectId)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
      if (e.key === '1') setMode('nam')
      else if (e.key === '2' && enabledModes.ir) setMode('ir')
      else if (e.key === '3' && enabledModes.namProjects) setMode('nam-projects')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabledModes.ir, enabledModes.namProjects])

  const rail = <ModeRail mode={mode} onChange={setMode} hiddenModes={hiddenModes} />

  if (mode === 'ir') return <IrModeShell leftRail={rail} />
  if (mode === 'nam-projects') return <NamProjectsShell leftRail={rail} />
  return <App leftRail={rail} />
}
