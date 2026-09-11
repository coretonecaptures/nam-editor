/**
 * One tooltip/disabled-state rule for every "Send to IR Lab" button in the app (IrTray, NAM
 * Projects' session/project send, Play Groups), so a user sees the same explanation everywhere
 * instead of each button inventing its own wording. Distinguishes build-time (was the connector
 * compiled into this build at all — `connectorAvailable`) from runtime (has IR Lab actually run on
 * this machine, and what did it last report — `status`, from `irLibraryGetIrLabStatus()`).
 */
export interface IrLabStatus {
  installed: boolean
  version: string | null
  licenseState: 'licensed' | 'unlicensed' | 'unknown'
  trialDaysRemaining: number | null
}

export interface IrLabAvailability {
  /** Whether the send action should be clickable at all. */
  disabled: boolean
  /** Tooltip explaining why, or what will happen. */
  tooltip: string
}

export function describeIrLabAvailability(
  connectorAvailable: boolean,
  status: IrLabStatus | null,
  actionLabel: string
): IrLabAvailability {
  if (!connectorAvailable) {
    return { disabled: true, tooltip: 'IR Lab connector not configured in this build' }
  }
  if (!status || !status.installed) {
    return {
      disabled: false,
      tooltip: "IR Lab hasn't reported running on this machine yet — install and launch it once, then try this."
    }
  }
  if (status.licenseState === 'unlicensed') {
    const trial =
      status.trialDaysRemaining != null
        ? ` (${status.trialDaysRemaining} trial day${status.trialDaysRemaining === 1 ? '' : 's'} left)`
        : ''
    return { disabled: false, tooltip: `${actionLabel} — IR Lab is unlicensed${trial}` }
  }
  const version = status.version ? ` (v${status.version})` : ''
  return { disabled: false, tooltip: `${actionLabel} in IR Lab${version}` }
}
