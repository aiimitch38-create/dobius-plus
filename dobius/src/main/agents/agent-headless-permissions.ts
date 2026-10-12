import type { CanUseTool, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentRunPermissionDenial, AgentRunSource } from '../../shared/agents'
import { broadcastRunEvent, broadcastRunsChanged, eventBase } from './agent-run-events'
import { getStoredAgentRun, updateStoredAgentRun } from './agent-runs-store'

// Why: a looping model can hit the same denied tool hundreds of times; the run
// record only needs enough entries to show what was blocked.
const MAX_RECORDED_DENIALS = 20
const MAX_REASON_LENGTH = 300

type DenialRunContext = {
  runId: string
  agentId: string
}

// Why: the saved list is capped, so it cannot dedupe or count past the cap. This
// per-run tally does both, and lives only until the run is finalized.
type DenialTally = {
  seenToolUseIds: Set<string>
  total: number
  toolNames: Set<string>
}
const denialTallies = new Map<string, DenialTally>()

export function forgetPermissionDenials(runId: string): void {
  denialTallies.delete(runId)
}

function headlessLabel(source: AgentRunSource): string {
  return source === 'manual' ? 'CLI/RPC' : source
}

export function headlessDenialReason(source: AgentRunSource, toolName: string): string {
  return (
    `${toolName} needs approval, but this ${headlessLabel(source)} run has nobody to ask, ` +
    `so it was denied. Add ${toolName} to the agent's allowed tools, or run it from the Agents page.`
  )
}

export function recordPermissionDenial(
  context: DenialRunContext,
  denial: { toolName: string; toolUseId?: string; reason: string }
): void {
  const run = getStoredAgentRun(context.runId)
  if (!run) {
    return
  }
  const existing = run.permissionDenials ?? []
  let tally = denialTallies.get(context.runId)
  if (!tally) {
    tally = { seenToolUseIds: new Set(), total: 0, toolNames: new Set() }
    denialTallies.set(context.runId, tally)
  }
  if (denial.toolUseId) {
    if (tally.seenToolUseIds.has(denial.toolUseId)) {
      return
    }
    tally.seenToolUseIds.add(denial.toolUseId)
  }
  tally.total += 1
  tally.toolNames.add(denial.toolName)
  const reason = denial.reason.slice(0, MAX_REASON_LENGTH)
  if (existing.length < MAX_RECORDED_DENIALS) {
    const entry: AgentRunPermissionDenial = {
      toolName: denial.toolName,
      ...(denial.toolUseId ? { toolUseId: denial.toolUseId } : {}),
      reason,
      at: Date.now()
    }
    if (updateStoredAgentRun(context.runId, { permissionDenials: [...existing, entry] })) {
      broadcastRunsChanged()
    }
  }
  broadcastRunEvent({
    ...eventBase(context.runId, context.agentId),
    kind: 'error',
    toolName: denial.toolName,
    text: `Permission denied: ${reason}`
  })
}

/**
 * canUseTool for runs nobody is watching. It answers every prompt at once with
 * a deny, so a headless run can never wait on an approval that will not come,
 * and the refusal is recorded on the run instead of only reaching the model.
 */
export function createHeadlessCanUseTool(
  context: DenialRunContext & { source: AgentRunSource }
): CanUseTool {
  return async (toolName, _input, options) => {
    const reason = headlessDenialReason(context.source, toolName)
    recordPermissionDenial(context, { toolName, toolUseId: options.toolUseID, reason })
    return { behavior: 'deny', message: reason }
  }
}

/**
 * Records denials the CLI decided on its own (dontAsk mode, deny rules): they
 * never reach canUseTool, only the stream's permission_denied events and the
 * result's permission_denials list.
 */
export function recordStreamPermissionDenials(
  context: DenialRunContext,
  message: SDKMessage
): void {
  if (message.type === 'system' && message.subtype === 'permission_denied') {
    recordPermissionDenial(context, {
      toolName: message.tool_name,
      toolUseId: message.tool_use_id,
      reason: message.message || `${message.tool_name} was not pre-approved for this run`
    })
    return
  }
  if (message.type === 'result') {
    for (const denial of message.permission_denials ?? []) {
      recordPermissionDenial(context, {
        toolName: denial.tool_name,
        toolUseId: denial.tool_use_id,
        reason: `${denial.tool_name} was not pre-approved for this run`
      })
    }
  }
}

/** Appends the blocked-tools outcome to a finished run's summary. */
export function withPermissionDenialNote(runId: string, summary: string): string {
  const run = getStoredAgentRun(runId)
  // Why: a channel run's summary is the reply posted into the chat (and read by
  // other agents). Its denials stay on permissionDenials and the error events.
  if (run?.source === 'channel') {
    return summary
  }
  const denials = run?.permissionDenials ?? []
  const tally = denialTallies.get(runId)
  const total = Math.max(tally?.total ?? 0, denials.length)
  if (total === 0) {
    return summary
  }
  const toolNames = new Set([
    ...(tally?.toolNames ?? []),
    ...denials.map((denial) => denial.toolName)
  ])
  const tools = [...toolNames].join(', ')
  const note =
    `Blocked: ${total} tool request(s) needed approval and were denied (${tools}). ` +
    'Nobody could approve them during this run.'
  return summary ? `${summary}\n\n${note}` : note
}
