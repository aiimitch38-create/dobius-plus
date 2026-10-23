import {
  LayaProviderRequest as RequestSchema,
  type LayaDeploymentGate,
  type LayaProviderRequest
} from '../../shared/laya-advisory'

export const sourceRevision = '3cf26cbcb18725dbc2d127bb8bb2c4c43243ae63'
export const checkpointRevision = '7b928d828b7b0e022f929d9bd2e44165aa270148'
export const evaluationDigest = '3'.repeat(64)

export function gate(overrides: Partial<LayaDeploymentGate> = {}): LayaDeploymentGate {
  const surfaces = ['job-routing', 'kanban', 'agents', 'data', 'storage', 'verification'] as const
  return {
    status: 'accepted',
    deploymentId: 'deployment-test',
    issuedAt: 1_000,
    expiresAt: 20_000,
    sourceRevision,
    checkpointRevision,
    evaluationReportSha256: evaluationDigest,
    schemaVersion: 1,
    policyVersion: '1',
    heldoutKind: 'independent-human-labeled',
    samplesPerSurface: Object.fromEntries(surfaces.map((surface) => [surface, 20])) as Record<
      (typeof surfaces)[number],
      number
    >,
    confidenceThresholds: Object.fromEntries(surfaces.map((surface) => [surface, 0.8])) as Record<
      (typeof surfaces)[number],
      number
    >,
    thresholdsPassed: true,
    policyViolationCount: 0,
    calibrationReviewed: true,
    fallbackTested: true,
    providerAuthenticated: true,
    twoClientReadback: true,
    privacyReviewed: true,
    ...overrides
  }
}

export function request(overrides: Record<string, unknown> = {}): LayaProviderRequest {
  return RequestSchema.parse({
    schemaVersion: 1,
    surface: 'job-routing',
    requestDigest: '4'.repeat(64),
    snapshotRevision: '5'.repeat(64),
    modelSourceRevision: sourceRevision,
    checkpointRevision,
    evaluationReportSha256: evaluationDigest,
    policyVersion: '1',
    facts: { nativeAppleRequired: false, targetSupportsNativeApple: true, dependenciesReady: true },
    choices: ['opaque-target', 'needs-human'],
    ...overrides
  })
}

export function deploymentReceipt(overrides: Record<string, unknown> = {}) {
  return {
    endpoint: 'http://127.0.0.1:8000/',
    model: 'multilingual',
    gate: gate(),
    ...overrides
  }
}

export function health(overrides: Record<string, unknown> = {}) {
  return {
    status: 'ok',
    loaded: ['multilingual'],
    revisions: { multilingual: checkpointRevision },
    device: 'cpu',
    ...overrides
  }
}

export function systemOneResponse(
  choices: string[] = ['opaque-target', 'needs-human'],
  overrides: Record<string, unknown> = {}
) {
  const selected = choices[0]!
  const remaining = 1 - 0.9
  return {
    model: 'multilingual',
    answers: {
      dobius_decision: {
        type: 'choice',
        choice: selected,
        confidence: 0.9,
        probabilities: Object.fromEntries(
          choices.map((choice) => [
            choice,
            choice === selected ? 0.9 : remaining / (choices.length - 1)
          ])
        ),
        action: selected,
        answer_confidence: 0.9
      }
    },
    usage: { input_tokens: 12, output_tokens: 1 },
    routing: { selected: 'multilingual' },
    ...overrides
  }
}

export function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init
  })
}
