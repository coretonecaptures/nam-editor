/**
 * Renderer half of "Publish to IR Lab Library" (NAML-3): plan (read-only) -> one confirmation that
 * names the destination, copies and conflicts -> publish -> optionally open in IR Lab. Returns the
 * status line to show; never claims IR Lab loaded anything, only that the link was sent.
 */
export async function publishModelsToIrLab(modelPaths: string[]): Promise<string> {
  if (modelPaths.length === 0) return 'No trained models to publish.'
  const planned = await window.api.irLibraryPlanPublishToIrLab(modelPaths)
  if (!planned.success || !planned.plan) return planned.reason ?? 'Could not plan the publish.'
  const { entries, destFolder } = planned.plan
  const count = (action: string): number => entries.filter((e) => e.action === action).length
  const copies = count('copy')
  const reused = count('identical') + count('alreadyInLibrary')
  const conflicts = count('conflict')
  const missing = count('missing')
  if (copies + reused + conflicts === 0) return 'None of the selected model files exist on disk.'

  const lines = [
    `Destination: ${destFolder}`,
    `${copies} to copy, ${reused} already in IR Lab's NAM folder.`,
    conflicts > 0 ? `${conflicts} name${conflicts === 1 ? ' is' : 's are'} already used by a different model — kept as a renamed copy, nothing is overwritten.` : '',
    missing > 0 ? `${missing} model file${missing === 1 ? ' is' : 's are'} missing and will be skipped.` : ''
  ].filter(Boolean)
  const choice = await window.api.showMessageBox({
    type: 'question',
    title: 'Publish to IR Lab',
    message: `Publish ${copies + reused + conflicts} trained model${copies + reused + conflicts === 1 ? '' : 's'} to IR Lab?`,
    detail: lines.join('\n'),
    buttons: ['Publish and Open in IR Lab', 'Publish Only', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  })
  if (choice.response === 2) return 'Publish cancelled.'
  const result = await window.api.irLibraryPublishToIrLab(modelPaths, { keepBoth: conflicts > 0, open: choice.response === 0 })
  return result.reason ?? (result.success ? 'Published.' : 'Publish failed.')
}
