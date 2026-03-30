import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './assets/index.css'

// Electron on Windows loses webContents focus after native dialogs (confirm/alert/prompt).
// Wrap window.confirm to refocus after every call so inputs don't go dead.
const _nativeConfirm = window.confirm.bind(window)
window.confirm = (message?: string): boolean => {
  const result = _nativeConfirm(message)
  // Fire-and-forget — just need the main process to call webContents.focus()
  ;(window as any).api?.refocusWindow?.()
  return result
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
