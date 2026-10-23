import { createHash, randomUUID } from 'node:crypto'
import type { AdamDatabase } from '../db/database.js'
import type { SessionMonitor } from '../sessions/monitor.js'
import { classifyIMessageIntent } from './intents.js'
import { JobStore } from '../jobs/store.js'

export type GatewayResult = {
  handled: boolean
  intent: string
  reply?: string
  routeContext?: string
  commandIntentId: string
  requestedActions: string[]
}

export class IMessageCommandGateway {
  constructor(private readonly db: AdamDatabase, private readonly monitors: SessionMonitor) {}

  handle(input: { messageId: string; rowid?: number; text: string }): GatewayResult {
    const existing = this.db.prepare('SELECT id,intent,requested_actions,route_context,result,state FROM imessage_command_intents WHERE inbound_message_id=?')
      .get(input.messageId) as { id: string; intent: string; requested_actions: string; route_context: string | null; result: string | null; state: string } | undefined
    if (existing) return {
      handled: existing.state === 'handled', intent: existing.intent,
      ...(existing.result ? { reply: JSON.parse(existing.result).reply as string } : {}),
      ...(existing.route_context ? { routeContext: existing.route_context } : {}),
      commandIntentId: existing.id, requestedActions: JSON.parse(existing.requested_actions) as string[]
    }
    const classified = classifyIMessageIntent(input.text)
    const now = new Date().toISOString()
    const id = randomUUID()
    const jobs = new JobStore(this.db)
    // Only actionable intents get a job. Bare approval/ack words ("Go","Yes")
    // and general chatter have no executor, so minting a job for them just
    // leaves an orphan stuck in planning forever.
    const mintsJob = classified.intent !== 'general' && classified.intent !== 'approval'
    const command = mintsJob ? jobs.acceptCommand({
      channel: 'imessage', senderId: 'carson', dedupeKey: `imessage:${input.messageId}`,
      body: input.text, receivedAt: now
    }) : undefined
    const jobId = command ? jobs.createJob({
      commandId: command.id, objective: input.text,
      definitionOfDone: { requiredActions: classified.requestedActions, reportOnlyVerifiedOutcomes: true }
    }) : undefined
    if (jobId) {
      let dependencies: string[] = []
      for (const action of classified.requestedActions) {
        const stepId = jobs.addStep({ jobId, title: action, adapter: action.includes('monitor') || action.includes('alert') ? 'imessage-monitor' : 'dobius', dependsOn: dependencies })
        dependencies = [stepId]
      }
      jobs.transitionJob(jobId, 'interpreting', { intent: classified.intent })
      jobs.transitionJob(jobId, 'planning', { requestedActions: classified.requestedActions })
    }
    let handled = false
    let reply: string | undefined
    let routeContext = classified.routeContext
    let state = 'routed'
    if (classified.intent === 'monitor_stop') {
      const stopped = this.monitors.stopAll()
      handled = true
      state = 'handled'
      reply = `Stopped ${stopped.monitorsStopped} session monitor${stopped.monitorsStopped === 1 ? '' : 's'} and cancelled ${stopped.alertsCancelled} pending session alert${stopped.alertsCancelled === 1 ? '' : 's'}. Verified: ${stopped.activeRemaining} monitors active and ${stopped.pendingRemaining} alerts pending.`
      if (jobId) {
        this.db.prepare("UPDATE steps SET state='completed',result=?,updated_at=? WHERE job_id=?")
          .run(JSON.stringify({ verified: true, ...stopped }), now, jobId)
        jobs.transitionJob(jobId, 'preflight', { deterministic: true })
        jobs.transitionJob(jobId, 'running', { deterministic: true })
        jobs.transitionJob(jobId, 'verifying', stopped)
        jobs.recordEvidence({ jobId, verifier: 'monitor-stop-postcondition', source: 'session_monitors+outbox', result: { passed: stopped.activeRemaining === 0 && stopped.pendingRemaining === 0, ...stopped } })
        jobs.transitionJob(jobId, 'completed', stopped)
        jobs.transitionJob(jobId, 'reported', { reply })
      }
    } else if (classified.intent === 'approval') {
      const pending = this.db.prepare("SELECT id,preview FROM pending_action_approvals WHERE state='pending' AND expires_at>? ORDER BY created_at")
        .all(now) as unknown as Array<{ id: string; preview: string }>
      handled = true
      state = 'handled'
      if (pending.length === 0) reply = 'There is no pending action for “Go” to approve.'
      else if (pending.length > 1) reply = `I have ${pending.length} pending actions, so “Go” is ambiguous. Tell me which one: ${pending.map((item, index) => `${index + 1}) ${item.preview}`).join(' ')}`
      else {
        this.db.prepare("UPDATE pending_action_approvals SET state='approved',approval_message_id=?,resolved_at=? WHERE id=?")
          .run(input.messageId, now, pending[0]!.id)
        const approved = this.db.prepare('SELECT action_kind,preview,payload,action_digest FROM pending_action_approvals WHERE id=?')
          .get(pending[0]!.id) as { action_kind: string; preview: string; payload: string; action_digest: string }
        handled = false
        state = 'routed'
        reply = undefined
        routeContext = `EXACT APPROVAL: execute only ${approved.action_kind} with digest ${approved.action_digest}. Preview: ${approved.preview}. Payload: ${approved.payload}. After execution, verify the real outcome and mark this approval executed.`
      }
    }
    this.db.prepare(`INSERT INTO imessage_command_intents
      (id,inbound_message_id,inbound_rowid,command_id,job_id,intent,requested_actions,route_context,state,result,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, input.messageId, input.rowid ?? null, command?.id ?? null, jobId ?? null, classified.intent, JSON.stringify(classified.requestedActions),
        routeContext ?? null, state, reply ? JSON.stringify({ reply }) : null, now, now)
    return { handled, intent: classified.intent, ...(reply ? { reply } : {}),
      ...(routeContext ? { routeContext } : {}),
      commandIntentId: id, requestedActions: classified.requestedActions }
  }

  prepareApproval(input: { actionKind: string; preview: string; payload: unknown; sourceMessageId?: string; ttlMinutes?: number }): { id: string; actionDigest: string; created: boolean } {
    const payload = JSON.stringify(input.payload)
    const actionDigest = IMessageCommandGateway.digest(input.actionKind, input.payload)
    const existing = this.db.prepare('SELECT id FROM pending_action_approvals WHERE action_digest=?').get(actionDigest) as { id: string } | undefined
    if (existing) return { id: existing.id, actionDigest, created: false }
    const id = randomUUID()
    const now = new Date()
    this.db.prepare(`INSERT INTO pending_action_approvals
      (id,action_digest,action_kind,preview,payload,state,source_message_id,created_at,expires_at)
      VALUES (?,?,?,?,?,'pending',?,?,?)`)
      .run(id, actionDigest, input.actionKind, input.preview, payload, input.sourceMessageId ?? null,
        now.toISOString(), new Date(now.getTime() + (input.ttlMinutes ?? 30) * 60_000).toISOString())
    return { id, actionDigest, created: true }
  }

  markApprovalExecuted(actionDigest: string, evidence: unknown): boolean {
    const result = this.db.prepare(`UPDATE pending_action_approvals SET state='executed',result=?,resolved_at=?
      WHERE action_digest=? AND state='approved'`).run(JSON.stringify(evidence), new Date().toISOString(), actionDigest)
    return Number(result.changes) === 1
  }

  recordActionOutcome(input: { commandIntentId: string; action: string; passed: boolean; receipt: unknown }): { jobId: string; complete: boolean; remaining: number } {
    const intent = this.db.prepare('SELECT job_id FROM imessage_command_intents WHERE id=?').get(input.commandIntentId) as { job_id: string | null } | undefined
    if (!intent?.job_id) throw new Error('command intent has no parent job')
    const step = this.db.prepare('SELECT id,state FROM steps WHERE job_id=? AND title=?').get(intent.job_id, input.action) as { id: string; state: string } | undefined
    if (!step) throw new Error(`action is not part of command: ${input.action}`)
    if (step.state === 'completed') {
      const remaining = Number(this.db.prepare("SELECT COUNT(*) AS n FROM steps WHERE job_id=? AND state!='completed'").get(intent.job_id)?.n ?? 0)
      return { jobId: intent.job_id, complete: remaining === 0, remaining }
    }
    const now = new Date().toISOString()
    if (!input.passed) {
      this.db.prepare("UPDATE steps SET state='failed',result=?,error_class='action_failed',updated_at=? WHERE id=?")
        .run(JSON.stringify(input.receipt), now, step.id)
      this.db.prepare("UPDATE jobs SET state='failed',updated_at=? WHERE id=? AND state NOT IN ('reported','cancelled','failed')")
        .run(now, intent.job_id)
      this.db.prepare("UPDATE imessage_command_intents SET state='failed',error=?,updated_at=? WHERE id=?")
        .run(JSON.stringify(input.receipt), now, input.commandIntentId)
      return { jobId: intent.job_id, complete: false, remaining: 1 }
    }
    this.db.prepare("UPDATE steps SET state='completed',result=?,updated_at=? WHERE id=?")
      .run(JSON.stringify(input.receipt), now, step.id)
    new JobStore(this.db).recordEvidence({ jobId: intent.job_id, stepId: step.id, verifier: 'action-receipt', source: input.action, result: { passed: true, receipt: input.receipt } })
    const remaining = Number(this.db.prepare("SELECT COUNT(*) AS n FROM steps WHERE job_id=? AND state!='completed'").get(intent.job_id)?.n ?? 0)
    if (remaining === 0) {
      const jobs = new JobStore(this.db)
      jobs.transitionJob(intent.job_id, 'preflight', { receiptsComplete: true })
      jobs.transitionJob(intent.job_id, 'running', { receiptsComplete: true })
      jobs.transitionJob(intent.job_id, 'verifying', { receiptsComplete: true })
      jobs.transitionJob(intent.job_id, 'completed', { receiptsComplete: true })
      jobs.transitionJob(intent.job_id, 'reported', { receiptsComplete: true })
      this.db.prepare("UPDATE imessage_command_intents SET state='handled',result=?,updated_at=? WHERE id=?")
        .run(JSON.stringify({ passed: true, allActionsVerified: true }), now, input.commandIntentId)
    }
    return { jobId: intent.job_id, complete: remaining === 0, remaining }
  }

  static digest(kind: string, payload: unknown): string {
    return createHash('sha256').update(JSON.stringify({ kind, payload })).digest('hex')
  }
}
