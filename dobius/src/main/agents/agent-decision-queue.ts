import { randomUUID } from 'node:crypto'
import { BrowserWindow } from 'electron'
import type { CanUseTool, PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import type { AgentDecisionResolution, PendingAgentDecision } from '../../shared/agents'
import { appendAgentNotification } from './agent-notification-store'
import { getStoredAgentRun } from './agent-runs-store'
import { emitDobiusActionEvent, newActionContext } from './dobius-action-events'
import { DOBIUS_ACTOR, USER_ACTOR } from '../../shared/dobius-action-events'

type PendingResolver = {
  decision: PendingAgentDecision
  resolve: (result: PermissionResult) => void
  suggestions?: PermissionUpdate[]
}

type DecisionQueueContext = {
  runId: string
  agentId: string
  cwd: string
  branch?: string
  /** Whether the session can switch into bypass mode (fixed when it launched). */
  bypassRunSupported: boolean
}

export const BYPASS_RUN_UNSUPPORTED_REASON =
  'Bypass is unavailable for this run: it was not started with bypass support, and the Claude CLI ' +
  'cannot switch a running session into bypass. Turn on "Bypass permissions" for this agent and ' +
  'start a new run instead.'

type ResolveDecisionResult = {
  ok: true
  note?: string
}

type BypassRunHandler = (runId: string) => Promise<void>

const decisions = new Map<string, PendingResolver>()
let bypassRunHandler: BypassRunHandler | null = null

export function setDecisionBypassRunHandler(handler: BypassRunHandler): void {
  bypassRunHandler = handler
}

function broadcastDecisionsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('agents:decisionsChanged')
    }
  }
}

function listPendingDecisionValues(): PendingAgentDecision[] {
  return [...decisions.values()]
    .map((entry) => ({ ...entry.decision, input: { ...entry.decision.input } }))
    .sort((a, b) => a.createdAt - b.createdAt)
}

function resolveWith(id: string, result: PermissionResult, actor: string): boolean {
  const entry = decisions.get(id)
  if (!entry) {
    return false
  }
  decisions.delete(id)
  entry.resolve(result)
  broadcastDecisionsChanged()
  appendAgentNotification({
    agentId: entry.decision.agentId,
    kind: 'decision-resolved',
    ok: result.behavior === 'allow',
    text:
      result.behavior === 'allow'
        ? `Approved ${entry.decision.toolName}`
        : `Resolved ${entry.decision.toolName}: ${result.message}`,
    decisionId: entry.decision.id
  })
  const { decision } = entry
  emitDobiusActionEvent({
    type: 'agent.decision.resolved',
    actor,
    runId: decision.runId,
    // Why: the run's own context keeps the decision on the run's correlation id in the ledger.
    context: getStoredAgentRun(decision.runId)?.context ?? newActionContext(),
    payload: {
      decisionId: decision.id,
      agentId: decision.agentId,
      toolName: decision.toolName,
      behavior: result.behavior,
      ...(result.behavior === 'deny' ? { message: result.message } : {})
    }
  })
  return true
}

function editedInput(
  decision: PendingAgentDecision,
  payloadInput: Record<string, unknown> | string | undefined
): Record<string, unknown> {
  if (typeof payloadInput === 'string') {
    return decision.toolName === 'Bash'
      ? { ...decision.input, command: payloadInput }
      : { ...decision.input, input: payloadInput }
  }
  return payloadInput ? { ...payloadInput } : { ...decision.input }
}

export function createAgentCanUseTool(context: DecisionQueueContext): CanUseTool {
  return (toolName, input, options) =>
    new Promise<PermissionResult>((resolve) => {
      const id = randomUUID()
      const decision: PendingAgentDecision = {
        id,
        runId: context.runId,
        agentId: context.agentId,
        toolName,
        input: { ...input },
        title: options.title,
        displayName: options.displayName,
        description: options.description ?? options.decisionReason,
        cwd: context.cwd,
        branch: context.branch,
        createdAt: Date.now(),
        ...(context.bypassRunSupported
          ? {}
          : { bypassRunUnavailableReason: BYPASS_RUN_UNSUPPORTED_REASON })
      }
      decisions.set(id, { decision, resolve, suggestions: options.suggestions })
      options.signal.addEventListener(
        'abort',
        () => {
          resolveWith(
            id,
            {
              behavior: 'deny',
              message: 'Run stopped before the permission request was answered',
              interrupt: true
            },
            DOBIUS_ACTOR
          )
        },
        { once: true }
      )
      broadcastDecisionsChanged()
      appendAgentNotification({
        agentId: context.agentId,
        kind: 'decision-pending',
        ok: false,
        text: `${toolName} is waiting on you`,
        decisionId: id
      })
    })
}

export function listAgentDecisions(): PendingAgentDecision[] {
  return listPendingDecisionValues()
}

export async function resolveAgentDecision(
  resolution: AgentDecisionResolution
): Promise<ResolveDecisionResult> {
  const entry = decisions.get(resolution.id)
  if (!entry) {
    throw new Error('Decision not found')
  }
  const { decision, suggestions } = entry
  if (resolution.action === 'approve') {
    resolveWith(decision.id, { behavior: 'allow', updatedInput: { ...decision.input } }, USER_ACTOR)
    return { ok: true }
  }
  if (resolution.action === 'approveEdited') {
    resolveWith(
      decision.id,
      {
        behavior: 'allow',
        updatedInput: editedInput(decision, resolution.payload?.input)
      },
      USER_ACTOR
    )
    return { ok: true }
  }
  if (resolution.action === 'alwaysAllow') {
    resolveWith(
      decision.id,
      {
        behavior: 'allow',
        updatedInput: { ...decision.input },
        updatedPermissions: suggestions?.length ? suggestions : undefined
      },
      USER_ACTOR
    )
    return suggestions?.length
      ? { ok: true }
      : { ok: true, note: 'The SDK did not provide an always-allow permission suggestion.' }
  }
  if (resolution.action === 'deny') {
    resolveWith(decision.id, { behavior: 'deny', message: 'Denied by user' }, USER_ACTOR)
    return { ok: true }
  }
  if (resolution.action === 'respond') {
    resolveWith(
      decision.id,
      {
        behavior: 'deny',
        message: resolution.payload?.text?.trim() || 'Denied by user'
      },
      USER_ACTOR
    )
    return { ok: true }
  }
  if (resolution.action === 'bypassRun') {
    // Why: refuse before the SDK call; the CLI would reject the transition anyway.
    if (decision.bypassRunUnavailableReason) {
      throw new Error(decision.bypassRunUnavailableReason)
    }
    if (!bypassRunHandler) {
      throw new Error('Bypass is not available for this run')
    }
    await bypassRunHandler(decision.runId)
    resolveWith(decision.id, { behavior: 'allow', updatedInput: { ...decision.input } }, USER_ACTOR)
    return { ok: true }
  }
  throw new Error('Unknown decision action')
}

export function denyPendingDecisionsForRun(runId: string, message: string): void {
  const decisionIds = listPendingDecisionValues()
    .filter((decision) => decision.runId === runId)
    .map((decision) => decision.id)
  for (const id of decisionIds) {
    resolveWith(id, { behavior: 'deny', message, interrupt: true }, DOBIUS_ACTOR)
  }
}
