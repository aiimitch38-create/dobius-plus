import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { AdamDatabase } from '../db/database.js'
import { queueObsidianProjection } from './obsidian-projection.js'

export const DobiusEventSchema = z.object({
  eventId: z.string().min(1).max(300),
  eventType: z.string().min(1).max(200),
  occurredAt: z.string().min(1).max(100),
  sourceTool: z.literal('dobius'),
  runId: z.string().min(1).max(200),
  agentId: z.string().min(1).max(200),
  context: z.object({
    correlationId: z.string().min(1).max(200),
    adamJobId: z.string().min(1).max(200).optional(),
    adamTaskId: z.string().min(1).max(200).optional(),
    projectId: z.string().min(1).max(500).optional(),
    worktreeId: z.string().min(1).max(500).optional(),
    requestedBy: z.string().min(1).max(200).optional(),
    // Digest of the context pack Dobius+ admitted the run under (B2 run-adoption gate).
    contextDigest: z.string().min(1).max(300).optional()
  }).optional(),
  payload: z.record(z.string(), z.unknown()),
  schemaVersion: z.literal(1)
})

export type DobiusEvent = z.infer<typeof DobiusEventSchema>

export function ingestDobiusEvent(db: AdamDatabase, event: DobiusEvent): { eventId: string; inserted: boolean } {
  const occurredAt = new Date(event.occurredAt)
  const normalizedOccurredAt = Number.isNaN(occurredAt.getTime()) ? new Date().toISOString() : occurredAt.toISOString()
  const projectId = event.context?.projectId ?? null
  const payload = JSON.stringify({
    sourceTool: event.sourceTool,
    runId: event.runId,
    agentId: event.agentId,
    context: event.context ?? null,
    payload: event.payload,
    schemaVersion: event.schemaVersion
  })
  const result = db.prepare(`
    INSERT OR IGNORE INTO events (id, event_key, project_id, type, payload, occurred_at, ingested_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    randomUUID(),
    `dobius:${event.eventId}`,
    projectId,
    event.eventType,
    payload,
    normalizedOccurredAt,
    new Date().toISOString()
  )
  const inserted = result.changes === 1
  if (inserted) {
    queueObsidianProjection(event)
  }
  return { eventId: event.eventId, inserted }
}
