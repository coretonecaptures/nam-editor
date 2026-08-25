import { useEffect, useState } from 'react'
import App from './App'
import { IrModeShell } from './components/ir/IrModeShell'

type Mode = 'nam' | 'ir'
const MODE_KEY = 'nam-lab-app-mode'

/**
 * NAM/IR top-level mode switcher (docs/ir-lab-manager-build-plan.md section 10). Deliberately a
 * thin wrapper rather than folding the toggle into App.tsx's own layout: App's root uses
 * `h-screen` assuming it IS the viewport root, and IrModeShell does the same — nesting either
 * under a shared header/flex container would shrink its available height incorrectly. The toggle
 * is a floating overlay instead, so each mode keeps its own full-height root untouched.
 */
export default function AppRoot(): React.ReactElement {
  const [mode, setMode] = useState<Mode>(() => {
    try {
      return localStorage.getItem(MODE_KEY) === 'ir' ? 'ir' : 'nam'
    } catch {
      return 'nam'
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode)
    } catch {
      // Non-fatal — worst case the toggle doesn't remember across restarts.
    }
  }, [mode])

  return (
    <>
      {mode === 'nam' ? <App /> : <IrModeShell />}
      {/*
        Windows: BrowserWindow uses titleBarStyle 'hidden' + a titleBarOverlay (src/main/index.ts
        createWindow) -- Electron draws the real minimize/maximize/close buttons as OS-composited
        chrome in the top-right ~32px, on top of any web content there, invisibly. macOS uses
        'hiddenInset' instead, which puts traffic-light buttons top-LEFT. top-10 clears the
        Windows overlay height (32px) with margin and is nowhere near the Mac traffic lights.
      */}
      <div className="fixed top-10 right-3 z-[100] flex rounded-md overflow-hidden border border-gray-300 dark:border-gray-700 shadow-sm text-xs">
        <button
          onClick={() => setMode('nam')}
          className={`px-2.5 py-1 ${mode === 'nam' ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
        >
          NAM
        </button>
        <button
          onClick={() => setMode('ir')}
          className={`px-2.5 py-1 ${mode === 'ir' ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}
        >
          IR
        </button>
      </div>
    </>
  )
}
