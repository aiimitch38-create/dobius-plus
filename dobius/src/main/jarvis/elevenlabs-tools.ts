const API_ROOT = 'https://api.elevenlabs.io/v1/convai'
const TIMEOUT_MS = 15_000

/**
 * One client-side tool as ElevenLabs stores it.
 *
 * `parameters` is a JSON-Schema OBJECT (`{type: 'object', properties: {…}}`) —
 * NOT an array of parameter descriptors. The array shape is accepted by the API
 * and then silently never invoked, which reads as "the model ignores the tool".
 */
export type ClientToolConfig = {
  name: string
  description: string
  expects_response: boolean
  parameters: Record<string, unknown>
}

export type ToolSummary = { id: string; name: string }

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** The shell tool this build registers. */
export const PROPOSE_SHELL_TOOL: ClientToolConfig = {
  name: 'propose_shell',
  description:
    "Run a shell command on the user's Mac. Read-only commands (ls, cat, df, ps, system_profiler, networksetup and similar) run immediately and you get the output back. Anything that writes or changes the machine is put on screen for the user to approve — you will be told it is waiting, and you must ask them to read it and click Run. You cannot approve it yourself. Use this for app launching, system settings, hardware telemetry and file inspection.",
  expects_response: true,
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description:
          'The full command line, e.g. "df -h" or "system_profiler SPHardwareDataType". Quote any argument containing spaces.'
      }
    },
    required: ['command']
  }
}

async function callApi<T>(
  url: string,
  apiKey: string,
  init: RequestInit,
  fetchImpl: typeof fetch
): Promise<ApiResult<T>> {
  let response: Response
  try {
    response = await fetchImpl(url, {
      ...init,
      headers: { 'xi-api-key': apiKey, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    // Mirrors fetchAgentSignedUrl: a 401 here is almost always a key without the
    // Conversational AI permission, which is invisible from the key itself.
    const hint = response.status === 401 ? ' — the key needs convai_write.' : ''
    return { ok: false, error: `ElevenLabs HTTP ${response.status}${hint} ${body.slice(0, 160)}`.trim() }
  }
  try {
    return { ok: true, value: (await response.json()) as T }
  } catch {
    return { ok: false, error: 'ElevenLabs returned an unreadable response.' }
  }
}

export async function listClientTools(
  apiKey: string,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<ToolSummary[]>> {
  const result = await callApi<{ tools?: { id?: unknown; tool_config?: { name?: unknown } }[] }>(
    `${API_ROOT}/tools`,
    apiKey,
    { method: 'GET' },
    fetchImpl
  )
  if (!result.ok) {
    return result
  }
  const tools = (result.value.tools ?? [])
    .map((tool) => ({ id: String(tool?.id ?? ''), name: String(tool?.tool_config?.name ?? '') }))
    .filter((tool) => tool.id && tool.name)
  return { ok: true, value: tools }
}

export async function createClientTool(
  apiKey: string,
  config: ClientToolConfig,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<string>> {
  const result = await callApi<{ id?: unknown; tool_id?: unknown }>(
    `${API_ROOT}/tools`,
    apiKey,
    { method: 'POST', body: JSON.stringify({ tool_config: { type: 'client', ...config } }) },
    fetchImpl
  )
  if (!result.ok) {
    return result
  }
  const id = String(result.value.id ?? result.value.tool_id ?? '')
  return id ? { ok: true, value: id } : { ok: false, error: 'ElevenLabs returned no tool id.' }
}

export type AgentPrompt = Record<string, unknown> & { tool_ids?: unknown }

/** The agent's whole prompt block, so a later PATCH can send it back intact. */
export async function getAgentPrompt(
  apiKey: string,
  agentId: string,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ prompt: AgentPrompt; toolIds: string[] }>> {
  const result = await callApi<{
    conversation_config?: { agent?: { prompt?: AgentPrompt } }
  }>(`${API_ROOT}/agents/${encodeURIComponent(agentId)}`, apiKey, { method: 'GET' }, fetchImpl)
  if (!result.ok) {
    return result
  }
  const prompt = result.value.conversation_config?.agent?.prompt ?? {}
  const ids = prompt.tool_ids
  return { ok: true, value: { prompt, toolIds: Array.isArray(ids) ? ids.map(String) : [] } }
}

/**
 * Attaches a tool list, sending the agent's EXISTING prompt back with it.
 *
 * Why the whole prompt and not just `{tool_ids}`: this PATCHes the user's live
 * agent on their real ElevenLabs account, and whether the API deep-merges a
 * nested object or replaces it is not something this build can verify without
 * making billed calls against Carson's account. If it replaces, a bare
 * `{tool_ids: [...]}` silently wipes the agent's system prompt, first_message
 * and LLM choice — unrecoverable from here and invisible until the next call
 * sounds wrong. Round-tripping the prompt makes both semantics safe, and costs
 * one field.
 */
export async function setAgentToolIds(
  apiKey: string,
  agentId: string,
  toolIds: string[],
  prompt: AgentPrompt = {},
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<true>> {
  const result = await callApi<unknown>(
    `${API_ROOT}/agents/${encodeURIComponent(agentId)}`,
    apiKey,
    {
      method: 'PATCH',
      body: JSON.stringify({
        conversation_config: { agent: { prompt: { ...prompt, tool_ids: toolIds } } }
      })
    },
    fetchImpl
  )
  return result.ok ? { ok: true, value: true } : result
}

/**
 * Makes sure one tool exists and is attached to the agent.
 *
 * Idempotent by NAME, so relaunching cannot accumulate duplicate tools. Attaches
 * by appending to the agent's existing tool_ids rather than replacing them —
 * writing a fresh list here would detach `ask_adam` and every other tool that
 * this build did not create.
 */
export async function ensureClientTool(
  apiKey: string,
  agentId: string,
  config: ClientToolConfig,
  fetchImpl: typeof fetch = fetch
): Promise<ApiResult<{ id: string; created: boolean; attached: boolean }>> {
  if (!apiKey.trim() || !agentId.trim()) {
    return { ok: false, error: 'No ElevenLabs API key or agent ID saved in Settings → Voice.' }
  }
  const existing = await listClientTools(apiKey, fetchImpl)
  if (!existing.ok) {
    return existing
  }
  const match = existing.value.find((tool) => tool.name === config.name)
  let created = false
  let id = match?.id ?? ''
  if (!id) {
    const made = await createClientTool(apiKey, config, fetchImpl)
    if (!made.ok) {
      return made
    }
    id = made.value
    created = true
  }
  const agent = await getAgentPrompt(apiKey, agentId, fetchImpl)
  if (!agent.ok) {
    return agent
  }
  if (agent.value.toolIds.includes(id)) {
    return { ok: true, value: { id, created, attached: false } }
  }
  const patched = await setAgentToolIds(
    apiKey,
    agentId,
    [...agent.value.toolIds, id],
    agent.value.prompt,
    fetchImpl
  )
  if (!patched.ok) {
    return patched
  }
  return { ok: true, value: { id, created, attached: true } }
}
