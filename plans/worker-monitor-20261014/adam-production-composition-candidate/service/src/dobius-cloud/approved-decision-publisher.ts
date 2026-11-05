import { z } from 'zod'
import type { AdamDatabase } from '../db/database.js'
import {
  ApprovedDecisionStore, type ApprovedDecisionRow
} from './approved-decision-store.js'
import {
  ApprovedCloudDecisionAuthority, actorSourceEvidence,
  parseTrustedApprovedCloudDecision, type TrustedApprovedCloudDecision as Decision
} from './approved-decision-contract.js'
import { DobiusCloudReceiptStore } from './receipt-store.js'
import { ApprovedJobIntentRequest, parseCanonicalApprovedJobPayload } from './approved-job-payload.js'
import { canonicalCloudJobAdamJson } from './receipt-contract.js'
import {
  DobiusApprovedIntentCli, type IntentBridgeCall, type IntentBridgeCredentialAuthority, type ApprovedIntentChild
} from './intent-bridge-cli.js'
import { submitAdamApprovedIntent } from './child-submit.js'

const DecisionId = z.string().uuid()
const REQUEST_LIMIT = 1
const RECOVERY_INTERVAL_MS = 15_000

export type ApprovedDecisionPublisherOptions = {
  enabled: boolean
  database: AdamDatabase
  receipts: DobiusCloudReceiptStore
  decisionAuthority: ApprovedCloudDecisionAuthority
  credentialAuthority: IntentBridgeCredentialAuthority
  dobiusExecutablePath?: string
  invoke?: IntentBridgeCall
  now?: () => number
}

export type ApprovedDecisionDispatch = { decisionId: string; intentId: string; child: ApprovedIntentChild }

/** Production boundary: exact decision IDs only; all authority comes from injected main-owned providers. */
export function createApprovedDecisionPublisher(
  options?: ApprovedDecisionPublisherOptions
): ApprovedDecisionPublisher | undefined {
  if (!options?.enabled || !options.database || !options.receipts || !options.decisionAuthority ||
      !options.credentialAuthority || !options.dobiusExecutablePath) return undefined
  try {
    return new ApprovedDecisionPublisher(options)
  } catch {
    return undefined
  }
}

export class ApprovedDecisionPublisher {
  private readonly store: ApprovedDecisionStore
  private readonly bridge: DobiusApprovedIntentCli
  private readonly now: () => number
  private readonly inflight = new Map<string, Promise<ApprovedDecisionDispatch>>()
  private recovery: Promise<{ attempted: number; failed: number }> | undefined
  private stopping = false

  constructor(private readonly options: ApprovedDecisionPublisherOptions) {
    if (options.enabled !== true) throw new Error('unavailable')
    this.store = new ApprovedDecisionStore(options.database)
    this.bridge = new DobiusApprovedIntentCli(options.dobiusExecutablePath!,
      options.credentialAuthority, options.invoke)
    this.now = options.now ?? Date.now
  }

  dispatch(rawDecisionId: unknown): Promise<ApprovedDecisionDispatch> {
    const parsed = DecisionId.safeParse(rawDecisionId)
    if (!parsed.success || this.stopping) return Promise.reject(new Error('approved decision unavailable'))
    const id = parsed.data
    const existing = this.inflight.get(id)
    if (existing) return existing
    const pending = this.dispatchOne(id).finally(() => {
      if (this.inflight.get(id) === pending) this.inflight.delete(id)
    })
    this.inflight.set(id, pending)
    return pending
  }

  recover(): Promise<{ attempted: number; failed: number }> {
    if (this.stopping) return Promise.resolve({ attempted: 0, failed: 0 })
    if (this.recovery) return this.recovery
    this.recovery = this.recoverRows().finally(() => { this.recovery = undefined })
    return this.recovery
  }

