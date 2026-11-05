import { randomUUID } from 'node:crypto'
import type { AdamDatabase } from '../db/database.js'
import { canTransition, type JobState } from './states.js'

const nowIso = (): string => new Date().toISOString()
const json = (value: unknown): string => JSON.stringify(value)

const SPOKEN_LINE_MAX_CHARS = 300
const SPOKEN_SUBJECT_MAX_CHARS = 160
const SPOKEN_GIST_MAX_CHARS = 120

const cleanSpokenText = (text: string): string =>
  text.replace(/[*_`#>[\]]/g, ' ').replace(/\s+/g, ' ').trim()

const firstSentence = (text: string): string => {
  const match = text.match(/^([\s\S]*?[.!?])(?:\s|$)/)
  return (match ? match[1]! : text).replace(/[.!?]+$/, '').trim()
}

const clipAtWord = (text: string, max: number): string => {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trim()
}

export function spokenCompletion(input: { outcome: 'done' | 'failed'; objective: string; error?: string }): string {
  const subject = clipAtWord(firstSentence(cleanSpokenText(input.objective)), SPOKEN_SUBJECT_MAX_CHARS) || 'your request'
  if (input.outcome === 'done') return `Done: ${subject}. Verified.`
  const gist = input.error ? clipAtWord(firstSentence(cleanSpokenText(input.error)), SPOKEN_GIST_MAX_CHARS) : ''
  const line = gist ? `Failed: ${subject}. ${gist}.` : `Failed: ${subject}.`
  return clipAtWord(line, SPOKEN_LINE_MAX_CHARS)
}

export class JobStore {
  constructor(private readonly db: AdamDatabase) {}

  acceptCommand(input: {
    channel: string
    senderId: string
    dedupeKey: string
    body: string
    receivedAt?: string
  }): { id: string; created: boolean } {
    const existing = this.db.prepare('SELECT id FROM commands WHERE dedupe_key = ?').get(input.dedupeKey) as
      | { id: string }
      | undefined
    if (existing) {
      return { id: existing.id, created: false }
    }
    const id = randomUUID()
    this.db.prepare(
      'INSERT INTO commands (id, channel, sender_id, dedupe_key, body, received_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, input.channel, input.senderId, input.dedupeKey, input.body, input.receivedAt ?? nowIso())
    this.audit('system', 'command.accepted', id, { channel: input.channel, senderId: input.senderId })
    return { id, created: true }
  }

  createJob(input: {
    commandId?: string
    objective: string
    projectId?: string
    risk?: string
    definitionOfDone?: unknown
  }): string {
    const id = randomUUID()
    const at = nowIso()
    this.db.prepare(`
      INSERT INTO jobs (id, command_id, objective, project_id, state, risk, definition_of_done, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'received', ?, ?, ?, ?)
    `).run(
      id,
      input.commandId ?? null,
      input.objective,
      input.projectId ?? null,
      input.risk ?? 'low',
      json(input.definitionOfDone ?? {}),
      at,
      at
    )
    this.audit('system', 'job.created', id, { objective: input.objective })
    return id
  }

  getJob(id: string): Record<string, unknown> | undefined {
    return this.db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined
  }

  transitionJob(id: string, to: JobState, detail: unknown = {}): void {
    const job = this.getJob(id)
    if (!job) throw new Error(`Job not found: ${id}`)
    const from = job.state as JobState
    if (!canTransition(from, to)) throw new Error(`Invalid job transition: ${from} -> ${to}`)
    if (to === 'completed') {
      const incomplete = this.db.prepare(`
        SELECT count(*) AS count FROM steps WHERE job_id = ? AND state != 'completed'
      `).get(id) as { count: number }
      if (incomplete.count > 0) {
        throw new Error(`Completion gate failed: ${incomplete.count} step(s) are incomplete`)
      }
      const passedEvidence = this.db.prepare(`
        SELECT count(*) AS count FROM evidence
        WHERE job_id = ? AND json_extract(result, '$.passed') = 1
      `).get(id) as { count: number }
      if (passedEvidence.count === 0) {
        throw new Error('Completion gate failed: no independent passing evidence')
      }
    }
    const at = nowIso()
    const completedAt = to === 'completed' ? at : null
    this.db.prepare('UPDATE jobs SET state = ?, updated_at = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?')
      .run(to, at, completedAt, id)
    this.audit('system', 'job.transitioned', id, { from, to, detail })
  }

  addStep(input: {
    jobId: string
    title: string
    adapter: string
    payload?: unknown
    dependsOn?: string[]
    maxAttempts?: number
  }): string {
    const id = randomUUID()
    const at = nowIso()
    this.db.prepare(`
      INSERT INTO steps (id, job_id, title, adapter, input, depends_on, max_attempts, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.jobId, input.title, input.adapter, json(input.payload ?? {}), json(input.dependsOn ?? []), input.maxAttempts ?? 3, at, at)
    return id
  }

  claimReadyStep(workerId: string, leaseMs: number, at = new Date()): Record<string, unknown> | undefined {
    return this.claimReadyStepForJob(undefined, workerId, leaseMs, at)
  }

  claimReadyStepForJob(jobId: string | undefined, workerId: string, leaseMs: number, at = new Date()): Record<string, unknown> | undefined {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare(`
        UPDATE steps SET state = 'pending', lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
        WHERE state = 'running' AND lease_expires_at <= ?
      `).run(at.toISOString(), at.toISOString())
      const candidates = this.db.prepare(`
        SELECT * FROM steps WHERE state = 'pending' AND attempt_count < max_attempts
          AND (? IS NULL OR job_id = ?)
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        ORDER BY created_at
      `).all(jobId ?? null, jobId ?? null, at.toISOString()) as Record<string, unknown>[]
      const ready = candidates.find((candidate) => {
        const dependencies = JSON.parse(String(candidate.depends_on)) as string[]
        return dependencies.every((dependency) => {
          const row = this.db.prepare('SELECT state FROM steps WHERE id = ?').get(dependency) as { state: string } | undefined
          return row?.state === 'completed'
        })
      })
      if (!ready) {
        this.db.exec('COMMIT')
        return undefined
      }
      const expires = new Date(at.getTime() + leaseMs).toISOString()
      this.db.prepare(`
        UPDATE steps SET state = 'running', lease_owner = ?, lease_expires_at = ?,
          attempt_count = attempt_count + 1, updated_at = ? WHERE id = ? AND state = 'pending'
      `).run(workerId, expires, at.toISOString(), String(ready.id))
      const claimed = this.db.prepare('SELECT * FROM steps WHERE id = ?').get(String(ready.id)) as Record<string, unknown>
      this.db.exec('COMMIT')
      return claimed
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  deferStep(stepId: string, workerId: string, nextAttemptAt: Date, result: unknown): void {
    const changed = this.db.prepare(`
      UPDATE steps SET state='pending', result=?, lease_owner=NULL, lease_expires_at=NULL,
        next_attempt_at=?, attempt_count=MAX(0,attempt_count-1), updated_at=?
      WHERE id=? AND state='running' AND lease_owner=?
    `).run(json(result), nextAttemptAt.toISOString(), nowIso(), stepId, workerId).changes
    if (changed !== 1) throw new Error('Step deferral rejected: lease is not owned by worker')
  }

  completeStep(stepId: string, workerId: string, result: unknown): void {
    const changed = this.db.prepare(`
      UPDATE steps SET state = 'completed', result = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
      WHERE id = ? AND state = 'running' AND lease_owner = ?
    `).run(json(result), nowIso(), stepId, workerId).changes
    if (changed !== 1) throw new Error('Step completion rejected: lease is not owned by worker')
  }

  failStep(stepId: string, workerId: string, errorClass: string, detail: unknown): void {
    const row = this.db.prepare('SELECT attempt_count, max_attempts FROM steps WHERE id = ? AND lease_owner = ?').get(stepId, workerId) as
      | { attempt_count: number; max_attempts: number }
      | undefined
    if (!row) throw new Error('Step failure rejected: lease is not owned by worker')
    const state = row.attempt_count >= row.max_attempts ? 'failed' : 'pending'
    this.db.prepare(`
      UPDATE steps SET state = ?, error_class = ?, result = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?
    `).run(state, errorClass, json(detail), nowIso(), stepId)
  }

  failStepForced(stepId: string, workerId: string, errorClass: string, detail: unknown): void {
    const changed = this.db.prepare(`
      UPDATE steps SET state = 'failed', error_class = ?, result = ?, lease_owner = NULL,
        lease_expires_at = NULL, next_attempt_at = NULL, updated_at = ?
      WHERE id = ? AND lease_owner = ? AND state IN ('pending', 'running')
    `).run(errorClass, json(detail), nowIso(), stepId, workerId).changes
    if (changed !== 1) throw new Error('Forced step failure rejected: lease is not owned by worker')
  }

  recordEvidence(input: { jobId: string; stepId?: string; verifier: string; source: string; digest?: string; result: unknown }): string {
    const id = randomUUID()
    this.db.prepare(`
      INSERT INTO evidence (id, job_id, step_id, verifier, source, digest, result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.jobId, input.stepId ?? null, input.verifier, input.source, input.digest ?? null, json(input.result), nowIso())
    return id
  }

  enqueueOutbox(input: { dedupeKey: string; channel: string; recipient: string; payload: unknown }): { id: string; created: boolean } {
    const existing = this.db.prepare('SELECT id FROM outbox WHERE dedupe_key = ?').get(input.dedupeKey) as { id: string } | undefined
    if (existing) return { id: existing.id, created: false }
    const id = randomUUID()
    const at = nowIso()
    this.db.prepare(`
      INSERT INTO outbox (id, dedupe_key, channel, recipient, payload, next_attempt_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.dedupeKey, input.channel, input.recipient, json(input.payload), at, at)
    return { id, created: true }
  }

  pendingTts(limit = 20): Array<{ id: string; dedupeKey: string; recipient: string; text?: string }> {
    const rows = this.db.prepare(`
      SELECT id, dedupe_key, recipient, payload FROM outbox
      WHERE channel = 'tts' AND sent_at IS NULL
      ORDER BY created_at LIMIT ?
    `).all(limit) as Array<{ id: string; dedupe_key: string; recipient: string; payload: string }>
    return rows.map((row) => {
      let text: string | undefined
      try {
        const payload = JSON.parse(row.payload) as { text?: unknown }
        if (typeof payload.text === 'string') text = payload.text
      } catch {
        text = undefined
      }
      return { id: row.id, dedupeKey: row.dedupe_key, recipient: row.recipient, ...(text !== undefined ? { text } : {}) }
    })
  }

  markTtsSent(id: string): boolean {
    const at = nowIso()
    return this.db.prepare("UPDATE outbox SET sent_at = ?, state = 'delivered', delivered_at = ? WHERE id = ? AND channel = 'tts' AND sent_at IS NULL")
      .run(at, at, id).changes === 1
  }

  private audit(actor: string, eventType: string, subjectId: string | null, detail: unknown): void {
    this.db.prepare(`
      INSERT INTO audit_log (event_id, actor, event_type, subject_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), actor, eventType, subjectId, json(detail), nowIso())
  }
}
