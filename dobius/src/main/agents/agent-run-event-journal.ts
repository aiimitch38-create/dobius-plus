import { appendFile, mkdir, open } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { AgentRunContext, AgentRunEvent } from '../../shared/agents'
import type { DobiusActionEvent } from '../../shared/dobius-action-events'
import {
  agentRunJournalPath,
  requestAgentRunEventDelivery,
  whenAgentRunEventDeliveryIdle
} from './agent-run-event-delivery'

export { getAdamEventDeliveryHealth, startAgentRunEventDelivery } from './agent-run-event-delivery'
export type { AdamEventDeliveryHealth, AdamEventDeliveryState } from './agent-run-event-delivery'

// The envelope ADAM's /v1/events/ingest validates (DobiusEventSchema): runId
// and agentId are required there, so every record carries both.
type JournalRecord = {
  eventId: string
  eventType: string
  occurredAt: string
  sourceTool: 'dobius'
  runId: string
  agentId: string
  context?: AgentRunContext
  payload: Record<string, unknown>
  schemaVersion: 1
}

const MAX_FIELD_LENGTH = 4_000
let appendTail: Promise<void> = Promise.resolve()
let tailChecked = false

// Why: a crash can leave a torn last line with no newline; appending straight
// onto it would glue the next valid event to the fragment and quarantine both.
async function terminateTornTail(journalPath: string): Promise<string> {
  let handle
  try {
    handle = await open(journalPath, 'r')
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return ''
    }
    throw error
  }
  try {
    const { size } = await handle.stat()
    if (size === 0) {
      return ''
    }
    const last = Buffer.alloc(1)
    await handle.read(last, 0, 1, size - 1)
    return last[0] === 0x0a ? '' : '\n'
  } finally {
    await handle.close()
  }
}

function truncate(value: string | undefined): string | undefined {
  if (!value) {
    return value
  }
  return value.length <= MAX_FIELD_LENGTH ? value : `${value.slice(0, MAX_FIELD_LENGTH)}…`
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

function buildActionRecord(event: DobiusActionEvent): JournalRecord {
  const payload: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(event.payload)) {
    payload[key] = typeof value === 'string' ? truncate(value) : value
  }
  return {
    eventId: randomUUID(),
    eventType: event.type,
    occurredAt: new Date(event.ts).toISOString(),
    sourceTool: 'dobius',
    // Why: ADAM requires runId/agentId. An action outside a run is keyed by its
    // correlation id and attributed to whoever performed it.
    runId: event.runId ?? event.context.correlationId,
    agentId: event.actor,
    context: event.context,
    payload,
    schemaVersion: 1
  }
}

export function appendAgentRunJournalEvent(event: AgentRunEvent): void {
  appendRecord(buildRecord(event))
}

/** Appends a significant Dobius action to the same journal the run events use. */
export function appendDobiusActionJournalEvent(event: DobiusActionEvent): void {
  appendRecord(buildActionRecord(event))
}

// Why: one append chain for every event type keeps a single writer to the
// journal, and so a single drainer to ADAM (B3).
function appendRecord(record: JournalRecord): void {
  const line = `${JSON.stringify(record)}\n`
  // Why: the append chain never waits on the network; delivery is a separate
  // drainer that reads what is already on disk (#78).
  appendTail = appendTail
    .then(async () => {
      const journalPath = agentRunJournalPath()
      await mkdir(path.dirname(journalPath), { recursive: true })
      const prefix = tailChecked ? '' : await terminateTornTail(journalPath)
      await appendFile(journalPath, prefix + line, 'utf8')
      tailChecked = true
      requestAgentRunEventDelivery()
    })
    .catch((error) => {
      console.warn(
        '[agents] failed to persist run event:',
        error instanceof Error ? error.message : String(error)
      )
    })
}

/** Resolves once queued appends and the current delivery pass have finished. */
export async function whenAgentRunJournalIdle(): Promise<void> {
  await appendTail
  await whenAgentRunEventDeliveryIdle()
}
