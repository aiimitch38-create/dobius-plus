import { createHash } from 'node:crypto'
import {
  LAYA_ADVISORY_POLICY_VERSION,
  LAYA_ADVISORY_SCHEMA_VERSION,
  LayaAdvisoryResult,
  LayaProviderDecision as LayaProviderDecisionSchema,
  LayaProviderRequest as LayaProviderRequestSchema,
  type LayaAdvisoryResult as LayaAdvisoryResultType,
  type LayaAuthoritySnapshot,
  type LayaDeploymentGate,
  type LayaProviderDecision,
  type LayaProviderRequest
} from '../../shared/laya-advisory'
import { allowedLabels, validateCandidateLabel } from './laya-advisory-veto-policy'
import { opaqueSourceRevision } from './laya-authority-epoch'

export { validateCandidateLabel } from './laya-advisory-veto-policy'
export type { CandidatePolicy } from './laya-advisory-veto-policy'

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function digestAdvisoryInput(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}

export function sameAuthoritySnapshot(
  left: LayaAuthoritySnapshot,
  right: LayaAuthoritySnapshot
): boolean {
  const identity = (snapshot: LayaAuthoritySnapshot) => ({
    surface: snapshot.surface,
    subjectIds: snapshot.subjectIds,
    sourceRevision: snapshot.sourceRevision,
    evidenceRefs: snapshot.evidenceRefs,
    facts: snapshot.facts,
    eligibleChoices: snapshot.eligibleChoices
  })
  return digestAdvisoryInput(identity(left)) === digestAdvisoryInput(identity(right))
}

export function authoritySnapshotIsFresh(snapshot: LayaAuthoritySnapshot, now: number): boolean {
  return (
    snapshot.capturedAt <= now + 5_000 &&
    snapshot.expiresAt > now &&
    snapshot.expiresAt > snapshot.capturedAt
  )
}

export function isCurrentAuthorityIdentity(
  identity: { surface: LayaAuthoritySnapshot['surface']; subjectIds: string[] },
  snapshot: LayaAuthoritySnapshot,
  now: number
): boolean {
  return (
    snapshot.surface === identity.surface &&
    JSON.stringify([...snapshot.subjectIds].sort()) ===
      JSON.stringify([...identity.subjectIds].sort()) &&
    (snapshot.surface === 'job-routing' ||
      snapshot.surface === 'storage' ||
      snapshot.eligibleChoices.length === 0) &&
    new Set(snapshot.eligibleChoices).size === snapshot.eligibleChoices.length &&
    authoritySnapshotIsFresh(snapshot, now)
  )
}

export function deploymentGateFailure(
  gate: LayaDeploymentGate,
  now: number
): 'deployment-gate-expired' | 'deployment-gate-mismatch' | null {
  if (gate.expiresAt <= now || gate.issuedAt > now + 5_000) {
    return 'deployment-gate-expired'
  }
  if (gate.expiresAt <= gate.issuedAt) {
    return 'deployment-gate-mismatch'
  }
  if (
    LAYA_ADVISORY_SCHEMA_VERSION !== gate.schemaVersion ||
    LAYA_ADVISORY_POLICY_VERSION !== gate.policyVersion
  ) {
    return 'deployment-gate-mismatch'
  }
  return null
}

export function unavailableAdvisory(
  reason: Extract<LayaAdvisoryResult, { status: 'unavailable' }>['reason'],
  decisionId: string,
  requestDigest: string
): Extract<LayaAdvisoryResult, { status: 'unavailable' }> {
  return LayaAdvisoryResult.parse({
    status: 'unavailable',
    reason,
    decisionId,
    requestDigest
  }) as Extract<LayaAdvisoryResult, { status: 'unavailable' }>
}

