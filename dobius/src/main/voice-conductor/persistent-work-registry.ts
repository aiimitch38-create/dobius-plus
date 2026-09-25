import { parseEveryEntry, SafeJsonFile } from '../storage/safe-json-file'
import type { WorkItem, WorkRegistry } from './types'
import { createWorkRegistry } from './work-registry'

type WorkPayload = { version: 1; items: WorkItem[] }

function normalizeItem(item: unknown): WorkItem | null {
  if (!item || typeof item !== 'object') {return null}
  const record = item as Record<string, unknown>
  if (
    typeof record.workId !== 'string' ||
    typeof record.tabId !== 'string' ||
    typeof record.requestId !== 'string' ||
    typeof record.description !== 'string' ||
    typeof record.startedAt !== 'number' ||
    !['running', 'done', 'error'].includes(String(record.status))
  ) {
    return null
  }
  return {
    workId: record.workId.slice(0, 512),
    tabId: record.tabId.slice(0, 512),
    requestId: record.requestId.slice(0, 80),
    description: record.description.slice(0, 4000),
    startedAt: record.startedAt,
    status: record.status as WorkItem['status'],
    ...(typeof record.summary === 'string' ? { summary: record.summary.slice(0, 4000) } : {}),
    ...(record.kind === 'spawn' ? { kind: 'spawn' as const } : {})
  }
}

// Why: a malformed row makes the file unreadable (kept, saves refused) instead
// of being dropped and then saved over.
function parsePayload(raw: unknown): WorkPayload | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {return undefined}
  const items = (raw as { items?: unknown }).items
  if (!Array.isArray(items)) {return undefined}
  const parsed = parseEveryEntry(items, normalizeItem)
  return parsed ? { version: 1, items: parsed } : undefined
}

// A spawned run's completion callback lives only in the process that started
// it, so after a restart nothing would ever release its reservation.
// Correct only on the first load in a process: service.ts keeps one registry.
function releaseInterruptedSpawns(items: WorkItem[]): WorkItem[] {
  return items.map((item) =>
    item.kind === 'spawn' && item.status === 'running'
      ? { ...item, status: 'error', summary: 'interrupted: Dobius+ restarted before the run finished' }
      : item
  )
}

export function createPersistentWorkRegistry(filePath: string): WorkRegistry {
  const file = new SafeJsonFile<WorkPayload>({
    filePath: () => filePath,
    parse: parsePayload,
    fallback: () => ({ version: 1, items: [] }),
    label: '[voice-conductor] work registry',
    mode: 0o600
  })
  return createWorkRegistry({
    initialItems: releaseInterruptedSpawns(file.get().items),
    // save() throws when nothing was written; the registry then keeps its old state.
    onChange: (items) => file.save({ version: 1, items: [...items] })
  })
}
