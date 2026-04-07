interface StatusBarProps {
  message: string
  type: 'info' | 'success' | 'error'
  logPath?: string
}

export function StatusBar({ message, type, logPath }: StatusBarProps) {
  const colors = {
    info: 'text-gray-500',
    success: 'text-green-500',
    error: 'text-red-400'
  }

  return (
    <div className="h-6 flex items-center gap-2 px-4 bg-gray-100 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 flex-shrink-0">
      <div
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
          type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-400' : 'bg-gray-400 dark:bg-gray-600'
        }`}
      />
      <span className={`text-xs ${colors[type]}`}>{message}</span>
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
