import {
  recordStoppedSession,
  waitForStoppedSession
} from '@/components/dictation/dictation-stopped-sessions'

/**
 * Tracks main-side dictation shutdowns so clean teardown can await them and
 * stale stopped/final events cannot leak into the next session.
 */
export type StoppedSessionTracker = {
  record: (sessionId: string) => void
  wait: (sessionId: string) => Promise<void>
}

export function createStoppedSessionTracker(): StoppedSessionTracker {
  const idsRef = { current: new Set<string>() }
  const resolversRef = { current: new Map<string, () => void>() }
  return {
    record: (sessionId) => recordStoppedSession(sessionId, idsRef, resolversRef),
    wait: (sessionId) => waitForStoppedSession(sessionId, idsRef, resolversRef)
  }
}
