import { z } from 'zod'

const Digest = z.string().regex(/^[a-f0-9]{64}$/)
const Revision = z.string().regex(/^[a-f0-9]{40}$/)
const Id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
const Token = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/)
const Probability = z.number().finite().min(0).max(1)
const ProbabilityMap = z
  .record(Token, Probability)
  .refine(
    (values) => Object.keys(values).length >= 1 && Object.keys(values).length <= 32,
    'probability map must contain 1 to 32 choices'
  )

export const LAYA_ADVISORY_SCHEMA_VERSION = 1 as const
export const LAYA_ADVISORY_POLICY_VERSION = '1' as const
export const LayaAdvisorySurface = z.enum([
  'job-routing',
  'kanban',
  'agents',
  'data',
  'storage',
  'verification'
])
export type LayaAdvisorySurface = z.infer<typeof LayaAdvisorySurface>

const DecisionLabels = {
  'job-routing': ['needs-human'],
  kanban: ['priority-low', 'priority-normal', 'priority-high', 'blocked', 'needs-human'],
  agents: ['working', 'stuck', 'waiting-permission', 'failed', 'needs-human'],
  data: ['keep-local', 'archive-candidate', 'needs-human'],
  storage: ['needs-human'],
  verification: ['routine-review', 'deep-review', 'needs-human']
} as const

const SnapshotBase = z.object({
  schemaVersion: z.literal(LAYA_ADVISORY_SCHEMA_VERSION),
  subjectIds: z.array(Id).min(1).max(32),
  sourceRevision: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
  capturedAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
  evidenceRefs: z.array(Digest).max(64)
})
const EligibleChoices = z.array(Token).max(32)
const JobRoutingFacts = z
  .object({
    nativeAppleRequired: z.boolean(),
    targetSupportsNativeApple: z.boolean(),
    dependenciesReady: z.boolean()
  })
  .strict()
const KanbanFacts = z.object({ hardFailure: z.boolean(), verifiedCompleted: z.boolean() }).strict()
const AgentFacts = z
  .object({
    permissionPrompt: z.boolean(),
    hardFailure: z.boolean(),
    processIdentityKnown: z.boolean(),
    heartbeatFresh: z.boolean(),
    testsFailed: z.number().int().nonnegative().nullable()
  })
  .strict()
const DataFacts = z
  .object({
    dirty: z.boolean(),
    pinned: z.boolean(),
    activeLease: z.boolean(),
    ownerKnown: z.boolean(),
    remoteVerified: z.boolean(),
    inactive: z.boolean()
  })
  .strict()
const StorageFacts = z
  .object({
    monitorFresh: z.boolean(),
    rootIdentityKnown: z.boolean(),
    freeBytesKnown: z.boolean()
  })
  .strict()
const VerificationFacts = z
  .object({
    hardFailure: z.boolean(),
    evidenceIncomplete: z.boolean(),
    testsFailed: z.number().int().nonnegative().nullable(),
    httpFailure: z.boolean(),
    consoleErrors: z.number().int().nonnegative().nullable()
  })
  .strict()

/** Surface-specific strict facts prevent arbitrary text and incomplete policy evidence. */
export const LayaAuthoritySnapshot = z.discriminatedUnion('surface', [
  SnapshotBase.extend({
    surface: z.literal('job-routing'),
    facts: JobRoutingFacts,
    eligibleChoices: EligibleChoices
  }).strict(),
  SnapshotBase.extend({
    surface: z.literal('kanban'),
    facts: KanbanFacts,
    eligibleChoices: z.tuple([])
  }).strict(),
  SnapshotBase.extend({
    surface: z.literal('agents'),
    facts: AgentFacts,
    eligibleChoices: z.tuple([])
  }).strict(),
  SnapshotBase.extend({
    surface: z.literal('data'),
    facts: DataFacts,
    eligibleChoices: z.tuple([])
  }).strict(),
  SnapshotBase.extend({
    surface: z.literal('storage'),
    facts: StorageFacts,
    eligibleChoices: EligibleChoices
  }).strict(),
  SnapshotBase.extend({
    surface: z.literal('verification'),
    facts: VerificationFacts,
    eligibleChoices: z.tuple([])
  }).strict()
])
export type LayaAuthoritySnapshot = z.infer<typeof LayaAuthoritySnapshot>

export const LayaAdvisoryIdentity = z
  .object({
    surface: LayaAdvisorySurface,
    subjectIds: z.array(Id).min(1).max(32)
  })
  .strict()
export type LayaAdvisoryIdentity = z.infer<typeof LayaAdvisoryIdentity>

