/**
 * Public API for the workflow RPC methods (workflow-rpc-methods.ts) — the
 * one seam that composes workflow-store.ts (definitions) with
 * workflow-run-store.ts + workflow-executor.ts (execution/history). Kept
 * separate from the RPC file so the zod/RpcMethod plumbing doesn't leak
 * into the part of this feature that has real unit-testable behavior.
 */
import { randomUUID } from 'node:crypto'
import {
  createWorkflow as storeCreateWorkflow,
  getWorkflow as storeGetWorkflow,
  listWorkflowsByChannel,
  listWorkflowsByChannels,
  removeWorkflow as storeRemoveWorkflow,
  updateWorkflow as storeUpdateWorkflow,
  type Workflow,
  type WorkflowCreateInput,
  type WorkflowUpdateInput
} from './workflow-store'
import { appendRun, listRuns, removeRunsForWorkflow, type WorkflowRun } from './workflow-run-store'
import { executeWorkflowSteps } from './workflow-executor'

export type { Workflow, WorkflowCreateInput, WorkflowUpdateInput } from './workflow-store'
export type { WorkflowRun, TraceEntry, WorkflowRunStatus } from './workflow-run-store'

export function getChannelWorkflows(channelId: string): Workflow[] {
  return listWorkflowsByChannel(channelId)
}

export function getChannelsWorkflows(channelIds: string[]): Workflow[] {
  return listWorkflowsByChannels(channelIds)
}

export function getWorkflowOrThrow(id: string): Workflow {
  const workflow = storeGetWorkflow(id)
  if (!workflow) {
    throw new Error(`Workflow not found: ${id}`)
  }
  return workflow
}

export function createWorkflow(input: WorkflowCreateInput): Workflow {
  return storeCreateWorkflow(input)
}

export function updateWorkflow(id: string, input: WorkflowUpdateInput): Workflow {
  getWorkflowOrThrow(id)
  return storeUpdateWorkflow(id, input)
}

export function deleteWorkflow(id: string): void {
  getWorkflowOrThrow(id)
  storeRemoveWorkflow(id)
  // Why: run history is scoped to a workflow that no longer exists once
  // deleted — orphaned trace data serves no purpose and would keep growing
  // the run-history file for an id nothing can look up again.
  removeRunsForWorkflow(id)
}

export function getWorkflowRuns(workflowId: string, limit?: number): WorkflowRun[] {
  getWorkflowOrThrow(workflowId)
  return listRuns(workflowId, limit)
}

export type TriggerWorkflowResult = {
  runId: string
  workflowId: string
  status: WorkflowRun['status']
}

export function triggerWorkflow(workflowId: string): TriggerWorkflowResult {
  const workflow = getWorkflowOrThrow(workflowId)
  const startedAt = Date.now()
  const execution = executeWorkflowSteps(workflow.steps)
  const run: WorkflowRun = {
    id: randomUUID(),
    workflowId: workflow.id,
    status: execution.status,
    currentStep: execution.currentStep,
    executionTrace: execution.trace,
    startedAt,
    completedAt: Date.now(),
    errorMessage: execution.errorMessage,
    createdAt: startedAt
  }
  const saved = appendRun(run)
  return { runId: saved.id, workflowId: saved.workflowId, status: saved.status }
}
