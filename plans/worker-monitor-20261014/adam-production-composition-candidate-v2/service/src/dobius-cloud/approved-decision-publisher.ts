import { z } from "zod";
import type { AdamDatabase } from "../db/database.js";
import { ApprovedDecisionStore, type ApprovedDecisionRow } from "./approved-decision-store.js";
import {
  ApprovedCloudDecisionAuthority,
  actorSourceEvidence,
  parseTrustedApprovedCloudDecision,
  type TrustedApprovedCloudDecision as Decision,
} from "./approved-decision-contract.js";
import { DobiusCloudReceiptStore } from "./receipt-store.js";
import {
  ApprovedJobIntentRequest,
  parseCanonicalApprovedJobPayload,
} from "./approved-job-payload.js";
import { canonicalCloudJobAdamJson } from "./receipt-contract.js";
import {
  DobiusApprovedIntentCli,
  type IntentBridgeCall,
  type IntentBridgeCredentialAuthority,
  type ApprovedIntentChild,
} from "./intent-bridge-cli.js";
import { submitAdamApprovedIntent } from "./child-submit.js";
import {
  ApprovedDecisionOperationRunner,
  type ApprovedDecisionOperation,
} from "./approved-decision-operation.js";

const DecisionId = z.string().uuid();
const REQUEST_LIMIT = 1;
const RECOVERY_INTERVAL_MS = 15_000;

export type ApprovedDecisionPublisherOptions = {
  enabled: boolean;
  database: AdamDatabase;
  receipts: DobiusCloudReceiptStore;
  decisionAuthority: ApprovedCloudDecisionAuthority;
  credentialAuthority: IntentBridgeCredentialAuthority;
  dobiusExecutablePath?: string;
  invoke?: IntentBridgeCall;
  now?: () => number;
};

export type ApprovedDecisionDispatch = {
  decisionId: string;
  intentId: string;
  child: ApprovedIntentChild;
};

/** Production boundary: exact decision IDs only; all authority comes from injected main-owned providers. */
export function createApprovedDecisionPublisher(
  options?: ApprovedDecisionPublisherOptions,
): ApprovedDecisionPublisher | undefined {
  if (
    !options?.enabled ||
    !options.database ||
    !options.receipts ||
    !options.decisionAuthority ||
    !options.credentialAuthority ||
    !options.dobiusExecutablePath
  )
    return undefined;
  try {
    return new ApprovedDecisionPublisher(options);
  } catch {
    return undefined;
  }
}

export class ApprovedDecisionPublisher {
  private readonly store: ApprovedDecisionStore;
  private readonly bridge: DobiusApprovedIntentCli;
  private readonly now: () => number;
  private readonly operations = new ApprovedDecisionOperationRunner();
  private readonly inflight = new Map<string, Promise<ApprovedDecisionDispatch>>();
  private recovery: Promise<{ attempted: number; failed: number }> | undefined;

  constructor(private readonly options: ApprovedDecisionPublisherOptions) {
    if (options.enabled !== true) throw new Error("unavailable");
    this.store = new ApprovedDecisionStore(options.database);
    this.bridge = new DobiusApprovedIntentCli(
      options.dobiusExecutablePath!,
      options.credentialAuthority,
      options.invoke,
    );
    this.now = options.now ?? Date.now;
  }

  dispatch(rawDecisionId: unknown): Promise<ApprovedDecisionDispatch> {
    const parsed = DecisionId.safeParse(rawDecisionId);
    if (!parsed.success) return Promise.reject(new Error("approved decision unavailable"));
    const id = parsed.data;
    const existing = this.inflight.get(id);
    if (existing) return existing;
    let operation: ApprovedDecisionOperation;
    try {
      operation = this.operations.begin();
    } catch {
      return Promise.reject(new Error("approved decision unavailable"));
    }
    const pending = this.dispatchOne(id, operation).finally(() => {
      this.operations.end(operation);
      if (this.inflight.get(id) === pending) this.inflight.delete(id);
    });
    this.inflight.set(id, pending);
    return pending;
  }

  recover(): Promise<{ attempted: number; failed: number }> {
    if (this.recovery) return this.recovery;
    try {
      this.operations.assertNotStopping();
    } catch {
      return Promise.resolve({ attempted: 0, failed: 0 });
    }
    this.recovery = this.recoverRows().finally(() => {
      this.recovery = undefined;
    });
    return this.recovery;
  }

