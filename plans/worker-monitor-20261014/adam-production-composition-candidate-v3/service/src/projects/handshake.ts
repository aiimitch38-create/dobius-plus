import { createHash } from 'node:crypto'
import { z } from 'zod'
import { toolPolicyForLevel, type ToolPolicyTier } from '../workers/tool-policy.js'
import type { ProjectManifest, ProjectRegistry } from './registry.js'

export type ContextPackAuthority = {
  allowed: string[]
  prohibited: string[]
  approvalRequired: string[]
}

export type ContextPack = {
  projectId: string
  projectName: string
  owner: string
  classification: ProjectManifest['classification']
  status: ProjectManifest['status']
  riskTier: ProjectManifest['riskTier']
  dataSensitivity: ProjectManifest['dataSensitivity']
  purpose: string
  executionMode: ProjectManifest['execution']['mode']
  canonicalPath: string
  matchedLocation: { path: string; role: ProjectManifest['locations'][number]['role'] }
  worktreePath: string
  toolPolicyTier: ToolPolicyTier
  authority: ContextPackAuthority
  notes: string[]
  registryReconciledAt: string
  digest: string
}

export type ContextHandshakeCode =
  | 'unknown_project'
  | 'project_not_managed'
  | 'location_unverified'
  | 'readiness_too_low'

export class ContextHandshakeError extends Error {
  readonly code: ContextHandshakeCode
  // Safe to return to the caller over HTTP: no filesystem contents, no secrets.
  readonly reason: string
  constructor(code: ContextHandshakeCode, reason: string) {
    super(reason)
    this.name = 'ContextHandshakeError'
    this.code = code
    this.reason = reason
  }
}

// A registry path that is a placeholder, not a filesystem location. These can
// never match an observed worktree path.
function isSyntheticPath(path: string): boolean {
  return path.startsWith('registry-evidence:') || path.startsWith('registry-only:')
}

// Trim + strip trailing slashes. Comparison is case-insensitive because macOS
// APFS is (registry.ts normalizes the same way).
function normalizePath(path: string): string {
  return path.trim().replace(/\/+$/, '')
}

type LocationMatch = {
  project: ProjectManifest
  location: ProjectManifest['locations'][number]
  normalizedPath: string
}

function matchWorktree(registry: ProjectRegistry, worktreePath: string): LocationMatch | undefined {
  const observed = normalizePath(worktreePath)
  const observedLower = observed.toLocaleLowerCase()
  let best: LocationMatch | undefined
  let bestLength = -1
  for (const project of registry.projects) {
    for (const location of project.locations) {
      if (location.role === 'missing') continue
      if (isSyntheticPath(location.path)) continue
      const candidate = normalizePath(location.path)
      const candidateLower = candidate.toLocaleLowerCase()
      const exact = candidateLower === observedLower
      const nested = observedLower.startsWith(`${candidateLower}/`)
      if (!exact && !nested) continue
      if (candidateLower.length > bestLength) {
        bestLength = candidateLower.length
        best = { project, location, normalizedPath: observed }
      }
    }
  }
  return best
}

function canonicalPathFor(project: ProjectManifest, fallback: string): string {
  const canonical = project.locations.find((location) => location.role === 'canonical' && !isSyntheticPath(location.path))
  return canonical ? normalizePath(canonical.path) : fallback
}

function deriveAuthority(project: ProjectManifest, matchedPath: string, tier: ToolPolicyTier): ContextPackAuthority {
  const prohibited = ['git push', 'merge', 'deploy', 'release or publish', 'spend money', 'contact external people']
  const restrictedToPath =
    project.riskTier === 'critical' || project.riskTier === 'high' || project.dataSensitivity === 'restricted'
  if (restrictedToPath) prohibited.push(`edit files outside ${matchedPath}`)
  const approvalRequired = tier === 'approval_gated'
    ? ['git push', 'merge', 'deploy', 'release or publish', 'spend money', 'message a person']
    : []
  return {
    allowed: ['read repository files', `edit files within ${matchedPath}`, 'run local tests and builds'],
    prohibited,
    approvalRequired
  }
}

