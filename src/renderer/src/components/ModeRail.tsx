import beakerMark from '../assets/images/beaker.only.transparent.png'

/**
 * Skinny left navigation rail — the persistent switcher between the app's three top-level
 * workspaces (NAM `.nam` editor, IR cabinet library, NAM Projects capture folders). Replaces
 * the floating `fixed top-10 right-3` overlay pill that used to live in AppRoot.
 *
 * Modelled on the VS Code activity bar / Discord server rail / the Wonderverse skinny bar the
 * user referenced: a ~48px column pinned to the window's left edge, one square icon per mode,
 * the active one lit with a left accent bar. The NAM Lab beaker mark sits at the top so the
 * app's identity is anchored top-left in *every* mode (today it only shows in NAM mode's
 * Toolbar) — the rail promotes it, it never hides it.
 *
 * Icons are abstract line art in the app's standard idiom (`viewBox 0 0 24 24`, `fill="none"`,
 * `stroke="currentColor"`, `strokeWidth 2`):
 *   NAM          → waveform bars (a model built from audio)
 *   IR           → speaker cabinet (impulse responses are cab captures)
 *   NAM Projects → folder (capture projects on disk)
 *
 * The empty top area is a window drag region (`WebkitAppRegion: drag`) with a platform-aware
 * inset so it clears the macOS traffic lights; the buttons themselves are `no-drag`.
 */

export type AppMode = 'nam' | 'ir' | 'nam-projects'

const MODES: Array<{ mode: AppMode; label: string; hint: string; icon: React.ReactElement }> = [
  {
    mode: 'nam',
    label: 'NAM',
    hint: 'NAM — edit .nam model metadata',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
        <path d="M4 10v4M8 6v12M12 3v18M16 8v8M20 11v2" />
      </svg>
    )
  },
  {
    mode: 'ir',
    label: 'IR',
    hint: 'IR — browse the impulse-response cabinet library',
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
    hint: 'NAM Projects — capture WAV projects staged for training',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round">
        <path d="M3 7.5a2 2 0 012-2h3.6a2 2 0 011.4.6l1.4 1.4H19a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
      </svg>
    )
  }
]

export function ModeRail({
  mode,
  onChange,
  isMac
}: {
  mode: AppMode
  onChange: (mode: AppMode) => void
  isMac: boolean
}): React.ReactElement {
  return (
    <nav
      aria-label="Workspace"
      className="flex-shrink-0 w-12 h-screen flex flex-col items-center bg-panel-2 border-r border-nm-border select-none"
      style={{ WebkitAppRegion: 'drag', paddingTop: isMac ? 28 : 8 } as React.CSSProperties}
    >
      <div
        className="w-7 h-7 mb-1.5 opacity-90 flex items-center justify-center"
        title="NAM Lab"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <img src={beakerMark} alt="NAM Lab" className="w-full h-full object-contain" />
      </div>
      <div className="w-6 h-px bg-nm-border mb-1.5" />

      <div className="flex flex-col gap-1" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
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
              className={`relative w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                active
                  ? 'bg-active-bg text-nm-accent'
                  : 'text-nm-text-3 hover:text-nm-text hover:bg-hov'
              }`}
            >
              {active && (
                <span className="absolute -left-1 top-1.5 bottom-1.5 w-0.5 rounded-full bg-nm-accent" />
              )}
              <span className="w-5 h-5">{icon}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
