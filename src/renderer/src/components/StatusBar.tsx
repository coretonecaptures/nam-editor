interface StatusBarProps {
  message: string
  type: 'info' | 'success' | 'error'
  logPath?: string
}

export function StatusBar({ message, type, logPath }: StatusBarProps) {
  const isActiveProgress = type === 'info' && (
    /loading|scanning|saving|copying metadata/i.test(message) ||
    /\b\d+\s*\/\s*\d+\s*file\(s\)\.\.\./i.test(message)
  )

  const dotClass = type === 'success' ? 'bg-green-500'
    : type === 'error' ? 'bg-red-400'
    : isActiveProgress ? 'bg-amber-400 animate-pulse shadow-[0_0_10px_rgba(251,191,36,0.7)]'
    : 'bg-gray-400 dark:bg-gray-600'

  const textClass = type === 'success' ? 'text-green-500'
    : type === 'error' ? 'text-red-400'
    : isActiveProgress ? 'text-amber-400 animate-pulse'
    : 'text-gray-500'

  const barClass = isActiveProgress
    ? 'bg-amber-500/10 border-amber-500/30'
    : 'bg-gray-100 dark:bg-gray-900 border-gray-200 dark:border-gray-800'

  return (
    <div className={`h-6 flex items-center gap-2 px-4 border-t flex-shrink-0 transition-colors ${barClass}`}>
      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotClass}`} />
      <span className={`text-xs ${textClass}`}>{message}</span>
      {logPath && type === 'error' && (
        <button
          onClick={() => window.api.revealFile(logPath)}
          className="text-xs text-red-400 underline hover:text-red-300 transition-colors ml-1"
          title={logPath}
        >
          view log
        </button>
      )}
      <div className="flex-1" />
      <span className="text-xs text-gray-400 dark:text-gray-700">{import.meta.env['VITE_APP_VERSION'] ?? ''}</span>
    </div>
  )
}