  async stop(timeoutMs = 20_000): Promise<boolean> {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 60_000) return false
    this.stopping = true
    const pending = Promise.allSettled([
      ...this.inflight.values(),
      ...(this.recovery ? [this.recovery] : [])
    ])
    if (timeoutMs === 0) return this.inflight.size === 0 && !this.recovery
    let timer: NodeJS.Timeout | undefined
    const drained = await Promise.race([
      pending.then(() => true),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); timer.unref() })
    ])
    if (timer) clearTimeout(timer)
    return drained
  }

  private async recoverRows(): Promise<{ attempted: number; failed: number }> {
    let attempted = 0
    let failed = 0
    let rows: ApprovedDecisionRow[]
    try { rows = this.store.listRecoverable(this.readNow(), REQUEST_LIMIT) }
    catch { return { attempted, failed: 1 } }
    for (const row of rows) {
      attempted += 1
      try { await this.dispatch(row.decision_id) } catch { failed += 1 }
    }
    return { attempted, failed }
  }

  private async dispatchOne(decisionId: string): Promise<ApprovedDecisionDispatch> {
    const decision = await this.loadCurrentDecision(decisionId)
    let row = this.store.persistAuthorizedDecision(decision, this.readNow())
    this.assertRowMatches(row, decision)
    if (row.child_json !== null) {
      const child = parseStoredChild(row.child_json, row)
      this.assertCurrent(decision)
      return { decisionId, intentId: row.intent_id, child }
    }
    const lease = this.store.claim(decisionId, this.readNow())
    let published = lease.row.intent_published === 1
    try {
      let dto = this.options.receipts.findApprovedIntentForSubmission(lease.row.intent_id)
      if (!dto) {
        if (published || lease.row.decision_expires_at_ms <= this.readNow()) throw new Error('approved decision unavailable')
        const requestJson = this.store.prepareIntentRequest(decisionId, lease.token, this.readNow())
        row = this.store.get(decisionId) ?? lease.row
        const request = ApprovedJobIntentRequest.parse(JSON.parse(requestJson))
        if (canonicalCloudJobAdamJson(request) !== requestJson) throw new Error('approved decision unavailable')
        const payload = parseCanonicalApprovedJobPayload(row.approved_payload_json)
        if (payload.projectId !== row.project_id || payload.digest !== row.approved_payload_digest) {
          throw new Error('approved decision unavailable')
        }
        this.assertCurrent(decision)
        const staged = this.store.readStagedIntent(decisionId, lease.token)
        if (staged) {
          this.options.receipts.publishStagedApprovedJobGrantWithIntent(
            canonicalCloudJobAdamJson(request), staged, () => this.assertCurrent(decision)
          )
        } else {
          await this.options.receipts.issueApprovedJobGrantWithIntent(
            canonicalCloudJobAdamJson(request), async (envelope) => {
              const sealed = await this.bridge.seal(envelope, decision, () => this.assertCurrent(decision))
              this.assertCurrent(decision)
              this.store.stageSealedIntent(decisionId, lease.token, envelope, sealed, this.readNow())
              return sealed
            }, () => this.assertCurrent(decision), row.intent_expires_at_ms
          )
        }
        dto = this.options.receipts.findApprovedIntentForSubmission(row.intent_id)
        if (!dto) throw new Error('approved decision unavailable')
      }
      this.assertDtoMatches(dto, row, decision)
      if (!published) {
        this.store.markIntentPublished(decisionId, lease.token, this.readNow())
        published = true
      }
      this.assertCurrent(decision)
      const child = await submitAdamApprovedIntent(dto, decision, this.bridge, () => this.assertCurrent(decision))
      this.assertCurrent(decision)
      this.store.markChildSubmitted(decisionId, lease.token, child, this.readNow())
      return { decisionId, intentId: row.intent_id, child }
    } catch (error) {
      // Do not compensate or reseal; a published exact intent is the only retry input.
      if (published) {
        try { this.store.releasePublishedAttempt(decisionId, lease.token, this.readNow()) } catch { /* lease expires safely */ }
      }
      throw error
    }
  }

  private async loadCurrentDecision(decisionId: string): Promise<Decision> {
    const source = this.options.decisionAuthority
    let raw: unknown
    try { raw = await source.resolveExactDecisionJson(decisionId) } catch { throw new Error('approved decision unavailable') }
    let decision: Decision
    try { decision = parseTrustedApprovedCloudDecision(raw, decisionId) }
    catch { throw new Error('approved decision unavailable') }
    this.assertCurrent(decision)
    const existing = this.store.get(decisionId)
    if (existing && (existing.source_record_json !== canonicalCloudJobAdamJson(decision) ||
        existing.actor_source_json !== actorSourceEvidence(decision) ||
        existing.authority_generation !== decision.authorityGeneration || existing.source_binding !== decision.sourceBinding)) {
      throw new Error('approved decision unavailable')
    }
    return decision
  }

  private assertRowMatches(row: ApprovedDecisionRow, decision: Decision): void {
    if (row.source_record_json !== canonicalCloudJobAdamJson(decision) ||
        row.actor_source_json !== actorSourceEvidence(decision) || row.decision_id !== decision.decisionId ||
        row.project_id !== decision.projectId || row.parent_objective_id !== decision.parentObjectiveId ||
        row.parent_objective_version !== decision.parentObjectiveVersion || row.context_digest !== decision.contextDigest ||
        row.authority_generation !== decision.authorityGeneration || row.source_binding !== decision.sourceBinding) {
      throw new Error('approved decision unavailable')
    }
  }

  private assertDtoMatches(
    dto: NonNullable<ReturnType<DobiusCloudReceiptStore['findApprovedIntentForSubmission']>>,
    row: ApprovedDecisionRow,
    decision: Decision
  ): void {
    if (dto.intentId !== row.intent_id || dto.identity.projectId !== row.project_id ||
        dto.identity.parentObjectiveId !== row.parent_objective_id ||
        dto.identity.parentObjectiveVersion !== row.parent_objective_version ||
        dto.identity.contextDigest !== row.context_digest || dto.identity.adamInstanceId !== this.options.receipts.instanceId ||
        dto.approvedJob.projectId !== row.project_id ||
        canonicalCloudJobAdamJson(dto.approvedJob) !== row.approved_payload_json ||
        dto.identity.requestFingerprint !== row.approved_payload_digest ||
        dto.identity.expiresAtMs !== row.intent_expires_at_ms ||
        dto.identity.expiresAtMs > row.decision_expires_at_ms || decision.projectId !== row.project_id) {
      throw new Error('approved decision unavailable')
    }
  }

  private assertCurrent(decision: Decision): void {
    try {
      if (!this.options.decisionAuthority.isCurrent(decision)) throw new Error('stale')
    } catch { throw new Error('approved decision unavailable') }
  }

  private readNow(): number {
    const value = this.now()
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('approved decision unavailable')
    return value
  }
}

