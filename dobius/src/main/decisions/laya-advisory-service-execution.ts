import { randomUUID } from 'node:crypto'
import {
  LayaAuthoritySnapshot as LayaAuthoritySnapshotSchema,
  LayaDeploymentGate as LayaDeploymentGateSchema,
  type LayaAdvisoryIdentity,
  type LayaProviderDecision,
  type LayaAdvisoryResult,
  type LayaAuthoritySnapshot,
  type LayaDeploymentGate,
  type LayaProviderRequest
} from '../../shared/laya-advisory'
import type { LayaAdvisoryJournal } from './laya-advisory-journal'
import type { LayaAdvisoryRequestBudget } from './laya-advisory-request-budget'
import {
  authorityEpochMatches,
  type LayaAuthorityEpochReader,
  type LayaAuthorityEpochTicket
} from './laya-authority-epoch'
import {
  authoritySnapshotIsFresh,
  deploymentGateFailure,
  digestAdvisoryInput,
  evaluateAdvisoryResult,
  sameAuthoritySnapshot,
  unavailableAdvisory,
  validateProviderOutput
} from './laya-advisory-policy'
export type LayaAdvisoryExecutionDependencies = {
  authority: {
    read(
      identity: { surface: LayaAuthoritySnapshot['surface']; subjectIds: string[] },
      signal: AbortSignal
    ): Promise<unknown>
  }
  deploymentGate: { current(signal: AbortSignal): Promise<unknown> }
  authorityEpoch: LayaAuthorityEpochReader | undefined
  epochTicket: LayaAuthorityEpochTicket
  provider: { decide(request: LayaProviderRequest, signal: AbortSignal): Promise<unknown> }
  journal: LayaAdvisoryJournal
  now: () => number
  cacheSuggestion: (result: Extract<LayaAdvisoryResult, { status: 'suggestion' }>) => void
}
export type LayaAuthorityReader = {
  read(identity: LayaAdvisoryIdentity, signal: AbortSignal): Promise<unknown>
}
export type LayaDeploymentGateReader = { current(signal: AbortSignal): Promise<unknown> }
export type LayaDecisionProvider = {
  availability(
    surface: LayaAdvisoryIdentity['surface'],
    signal: AbortSignal
  ): Promise<'available' | 'unsupported' | 'unavailable'>
  decide(request: LayaProviderRequest, signal: AbortSignal): Promise<unknown>
}
export const unavailableLayaDecisionProvider: LayaDecisionProvider = {
  availability: async () => 'unavailable',
  decide: async () => {
    throw new Error('No Laya inference provider is deployed.')
  }
}
export function recordAuthorityUnavailableAdvisory(
  journal: LayaAdvisoryJournal,
  identity: LayaAdvisoryIdentity,
  reason: Extract<LayaAdvisoryResult, { status: 'unavailable' }>['reason'],
  now: number
): LayaAdvisoryResult {
  const result = unavailableAdvisory(reason, randomUUID(), digestAdvisoryInput(identity))
  try {
    journal.appendAuthorityUnavailable(identity.surface, result, now)
    return result
  } catch {
    return unavailableAdvisory('journal-unavailable', result.decisionId, result.requestDigest)
  }
}

export function recordUnavailableAdvisory(
  journal: LayaAdvisoryJournal,
  snapshot: LayaAuthoritySnapshot,
  reason: Extract<LayaAdvisoryResult, { status: 'unavailable' }>['reason'],
  now: number,
  requestDigest = digestAdvisoryInput({ snapshot }),
  decisionId: string = randomUUID(),
  gate?: LayaDeploymentGate
): LayaAdvisoryResult {
  const result = unavailableAdvisory(reason, decisionId, requestDigest)
  try {
    journal.appendAdvisoryResult(
      snapshot,
      result,
      {
        elapsedMs: null,
        sourceRevision: gate?.sourceRevision,
        checkpointRevision: gate?.checkpointRevision,
        evaluationReportSha256: gate?.evaluationReportSha256
      },
      now
    )
    return result
  } catch {
    return unavailableAdvisory('journal-unavailable', decisionId, requestDigest)
  }
}

export async function revalidateAdvisoryInputs(
  dependencies: Pick<LayaAdvisoryExecutionDependencies, 'authority' | 'deploymentGate'>,
  identity: LayaAdvisoryIdentity,
  snapshot: LayaAuthoritySnapshot,
  gate: LayaDeploymentGate,
  budget: LayaAdvisoryRequestBudget,
  now: () => number,
  authorityEpoch: LayaAuthorityEpochReader | undefined,
  epochTicket: LayaAuthorityEpochTicket
): Promise<
  | 'deadline'
  | 'authority-unavailable'
  | 'stale-source'
  | 'deployment-gate-missing'
  | 'deployment-gate-expired'
  | 'deployment-gate-mismatch'
  | 'authority-epoch-changed'
  | null
