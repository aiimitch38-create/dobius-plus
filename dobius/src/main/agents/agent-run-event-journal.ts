import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import type { AgentRunEvent } from '../../shared/agents'

type JournalRecord = {
  eventId: string
  eventType: string
  occurredAt: string
  sourceTool: 'dobius'
  runId: string
  agentId: string
  context?: AgentRunEvent['context']
  payload: {
    text?: string
    toolName?: string
    detail?: string
  }
  schemaVersion: 1
}

const MAX_FIELD_LENGTH = 4_000
let writeTail = Promise.resolve()

function dataDirectory(): string {
  if (app.isReady()) {
    return app.getPath('userData')
  }
  return process.env.DOBIUS_DATA_DIR ?? path.join(os.homedir(), '.dobius')
}

function truncate(value: string | undefined): string | undefined {
  if (!value) return value
  return value.length <= MAX_FIELD_LENGTH ? value : `${value.slice(0, MAX_FIELD_LENGTH)}…`
}

function journalPath(): string {
  return path.join(dataDirectory(), 'agent-events.ndjson')
}

function adamServiceUrl(): string {
  return process.env.ADAM_SERVICE_URL ?? 'http://127.0.0.1:8791'
}

async function adamServiceToken(): Promise<string | undefined> {
  if (process.env.ADAM_SERVICE_TOKEN) {
    return process.env.ADAM_SERVICE_TOKEN
  }
  const tokenPath = process.env.ADAM_SERVICE_TOKEN_PATH ?? path.join(
    os.homedir(),
    'dobius',
    'projects',
    'ADAM',
    'service',
    'data',
    'service-token'
  )
  try {
    const token = await readFile(tokenPath, 'utf8')
    return token.trim() || undefined
  } catch {
    return undefined
  }
}

function buildRecord(event: AgentRunEvent): JournalRecord {
  return {
    eventId: randomUUID(),
    eventType: `agent.run.${event.kind}`,
    occurredAt: new Date(event.ts).toISOString(),
    sourceTool: 'dobius',
    runId: event.runId,
    agentId: event.agentId,
    ...(event.context ? { context: event.context } : {}),
    payload: {
      ...(event.text ? { text: truncate(event.text) } : {}),
      ...(event.toolName ? { toolName: truncate(event.toolName) } : {}),
      ...(event.detail ? { detail: truncate(event.detail) } : {})
    },
    schemaVersion: 1
  }
}

async function forwardToAdam(record: JournalRecord): Promise<void> {
  const token = await adamServiceToken()
  if (!token || typeof fetch !== 'function') return
  const response = await fetch(new URL('/v1/events/ingest', adamServiceUrl()), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(record),
    signal: AbortSignal.timeout(5_000)
  })
  if (!response.ok) throw new Error(`ADAM event ingest returned HTTP ${response.status}`)
}

export function appendAgentRunJournalEvent(event: AgentRunEvent): void {
  const record = buildRecord(event)
  const line = `${JSON.stringify(record)}\n`
  writeTail = writeTail
    .then(async () => {
      await mkdir(dataDirectory(), { recursive: true })
      await appendFile(journalPath(), line, 'utf8')
      await forwardToAdam(record)
    })
    .catch((error) => {
      console.warn('[agents] failed to persist or forward run event:', error instanceof Error ? error.message : String(error))
    })
}

export function replayRecentAgentRunJournalEvents(limit = 1_000): void {
  writeTail = writeTail
    .then(async () => {
      let contents: string
      try {
        contents = await readFile(journalPath(), 'utf8')
      } catch {
        return
      }
      const records = contents
        .trim()
        .split('\n')
        .filter(Boolean)
        .slice(-limit)
        .flatMap((line) => {
          try {
            return [JSON.parse(line) as JournalRecord]
          } catch {
            return []
          }
        })
      for (const record of records) {
        await forwardToAdam(record)
      }
    })
    .catch((error) => {
      console.warn('[agents] failed to replay run events:', error instanceof Error ? error.message : String(error))
    })
}
