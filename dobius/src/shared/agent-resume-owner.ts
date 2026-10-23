import { z } from 'zod'
import type { AgentProviderSessionMetadata, ResumableTuiAgent } from './agent-session-resume'
import { parsePaneKey } from './stable-pane-id'

export type AgentResumeAuthority = { kind: 'local' } | { kind: 'ssh'; connectionId: string }

export type AgentResumeOwner = {
  authority: AgentResumeAuthority
  worktreeId: string
  tabId: string
  leafId: string
  paneKey: string
  ptyId: string
  launchToken: string
  terminalHandle?: string
  agent: ResumableTuiAgent
  providerSession: AgentProviderSessionMetadata
}

/** Main-approved relocation is limited to a fresh pane in the source worktree and authority. */
export type AgentResumeSpawnTarget = {
  worktreeId: string
  authority: AgentResumeAuthority
  paneRelocation: 'new-pane-in-same-worktree'
}

export const AGENT_RESUME_CLAIM_ENV = 'DOBIUS_INTERNAL_AGENT_RESUME_CLAIM'

export type AgentResumeSpawnClaim = {
  token: string
  owner: AgentResumeOwner
  target: AgentResumeSpawnTarget
}

export function encodeAgentResumeSpawnClaim(claim: AgentResumeSpawnClaim): string {
  return JSON.stringify(claim)
}

export function parseAgentResumeSpawnClaim(value: unknown): AgentResumeSpawnClaim | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 8192) {
    return null
  }
  try {
    const raw = JSON.parse(value) as Record<string, unknown>
    if (typeof raw.token !== 'string' || raw.token.length === 0 || raw.token.length > 256) {
      return null
    }
    const owner = parseAgentResumeOwner(raw.owner)
    const target = parseAgentResumeSpawnTarget(raw.target)
    return owner && target ? { token: raw.token, owner, target } : null
  } catch {
    return null
  }
}

export function stripAgentResumeSpawnClaimEnv(
  env: Record<string, string> | undefined
): Record<string, string> | undefined {
  if (!env || !(AGENT_RESUME_CLAIM_ENV in env)) {
    return env
  }
  const stripped = { ...env }
  delete stripped[AGENT_RESUME_CLAIM_ENV]
  return stripped
}

function safeIdentityString(maxLength: number) {
  return z
    .string()
    .min(1)
    .max(maxLength)
    .refine((value) => {
      for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index)
        if (code <= 0x1f || code === 0x7f) {
          return false
        }
      }
      return true
    }, 'identity fields must not contain control characters')
}

const agentResumeAuthoritySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local') }).strict(),
  z.object({ kind: z.literal('ssh'), connectionId: safeIdentityString(256) }).strict()
])

const agentResumeSpawnTargetSchema = z
  .object({
    worktreeId: safeIdentityString(512),
    authority: agentResumeAuthoritySchema,
    paneRelocation: z.literal('new-pane-in-same-worktree')
  })
  .strict()

export const agentResumeOwnerSchema = z
  .object({
    authority: agentResumeAuthoritySchema,
    worktreeId: safeIdentityString(512),
    tabId: safeIdentityString(256),
    leafId: z.string().uuid(),
    paneKey: safeIdentityString(512),
    ptyId: safeIdentityString(512),
    launchToken: safeIdentityString(256),
    terminalHandle: safeIdentityString(256).optional(),
    agent: z.enum([
      'claude',
      'codex',
      'gemini',
      'antigravity',
      'opencode',
      'mimo-code',
      'droid',
      'grok',
      'devin'
    ]),
    providerSession: z
      .object({
        key: z.enum(['session_id', 'conversation_id']),
        id: safeIdentityString(512),
        transcriptPath: z.string().optional()
      })
      .strict()
  })
  .strict()
  .superRefine((owner, context) => {
    const parsed = parsePaneKey(owner.paneKey)
    if (!parsed || parsed.tabId !== owner.tabId || parsed.leafId !== owner.leafId) {
      context.addIssue({ code: 'custom', message: 'paneKey must match tabId and leafId' })
    }
  })

export function parseAgentResumeOwner(value: unknown): AgentResumeOwner | null {
  const parsed = agentResumeOwnerSchema.safeParse(value)
  return parsed.success ? (parsed.data as AgentResumeOwner) : null
}

export function parseAgentResumeSpawnTarget(value: unknown): AgentResumeSpawnTarget | null {
  const parsed = agentResumeSpawnTargetSchema.safeParse(value)
  return parsed.success ? (parsed.data as AgentResumeSpawnTarget) : null
}

export function getAgentResumeSpawnTarget(owner: AgentResumeOwner): AgentResumeSpawnTarget {
  return {
    worktreeId: owner.worktreeId,
    authority: owner.authority,
    paneRelocation: 'new-pane-in-same-worktree'
  }
}

export function sameAgentResumeSpawnTarget(
  left: AgentResumeSpawnTarget,
  right: AgentResumeSpawnTarget
): boolean {
  return (
    left.worktreeId === right.worktreeId &&
    left.paneRelocation === right.paneRelocation &&
    left.authority.kind === right.authority.kind &&
    (left.authority.kind !== 'ssh' ||
      (right.authority.kind === 'ssh' &&
        left.authority.connectionId === right.authority.connectionId))
  )
}

/** One provider session is claimable only once per trusted execution authority. */
export function getAgentResumeClaimKey(owner: AgentResumeOwner): string {
  const authority =
    owner.authority.kind === 'local' ? 'local' : `ssh:${owner.authority.connectionId}`
  return [authority, owner.agent, owner.providerSession.key, owner.providerSession.id].join('\0')
}

/** The retry owner includes the concrete source pane and the PTY/launch generation. */
export function getAgentResumeOwnerFingerprint(owner: AgentResumeOwner): string {
  return [
    getAgentResumeClaimKey(owner),
    owner.worktreeId,
    owner.paneKey,
    owner.ptyId,
    owner.launchToken,
    owner.terminalHandle ?? ''
  ].join('\0')
}