> {
  let latest: LayaAuthoritySnapshot
  try {
    latest = LayaAuthoritySnapshotSchema.parse(
      await budget.run((signal) => dependencies.authority.read(identity, signal))
    )
  } catch {
    return budget.expired ? 'deadline' : 'authority-unavailable'
  }
  if (!authoritySnapshotIsFresh(latest, now()) || !sameAuthoritySnapshot(snapshot, latest)) {
    return 'stale-source'
  }

  let currentGate: LayaDeploymentGate
  try {
    currentGate = LayaDeploymentGateSchema.parse(
      await budget.run((signal) => dependencies.deploymentGate.current(signal))
    )
  } catch {
    return budget.expired ? 'deadline' : 'deployment-gate-missing'
  }
  const failure = deploymentGateFailure(currentGate, now())
  if (failure) {
    return failure
  }
  if (digestAdvisoryInput(currentGate) !== digestAdvisoryInput(gate)) {
    return 'deployment-gate-mismatch'
  }
  return authorityEpochMatches(authorityEpoch, epochTicket) ? null : 'authority-epoch-changed'
}

export async function executeLayaAdvisory(
  dependencies: LayaAdvisoryExecutionDependencies,
  snapshot: LayaAuthoritySnapshot,
  gate: LayaDeploymentGate,
  request: LayaProviderRequest,
  decisionId: string,
  budget: LayaAdvisoryRequestBudget,
  startedAt: number
): Promise<LayaAdvisoryResult> {
  try {
    if (!authorityEpochMatches(dependencies.authorityEpoch, dependencies.epochTicket)) {
      return unavailable(
        dependencies,
        snapshot,
        'authority-epoch-changed',
        request.requestDigest,
        decisionId,
        gate
      )
    }
    const raw = await budget.run((signal) => dependencies.provider.decide(request, signal))
    const output = validateProviderOutput(raw, request, gate, dependencies.now())
    if (!output) {
      return unavailable(
        dependencies,
        snapshot,
        'invalid-response',
        request.requestDigest,
        decisionId,
        gate
      )
    }
    const currentGate = LayaDeploymentGateSchema.safeParse(
      await budget.run((signal) => dependencies.deploymentGate.current(signal))
    )
    if (!currentGate.success) {
      return unavailable(
        dependencies,
        snapshot,
        budget.expired ? 'deadline' : 'deployment-gate-missing',
        request.requestDigest,
        decisionId,
        gate
      )
    }
    const gateExpired = deploymentGateFailure(currentGate.data, dependencies.now())
    if (gateExpired || digestAdvisoryInput(currentGate.data) !== digestAdvisoryInput(gate)) {
      return unavailable(
        dependencies,
        snapshot,
        gateExpired ?? 'deployment-gate-mismatch',
        request.requestDigest,
        decisionId,
        currentGate.data
      )
    }
    const latest = LayaAuthoritySnapshotSchema.safeParse(
      await budget.run((signal) =>
        dependencies.authority.read(
          { surface: snapshot.surface, subjectIds: snapshot.subjectIds },
          signal
        )
      )
    )
    if (
      !latest.success ||
      !authoritySnapshotIsFresh(latest.data, dependencies.now()) ||
      !sameAuthoritySnapshot(snapshot, latest.data)
    ) {
      return unavailable(
        dependencies,
        snapshot,
        budget.expired ? 'deadline' : 'stale-source',
        request.requestDigest,
        decisionId,
        gate
      )
    }
    const elapsedMs = Math.max(dependencies.now() - startedAt, output.elapsedMs)
    const result = evaluateAdvisoryResult(snapshot, gate, output, decisionId, elapsedMs)
    // No await may separate this shared-ticket check from the synchronous commit.
    if (!authorityEpochMatches(dependencies.authorityEpoch, dependencies.epochTicket)) {
      return unavailable(
        dependencies,
        snapshot,
        'authority-epoch-changed',
        request.requestDigest,
        decisionId,
        gate
      )
    }
    if (!persist(dependencies, snapshot, result, output, elapsedMs)) {
      return unavailableAdvisory('journal-unavailable', decisionId, output.requestDigest)
    }
    if (result.status === 'suggestion') {
      dependencies.cacheSuggestion(result)
    }
    return result
  } catch {
    return unavailable(
      dependencies,
      snapshot,
      budget.expired ? 'deadline' : 'provider-error',
      request.requestDigest,
      decisionId,
      gate
    )
  }
}

function unavailable(
  dependencies: LayaAdvisoryExecutionDependencies,
  snapshot: LayaAuthoritySnapshot,
  reason: Extract<LayaAdvisoryResult, { status: 'unavailable' }>['reason'],
  requestDigest: string,
  decisionId: string,
  gate: LayaDeploymentGate
): LayaAdvisoryResult {
  const result = unavailableAdvisory(reason, decisionId, requestDigest)
  return persist(dependencies, snapshot, result, null, null, gate)
    ? result
    : unavailableAdvisory('journal-unavailable', decisionId, requestDigest)
}

function persist(
  dependencies: LayaAdvisoryExecutionDependencies,
  snapshot: LayaAuthoritySnapshot,
  result: LayaAdvisoryResult,
  output: LayaProviderDecision | null,
  elapsedMs: number | null,
  gate?: LayaDeploymentGate
): boolean {
  try {
    dependencies.journal.appendAdvisoryResult(
      snapshot,
      result,
      {
        elapsedMs,
        sourceRevision: output?.sourceRevision ?? gate?.sourceRevision,
        checkpointRevision: output?.checkpointRevision ?? gate?.checkpointRevision,
        evaluationReportSha256: output?.evaluationReportSha256 ?? gate?.evaluationReportSha256
      },
      dependencies.now()
    )
    return true
  } catch {
    return false
  }
}
