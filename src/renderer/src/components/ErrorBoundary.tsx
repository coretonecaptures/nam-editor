import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
  info: string
}

// Root-level error boundary. Without this, ANY uncaught exception thrown during a
// React render unmounts the entire tree and leaves a permanently blank screen with
// no way back. The boundary catches it, logs full detail to the main-process error
// log (via console.error, which main mirrors), and offers a recover/reload path.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // console.error is mirrored into the main-process log (see console-message handler
    // in main/index.ts), so this leaves a durable trace of what blanked the UI.
    console.error('UI crash caught by ErrorBoundary:', error?.stack || String(error), info?.componentStack)
    this.setState({ info: info?.componentStack ?? '' })
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  private handleDismiss = (): void => {
    this.setState({ error: null, info: '' })
  }

  render(): ReactNode {
    const { error, info } = this.state
    if (!error) return this.props.children

    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#030712] p-8 text-nm-text">
        <div className="max-w-2xl w-full rounded-xl border border-nm-border-s bg-field p-6 space-y-4">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <h1 className="text-lg font-semibold">Something went wrong</h1>
          </div>
          <p className="text-[13px] text-nm-text-2">
            The interface hit an unexpected error and stopped rendering. Your training queue and
            files are unaffected — the trainer keeps running in the background. You can try to
            recover the screen, or reload the app.
          </p>
          <pre className="max-h-48 overflow-auto rounded-lg bg-[#0b0f1a] p-3 text-[11px] leading-relaxed text-red-300 whitespace-pre-wrap">
            {error.message}
            {info ? `\n${info}` : ''}
          </pre>
          <div className="flex gap-2">
            <button
              onClick={this.handleDismiss}
              className="h-9 px-4 rounded-lg border border-nm-border-s bg-field text-[13px] hover:bg-white/5"
            >
              Try to recover
            </button>
            <button
              onClick={this.handleReload}
              className="h-9 px-4 rounded-lg bg-nm-accent text-[13px] font-medium text-white hover:opacity-90"
            >
              Reload app
            </button>
          </div>
        </div>
      </div>
    )
  }
}
