/**
 * The NAM Lab identity chip + a "→ <area>" breadcrumb, for the IR and NAM Projects headers so
 * every mode reads as one app ("the app is still NAM Lab"). Reuses the exact `.nam-logo-chip` /
 * `.nam-logo-icon` / `.nam-logo-name` styles the toolbar's own logo uses, so it is visually the
 * same blue chip, just with the current workspace appended.
 */

const LABELS: Record<'nam' | 'ir' | 'nam-projects', string> = {
  nam: 'NAM',
  ir: 'IR',
  'nam-projects': 'Projects'
}

export function NamLabCrumb({ mode }: { mode: 'nam' | 'ir' | 'nam-projects' }): React.ReactElement {
  return (
    <div className="nam-logo-chip flex items-center gap-2 flex-shrink-0">
      <div className="nam-logo-icon">
        <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2.2}
            d="M3 12h2m0 0V9m0 3v3m4-7v8m0-8v8m4-11v14m0-14v14m4-9v4m0-4v4m4-7v10"
          />
        </svg>
      </div>
      <span className="nam-logo-name">NAM Lab</span>
      <span className="text-nm-text-3 text-sm leading-none">→</span>
      <span className="text-sm font-medium text-nm-text-2">{LABELS[mode]}</span>
    </div>
  )
}