  stop(timeoutMs = 20_000): Promise<boolean> {
    return this.operations.stop(timeoutMs);
  }

  private async recoverRows(): Promise<{ attempted: number; failed: number }> {
    let rows: ApprovedDecisionRow[];
    try {
      rows = this.store.listRecoverable(this.readNow(), REQUEST_LIMIT);
    } catch {
      return { attempted: 0, failed: 1 };
    }
    let attempted = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        this.operations.assertNotStopping();
      } catch {
        break;
      }
      attempted += 1;
      try {
        await this.dispatch(row.decision_id);
      } catch {
        failed += 1;
      }
    }
    return { attempted, failed };
  }

  private async dispatchOne(
    decisionId: string,
    operation: ApprovedDecisionOperation,
  ): Promise<ApprovedDecisionDispatch> {
    this.operations.assert(operation);
    let row = this.store.get(decisionId);
    if (row?.child_json !== null && row?.child_json !== undefined) return this.completed(row);
    if (row?.intent_published === 1) return this.reconcilePublished(row, operation);

    const decision = await this.loadCurrentDecision(decisionId, operation);
    this.operations.assert(operation);
    row = this.store.persistAuthorizedDecision(decision, this.readNow());
    this.assertRowMatches(row, decision);
    if (row.child_json !== null) return this.completed(row);
    if (row.intent_published === 1) return this.reconcilePublished(row, operation);

    const lease = this.store.claim(decisionId, this.readNow());
    if (lease.row.intent_published === 1)
      return this.reconcileClaimed(lease.row, lease.token, operation);
    return this.publishAndSubmit(decision, lease.row, lease.token, operation);
  }

  /** A published intent is queried before decision authority so revoked approvals can reconcile an ACK loss. */
  private async reconcilePublished(
    row: ApprovedDecisionRow,
    operation: ApprovedDecisionOperation,
  ): Promise<ApprovedDecisionDispatch> {
    const lease = this.store.claim(row.decision_id, this.readNow());
    return this.reconcileClaimed(lease.row, lease.token, operation);
  }

  private async reconcileClaimed(
    row: ApprovedDecisionRow,
    token: string,
    operation: ApprovedDecisionOperation,
  ): Promise<ApprovedDecisionDispatch> {
    let published = true;
    try {
      this.operations.assert(operation);
      const dto = this.options.receipts.findApprovedIntentForSubmission(row.intent_id);
      if (!dto) throw new Error("approved decision unavailable");
      this.assertDtoMatchesRow(dto, row);
      const observed = await this.operations.wait(operation, ({ signal }) =>
        this.bridge.lookup(dto, signal),
      );
      this.operations.assert(operation);
      if (observed) {
        this.store.markChildSubmitted(row.decision_id, token, observed, this.readNow());
        return { decisionId: row.decision_id, intentId: row.intent_id, child: observed };
      }

      const decision = await this.loadCurrentDecision(row.decision_id, operation);
      this.assertRowMatches(row, decision);
      if (
        row.decision_expires_at_ms <= this.readNow() ||
        row.intent_expires_at_ms <= this.readNow()
      ) {
        throw new Error("approved decision unavailable");
      }
      this.assertCurrent(decision, operation);
      const child = await this.operations.wait(operation, ({ signal }) =>
        this.bridge.submit(dto, decision, () => this.assertCurrent(decision, operation), signal),
      );
      this.assertCurrent(decision, operation);
      this.store.markChildSubmitted(row.decision_id, token, child, this.readNow());
      return { decisionId: row.decision_id, intentId: row.intent_id, child };
    } catch (error) {
      if (published && !operation.signal.aborted)
        this.releasePublishedAttempt(row.decision_id, token);
      throw error;
    }
  }

  private async publishAndSubmit(
    decision: Decision,
    initialRow: ApprovedDecisionRow,
    token: string,
    operation: ApprovedDecisionOperation,
  ): Promise<ApprovedDecisionDispatch> {
    let row = initialRow;
    let published = false;
    try {
      this.operations.assert(operation);
      let dto = this.options.receipts.findApprovedIntentForSubmission(row.intent_id);
      if (!dto) {
        if (
          row.decision_expires_at_ms <= this.readNow() ||
          row.intent_expires_at_ms <= this.readNow()
        ) {
          throw new Error("approved decision unavailable");
        }
        const requestJson = this.store.prepareIntentRequest(row.decision_id, token, this.readNow());
        row = this.store.get(row.decision_id) ?? row;
        const request = ApprovedJobIntentRequest.parse(JSON.parse(requestJson));
        if (canonicalCloudJobAdamJson(request) !== requestJson)
          throw new Error("approved decision unavailable");
        const payload = parseCanonicalApprovedJobPayload(row.approved_payload_json);
        if (
          payload.projectId !== row.project_id ||
          payload.digest !== row.approved_payload_digest
        ) {
          throw new Error("approved decision unavailable");
        }
        this.assertCurrent(decision, operation);
        const staged = this.store.readStagedIntent(row.decision_id, token);
        if (staged) {
          this.options.receipts.publishStagedApprovedJobGrantWithIntent(
            canonicalCloudJobAdamJson(request),
            staged,
            () => this.assertCurrent(decision, operation),
          );
        } else {
          await this.options.receipts.issueApprovedJobGrantWithIntent(
            canonicalCloudJobAdamJson(request),
            async (envelope) => {
              const sealed = await this.operations.wait(operation, ({ signal }) =>
                this.bridge.seal(
                  envelope,
                  decision,
                  () => this.assertCurrent(decision, operation),
                  signal,
                ),
              );
              this.assertCurrent(decision, operation);
              this.store.stageSealedIntent(
                row.decision_id,
                token,
                envelope,
                sealed,
                this.readNow(),
              );
              return sealed;
            },
            () => this.assertCurrent(decision, operation),
            row.intent_expires_at_ms,
          );
        }
        this.operations.assert(operation);
        this.assertCurrent(decision, operation);
        dto = this.options.receipts.findApprovedIntentForSubmission(row.intent_id);
        if (!dto) throw new Error("approved decision unavailable");
      }
      this.assertDtoMatchesDecision(dto, row, decision);
      this.assertCurrent(decision, operation);
      this.store.markIntentPublished(row.decision_id, token, this.readNow());
      published = true;
      const child = await this.operations.wait(operation, ({ signal }) =>
        submitAdamApprovedIntent(
          dto!,
          decision,
          this.bridge,
          () => this.assertCurrent(decision, operation),
          signal,
        ),
      );
      this.assertCurrent(decision, operation);
      this.store.markChildSubmitted(row.decision_id, token, child, this.readNow());
      return { decisionId: row.decision_id, intentId: row.intent_id, child };
    } catch (error) {
      if (published && !operation.signal.aborted)
        this.releasePublishedAttempt(row.decision_id, token);
      throw error;
    }
  }

  private async loadCurrentDecision(
    decisionId: string,
    operation: ApprovedDecisionOperation,
  ): Promise<Decision> {
    const raw = await this.operations.wait(operation, (context) =>
      this.options.decisionAuthority.resolveExactDecisionJson(decisionId, context),
    );
    this.operations.assert(operation);
    let decision: Decision;
    try {
      decision = parseTrustedApprovedCloudDecision(raw, decisionId);
    } catch {
      throw new Error("approved decision unavailable");
    }
    this.assertCurrent(decision, operation);
    const existing = this.store.get(decisionId);
    if (
      existing &&
      (existing.source_record_json !== canonicalCloudJobAdamJson(decision) ||
        existing.actor_source_json !== actorSourceEvidence(decision) ||
        existing.authority_generation !== decision.authorityGeneration ||
        existing.source_binding !== decision.sourceBinding)
    ) {
      throw new Error("approved decision unavailable");
    }
    return decision;
  }

  private assertRowMatches(row: ApprovedDecisionRow, decision: Decision): void {
    if (
      row.source_record_json !== canonicalCloudJobAdamJson(decision) ||
      row.actor_source_json !== actorSourceEvidence(decision) ||
      row.decision_id !== decision.decisionId ||
      row.project_id !== decision.projectId ||
      row.parent_objective_id !== decision.parentObjectiveId ||
      row.parent_objective_version !== decision.parentObjectiveVersion ||
      row.context_digest !== decision.contextDigest ||
      row.authority_generation !== decision.authorityGeneration ||
      row.source_binding !== decision.sourceBinding
    ) {
      throw new Error("approved decision unavailable");
    }
  }

  private assertDtoMatchesRow(
    dto: NonNullable<ReturnType<DobiusCloudReceiptStore["findApprovedIntentForSubmission"]>>,
    row: ApprovedDecisionRow,
  ): void {
    if (
      dto.intentId !== row.intent_id ||
      dto.identity.projectId !== row.project_id ||
      dto.identity.parentObjectiveId !== row.parent_objective_id ||
      dto.identity.parentObjectiveVersion !== row.parent_objective_version ||
      dto.identity.contextDigest !== row.context_digest ||
      dto.identity.adamInstanceId !== this.options.receipts.instanceId ||
      dto.approvedJob.projectId !== row.project_id ||
      canonicalCloudJobAdamJson(dto.approvedJob) !== row.approved_payload_json ||
      dto.identity.requestFingerprint !== row.approved_payload_digest ||
      dto.identity.expiresAtMs !== row.intent_expires_at_ms ||
      dto.identity.expiresAtMs > row.decision_expires_at_ms
    )
      throw new Error("approved decision unavailable");
  }

  private assertDtoMatchesDecision(
    dto: NonNullable<ReturnType<DobiusCloudReceiptStore["findApprovedIntentForSubmission"]>>,
    row: ApprovedDecisionRow,
    decision: Decision,
  ): void {
    this.assertDtoMatchesRow(dto, row);
    if (
      decision.projectId !== row.project_id ||
      decision.parentObjectiveId !== row.parent_objective_id ||
      decision.parentObjectiveVersion !== row.parent_objective_version ||
      decision.contextDigest !== row.context_digest
    ) {
      throw new Error("approved decision unavailable");
    }
  }

  private assertCurrent(decision: Decision, operation: ApprovedDecisionOperation): void {
    this.operations.assert(operation);
    try {
      if (!this.options.decisionAuthority.isCurrent(decision, operation)) throw new Error("stale");
    } catch {
      throw new Error("approved decision unavailable");
    }
  }

  private releasePublishedAttempt(decisionId: string, token: string): void {
    try {
      this.store.releasePublishedAttempt(decisionId, token, this.readNow());
    } catch {
      /* lease expires safely */
    }
  }

  private completed(row: ApprovedDecisionRow): ApprovedDecisionDispatch {
    if (row.child_json === null) throw new Error("approved decision unavailable");
    return {
      decisionId: row.decision_id,
      intentId: row.intent_id,
      child: parseStoredChild(row.child_json, row),
    };
  }

  private readNow(): number {
    const value = this.now();
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("approved decision unavailable");
    return value;
  }
}

