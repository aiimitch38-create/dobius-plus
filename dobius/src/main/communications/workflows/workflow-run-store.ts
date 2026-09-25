/**
 * Persistence for workflow run history (get_workflow_runs — see
 * tauriWorkflows.ts's WorkflowRun/TraceEntry contract). Keyed by workflowId
 * so get_workflow_runs's `limit` (tail of a workflow's own run list) is a
 * cheap slice instead of a full-file scan. Same atomic tmp-then-rename write
 * as workflow-store.ts.
 */
import path from 'node:path'
import { app } from 'electron'
import { parseEveryEntry, parseEveryValue, SafeJsonFile } from '../../storage/safe-json-file'

const FILE_NAME = 'workflow-runs.json'
// Why: an unbounded run history for one workflow would grow the JSON file
// forever on a repeatedly-triggered workflow. Keep the most recent runs per
// workflow only — get_workflow_runs never asks for more than a UI page.
const MAX_RUNS_PER_WORKFLOW = 200

export type WorkflowRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'waiting_approval'

export type TraceEntry = {
  stepId: string
  status: string
  output: Record<string, unknown>
  startedAt: number | null
  completedAt: number | null
  error: string | null
}

export type WorkflowRun = {
  id: string
  workflowId: string
  status: WorkflowRunStatus
  currentStep: number | null
  executionTrace: TraceEntry[]
  startedAt: number | null
  completedAt: number | null
  errorMessage: string | null
  createdAt: number
}

type RunsByWorkflow = Record<string, WorkflowRun[]>

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

function cloneRun(run: WorkflowRun): WorkflowRun {
  return { ...run, executionTrace: run.executionTrace.map((entry) => ({ ...entry, output: { ...entry.output } })) }
}

function isTraceEntry(value: unknown): value is TraceEntry {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as Partial<TraceEntry>
  return typeof record.stepId === 'string' && typeof record.status === 'string'
}

function sanitizeRun(value: unknown): WorkflowRun | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const record = value as Partial<Record<keyof WorkflowRun, unknown>>
  const id = typeof record.id === 'string' ? record.id : ''
  const workflowId = typeof record.workflowId === 'string' ? record.workflowId : ''
  if (!id || !workflowId) {
    return null
  }
  const statuses: WorkflowRunStatus[] = ['pending', 'running', 'completed', 'failed', 'cancelled', 'waiting_approval']
  const status = statuses.includes(record.status as WorkflowRunStatus) ? (record.status as WorkflowRunStatus) : 'pending'
  const trace = Array.isArray(record.executionTrace) ? record.executionTrace.filter(isTraceEntry) : []
  return {
    id,
    workflowId,
    status,
    currentStep: typeof record.currentStep === 'number' ? record.currentStep : null,
    executionTrace: trace,
    startedAt: typeof record.startedAt === 'number' ? record.startedAt : null,
    completedAt: typeof record.completedAt === 'number' ? record.completedAt : null,
    errorMessage: typeof record.errorMessage === 'string' ? record.errorMessage : null,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now()
  }
}

// Why: a malformed run makes the whole file unreadable instead of being
// dropped and then saved over (CX12 F2).
function sanitizeRunList(entries: unknown): WorkflowRun[] | null {
  return Array.isArray(entries) ? (parseEveryEntry(entries, sanitizeRun) ?? null) : null
}

const file = new SafeJsonFile<RunsByWorkflow>({
  filePath,
  parse: (raw) => parseEveryValue(raw, sanitizeRunList),
  fallback: () => ({}),
  label: `[workflow-runs] ${FILE_NAME}`
})

function load(): RunsByWorkflow {
  return file.get()
}

// Warn-and-continue like before; SafeJsonFile logs a refused or failed save.
function persist(runs: RunsByWorkflow): void {
  file.set(runs)
}

export function listRuns(workflowId: string, limit?: number): WorkflowRun[] {
  const all = load()[workflowId] ?? []
  // Why newest-first: get_workflow_runs backs a run-history panel, which
  // reads most naturally as "most recent run at the top" — matches
  // orchestration's other run-listing RPC methods (automation.runs).
  const ordered = [...all].sort((a, b) => b.createdAt - a.createdAt).map(cloneRun)
  if (typeof limit === 'number' && limit >= 0) {
    return ordered.slice(0, limit)
  }
  return ordered
}

export function appendRun(run: WorkflowRun): WorkflowRun {
  const all = load()
  const existing = all[run.workflowId] ?? []
  const updated = [run, ...existing].slice(0, MAX_RUNS_PER_WORKFLOW)
  const next: RunsByWorkflow = { ...all, [run.workflowId]: updated }
  persist(next)
  return cloneRun(run)
}

/** Deletes all run history for a workflow — called when the workflow itself is deleted. */
export function removeRunsForWorkflow(workflowId: string): void {
  const all = load()
  if (!(workflowId in all)) {
    return
  }
  const next = { ...all }
  delete next[workflowId]
  persist(next)
}
