// fetch_workspace_icon: reads a community's icon from its relay's NIP-11
// relay-information document (see vendor/buzz-desktop/src/shared/api/
// communityProfile.ts — the icon is a small data: URL an admin published in a
// kind:9033 event and the relay serves back in NIP-11's `icon` field). This
// call happens in the main process (not the sandboxed Buzz webview) so it can
// reach an arbitrary community relay's plain HTTP endpoint without a CORS
// restriction, mirroring why the original Tauri command was native too.
const FETCH_TIMEOUT_MS = 5_000

function toInfoDocumentUrl(relayUrl: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(relayUrl)
  } catch {
    return null
  }
  if (parsed.protocol === 'ws:') {parsed.protocol = 'http:'}
  else if (parsed.protocol === 'wss:') {parsed.protocol = 'https:'}
  else if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {return null}
  return parsed.toString()
}

/** Fetches a relay's NIP-11 icon. Returns null for an unreachable relay or a missing/blank icon field. */
export async function fetchWorkspaceIcon(relayUrl: string): Promise<string | null> {
  const infoUrl = toInfoDocumentUrl(relayUrl)
  if (!infoUrl) {return null}

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(infoUrl, {
      headers: { Accept: 'application/nostr+json' },
      signal: controller.signal
    })
    if (!response.ok) {return null}
    const document = (await response.json()) as { icon?: unknown }
    return typeof document.icon === 'string' && document.icon.length > 0 ? document.icon : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
