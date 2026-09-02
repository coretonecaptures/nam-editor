/**
 * Skinny vertical navigation rail — the persistent switcher between the app's three top-level
 * workspaces (NAM `.nam` editor, IR cabinet library, NAM Projects capture folders). Replaces the
 * floating `fixed top-10 right-3` overlay pill that used to live in AppRoot.
 *
 * It is rendered *inside* each shell's working area, below that shell's own top bar — the top
 * bar (and the NAM Lab wordmark in it) is never touched or covered, and the rail never occupies
 * the top-left window corner. A ~44px column down the left edge, one square line-art icon per
 * mode, the active one lit with a left accent bar (VS Code activity bar / Discord rail idiom).
 *
 * Icons follow the app's standard idiom (`viewBox 0 0 24 24`, `fill="none"`,
 * `stroke="currentColor"`, `strokeWidth 2`):
 *   NAM          → waveform bars (a model built from audio)
 *   IR           → speaker cabinet (impulse responses are cab captures)
 *   NAM Projects → folder (capture projects on disk)
 */

export type AppMode = 'nam' | 'ir' | 'nam-projects'

const MODES: Array<{ mode: AppMode; label: string; hint: string; icon: React.ReactElement }> = [
  {
    mode: 'nam',
    label: 'NAM',
    hint: 'NAM — edit .nam model metadata  (Ctrl/Cmd+1)',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
        <path d="M4 10v4M8 6v12M12 3v18M16 8v8M20 11v2" />
      </svg>
    )
  },
  {
    mode: 'ir',
    label: 'IR',
    hint: 'IR — browse the impulse-response cabinet library  (Ctrl/Cmd+2)',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
        <rect x="5" y="3" width="14" height="18" rx="1.5" />
        <circle cx="12" cy="9" r="3.25" />
        <circle cx="12" cy="16.5" r="1.25" />
      </svg>
    )
  },
  {
    mode: 'nam-projects',
    label: 'NAM Projects',
    hint: 'NAM Projects — capture WAV projects staged for training  (Ctrl/Cmd+3)',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round">
        <path d="M3 7.5a2 2 0 012-2h3.6a2 2 0 011.4.6l1.4 1.4H19a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      </svg>
    )
  }
]

export function ModeRail({
  mode,
  onChange
}: {
  mode: AppMode
  onChange: (mode: AppMode) => void
}): React.ReactElement {
  return (
    <nav
      aria-label="Workspace"
      className="flex-shrink-0 w-11 h-full flex flex-col items-center gap-1 pt-2 bg-panel-2 border-r border-nm-border select-none"
    >
      {MODES.map(({ mode: m, label, hint, icon }) => {
        const active = mode === m
        return (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            title={hint}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            className={`relative w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
              active
                ? 'bg-active-bg text-nm-accent'
                : 'text-nm-text-3 hover:text-nm-text hover:bg-hov'
            }`}
          >
            {active && (
              <span className="absolute -left-2 top-1.5 bottom-1.5 w-0.5 rounded-full bg-nm-accent" />
            )}
            <span className="w-[18px] h-[18px]">{icon}</span>
          </button>
        )
      })}
    </nav>
  )
}
