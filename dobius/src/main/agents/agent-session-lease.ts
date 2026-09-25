// In-memory ownership of an agent's continuing sessions, keyed by
// (agentId, sessionKey). Stored run history is display state, not a mutex:
// checking it before an await let two concurrent starts both resume one
// session (two writers on one transcript). Claims are taken synchronously
// and released by the run's single finalizer.

type RunSessionClaim = {
  agentId: string
  sessionKey: string
  owner: boolean
  agentEpoch: number
  keyEpoch: number
}

const owners = new Map<string, string>()
const claims = new Map<string, RunSessionClaim>()
const agentEpochs = new Map<string, number>()
const keyEpochs = new Map<string, number>()

function leaseKey(agentId: string, sessionKey: string): string {
  return `${agentId}\u0000${sessionKey}`
}

/**
 * Registers a run against its session key. Returns true when the run owns the
 * key and may resume its session; false when another live run already does
 * (the caller must start fresh).
 */
export function claimRunSession(runId: string, agentId: string, sessionKey: string): boolean {
  const key = leaseKey(agentId, sessionKey)
  const owner = !owners.has(key)
  if (owner) {
    owners.set(key, runId)
  }
  claims.set(runId, {
    agentId,
    sessionKey,
    owner,
    agentEpoch: agentEpochs.get(agentId) ?? 0,
    keyEpoch: keyEpochs.get(key) ?? 0
  })
  return owner
}

/** Idempotent; only the owning run frees the key. */
export function releaseRunSession(runId: string): void {
  const claim = claims.get(runId)
  if (!claim) {
    return
  }
  claims.delete(runId)
  const key = leaseKey(claim.agentId, claim.sessionKey)
  if (claim.owner && owners.get(key) === runId) {
    owners.delete(key)
  }
}

/**
 * The session key a run may record its session under, or null when the run is
 * unknown or its session was reset after the run started (a reset must not be
 * undone by a run that was already in flight).
 */
export function currentRunSessionKey(runId: string): string | null {
  const claim = claims.get(runId)
  if (!claim) {
    return null
  }
  const key = leaseKey(claim.agentId, claim.sessionKey)
  if (
    (agentEpochs.get(claim.agentId) ?? 0) !== claim.agentEpoch ||
    (keyEpochs.get(key) ?? 0) !== claim.keyEpoch
  ) {
    return null
  }
  return claim.sessionKey
}

/** Marks sessions reset: every key of the agent, or only `sessionKey`. */
export function invalidateAgentSessions(agentId: string, sessionKey?: string): void {
  if (sessionKey === undefined) {
    agentEpochs.set(agentId, (agentEpochs.get(agentId) ?? 0) + 1)
    return
  }
  const key = leaseKey(agentId, sessionKey)
  keyEpochs.set(key, (keyEpochs.get(key) ?? 0) + 1)
}

/** The keyed sessions left after a reset of every key (undefined) or of one key. */
export function sessionsAfterReset<T>(
  sessions: Record<string, T> | undefined,
  sessionKey?: string
): Record<string, T> | undefined {
  if (sessionKey === undefined || !sessions) {
    return undefined
  }
  const rest = Object.fromEntries(Object.entries(sessions).filter(([key]) => key !== sessionKey))
  return Object.keys(rest).length > 0 ? rest : undefined
}