function parseStoredChild(json: string, row: ApprovedDecisionRow): ApprovedIntentChild {
  let value: unknown
  try { value = JSON.parse(json) } catch { throw new Error('approved decision unavailable') }
  const child = z.object({
    id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/),
    state: z.enum(['queued', 'waiting_for_worker', 'running', 'needs_review', 'completed', 'failed', 'cancelled', 'interrupted']),
    projectId: z.string(), requestKey: z.string(), taskId: z.string(), workspaceId: z.string(),
    sourceRevision: z.string(), targetDeviceId: z.string(), recipeId: z.string()
  }).strict().safeParse(value)
  if (!child.success || child.data.projectId !== row.project_id) throw new Error('approved decision unavailable')
  const payload = parseCanonicalApprovedJobPayload(row.approved_payload_json).approvedJob
  if (child.data.requestKey !== payload.requestKey || child.data.taskId !== payload.taskId ||
      child.data.workspaceId !== payload.workspaceId || child.data.sourceRevision !== payload.sourceRevision ||
      child.data.targetDeviceId !== payload.targetDeviceId || child.data.recipeId !== payload.recipeId) {
    throw new Error('approved decision unavailable')
  }
  return child.data
}

export const APPROVED_DECISION_RECOVERY_INTERVAL_MS = RECOVERY_INTERVAL_MS
