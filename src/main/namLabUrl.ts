/**
 * The `namlab://` receiving side — the reverse of the `irlab://` scheme this app already SENDS
 * to IR Lab. IR Lab's own "Manage in NAM Lab..." button (ir-lab MainComponent.cpp) fires
 * `namlab://project?id=<projectId>`. Pure and side-effect-free so it's testable without Electron;
 * `index.ts` wires the result into window focus + appNav's cross-mode nav.
 */
export type NamLabUrl =
  | { route: 'project'; id: string }
  /** IR Lab's "Train in NAM Lab": `namlab://train?project=<id>&capture=<id>&capture=...`, or
   * `&scope=untrained` for every capture NAM Lab's own result files say is untrained. Never
   * auto-runs anything — NAM Lab opens a review dialog first. */
  | { route: 'train'; projectId: string; captureIds: string[]; scope: 'selected' | 'untrained'; projectFolder: string | null }
  /** IR Lab's "Open NAM library in NAM Lab": `namlab://library?path=<absolute folder>`. Opens NAM
   * mode on that folder (asking first if it isn't already the library). Never scans or moves files
   * on its own. */
  | { route: 'library'; path: string }

export function parseNamLabUrl(urlString: string): NamLabUrl | null {
  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    return null
  }
  if (url.protocol !== 'namlab:') return null
  // Node's URL treats "namlab://project?id=x" as host="project" (same shape IR Lab's own
  // ExternalHandoffRouter.cpp reads via juce::URL::getDomain() for its irlab:// routes).
  const route = url.hostname
  if (route === 'project') {
    const id = url.searchParams.get('id')
    return id ? { route: 'project', id } : null
  }
  if (route === 'train') {
    const projectId = url.searchParams.get('project')
    if (!projectId) return null
    const captureIds = url.searchParams.getAll('capture').filter((c) => c.length > 0)
    const projectFolder = url.searchParams.get('path') || null
    if (url.searchParams.get('scope') === 'untrained') {
      return { route: 'train', projectId, captureIds: [], scope: 'untrained', projectFolder }
    }
    if (captureIds.length === 0) return null
    return { route: 'train', projectId, captureIds, scope: 'selected', projectFolder }
  }
  if (route === 'library') {
    const path = url.searchParams.get('path')
    return path ? { route: 'library', path } : null
  }
  return null
}