export function resolveContextPack(input: {
  registry: ProjectRegistry
  worktreePath: string
  intent: 'dispatch' | 'launch'
  readinessLevel?: number
}): ContextPack {
  const match = matchWorktree(input.registry, input.worktreePath)
  if (!match) {
    throw new ContextHandshakeError('unknown_project', `no registered project owns the observed worktree path`)
  }
  const { project, location, normalizedPath } = match
  if (project.execution.mode !== 'managed') {
    throw new ContextHandshakeError(
      'project_not_managed',
      `project ${project.id} is ${project.execution.mode}, not managed; ${input.intent} refused`
    )
  }
  if (!location.verified) {
    throw new ContextHandshakeError('location_unverified', `matched location for project ${project.id} is unverified`)
  }
  let tier: ToolPolicyTier
  if (input.readinessLevel === undefined) {
    tier = 'restricted'
  } else {
    try {
      tier = toolPolicyForLevel(input.readinessLevel).tier
    } catch (error) {
      throw new ContextHandshakeError('readiness_too_low', error instanceof Error ? error.message : String(error))
    }
  }
  const matchedPath = normalizePath(location.path)
  const authority = deriveAuthority(project, matchedPath, tier)
  // Build the digest input literally so key order is stable and the digest is
  // deterministic across processes.
  const digestBody = {
    projectId: project.id,
    projectName: project.name,
    owner: project.owner,
    classification: project.classification,
    status: project.status,
    riskTier: project.riskTier,
    dataSensitivity: project.dataSensitivity,
    purpose: project.purpose,
    executionMode: project.execution.mode,
    canonicalPath: canonicalPathFor(project, matchedPath),
    matchedLocation: { path: matchedPath, role: location.role },
    worktreePath: normalizedPath,
    toolPolicyTier: tier,
    authority: {
      allowed: authority.allowed,
      prohibited: authority.prohibited,
      approvalRequired: authority.approvalRequired
    },
    notes: project.notes,
    registryReconciledAt: input.registry.authority.reconciledAt
  }
  const digest = createHash('sha256').update(JSON.stringify(digestBody)).digest('hex')
  return { ...digestBody, digest }
}

// Body of POST /v1/context-handshake: the read-only "may a build be dispatched
// here?" probe. Same inputs resolveContextPack takes; the registry is ADAM's own.
export const ContextHandshakeRequestSchema = z.object({
  worktreePath: z.string().min(1),
  intent: z.enum(['dispatch', 'launch']),
  readinessLevel: z.number().int().optional()
})

export type ContextHandshakeCheck =
  | { ok: true; pack: ContextPack }
  | { ok: false; code?: ContextHandshakeCode; reason: string }

// Pure admission check shared by the write routes and the read-only probe.
// Fail closed: ANY resolver throw is a refusal, never a pass-through. The
// reason is safe to return over HTTP.
export function checkContextHandshake(input: {
  registry: ProjectRegistry
  worktreePath: string
  intent: 'dispatch' | 'launch'
  readinessLevel?: number
}): ContextHandshakeCheck {
  try {
    return { ok: true, pack: resolveContextPack(input) }
  } catch (error) {
    if (error instanceof ContextHandshakeError) return { ok: false, code: error.code, reason: error.reason }
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

// Plain-text block appended to an agent's prompt so it is not blind to where it
// is or what it may do. Under ~25 lines, no markdown tables.
export function renderContextPack(pack: ContextPack): string {
  const lines = [
    'PROJECT CONTEXT PACK (resolved from the observed worktree; authoritative):',
    `Project: ${pack.projectName} (${pack.projectId})`,
    `Purpose: ${pack.purpose}`,
    `Risk tier: ${pack.riskTier} · Data sensitivity: ${pack.dataSensitivity} · Execution: ${pack.executionMode}`,
    `Owner: ${pack.owner}`,
    `You own this worktree only: ${pack.worktreePath}`,
    `Tool policy tier: ${pack.toolPolicyTier}`,
    `You MAY: ${pack.authority.allowed.join('; ')}`,
    `You MAY NOT: ${pack.authority.prohibited.join('; ')}`
  ]
  if (pack.authority.approvalRequired.length > 0) {
    lines.push(`Requires an approved digest first: ${pack.authority.approvalRequired.join('; ')}`)
  }
  lines.push(`Context pack digest: ${pack.digest}`)
  return lines.join('\n')
}
