/**
 * The `namlab://` receiving side — the reverse of the `irlab://` scheme this app already SENDS
 * to IR Lab. IR Lab's own "Manage in NAM Lab..." button (ir-lab MainComponent.cpp) fires
 * `namlab://project?id=<projectId>`. Pure and side-effect-free so it's testable without Electron;
 * `index.ts` wires the result into window focus + appNav's cross-mode nav.
 */
export interface NamLabUrl {
  route: 'project'
  id: string
}

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
  if (route !== 'project') return null
  const id = url.searchParams.get('id')
  if (!id) return null
  return { route: 'project', id }
}
