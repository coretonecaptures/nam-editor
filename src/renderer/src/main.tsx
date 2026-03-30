import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './assets/index.css'

// Electron on Windows with a hidden titlebar loses webContents focus whenever
// the focused DOM element is removed (e.g. a panel closes after batch edit),
// or after native dialogs close. Alt+Tab restores it because that fires a
// window focus event. Fix: proactively refocus on every mousedown so the user
// never notices the gap.
document.addEventListener('mousedown', () => {
  ;(window as any).api?.refocusWindow?.()
})

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
