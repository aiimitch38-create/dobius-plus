import { useEffect } from 'react'
import { useAppStore } from '@/store'
import type { AdamTurnEvent } from '../../../../../shared/speech-types'
import { adamReplyMessage } from '../board-planner/adam-thread'
import { appendToBoardThread } from './board-thread-store'

// Voice and typed messages are one conversation with ADAM, so every spoken turn
// is written into the Board thread too. Typed turns add their own rows.

/** Same rule as the Board route: the thread belongs to the open workspace's repo. */
function activeRepoId(): string | null {
  const s = useAppStore.getState()
  return (
    (s.activeWorktreeId ? s.getKnownWorktreeById(s.activeWorktreeId)?.repoId : null) ??
    s.activeRepoId ??
    null
  )
}

/**
 * Returns the handler for ADAM turn events. A turn's reply goes to the thread
 * its question went to, even if Carson changed projects in between.
 */
export function createVoiceTurnRecorder(
  repoOf: () => string | null = activeRepoId,
  append: typeof appendToBoardThread = appendToBoardThread
): (event: AdamTurnEvent) => void {
  const repoByTurn = new Map<string, string | null>()
  return (event) => {
    if (event.source !== 'voice') {
      return
    }
    if (event.phase === 'asked') {
      const repoId = repoOf()
      repoByTurn.set(event.turnId, repoId)
      append(repoId, { role: 'user', text: event.text, voice: true })
      return
    }
    const repoId = repoByTurn.has(event.turnId) ? repoByTurn.get(event.turnId)! : repoOf()
    repoByTurn.delete(event.turnId)
    append(repoId, { ...adamReplyMessage({ ok: true, result: event.result }), voice: true })
  }
}

/** Mounted once, app-wide, so voice turns are kept even when the Board is not open. */
export function useAdamVoiceThread(): void {
  useEffect(() => window.api.jarvis.onAdamTurn(createVoiceTurnRecorder()), [])
}
