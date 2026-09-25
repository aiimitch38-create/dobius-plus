import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { BrowserWindow } from 'electron'
import type { BriefingItem } from '../../shared/agents'
import { parseEveryEntry, SafeJsonFile } from '../storage/safe-json-file'
import { getUserDataRoot } from '../storage/user-data-root'

const FILE_NAME = 'agents-briefing.json'
const MAX_ITEMS = 200
const RECENT_WINDOW_MS = 48 * 60 * 60 * 1000

// Why: dismissing hides items from the 48 h view; it must not delete history (#46).
type StoredBriefingItem = BriefingItem & { dismissed?: true }

function filePath(): string {
  return path.join(getUserDataRoot(), FILE_NAME)
}

// Why: a malformed entry makes the whole file unreadable instead of being
// dropped and then saved over (CX12 F2).
function sanitizeItem(entry: unknown): StoredBriefingItem | null {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    return null
  }
  const record = entry as Partial<Record<keyof StoredBriefingItem, unknown>>
  const id = typeof record.id === 'string' ? record.id : ''
  const agentId = typeof record.agentId === 'string' ? record.agentId : ''
  const ts = typeof record.ts === 'number' ? record.ts : 0
  const summary = typeof record.summary === 'string' ? record.summary : ''
  if (!id || !agentId || !ts || !summary) {
    return null
  }
  return {
    id,
    agentId,
    ts,
    urgency: record.urgency === 'now' ? 'now' : 'digest',
    summary,
    demoted: record.demoted === true,
    ...(record.dismissed === true ? { dismissed: true as const } : {})
  }
}

const file = new SafeJsonFile<StoredBriefingItem[]>({
  filePath,
  parse: (raw) => (Array.isArray(raw) ? parseEveryEntry(raw, sanitizeItem) : undefined),
  fallback: () => [],
  label: '[agents] agents-briefing.json'
})

function load(): StoredBriefingItem[] {
  return file.get()
}

function persist(items: StoredBriefingItem[]): void {
  file.set(items.slice(-MAX_ITEMS))
}

export function broadcastBriefingChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('agents:briefingChanged')
    }
  }
}

export function appendBriefingItem(input: Omit<BriefingItem, 'id' | 'ts'>): BriefingItem {
  const item: BriefingItem = { ...input, id: randomUUID(), ts: Date.now() }
  persist([...load(), item])
  broadcastBriefingChanged()
  return item
}

export function listRecentBriefingItems(): BriefingItem[] {
  const cutoff = Date.now() - RECENT_WINDOW_MS
  return load()
    .filter((item) => item.ts >= cutoff && !item.dismissed)
    .sort((a, b) => b.ts - a.ts)
    .map(({ dismissed: _dismissed, ...item }) => item)
}

export function dismissBriefingItems(): void {
  const now = Date.now()
  persist(
    load().map((item) => (item.ts <= now && !item.dismissed ? { ...item, dismissed: true } : item))
  )
  broadcastBriefingChanged()
}
