import { randomUUID } from 'node:crypto'
import {
  getAgentResumeClaimKey,
  getAgentResumeOwnerFingerprint,
  getAgentResumeSpawnTarget,
  parseAgentResumeOwner,
  parseAgentResumeSpawnTarget,
  sameAgentResumeSpawnTarget,
  type AgentResumeSpawnTarget,
  type AgentResumeOwner
} from '../../shared/agent-resume-owner'

type ResumeClaimState = 'reserved' | 'spawning' | 'started' | 'retryable'

type ResumeClaim = {
  fingerprint: string
  target: AgentResumeSpawnTarget
  state: ResumeClaimState
  token?: string
  /** The terminal a finished claim started, when the spawn site reported it. */
  ptyId?: string
}

export type AgentResumeClaimResult =
  | { ok: true; token: string; target: AgentResumeSpawnTarget }
  | { ok: false }

export type AgentResumeClaims = ReturnType<typeof createAgentResumeClaims>

/**
 * Process-local single-consumer claims shared by the startup sweep and PTY
 * cold-restore boundary. The provider-session key is global within its
 * local/SSH authority, so copied sleeping rows cannot launch in parallel tabs.
 */
export function createAgentResumeClaims(createToken: () => string = randomUUID) {
  const claimsBySession = new Map<string, ResumeClaim>()
  const sessionByToken = new Map<string, string>()

  return {
    claim(owner: AgentResumeOwner): AgentResumeClaimResult {
      const validatedOwner = parseAgentResumeOwner(owner)
      if (!validatedOwner) {
        return { ok: false }
      }
      const key = getAgentResumeClaimKey(validatedOwner)
      const fingerprint = getAgentResumeOwnerFingerprint(validatedOwner)
      const target = getAgentResumeSpawnTarget(validatedOwner)
      const existing = claimsBySession.get(key)
      if (existing) {
        if (existing.state !== 'retryable' || existing.fingerprint !== fingerprint) {
          return { ok: false }
        }
      }
      const token = createToken()
      claimsBySession.set(key, { fingerprint, target, state: 'reserved', token })
      sessionByToken.set(token, key)
      return { ok: true, token, target }
    },

    beginSpawn(token: string, owner: AgentResumeOwner, rawTarget: AgentResumeSpawnTarget): boolean {
      const validatedOwner = parseAgentResumeOwner(owner)
      const target = parseAgentResumeSpawnTarget(rawTarget)
      if (!validatedOwner || !target) {
        return false
      }
      const key = sessionByToken.get(token)
      if (!key || key !== getAgentResumeClaimKey(validatedOwner)) {
        return false
      }
      const claim = claimsBySession.get(key)
      if (
        !claim ||
        claim.token !== token ||
        claim.fingerprint !== getAgentResumeOwnerFingerprint(validatedOwner) ||
        !sameAgentResumeSpawnTarget(claim.target, target) ||
        claim.state !== 'reserved'
      ) {
        return false
      }
      claim.state = 'spawning'
      return true
    },

    finishSpawn(token: string, spawned: boolean, ptyId?: string): boolean {
      const key = sessionByToken.get(token)
      if (!key) {
        return false
      }
      const claim = claimsBySession.get(key)
      if (!claim || claim.token !== token || claim.state !== 'spawning') {
        return false
      }
      sessionByToken.delete(token)
      delete claim.token
      claim.state = spawned ? 'started' : 'retryable'
      if (spawned && ptyId) {
        claim.ptyId = ptyId
      }
      return true
    },

    release(token: string, owner: AgentResumeOwner): boolean {
      const validatedOwner = parseAgentResumeOwner(owner)
      if (!validatedOwner) {
        return false
      }
      const key = sessionByToken.get(token)
      if (!key || key !== getAgentResumeClaimKey(validatedOwner)) {
        return false
      }
      const claim = claimsBySession.get(key)
      if (
        !claim ||
        claim.token !== token ||
        claim.fingerprint !== getAgentResumeOwnerFingerprint(validatedOwner) ||
        claim.state !== 'reserved'
      ) {
        return false
      }
      sessionByToken.delete(token)
      delete claim.token
      claim.state = 'retryable'
      return true
    },

    /**
     * A snoozed tab is coming back and the terminal that ran its conversation
     * is gone, so the finished claim no longer describes anything running and
     * the return may claim the session again. Only the owner of the terminal
     * this claim started can give it up; in-flight claims are untouched.
     */
    forgetStarted(owner: AgentResumeOwner): boolean {
      const validatedOwner = parseAgentResumeOwner(owner)
      if (!validatedOwner) {
        return false
      }
      const key = getAgentResumeClaimKey(validatedOwner)
      const claim = claimsBySession.get(key)
      if (
        claim?.state !== 'started' ||
        claim.ptyId !== validatedOwner.ptyId ||
        !sameAgentResumeSpawnTarget(claim.target, getAgentResumeSpawnTarget(validatedOwner))
      ) {
        return false
      }
      return claimsBySession.delete(key)
    },

    /**
     * The operation holding this owner's claim is gone (its window closed).
     * A claim that never reached a spawn is given back for the same owner to
     * retry. Returns true when a spawn is in flight instead: that one is left
     * alone and its own completion decides the outcome.
     */
    abandon(owner: AgentResumeOwner): boolean {
      const validatedOwner = parseAgentResumeOwner(owner)
      if (!validatedOwner) {
        return false
      }
      const claim = claimsBySession.get(getAgentResumeClaimKey(validatedOwner))
      if (!claim || claim.fingerprint !== getAgentResumeOwnerFingerprint(validatedOwner)) {
        return false
      }
      if (claim.state === 'spawning') {
        return true
      }
      if (claim.state === 'reserved') {
        if (claim.token) {
          sessionByToken.delete(claim.token)
        }
        delete claim.token
        claim.state = 'retryable'
      }
      return false
    },

    /**
     * The terminal a finished claim started was killed again before it could
     * be used (its tab binding could not be saved): the same owner may retry.
     */
    failStarted(owner: AgentResumeOwner, ptyId: string): boolean {
      const validatedOwner = parseAgentResumeOwner(owner)
      if (!validatedOwner) {
        return false
      }
      const claim = claimsBySession.get(getAgentResumeClaimKey(validatedOwner))
      if (
        claim?.state !== 'started' ||
        claim.ptyId !== ptyId ||
        claim.fingerprint !== getAgentResumeOwnerFingerprint(validatedOwner)
      ) {
        return false
      }
      delete claim.ptyId
      claim.state = 'retryable'
      return true
    },

    size(): number {
      return claimsBySession.size
    }
  }
}

/** One registry per main process, shared by local PTY IPC and runtime RPC spawns. */
export const mainProcessAgentResumeClaims = createAgentResumeClaims()
