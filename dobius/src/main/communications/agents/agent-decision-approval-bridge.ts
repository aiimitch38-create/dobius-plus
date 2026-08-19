import {
  listAgentDecisions,
  resolveAgentDecision
} from '../../agents/agent-decision-queue'
import type { AgentDecisionResolution, PendingAgentDecision } from '../../../shared/agents'

// Why: Buzz's grant_approval/deny_approval/get_run_approvals gate a paused
// *workflow run* on a human-approved token. Dobius has no workflow-run engine
// (that whole command family — get_channel_workflows, create_workflow,
// trigger_workflow, ... — is outside this slice and mostly absent from
// Dobius entirely). The real Dobius concept that matches "a run paused
// pending human approval" is the agent tool-use decision queue
// (agent-decision-queue.ts): an agent run blocks mid-turn until the owner
// approves or denies a tool call. Mapping onto it keeps the Communications
// approvals UI honestly functional against a real gate, rather than a fake
// workflow-approval backend Dobius doesn't have.
export type CommunicationsAgentApproval = {
  token: string
  workflowId: string
  runId: string
  stepId: string
  stepIndex: number
  approverSpec: string
  status: 'pending'
  approverPubkey: string | null
  note: string | null
  expiresAt: string
  createdAt: number
}

// Decisions have no expiry of their own (they wait for a human indefinitely);
// report a far-future expiry so a UI that renders a countdown does not show a
// misleadingly-imminent one.
const APPROVAL_EXPIRY_MS = 24 * 60 * 60 * 1000

function toApproval(decision: PendingAgentDecision): CommunicationsAgentApproval {
  return {
    token: decision.id,
    workflowId: decision.agentId,
    runId: decision.runId,
    stepId: decision.toolName,
    stepIndex: 0,
    approverSpec: 'owner',
    status: 'pending',
    approverPubkey: null,
    note: decision.description ?? decision.title ?? null,
    expiresAt: new Date(decision.createdAt + APPROVAL_EXPIRY_MS).toISOString(),
    createdAt: decision.createdAt
  }
}

export function listApprovalsForRun(runId: string): CommunicationsAgentApproval[] {
  return listAgentDecisions()
    .filter((decision) => decision.runId === runId)
    .map(toApproval)
}

export type ApprovalActionResult = {
  token: string
  status: 'approved' | 'denied'
  runId: string
  workflowId: string
}

async function resolveAndDescribe(
  resolution: AgentDecisionResolution,
  status: 'approved' | 'denied'
): Promise<ApprovalActionResult> {
  const pending = listAgentDecisions().find((decision) => decision.id === resolution.id)
  if (!pending) {
    throw new Error('Approval not found')
  }
  await resolveAgentDecision(resolution)
  return { token: resolution.id, status, runId: pending.runId, workflowId: pending.agentId }
}

export async function grantAgentApproval(token: string): Promise<ApprovalActionResult> {
  return resolveAndDescribe({ id: token, action: 'approve' }, 'approved')
}

export async function denyAgentApproval(
  token: string,
  note?: string | null
): Promise<ApprovalActionResult> {
  const resolution: AgentDecisionResolution = note
    ? { id: token, action: 'respond', payload: { text: note } }
    : { id: token, action: 'deny' }
  return resolveAndDescribe(resolution, 'denied')
}