export function makeProviderRequest(
  snapshot: LayaAuthoritySnapshot,
  gate: LayaDeploymentGate,
  revisionDigestKey: Buffer
): LayaProviderRequest {
  const core = {
    schemaVersion: LAYA_ADVISORY_SCHEMA_VERSION,
    surface: snapshot.surface,
    snapshotRevision: opaqueSourceRevision(revisionDigestKey, snapshot.sourceRevision),
    modelSourceRevision: gate.sourceRevision,
    checkpointRevision: gate.checkpointRevision,
    evaluationReportSha256: gate.evaluationReportSha256,
    policyVersion: LAYA_ADVISORY_POLICY_VERSION,
    facts: snapshot.facts,
    choices: allowedLabels(snapshot)
  }
  const requestDigest = digestAdvisoryInput({
    ...core,
    deploymentGate: gate,
    evidenceRefs: snapshot.evidenceRefs,
    subjectIds: snapshot.subjectIds
  })
  return LayaProviderRequestSchema.parse({ ...core, requestDigest })
}

export function validateProviderOutput(
  raw: unknown,
  request: LayaProviderRequest,
  gate: LayaDeploymentGate,
  now: number
): LayaProviderDecision | null {
  const parsed = LayaProviderDecisionSchema.safeParse(raw)
  if (!parsed.success) {
    return null
  }
  const output = parsed.data
  const labels = new Set(request.choices)
  const probabilities = Object.entries(output.probabilities)
  const sum = probabilities.reduce((total, [, value]) => total + value, 0)
  const top = [...probabilities].sort((left, right) => right[1] - left[1])[0]?.[0]
  if (
    output.requestDigest !== request.requestDigest ||
    output.surface !== request.surface ||
    output.snapshotRevision !== request.snapshotRevision ||
    output.sourceRevision !== gate.sourceRevision ||
    output.checkpointRevision !== gate.checkpointRevision ||
    output.evaluationReportSha256 !== gate.evaluationReportSha256 ||
    output.policyVersion !== gate.policyVersion ||
    probabilities.length !== labels.size ||
    probabilities.some(([label]) => !labels.has(label)) ||
    Math.abs(sum - 1) > 1e-6 ||
    (output.decision !== null && output.decision !== top) ||
    (output.decision !== null &&
      Math.abs(output.confidence - output.probabilities[output.decision]) > 1e-6) ||
    output.providerMeasuredAt < gate.issuedAt ||
    output.providerMeasuredAt > now + 5_000 ||
    now - output.providerMeasuredAt > 60_000
  ) {
    return null
  }
  return output
}

export function evaluateAdvisoryResult(
  snapshot: LayaAuthoritySnapshot,
  gate: LayaDeploymentGate,
  output: LayaProviderDecision,
  decisionId: string,
  elapsedMs: number
): LayaAdvisoryResultType {
  const common = {
    decisionId,
    requestDigest: output.requestDigest,
    confidence: output.confidence,
    evidenceRefs: snapshot.evidenceRefs
  }
  if (output.decision === null) {
    return {
      status: 'abstained',
      reason: 'provider-abstain',
      ...common,
      deterministicVeto: null
    }
  }
  if (output.confidence < gate.confidenceThresholds[snapshot.surface]) {
    return {
      status: 'abstained',
      reason: 'low-confidence',
      ...common,
      deterministicVeto: null
    }
  }
  const policy = validateCandidateLabel(snapshot, output.decision)
  if (!policy.accepted) {
    return {
      status: 'abstained',
      reason: 'deterministic-veto',
      ...common,
      deterministicVeto: policy.veto ?? 'deterministic-authority-abstained'
    }
  }
  return LayaAdvisoryResult.parse({
    status: 'suggestion',
    surface: snapshot.surface,
    ...common,
    decision: output.decision,
    probabilities: output.probabilities,
    snapshotRevision: output.snapshotRevision,
    sourceRevision: gate.sourceRevision,
    checkpointRevision: gate.checkpointRevision,
    evaluationReportSha256: gate.evaluationReportSha256,
    policyVersion: gate.policyVersion,
    elapsedMs,
    deterministicVeto: null
  })
}
