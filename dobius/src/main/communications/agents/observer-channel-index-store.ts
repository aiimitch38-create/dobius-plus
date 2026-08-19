import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

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

let cached: IndexFile | null = null

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

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

function sanitize(raw: unknown): IndexFile {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {}
  }
  const out: IndexFile = {}
  for (const [eventId, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = sanitizeEntry(value)
    if (entry) {
      out[eventId] = entry
    }
  }
  return out
}

function load(): IndexFile {
  if (cached) {
    return cached
  }
  const target = filePath()
  if (!existsSync(target)) {
    cached = {}
    return cached
  }
  try {
    cached = sanitize(JSON.parse(readFileSync(target, 'utf-8')))
  } catch (error) {
    console.warn(
      '[communications/agents] failed to load observer channel index:',
      error instanceof Error ? error.message : String(error)
    )
    cached = {}
  }
  return cached
}

function persist(data: IndexFile): void {
  const target = filePath()
  const tmp = `${target}.${process.pid}.tmp`
  mkdirSync(path.dirname(target), { recursive: true })
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf-8')
  renameSync(tmp, target)
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
    cached = data
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
