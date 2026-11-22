// Why: default-deny for the agent key. Dobius terminals and agent runs get a
// narrower runtime key than Carson's own CLI. That key may only talk to other
// terminals, the orchestration mailbox and the Kanban work board, and read
// workspace state. Anything that starts processes or agent runs (including
// `agent.run --check`), changes settings, drives the browser or desktop,
// touches git/worktrees, or reads secrets is refused. A new RPC method is
// refused for agents until it is added here on purpose.

export const AGENT_RPC_METHOD_ALLOWLIST: ReadonlySet<string> = new Set([
  'status.get',
  // Terminals: read, wait on, message and label existing terminals.
  'terminal.list',
  'terminal.show',
  'terminal.read',
  'terminal.wait',
  'terminal.send',
  'terminal.sendBound',
  'terminal.resolveActive',
  'terminal.resolvePane',
  'terminal.rename',
  'terminal.focus',
  'terminal.agentStatus',
  'terminal.isRunningAgent',
  // Board consoles (`dobius board consoles` / `board send` = resolve + terminal.send).
  'board.listConsoles',
  'board.resolveConsole',
  'board.agentState',
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
  // Claude Agent Teams inside a Dobius terminal (gated by its own team token).
  'agentTeams.tmuxCompat',
  'agentTeams.prepareLaunch',
  // Read-only workspace lookups the CLI uses to resolve selectors.
  'worktree.list',
  'worktree.show',
  'worktree.ps',
  'repo.list',
  'project.list'
])

const OUTSIDE_DOBIUS_HINT =
  'Dobius terminals and agent runs use a limited Dobius key. Run this command from a terminal outside Dobius+ (for example Terminal.app).'

/** Why the agent key may not make this call, or null when it may. */
export function agentRpcDenial(method: string, params: unknown): string | null {
  if (!AGENT_RPC_METHOD_ALLOWLIST.has(method)) {
    return `'${method}' is not allowed with the agent key. ${OUTSIDE_DOBIUS_HINT}`
  }
  // Why: attaching by path makes the app read a file outside the agent's own
  // sandbox and hand it back on the card; agents must send the bytes instead.
  if (method === 'tasks.attach' && hasFileParam(params)) {
    return `'tasks.attach' with a file path is not allowed with the agent key; send the file contents (dataBase64) instead.`
  }
  return null
}

function hasFileParam(params: unknown): boolean {
  if (!params || typeof params !== 'object') {
    return false
  }
  const file = (params as Record<string, unknown>).file
  return file !== undefined && file !== null && file !== ''
}
