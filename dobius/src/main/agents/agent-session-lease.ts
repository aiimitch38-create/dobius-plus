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

// Live claims per key, owner or not: a fresh run still writes to the key's
// transcript lineage, so the key stays busy until every claim is released.
const liveClaims = new Map<string, number>()
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
  const live = liveClaims.get(key) ?? 0
  const owner = live === 0
  liveClaims.set(key, live + 1)
  claims.set(runId, {
    agentId,
    sessionKey,
    owner,
    agentEpoch: agentEpochs.get(agentId) ?? 0,
    keyEpoch: keyEpochs.get(key) ?? 0
  })
  return owner
}

/** Idempotent; the key is free once every claim on it is released. */
export function releaseRunSession(runId: string): void {
  const claim = claims.get(runId)
  if (!claim) {
    return
  }
  claims.delete(runId)
  const key = leaseKey(claim.agentId, claim.sessionKey)
  const live = (liveClaims.get(key) ?? 1) - 1
  if (live <= 0) {
    liveClaims.delete(key)
  } else {
    liveClaims.set(key, live)
  }
}

/**
 * The session key a run may record its session under, or null when the run is
 * unknown, does not own the key (a fresh run beside a live owner must not
 * become the key's session), or its session was reset after the run started.
 */
export function currentRunSessionKey(runId: string): string | null {
  const claim = claims.get(runId)
  if (!claim || !claim.owner) {
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
