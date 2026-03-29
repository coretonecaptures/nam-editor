interface StatusBarProps {
  message: string
  type: 'info' | 'success' | 'error'
}

export function StatusBar({ message, type }: StatusBarProps) {
  const colors = {
    info: 'text-gray-500',
    success: 'text-green-500',
    error: 'text-red-400'
  }

  return (
    <div className="h-6 flex items-center gap-2 px-4 bg-gray-900 border-t border-gray-800 flex-shrink-0">
      <div
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
          type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-400' : 'bg-gray-600'
        }`}
      />
      <span className={`text-xs ${colors[type]}`}>{message}</span>
    </div>
  )
}
