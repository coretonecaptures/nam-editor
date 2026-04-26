import type { HistoryEntry } from '../App'

interface Props {
  entries: HistoryEntry[]
  onClear: () => void
  onClose: () => void
}

const OPERATION_LABELS: Record<string, string> = {
  'save': 'Save',
  'save-all': 'Save All',
  'batch-edit': 'Batch Edit',
  'rename': 'Rename',
  'batch-rename': 'Batch Rename',
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function OperationBadge({ operation }: { operation: string }) {
  const colors: Record<string, string> = {
    'save': 'bg-emerald-900/60 text-emerald-300',
    'save-all': 'bg-emerald-900/60 text-emerald-300',
    'batch-edit': 'bg-indigo-900/60 text-indigo-300',
    'rename': 'bg-amber-900/60 text-amber-300',
    'batch-rename': 'bg-amber-900/60 text-amber-300',
  }
  const color = colors[operation] ?? 'bg-gray-800 text-gray-400'
  const label = OPERATION_LABELS[operation] ?? operation
  return (
    <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded ${color} flex-shrink-0`}>
      {label}
    </span>
  )
}

export function SessionHistoryPanel({ entries, onClear, onClose }: Props) {
  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
        <svg className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 flex-1">Session History</span>
        {entries.length > 0 && (
          <button
            onClick={onClear}
            className="text-[10px] text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors px-1.5 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-950/40"
          >
            Clear
          </button>
        )}
        <button
          onClick={onClose}
          className="text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-300 transition-colors ml-1"
          title="Close"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-6">
            <svg className="w-8 h-8 text-gray-300 dark:text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs text-gray-400 dark:text-gray-600">No actions recorded yet</p>
            <p className="text-[11px] text-gray-300 dark:text-gray-700">Saves, edits, and renames appear here</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800/60">
            {entries.map((entry) => (
              <div key={entry.id} className="px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                <div className="flex items-start gap-2">
                  <OperationBadge operation={entry.operation} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-700 dark:text-gray-300 leading-snug">{entry.summary}</p>
                    <p className="text-[10px] text-gray-400 dark:text-gray-600 mt-0.5">{formatTime(entry.timestamp)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {entries.length > 0 && (
        <div className="px-3 py-1.5 border-t border-gray-200 dark:border-gray-800 flex-shrink-0">
          <p className="text-[10px] text-gray-400 dark:text-gray-600">{entries.length} action{entries.length !== 1 ? 's' : ''} this session</p>
        </div>
      )}
    </div>
  )
}
