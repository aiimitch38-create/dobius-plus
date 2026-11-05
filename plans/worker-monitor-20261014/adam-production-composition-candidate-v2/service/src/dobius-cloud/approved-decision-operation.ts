import { performance } from "node:perf_hooks";
import type { ApprovedDecisionResolutionContext } from "./approved-decision-contract.js";

export const APPROVED_DECISION_OPERATION_LIMIT_MS = 45_000;

export type ApprovedDecisionOperation = ApprovedDecisionResolutionContext & {
  deadline: number;
  controller: AbortController;
  done: Promise<void>;
  finish: () => void;
};

/** Owns cancellation and drain accounting for every decision-provider/CLI await. */
export class ApprovedDecisionOperationRunner {
  private generation = 1;
  private stopping = false;
  private readonly active = new Set<ApprovedDecisionOperation>();
  private readonly unsettled = new Set<Promise<void>>();

  begin(): ApprovedDecisionOperation {
    if (this.stopping) throw new Error("approved decision unavailable");
    const controller = new AbortController();
    let finish!: () => void;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const operation: ApprovedDecisionOperation = {
      signal: controller.signal,
      generation: this.generation,
      deadline: performance.now() + APPROVED_DECISION_OPERATION_LIMIT_MS,
      deadlineAtMs: Date.now() + APPROVED_DECISION_OPERATION_LIMIT_MS,
      controller,
      done,
      finish,
    };
    this.active.add(operation);
    return operation;
  }

  assert(operation: ApprovedDecisionOperation): void {
    if (
      this.stopping ||
      operation.generation !== this.generation ||
      operation.signal.aborted ||
      performance.now() >= operation.deadline
    ) {
      operation.controller.abort();
      throw new Error("approved decision unavailable");
    }
  }

  assertNotStopping(): void {
    if (this.stopping) throw new Error("approved decision unavailable");
  }

  async wait<T>(
    operation: ApprovedDecisionOperation,
    action: (context: ApprovedDecisionResolutionContext) => Promise<T>,
  ): Promise<T> {
    this.assert(operation);
    const remaining = Math.max(1, Math.ceil(operation.deadline - performance.now()));
    const context: ApprovedDecisionResolutionContext = {
      signal: operation.signal,
      generation: operation.generation,
      deadlineAtMs: Math.min(operation.deadlineAtMs, Date.now() + remaining),
    };
    const pending = Promise.resolve().then(() => {
      this.assert(operation);
      return action(context);
    });
    const settled = pending.then(
      () => undefined,
      () => undefined,
    );
    this.unsettled.add(settled);
    void settled.then(() => this.unsettled.delete(settled));
    let onAbort!: () => void;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error("approved decision unavailable"));
      operation.signal.addEventListener("abort", onAbort, { once: true });
    });
    const timer = setTimeout(() => operation.controller.abort(), remaining);
    timer.unref();
    try {
      const value = await Promise.race([pending, aborted]);
      this.assert(operation);
      return value;
    } catch {
      throw new Error("approved decision unavailable");
    } finally {
      clearTimeout(timer);
      operation.signal.removeEventListener("abort", onAbort);
    }
  }

  end(operation: ApprovedDecisionOperation): void {
    if (!this.active.delete(operation)) return;
    operation.finish();
  }

  async stop(timeoutMs: number): Promise<boolean> {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 60_000) return false;
    this.stopping = true;
    this.generation += 1;
    for (const operation of this.active) operation.controller.abort();
    const drain = Promise.all([
      ...Array.from(this.active, (operation) => operation.done),
      ...this.unsettled,
    ]).then(() => true);
    if (timeoutMs === 0) return this.active.size === 0 && this.unsettled.size === 0;
    let timer: NodeJS.Timeout | undefined;
    const result = await Promise.race([
      drain,
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
        timer.unref();
      }),
    ]);
    if (timer) clearTimeout(timer);
    return result;
  }
}
