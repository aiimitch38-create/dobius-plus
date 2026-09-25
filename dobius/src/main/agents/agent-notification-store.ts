import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { BrowserWindow } from 'electron'
import type {
  AgentRun,
  AgentNotificationEntry,
  AgentNotificationsSnapshot
} from '../../shared/agents'
import type { CustomAgent } from '../../shared/agents'
import { parseEveryEntry, SafeJsonFile } from '../storage/safe-json-file'
import { getUserDataRoot } from '../storage/user-data-root'

const FILE_NAME = 'agents-notifications.json'
const MAX_ENTRIES = 50

type PersistedNotifications = {
  entries: AgentNotificationEntry[]
  lastReadTs: number
}

function filePath(): string {
  return path.join(getUserDataRoot(), FILE_NAME)
}

function sanitizeEntry(raw: unknown): AgentNotificationEntry | null {
  if (typeof raw !== 'object' || raw === null) {
    return null
  }
  const record = raw as Partial<Record<keyof AgentNotificationEntry, unknown>>
  if (
    typeof record.id !== 'string' ||
    typeof record.ts !== 'number' ||
    typeof record.agentId !== 'string' ||
    typeof record.text !== 'string'
  ) {
    return null
  }
  if (
    record.kind !== 'run-finished' &&
    record.kind !== 'run-failed' &&
    record.kind !== 'decision-pending' &&
    record.kind !== 'decision-resolved' &&
    record.kind !== 'briefing-now'
  ) {
    return null
  }
  return {
    id: record.id,
    ts: record.ts,
    agentId: record.agentId,
    kind: record.kind,
    ok: record.ok === true,
    text: record.text,
    decisionId: typeof record.decisionId === 'string' ? record.decisionId : undefined
  }
}

// Why: a malformed entry makes the whole file unreadable instead of being
// dropped and then saved over (CX12 F2).
function sanitize(raw: object): PersistedNotifications | undefined {
  const record = raw as Partial<PersistedNotifications>
  const entries = Array.isArray(record.entries)
    ? parseEveryEntry(record.entries, sanitizeEntry)
    : record.entries === undefined
      ? []
      : undefined
  if (!entries) {
    return undefined
  }
  return {
    entries,
    lastReadTs: typeof record.lastReadTs === 'number' ? record.lastReadTs : 0
  }
}

const file = new SafeJsonFile<PersistedNotifications>({
  filePath,
  parse: (raw) =>
    typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? sanitize(raw) : undefined,
  fallback: () => ({ entries: [], lastReadTs: 0 }),
  label: '[agents] agents-notifications.json'
})

function load(): PersistedNotifications {
  const data = file.get()
  data.entries = data.entries.slice(-MAX_ENTRIES)
  return data
}

function persist(data: PersistedNotifications): void {
  file.set({ ...data, entries: data.entries.slice(-MAX_ENTRIES) })
}

export function broadcastAgentNotificationsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('agents:notificationsChanged')
    }
  }
}

export function listAgentNotifications(): AgentNotificationsSnapshot {
  const data = load()
  const entries = [...data.entries].sort((a, b) => b.ts - a.ts)
  return {
    entries,
    lastReadTs: data.lastReadTs,
    unreadCount: entries.filter((entry) => entry.ts > data.lastReadTs).length
  }
}

export function appendAgentNotification(
  input: Omit<AgentNotificationEntry, 'id' | 'ts'>
): AgentNotificationEntry {
  const data = load()
  const entry: AgentNotificationEntry = { ...input, id: randomUUID(), ts: Date.now() }
  persist({ ...data, entries: [...data.entries, entry].slice(-MAX_ENTRIES) })
  broadcastAgentNotificationsChanged()
  return entry
}

export function appendAgentRunNotification(agent: CustomAgent, run: AgentRun): void {
  if (run.status === 'running') {
    return
  }
  const ok = run.status === 'success'
  appendAgentNotification({
    agentId: agent.id,
    kind: ok ? 'run-finished' : 'run-failed',
    ok,
    text:
      run.status === 'cancelled'
        ? `${agent.name} run was cancelled`
        : `${agent.name} run ${ok ? 'finished' : 'failed'}`
  })
}

export function markAgentNotificationsRead(): AgentNotificationsSnapshot {
  const data = load()
  persist({ ...data, lastReadTs: Date.now() })
  broadcastAgentNotificationsChanged()
  return listAgentNotifications()
}
