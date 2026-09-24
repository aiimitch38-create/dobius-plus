import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { app, BrowserWindow } from 'electron'
import type { AgentDraftComment } from '../../shared/agents'
import { SafeJsonFile } from '../storage/safe-json-file'

const FILE_NAME = 'agent-drafts.json'
const MAX_DRAFTS = 100
const RECENT_FINALIZED_COUNT = 20

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

function sanitizeStatus(value: unknown): AgentDraftComment['status'] {
  return value === 'approved' || value === 'discarded' ? value : 'pending'
}

function sanitize(raw: unknown): AgentDraftComment[] {
  if (!Array.isArray(raw)) {
    return []
  }
  return raw.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return []
    }
    const record = entry as Partial<Record<keyof AgentDraftComment, unknown>>
    const target = record.target
    const targetRecord =
      typeof target === 'object' && target !== null
        ? (target as Partial<AgentDraftComment['target']>)
        : null
    const id = typeof record.id === 'string' ? record.id : ''
    const agentId = typeof record.agentId === 'string' ? record.agentId : ''
    const gid = typeof targetRecord?.gid === 'string' ? targetRecord.gid : ''
    const body = typeof record.body === 'string' ? record.body : ''
    const createdAt = typeof record.createdAt === 'number' ? record.createdAt : 0
    if (!id || !agentId || !gid || !createdAt) {
      return []
    }
    return [
      {
        id,
        agentId,
        target: { kind: 'asana', gid },
        body,
        createdAt,
        status: sanitizeStatus(record.status)
      }
    ]
  })
}

const file = new SafeJsonFile<AgentDraftComment[]>({
  filePath,
  parse: (raw) => (Array.isArray(raw) ? sanitize(raw).slice(-MAX_DRAFTS) : undefined),
  fallback: () => [],
  label: '[agents] agent-drafts.json'
})

function load(): AgentDraftComment[] {
  return file.get()
}

function persist(drafts: AgentDraftComment[]): void {
  file.set(drafts.slice(-MAX_DRAFTS))
}

export function broadcastDraftsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('agents:draftsChanged')
    }
  }
}

export function appendDraft(input: {
  agentId: string
  target: AgentDraftComment['target']
  body: string
}): AgentDraftComment {
  const draft: AgentDraftComment = {
    ...input,
    id: randomUUID(),
    createdAt: Date.now(),
    status: 'pending'
  }
  persist([...load(), draft])
  broadcastDraftsChanged()
  return { ...draft, target: { ...draft.target } }
}

export function listDrafts(): AgentDraftComment[] {
  const drafts = load()
  const pending = drafts.filter((draft) => draft.status === 'pending')
  const recentFinalized = drafts
    .filter((draft) => draft.status !== 'pending')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, RECENT_FINALIZED_COUNT)
  return [...pending, ...recentFinalized]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((draft) => ({ ...draft, target: { ...draft.target } }))
}

export function getDraft(id: string): AgentDraftComment | null {
  const draft = load().find((entry) => entry.id === id)
  return draft ? { ...draft, target: { ...draft.target } } : null
}

export function setDraftStatus(
  id: string,
  status: AgentDraftComment['status']
): AgentDraftComment | null {
  const drafts = load()
  const draft = drafts.find((entry) => entry.id === id)
  if (!draft) {
    return null
  }
  draft.status = status
  persist(drafts)
  broadcastDraftsChanged()
  return { ...draft, target: { ...draft.target } }
}
