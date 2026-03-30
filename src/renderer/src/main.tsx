import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './assets/index.css'

// Patch window.confirm to restore keyboard focus after native dialogs close.
// On Windows with hidden titlebar, confirm dialogs leave Chromium in a stale
// focus state. A blur→focus cycle in the main process resets it.
const _nativeConfirm = window.confirm.bind(window)
window.confirm = (message?: string): boolean => {
  const result = _nativeConfirm(message)
  ;(window as any).api?.refocusWindow?.()
  return result
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
