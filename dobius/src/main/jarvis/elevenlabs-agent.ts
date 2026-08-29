const SIGNED_URL_ENDPOINT = 'https://api.elevenlabs.io/v1/convai/conversation/get-signed-url'

export type AgentSignedUrlResult = { ok: true; url: string } | { ok: false; error: string }

/**
 * Mints a short-lived signed websocket URL for one agent conversation.
 *
 * Why main and not the renderer: the signed URL keeps the ElevenLabs API key
 * out of the renderer entirely — the renderer receives a URL that already
 * carries its own token and expires on its own.
 */
export async function fetchAgentSignedUrl(
  apiKey: string,
  agentId: string,
  fetchImpl: typeof fetch = fetch
): Promise<AgentSignedUrlResult> {
  if (!apiKey.trim()) {
    return { ok: false, error: 'No ElevenLabs API key saved in Settings → Voice.' }
  }
  if (!agentId.trim()) {
    return { ok: false, error: 'No ElevenLabs agent ID saved in Settings → Voice.' }
  }
  let response: Response
  try {
    response = await fetchImpl(`${SIGNED_URL_ENDPOINT}?agent_id=${encodeURIComponent(agentId.trim())}`, {
      headers: { 'xi-api-key': apiKey.trim() },
      signal: AbortSignal.timeout(15_000)
    })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    // 401 here is almost always a key scoped without convai permissions, which
    // is invisible from the key itself — say so instead of a bare status code.
    const hint =
      response.status === 401
        ? ' — the key needs the Conversational AI permission (convai_write).'
        : ''
    return { ok: false, error: `ElevenLabs HTTP ${response.status}${hint} ${body.slice(0, 160)}`.trim() }
  }
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return { ok: false, error: 'ElevenLabs returned an unreadable signed-url response.' }
  }
  const url = (payload as { signed_url?: unknown })?.signed_url
  if (typeof url !== 'string' || !url) {
    return { ok: false, error: 'ElevenLabs returned no signed_url.' }
  }
  return { ok: true, url }
}
