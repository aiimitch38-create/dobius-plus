import {
  labelsForSurface,
  type LayaAdvisorySurface,
  type LayaAuthoritySnapshot
} from '../../shared/laya-advisory'

export type CandidatePolicy = { accepted: boolean; veto: string | null }

function enabled(facts: unknown, key: string): boolean {
  return (
    typeof facts === 'object' && facts !== null && (facts as Record<string, unknown>)[key] === true
  )
}

function numericFact(facts: unknown, key: string): number | null {
  if (typeof facts !== 'object' || facts === null) {
    return null
  }
  const value = (facts as Record<string, unknown>)[key]
  return typeof value === 'number' ? value : null
}

export function allowedLabels(snapshot: LayaAuthoritySnapshot): readonly string[] {
  const fixed = labelsForSurface(snapshot.surface)
  if (snapshot.surface === 'job-routing' || snapshot.surface === 'storage') {
    return [...snapshot.eligibleChoices, ...fixed]
  }
  return fixed
}

export function isEligibleChoice(snapshot: LayaAuthoritySnapshot, decision: string): boolean {
  return (
    (snapshot.surface === 'job-routing' || snapshot.surface === 'storage') &&
    snapshot.eligibleChoices.includes(decision)
  )
}

export function validateCandidateLabel(
  snapshot: LayaAuthoritySnapshot,
  decision: string | null
): CandidatePolicy {
  if (decision === null) {
    return { accepted: false, veto: null }
  }
  if (!allowedLabels(snapshot).includes(decision)) {
    return { accepted: false, veto: 'decision-outside-authority-options' }
  }

  const facts = snapshot.facts
  switch (snapshot.surface satisfies LayaAdvisorySurface) {
    case 'job-routing':
      if (!enabled(facts, 'dependenciesReady') && decision !== 'needs-human') {
        return { accepted: false, veto: 'dependencies-not-ready' }
      }
      if (decision !== 'needs-human' && !isEligibleChoice(snapshot, decision)) {
        return { accepted: false, veto: 'target-not-currently-eligible' }
      }
      if (
        enabled(facts, 'nativeAppleRequired') &&
        decision !== 'needs-human' &&
        !enabled(facts, 'targetSupportsNativeApple')
      ) {
        return { accepted: false, veto: 'native-build-requires-eligible-apple-worker' }
      }
      break
    case 'kanban':
      if (enabled(facts, 'hardFailure') && decision !== 'blocked' && decision !== 'priority-high') {
        return { accepted: false, veto: 'hard-failure-keeps-work-escalated' }
      }
      if (decision === 'done' || enabled(facts, 'verifiedCompleted')) {
        return { accepted: false, veto: 'advisory-cannot-mark-complete' }
      }
      break
    case 'agents':
      if (
        enabled(facts, 'permissionPrompt') &&
        decision !== 'waiting-permission' &&
        decision !== 'needs-human'
      ) {
        return { accepted: false, veto: 'permission-gate-requires-human' }
      }
      if (decision === 'waiting-permission' && !enabled(facts, 'permissionPrompt')) {
        return { accepted: false, veto: 'permission-state-not-observed' }
      }
      if (enabled(facts, 'hardFailure') && decision !== 'failed') {
        return { accepted: false, veto: 'hard-failure-cannot-be-softened' }
      }
      if (
        (!enabled(facts, 'processIdentityKnown') || !enabled(facts, 'heartbeatFresh')) &&
        decision !== 'needs-human'
      ) {
        return { accepted: false, veto: 'missing-live-process-evidence' }
      }
      break
    case 'data':
      if (enabled(facts, 'dirty') || enabled(facts, 'pinned') || enabled(facts, 'activeLease')) {
        if (decision !== 'keep-local') {
          return { accepted: false, veto: 'protected-data-must-remain-local' }
        }
      }
      if (
        decision === 'archive-candidate' &&
        (!enabled(facts, 'ownerKnown') ||
          !enabled(facts, 'remoteVerified') ||
          !enabled(facts, 'inactive'))
      ) {
        return { accepted: false, veto: 'archive-evidence-incomplete' }
      }
      break
    case 'storage':
      if (
        decision !== 'needs-human' &&
        (!enabled(facts, 'monitorFresh') ||
          !enabled(facts, 'rootIdentityKnown') ||
          !enabled(facts, 'freeBytesKnown'))
      ) {
        return { accepted: false, veto: 'storage-authority-incomplete' }
      }
      if (decision !== 'needs-human' && !isEligibleChoice(snapshot, decision)) {
        return { accepted: false, veto: 'storage-target-not-preapproved' }
      }
      break
    case 'verification':
      if (enabled(facts, 'hardFailure') && decision !== 'deep-review') {
        return { accepted: false, veto: 'hard-failure-requires-deep-review' }
      }
      if (
        enabled(facts, 'evidenceIncomplete') &&
        decision !== 'needs-human' &&
        decision !== 'deep-review'
      ) {
        return { accepted: false, veto: 'incomplete-evidence-cannot-pass' }
      }
      if (
        (numericFact(facts, 'testsFailed') ?? 0) > 0 ||
        enabled(facts, 'httpFailure') ||
        (numericFact(facts, 'consoleErrors') ?? 0) > 0
      ) {
        if (decision !== 'needs-human' && decision !== 'deep-review') {
          return { accepted: false, veto: 'observed-failure-requires-deep-review' }
        }
      }
      if (decision === 'passed' || decision === 'complete') {
        return { accepted: false, veto: 'laya-cannot-approve-verification' }
      }
      break
  }

  const failedTests = numericFact(facts, 'testsFailed')
  if (
    snapshot.surface === 'agents' &&
    decision === 'working' &&
    typeof failedTests === 'number' &&
    failedTests > 0
  ) {
    return { accepted: false, veto: 'failed-tests-preclude-working-label' }
  }
  return { accepted: true, veto: null }
}
