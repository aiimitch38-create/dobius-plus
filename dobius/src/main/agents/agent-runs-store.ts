import path from 'node:path'
import { app } from 'electron'
import type { AgentRun, AgentRunContext, AgentRunOutboxItem } from '../../shared/agents'
import { SafeJsonFile } from '../storage/safe-json-file'

const RUNS_FILE_NAME = 'agents-runs.json'
const MAX_RUNS = 50

function runsPath(): string {
  return path.join(app.getPath('userData'), RUNS_FILE_NAME)
}

function sanitizeRuns(raw: unknown): AgentRun[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return []
    }
    const record = entry as Partial<Record<keyof AgentRun, unknown>>
    const id = typeof record.id === 'string' ? record.id : ''
    const agentId = typeof record.agentId === 'string' ? record.agentId : ''
    const prompt = typeof record.prompt === 'string' ? record.prompt : ''
    const startedAt = typeof record.startedAt === 'number' ? record.startedAt : 0
    if (!id || !agentId || !startedAt) {
      return []
    }
    const status =
      record.status === 'success' ||
      record.status === 'error' ||
      record.status === 'cancelled' ||
      record.status === 'running'
        ? record.status
        : 'error'
    const run: AgentRun = {
      id,
      agentId,
      prompt,
      source:
        record.source === 'heartbeat' || record.source === 'channel' || record.source === 'asana'
          ? record.source
          : 'manual',
      // Preserved across restarts on purpose: channel revival matches
      // interrupted runs back to their channel by this key.
      ...(typeof record.sessionKey === 'string' ? { sessionKey: record.sessionKey } : {}),
      startedAt,
      status: status === 'running' ? 'error' : status,
      summary:
        status === 'running'
          ? 'app restarted during run'
          : typeof record.summary === 'string'
            ? record.summary
            : undefined
    }
    if (typeof record.context === 'object' && record.context !== null) {
      const context = record.context as Partial<AgentRunContext>
      if (typeof context.correlationId === 'string' && context.correlationId.length > 0) {
        run.context = {
          correlationId: context.correlationId,
          ...(typeof context.adamJobId === 'string' ? { adamJobId: context.adamJobId } : {}),
          ...(typeof context.adamTaskId === 'string' ? { adamTaskId: context.adamTaskId } : {}),
          ...(typeof context.projectId === 'string' ? { projectId: context.projectId } : {}),
          ...(typeof context.worktreeId === 'string' ? { worktreeId: context.worktreeId } : {}),
          ...(typeof context.requestedBy === 'string' ? { requestedBy: context.requestedBy } : {})
        }
      }
    }
    if (typeof record.endedAt === 'number' || status === 'running') {
      run.endedAt = typeof record.endedAt === 'number' ? record.endedAt : Date.now()
    }
    if (typeof record.numTurns === 'number') {
      run.numTurns = record.numTurns
    }
    if (typeof record.costUsd === 'number') {
      run.costUsd = record.costUsd
    }
    return [run]
  })
}

const file = new SafeJsonFile<AgentRun[]>({
  filePath: runsPath,
  parse: (raw) => (Array.isArray(raw) ? sanitizeRuns(raw).slice(-MAX_RUNS) : undefined),
  fallback: () => [],
  label: '[agents] agents-runs.json'
})
let reconciled = false

function loadRuns(): AgentRun[] {
  const runs = file.get()
  // Why: persist restart reconciliation (running -> error) only after a
  // successful parse; a failed or missing read never writes.
  if (!reconciled && file.getStatus().status === 'ok') {
    reconciled = true
    persistRuns(runs)
  }
  return runs
}

function persistRuns(runs: AgentRun[]): void {
  file.set(runs.slice(-MAX_RUNS))
}

export function addStoredAgentRun(run: AgentRun): AgentRun[] {
  const runs = loadRuns()
  runs.push(run)
  persistRuns(runs)
  return listStoredAgentRuns()
}

export function updateStoredAgentRun(runId: string, updates: Partial<AgentRun>): AgentRun | null {
  const runs = loadRuns()
  const run = runs.find((entry) => entry.id === runId)
  if (!run) {
    return null
  }
  Object.assign(run, updates)
  persistRuns(runs)
  return { ...run }
}

// Live-run outbox: memory only, keyed by runId. Persisting these on the run
// record was an app-freezing mistake — items carry base64 images, the store
// rewrote the whole pretty-printed file synchronously on every append, and
// the 750ms runs poll re-serialized every blob across IPC. Load-time
// sanitizeRuns dropped them on restart anyway, so persistence bought nothing.
const MAX_OUTBOX_RUNS = 32
const liveRunOutbox = new Map<string, AgentRunOutboxItem[]>()

export function appendAgentRunOutbox(runId: string, item: AgentRunOutboxItem): boolean {
  const run = loadRuns().find((entry) => entry.id === runId)
  if (!run) {
    return false
  }
  const items = liveRunOutbox.get(runId) ?? []
  items.push(item)
  liveRunOutbox.set(runId, items)
  while (liveRunOutbox.size > MAX_OUTBOX_RUNS) {
    const oldest = liveRunOutbox.keys().next().value
    if (oldest === undefined) {
      break
    }
    liveRunOutbox.delete(oldest)
  }
  return true
}

/** Items appended after `afterId` (all items when afterId is absent/unknown). */
export function getAgentRunOutbox(runId: string, afterId?: string | null): AgentRunOutboxItem[] {
  const items = liveRunOutbox.get(runId) ?? []
  if (!afterId) {
    return [...items]
  }
  const index = items.findIndex((item) => item.id === afterId)
  return index === -1 ? [...items] : items.slice(index + 1)
}

export function getStoredAgentRun(runId: string): AgentRun | null {
  const run = loadRuns().find((entry) => entry.id === runId)
  return run ? { ...run } : null
}

export function listStoredAgentRuns(): AgentRun[] {
  return loadRuns().map((run) => ({ ...run }))
}