const ProviderRequestBase = z.object({
  schemaVersion: z.literal(LAYA_ADVISORY_SCHEMA_VERSION),
  requestDigest: Digest,
  snapshotRevision: Digest,
  modelSourceRevision: Revision,
  checkpointRevision: Revision,
  evaluationReportSha256: Digest,
  policyVersion: z.literal(LAYA_ADVISORY_POLICY_VERSION)
})
export const LayaProviderRequest = z.discriminatedUnion('surface', [
  ProviderRequestBase.extend({
    surface: z.literal('job-routing'),
    facts: JobRoutingFacts,
    choices: EligibleChoices
  }).strict(),
  ProviderRequestBase.extend({
    surface: z.literal('kanban'),
    facts: KanbanFacts,
    choices: z.array(Token).max(32)
  }).strict(),
  ProviderRequestBase.extend({
    surface: z.literal('agents'),
    facts: AgentFacts,
    choices: z.array(Token).max(32)
  }).strict(),
  ProviderRequestBase.extend({
    surface: z.literal('data'),
    facts: DataFacts,
    choices: z.array(Token).max(32)
  }).strict(),
  ProviderRequestBase.extend({
    surface: z.literal('storage'),
    facts: StorageFacts,
    choices: EligibleChoices
  }).strict(),
  ProviderRequestBase.extend({
    surface: z.literal('verification'),
    facts: VerificationFacts,
    choices: z.array(Token).max(32)
  }).strict()
])
export type LayaProviderRequest = z.infer<typeof LayaProviderRequest>

export const LayaDeploymentGate = z
  .object({
    status: z.literal('accepted'),
    deploymentId: Id,
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    sourceRevision: Revision,
    checkpointRevision: Revision,
    evaluationReportSha256: Digest,
    schemaVersion: z.literal(LAYA_ADVISORY_SCHEMA_VERSION),
    policyVersion: z.literal(LAYA_ADVISORY_POLICY_VERSION),
    heldoutKind: z.literal('independent-human-labeled'),
    samplesPerSurface: z.record(LayaAdvisorySurface, z.number().int().positive()),
    confidenceThresholds: z.record(LayaAdvisorySurface, z.number().finite().min(0.5).max(1)),
    thresholdsPassed: z.literal(true),
    policyViolationCount: z.literal(0),
    calibrationReviewed: z.literal(true),
    fallbackTested: z.literal(true),
    providerAuthenticated: z.literal(true),
    twoClientReadback: z.literal(true),
    privacyReviewed: z.literal(true)
  })
  .strict()
export type LayaDeploymentGate = z.infer<typeof LayaDeploymentGate>

const ProviderDecisionBase = z.object({
  schemaVersion: z.literal(LAYA_ADVISORY_SCHEMA_VERSION),
  requestDigest: Digest,
  snapshotRevision: Digest,
  sourceRevision: Revision,
  checkpointRevision: Revision,
  evaluationReportSha256: Digest,
  policyVersion: z.literal(LAYA_ADVISORY_POLICY_VERSION),
  decision: Token.nullable(),
  confidence: Probability,
  probabilities: ProbabilityMap,
  elapsedMs: z.number().finite().nonnegative().max(120_000),
  providerMeasuredAt: z.number().int().nonnegative()
})
export const LayaProviderDecision = z.discriminatedUnion('surface', [
  ProviderDecisionBase.extend({ surface: z.literal('job-routing') }).strict(),
  ProviderDecisionBase.extend({ surface: z.literal('kanban') }).strict(),
  ProviderDecisionBase.extend({ surface: z.literal('agents') }).strict(),
  ProviderDecisionBase.extend({ surface: z.literal('data') }).strict(),
  ProviderDecisionBase.extend({ surface: z.literal('storage') }).strict(),
  ProviderDecisionBase.extend({ surface: z.literal('verification') }).strict()
])
export type LayaProviderDecision = z.infer<typeof LayaProviderDecision>

export const LayaAdvisoryResult = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('unavailable'),
      reason: z.enum([
        'provider-not-deployed',
        'provider-unsupported-surface',
        'deployment-gate-missing',
        'deployment-gate-expired',
        'deployment-gate-mismatch',
        'authority-unavailable',
        'authority-epoch-unavailable',
        'authority-epoch-changed',
        'stale-source',
        'deadline',
        'quota',
        'backpressure',
        'provider-error',
        'invalid-response',
        'journal-unavailable'
      ]),
      decisionId: Id,
      requestDigest: Digest
    })
    .strict(),
  z
    .object({
      status: z.literal('abstained'),
      reason: z.enum(['provider-abstain', 'low-confidence', 'deterministic-veto']),
      decisionId: Id,
      requestDigest: Digest,
      confidence: Probability,
      deterministicVeto: z.string().max(160).nullable(),
      evidenceRefs: z.array(Digest).max(64)
    })
    .strict(),
  z
    .object({
      status: z.literal('suggestion'),
      surface: LayaAdvisorySurface,
      decisionId: Id,
      requestDigest: Digest,
      decision: Token,
      confidence: Probability,
      probabilities: ProbabilityMap,
      snapshotRevision: Digest,
      sourceRevision: Revision,
      checkpointRevision: Revision,
      evaluationReportSha256: Digest,
      policyVersion: z.literal(LAYA_ADVISORY_POLICY_VERSION),
      evidenceRefs: z.array(Digest).max(64),
      elapsedMs: z.number().finite().nonnegative().max(120_000),
      deterministicVeto: z.null()
    })
    .strict()
])
export type LayaAdvisoryResult = z.infer<typeof LayaAdvisoryResult>

export function labelsForSurface(surface: LayaAdvisorySurface): readonly string[] {
  return DecisionLabels[surface]
}
