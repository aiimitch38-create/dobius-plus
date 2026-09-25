import path from 'node:path'
import { app } from 'electron'
import { parseEveryValue, SafeJsonFile } from '../../storage/safe-json-file'

const FILE_NAME = 'communications-observer-channel-index.json'

// Why: mirrors Buzz's `observer_channel_index` — a lookup from an archived
// kind:24200 observer-frame event id to the channel it belongs to (or null
// for unscoped/undecryptable frames), so a channel screen can page through
// its observer history without scanning every archived event. The raw event
// bodies themselves are archived by a different, not-yet-built feature
// (identity-keychain's archive_events/read_archived_events); this store only
// owns the id -> channelId mapping, so readForChannel below can only ever
// return entries, never full event bodies, until that archive exists. See
// the OBSERVER section of the handoff report.
export type ObserverChannelIndexEntry = {
  eventId: string
  channelId: string | null
  createdAt: number
}

type IndexFile = Record<string, ObserverChannelIndexEntry>

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

// Why: a malformed entry makes the whole file unreadable instead of being
// dropped and then saved over (CX12 F2).
function sanitizeEntry(raw: unknown): ObserverChannelIndexEntry | null {
  if (typeof raw !== 'object' || raw === null) {
    return null
  }
  const record = raw as Partial<Record<keyof ObserverChannelIndexEntry, unknown>>
  const eventId = typeof record.eventId === 'string' ? record.eventId : ''
  const createdAt = typeof record.createdAt === 'number' ? record.createdAt : NaN
  if (!eventId || !Number.isFinite(createdAt)) {
    return null
  }
  return {
    eventId,
    channelId: typeof record.channelId === 'string' ? record.channelId : null,
    createdAt
  }
}

const file = new SafeJsonFile<IndexFile>({
  filePath,
  parse: (raw) => parseEveryValue(raw, sanitizeEntry),
  fallback: () => ({}),
  label: `[communications/agents] ${FILE_NAME}`
})

function load(): IndexFile {
  return file.get()
}

// Throws like the old writer did, so the RPC caller sees that nothing was saved.
function persist(data: IndexFile): void {
  if (!file.set(data)) {
    throw new Error('Observer channel index could not be saved')
  }
}

// Idempotent by design (matches the real contract): already-indexed frames
// are silently skipped rather than overwritten.
export function indexObserverChannelIds(entries: ObserverChannelIndexEntry[]): void {
  if (entries.length === 0) {
    return
  }
  const data = load()
  let changed = false
  for (const entry of entries) {
    if (!entry.eventId || data[entry.eventId]) {
      continue
    }
    data[entry.eventId] = entry
    changed = true
  }
  if (changed) {
    persist(data)
  }
}

export type ObserverChannelPageCursor = { createdAt: number; id: string } | null

export function readIndexedEventsForChannel(
  channelId: string,
  opts: { before?: ObserverChannelPageCursor; limit?: number } = {}
): ObserverChannelIndexEntry[] {
  const limit = opts.limit && opts.limit > 0 ? opts.limit : 50
  const before = opts.before ?? null
  const matches = Object.values(load())
    .filter((entry) => entry.channelId === channelId)
    // Newest-first, matching the real `ORDER BY created_at DESC, id DESC` contract.
    .sort((a, b) => (b.createdAt - a.createdAt) || (b.eventId < a.eventId ? -1 : 1))
    .filter((entry) => {
      if (!before) {
        return true
      }
      if (entry.createdAt !== before.createdAt) {
        return entry.createdAt < before.createdAt
      }
      return entry.eventId < before.id
    })
  return matches.slice(0, limit)
}
