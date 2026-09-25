/**
 * What the Codex engine can honestly enforce for a run. `codex exec` has no
 * turn, budget or per-tool options and never goes through the Claude SDK's
 * canUseTool or the PreToolUse hard-rail hook, so a run that depends on any of
 * those limits is refused before a slot is reserved or a process is spawned.
 */

/** Same default ceiling as a Claude run's maxTurns. */
export const DEFAULT_CODEX_MAX_STEPS = 100

type CodexRunRequest = {
  source?: string
  profile?: string
  allowedTools?: readonly string[]
  permissionMode?: string
  maxBudgetUsd?: number
  outputFormat?: unknown
  onResult?: unknown
}

export class CodexRunUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CodexRunUnsupportedError'
  }
}

export function codexRunRejection(options: CodexRunRequest | undefined): string | null {
  const profile = options?.profile ?? options?.source ?? 'manual'
  if (profile !== 'manual') {
    return `Codex agents cannot run the '${profile}' profile: its tool limits and hard rails are only enforced on the Claude engine.`
  }
  if (options?.allowedTools !== undefined) {
    return 'Codex agents cannot run with a restricted tool list: Codex does not enforce per-tool limits.'
  }
  if (options?.permissionMode !== undefined) {
    return `Codex agents cannot run with permission mode '${options.permissionMode}': Codex uses its own sandbox setting.`
  }
  if (options?.maxBudgetUsd !== undefined) {
    return 'Codex agents cannot run with a dollar budget: the Codex CLI reports no cost to enforce it against.'
  }
  if (options?.outputFormat !== undefined || options?.onResult !== undefined) {
    return 'Codex agents cannot return a structured result: use a Claude agent for this run.'
  }
  return null
}

export function isCodexRunUnsupportedError(error: unknown): error is CodexRunUnsupportedError {
  return error instanceof CodexRunUnsupportedError
}

export function assertCodexRunSupported(options: CodexRunRequest | undefined): void {
  const rejection = codexRunRejection(options)
  if (rejection) {
    throw new CodexRunUnsupportedError(rejection)
  }
}

const CODEX_TOOL_ITEM_TYPES = new Set([
  'command_execution',
  'file_change',
  'mcp_tool_call',
  'web_search',
  // Multi-agent (spawned sub-agent) calls, codex 0.156+.
  'collab_tool_call'
])

/** The id of a tool step (command, file edit, MCP call, web search) a JSONL event reports, else null. */
export function codexToolStepFromLine(line: string): string | null {
  try {
    const event = JSON.parse(line) as Record<string, unknown>
    if (event.type !== 'item.started' && event.type !== 'item.completed') {
      return null
    }
    const item = event.item as Record<string, unknown> | undefined
    if (!item || typeof item.type !== 'string' || !CODEX_TOOL_ITEM_TYPES.has(item.type)) {
      return null
    }
    return typeof item.id === 'string' ? item.id : line
  } catch {
    return null
  }
}
