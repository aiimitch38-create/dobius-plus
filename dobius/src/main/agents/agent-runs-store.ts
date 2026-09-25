import path from 'node:path'
import type {
  AgentRun,
  AgentRunContext,
  AgentRunOutboxItem,
  AgentRunPermissionDenial
} from '../../shared/agents'
import { parseEveryEntry, SafeJsonFile } from '../storage/safe-json-file'
import { getUserDataRoot } from '../storage/user-data-root'

const RUNS_FILE_NAME = 'agents-runs.json'
const MAX_RUNS = 50

function runsPath(): string {
  return path.join(getUserDataRoot(), RUNS_FILE_NAME)
}

function sanitizePermissionDenials(raw: unknown): AgentRunPermissionDenial[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return []
    }
    const denial = entry as Partial<Record<keyof AgentRunPermissionDenial, unknown>>
    if (typeof denial.toolName !== 'string' || typeof denial.reason !== 'string') {
      return []
    }
    return [
      {
        toolName: denial.toolName,
        ...(typeof denial.toolUseId === 'string' ? { toolUseId: denial.toolUseId } : {}),
        reason: denial.reason,
        at: typeof denial.at === 'number' ? denial.at : 0
      }
    ]
  })
}

function isRunStatus(value: unknown): value is AgentRun['status'] {
  return value === 'success' || value === 'error' || value === 'cancelled' || value === 'running'
}

// Why: a malformed entry makes the whole file unreadable (never dropped and
// saved over); every writer since caee2df0 sets the five required fields.
function sanitizeRun(entry: unknown): AgentRun | null {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return null
  }
  const record = entry as Partial<Record<keyof AgentRun, unknown>>
  const { id, agentId, prompt, startedAt, status } = record
  if (
    typeof id !== 'string' ||
    !id ||
    typeof agentId !== 'string' ||
    !agentId ||
    typeof prompt !== 'string' ||
    typeof startedAt !== 'number' ||
    !Number.isFinite(startedAt) ||
    startedAt <= 0 ||
    !isRunStatus(status)
  ) {
    return null
  }
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
  // Why: denials are best-effort diagnostics; a malformed one is dropped, never the file.
  const denials = sanitizePermissionDenials(record.permissionDenials)
  if (denials.length > 0) {
    run.permissionDenials = denials
  }
  return run
}

// Why: MAX_RUNS bounds settled history only. A running run is live state —
// evicting it made its completion/cancellation updates (and its outbox) miss.
function retainRuns(runs: AgentRun[]): AgentRun[] {
  let excess = runs.length - MAX_RUNS
  if (excess <= 0) {
    return runs
  }
  return runs.filter((run) => {
    if (excess > 0 && run.status !== 'running') {
      excess -= 1
      return false
    }
    return true
  })
}

const file = new SafeJsonFile<AgentRun[]>({
  filePath: runsPath,
  parse: (raw) => {
    const runs = Array.isArray(raw) ? parseEveryEntry(raw, sanitizeRun) : undefined
    return runs ? retainRuns(runs) : undefined
  },
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
  file.set(retainRuns(runs))
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
// Byte budgets (#77): the client polls about once a second, so the oldest
// items are long delivered when a run passes 8 MiB (~8 max-size screenshots).
const MAX_OUTBOX_RUNS = 32
export const MAX_OUTBOX_BYTES_PER_RUN = 8 * 1024 * 1024
export const MAX_OUTBOX_BYTES_TOTAL = 32 * 1024 * 1024
const liveRunOutbox = new Map<string, AgentRunOutboxItem[]>()

function outboxItemBytes(item: AgentRunOutboxItem): number {
  return Buffer.byteLength(item.content, 'utf8') + (item.imageDataUrl?.length ?? 0)
}

function outboxBytes(items: AgentRunOutboxItem[]): number {
  return items.reduce((total, item) => total + outboxItemBytes(item), 0)
}

function totalOutboxBytes(): number {
  let total = 0
  for (const items of liveRunOutbox.values()) {
    total += outboxBytes(items)
  }
  return total
}

/** False when the run is not tracked or the item alone exceeds the per-run budget. */
export function appendAgentRunOutbox(runId: string, item: AgentRunOutboxItem): boolean {
  const run = loadRuns().find((entry) => entry.id === runId)
  if (!run || outboxItemBytes(item) > MAX_OUTBOX_BYTES_PER_RUN) {
    return false
  }
  const items = liveRunOutbox.get(runId) ?? []
  items.push(item)
  // Re-inserted so the run just written to is the newest and evicted last.
  liveRunOutbox.delete(runId)
  liveRunOutbox.set(runId, items)
  let dropped = 0
  while (outboxBytes(items) > MAX_OUTBOX_BYTES_PER_RUN) {
    items.shift()
    dropped += 1
  }
  while (
    liveRunOutbox.size > MAX_OUTBOX_RUNS ||
    (liveRunOutbox.size > 1 && totalOutboxBytes() > MAX_OUTBOX_BYTES_TOTAL)
  ) {
    const oldest = liveRunOutbox.keys().next().value
    if (oldest === undefined || oldest === runId) {
      break
    }
    dropped += liveRunOutbox.get(oldest)?.length ?? 0
    liveRunOutbox.delete(oldest)
  }
  if (dropped > 0) {
    console.warn(`[agents] run outbox over its byte budget; dropped ${dropped} oldest item(s)`)
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
