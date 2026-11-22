// Why: default-deny for the agent key. Background (sandboxed) agent runs and
// their postchecks get a narrower runtime key than Carson's own CLI and the
// interactive Dobius terminals. That key may only talk to other
// terminals, the orchestration mailbox and the Kanban work board, and read
// workspace state. Anything that starts processes or agent runs (including
// `agent.run --check`), changes settings, drives the browser or desktop,
// touches git/worktrees, or reads secrets is refused. A new RPC method is
// refused for agents until it is added here on purpose.

export const AGENT_RPC_METHOD_ALLOWLIST: ReadonlySet<string> = new Set([
  'status.get',
  // Terminals: read, wait on and message existing terminals. Sends are forced
  // through the agent-status guard (see scopeAgentRequestParams). Renaming is
  // not allowed: a title like "Codex ready" makes a shell look like an agent.
  'terminal.list',
  'terminal.show',
  'terminal.read',
  'terminal.wait',
  'terminal.send',
  'terminal.sendBound',
  'terminal.resolveActive',
  'terminal.resolvePane',
  'terminal.focus',
  'terminal.agentStatus',
  'terminal.isRunningAgent',
  // Board consoles (`dobius board consoles` / `board send` = resolve + terminal.send).
  'board.listConsoles',
  'board.resolveConsole',
  'board.agentState',
  // `dobius board list`: read-only card list. Card actions stay full-key only.
  'board.listCards',
  // Crew: only whether it is paused. Decisions and drafts hold tool inputs and
  // Asana text; every crew change stays full-key only.
  'crew.state',
  // Orchestration mailbox, task DAG and gates. Starting a coordinator run
  // (orchestration.run) dispatches autonomous workers, so it is not here.
  'orchestration.send',
  'orchestration.ask',
  'orchestration.check',
  'orchestration.reply',
  'orchestration.inbox',
  'orchestration.dispatch',
  'orchestration.dispatchShow',
  'orchestration.taskCreate',
  'orchestration.taskList',
  'orchestration.taskUpdate',
  'orchestration.gateCreate',
  'orchestration.gateList',
  'orchestration.gateResolve',
  // The Kanban work board for Hermes leads and worker consoles.
  'tasks.list',
  'tasks.show',
  'tasks.create',
  'tasks.claim',
  'tasks.heartbeat',
  'tasks.complete',
  'tasks.block',
  'tasks.review',
  'tasks.release',
  'tasks.comment',
  'tasks.attach',
  // Read-only workspace lookups the CLI uses to resolve selectors.
  'worktree.list',
  'worktree.show',
  'worktree.ps',
  'repo.list',
  'project.list'
])

const OUTSIDE_DOBIUS_HINT =
  'Background agent runs use a limited Dobius key. Ask Carson to run this command from his own terminal.'

/** Why the agent key may not make this call, or null when it may. */
export function agentRpcDenial(method: string, params: unknown): string | null {
  if (!AGENT_RPC_METHOD_ALLOWLIST.has(method)) {
    return `'${method}' is not allowed with the agent key. ${OUTSIDE_DOBIUS_HINT}`
  }
  // Why: attaching by path makes the app read a file outside the agent's own
  // sandbox and hand it back on the card; agents must send the bytes instead.
  if (method === 'tasks.attach' && isSet(params, 'file')) {
    return `'tasks.attach' with a file path is not allowed with the agent key; send the file contents (dataBase64) instead.`
  }
  // Why: --inject types the preamble plus Enter in one write after a one-time
  // agent check, so a terminal whose agent just exited would run it as shell
  // input. Agents dispatch without --inject; the worker picks the task up.
  if (method === 'orchestration.dispatch' && isSet(params, 'inject')) {
    return `'orchestration.dispatch --inject' is not allowed with the agent key; dispatch without --inject.`
  }
  return null
}

const GUARDED_SEND_METHODS: ReadonlySet<string> = new Set(['terminal.send', 'terminal.sendBound'])

/**
 * Params the agent key's request is dispatched with. Why: an unguarded send
 * can type a command plus Enter into a plain shell, which runs outside every
 * sandbox with the full key. Agent-key sends therefore always require the
 * target to be running an agent at a sendable prompt (the two-phase guarded
 * path in terminal.ts), whatever the caller asked for.
 */
export function scopeAgentRequestParams(method: string, params: unknown): unknown {
  if (!GUARDED_SEND_METHODS.has(method)) {
    return params
  }
  const base = params && typeof params === 'object' ? (params as Record<string, unknown>) : {}
  return { ...base, requireAgentStatus: 'sendable' }
}

function isSet(params: unknown, key: string): boolean {
  if (!params || typeof params !== 'object') {
    return false
  }
  const value = (params as Record<string, unknown>)[key]
  return value !== undefined && value !== null && value !== '' && value !== false
}
