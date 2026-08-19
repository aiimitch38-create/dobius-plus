/**
 * Pure verdict logic for the communications command verification harness.
 * Kept separate from the runner (which does real I/O — relay HTTP, RPC
 * dispatch) so the classification rules themselves are unit-testable
 * without a live relay or dispatcher. See classify.test.ts, in particular
 * "does not report PASS when the command actually threw", which is the
 * harness's own required self-check (a harness that can produce false
 * PASSes is worse than no harness).
 */

export type Verdict = 'PASS' | 'UNIMPLEMENTED' | 'SHAPE_FAIL' | 'ERROR' | 'SKIPPED'

export type InvokeOutcome =
  | { threw: false; result: unknown }
  | { threw: true; message: string }

export type ShapeCheck = (result: unknown) => { ok: true } | { ok: false; reason: string }

/**
 * Matches the exact string `invokeTauri` throws (tauri.ts) when a command
 * reaches the seam but has no case in dobiusCommunications.ts's switch. This
 * is the ground-truth signal for "pending" — not the manifest's own status
 * field, which is why the harness re-derives it live instead of trusting
 * the JSON on disk.
 */
const UNIMPLEMENTED_PREFIX = 'Dobius Communications command is not implemented: '

export function isUnimplementedError(message: string): boolean {
  return message.startsWith(UNIMPLEMENTED_PREFIX)
}

export type ClassifyResult = {
  verdict: Verdict
  detail?: string
}

/**
 * Predicate for a command that is CORRECTLY implemented by always throwing a
 * real (non-"not implemented") Error — see `classifyOutcome`'s
 * `expectedError` option. Returning true means "this exact thrown message is
 * the command working as designed," not a bug.
 */
export type ExpectedErrorCheck = (message: string) => boolean

/**
 * Classifies one command's real invocation outcome.
 *
 * `shapeCheck` is optional: commands without a hand-built oracle (every
 * currently-pending/removed command, where the verdict is fully determined
 * by whether the switch has a case at all — see command-fixtures.ts for why
 * arguments don't matter for those) fall back to "any non-throwing result
 * is a PASS."
 *
 * `options.expectedError` is for the rarer case a hand-built fixture needs:
 * a command whose REAL, CORRECT, permanent behavior is to always reject
 * every call (e.g. "Dobius has no external-runtime installer by design").
 * Without this, such a command can never verify PASS under any fixture —
 * every real, non-"not implemented" throw is unconditionally ERROR — which
 * either forces a permanent KNOWN_HARNESS_LIMITATIONS carve-out for a
 * command that isn't actually broken, or leaves it looking broken forever.
 * If the thrown message doesn't match, that's still ERROR (a message change
 * on an expected-error command is itself worth surfacing, not silently
 * absorbed). If the command does NOT throw at all, that's SHAPE_FAIL — the
 * fixture's whole premise ("this always rejects") just became false, which
 * is real information, not something to swallow either.
 */
export function classifyOutcome(
  outcome: InvokeOutcome,
  shapeCheck?: ShapeCheck,
  options?: { expectedError?: ExpectedErrorCheck }
): ClassifyResult {
  if (outcome.threw) {
    if (isUnimplementedError(outcome.message)) {
      return { verdict: 'UNIMPLEMENTED' }
    }
    if (options?.expectedError?.(outcome.message)) {
      return { verdict: 'PASS', detail: `expected rejection: ${outcome.message}` }
    }
    return { verdict: 'ERROR', detail: outcome.message }
  }

  if (options?.expectedError) {
    return {
      verdict: 'SHAPE_FAIL',
      detail: 'expected this command to always reject, but it returned a result instead'
    }
  }

  if (!shapeCheck) {
    return { verdict: 'PASS' }
  }

  const shape = shapeCheck(outcome.result)
  if (shape.ok) {
    return { verdict: 'PASS' }
  }
  return { verdict: 'SHAPE_FAIL', detail: shape.reason }
}

export function skipped(reason: string): ClassifyResult {
  return { verdict: 'SKIPPED', detail: reason }
}