function parseStoredChild(json: string, row: ApprovedDecisionRow): ApprovedIntentChild {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("approved decision unavailable");
  }
  const child = z
    .object({
      id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/),
      state: z.enum([
        "queued",
        "waiting_for_worker",
        "running",
        "needs_review",
        "completed",
        "failed",
        "cancelled",
        "interrupted",
      ]),
      projectId: z.string(),
      requestKey: z.string(),
      taskId: z.string(),
      workspaceId: z.string(),
      sourceRevision: z.string(),
      targetDeviceId: z.string(),
      recipeId: z.string(),
    })
    .strict()
    .safeParse(value);
  if (!child.success || child.data.projectId !== row.project_id)
    throw new Error("approved decision unavailable");
  const payload = parseCanonicalApprovedJobPayload(row.approved_payload_json).approvedJob;
  if (
    child.data.requestKey !== payload.requestKey ||
    child.data.taskId !== payload.taskId ||
    child.data.workspaceId !== payload.workspaceId ||
    child.data.sourceRevision !== payload.sourceRevision ||
    child.data.targetDeviceId !== payload.targetDeviceId ||
    child.data.recipeId !== payload.recipeId
  ) {
    throw new Error("approved decision unavailable");
  }
  return child.data;
}

export const APPROVED_DECISION_RECOVERY_INTERVAL_MS = RECOVERY_INTERVAL_MS;
