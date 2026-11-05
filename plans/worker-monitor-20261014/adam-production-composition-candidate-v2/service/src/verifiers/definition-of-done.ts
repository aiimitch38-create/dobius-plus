export type DefinitionOfDoneVerification = {
  passed: boolean
  met: string[]
  unmet: string[]
}

const FAILURE_SIGNAL = /\b(error|errors|failed|failure|exception|traceback|blocked|cannot|can't|couldn't|could not|unable|not able|aborted|crash|crashed|timed out|timeout)\b/i

// Deterministic floor gate on the worker's OWN evidence: a job may no longer
// report as complete on delivery alone. Every definition-of-done item is
// treated as unmet when the worker produced no evidence, or the evidence
// carries an explicit failure signal; otherwise met. This kills the core lie
// (prompt-delivered announced as "verified complete") without pretending to
// judge each item semantically.
// ponytail: floor gate, not per-item semantic judging — swap in an LLM-judged
// evaluator only when this floor misjudges a task type 3+ times
// (DECISIONS 2026-09-02 re-add rule).
export function verifyDefinitionOfDone(definitionOfDone: string[], evidence: string): DefinitionOfDoneVerification {
  const trimmed = evidence.trim()
  // Drop benign "no errors" / "0 failures" phrasing so a clean report does not
  // trip the failure gate (the most common false positive).
  const scanned = trimmed.toLowerCase().replace(/\b(no|zero|0|without|handled|caught)\s+(errors?|failures?|exceptions?)\b/g, '')
  const failed = trimmed.length === 0 || FAILURE_SIGNAL.test(scanned)
  return failed
    ? { passed: false, met: [], unmet: [...definitionOfDone] }
    : { passed: true, met: [...definitionOfDone], unmet: [] }
}
