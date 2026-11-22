import { useEffect } from 'react'
import { useAppStore } from '@/store'
import type { AdamTurnEvent } from '../../../../../shared/speech-types'
import { adamReplyMessage } from '../board-planner/adam-thread'
import { appendToBoardThread } from './board-thread-store'

// Voice and typed messages are one conversation with ADAM, so every spoken turn
// is written into the Board thread too. Typed turns add their own rows.

/** Same rule as the Board route: the thread belongs to the open workspace's repo. */
export function activeBoardThreadId(): string | null {
  const s = useAppStore.getState()
  return (
    (s.activeWorktreeId ? s.getKnownWorktreeById(s.activeWorktreeId)?.repoId : null) ??
    s.activeRepoId ??
    null
  )
}

/**
 * Returns the handler for ADAM turn events. The thread a turn belongs to is
 * fixed when it starts: main carries it in both events (`threadId`). Only a
 * turn started without one (the wake word, heard in main) falls back to the
 * thread on screen at that moment, remembered here. A reply whose thread is
 * not known is dropped, never guessed.
 */
export function createVoiceTurnRecorder(
  repoOf: () => string | null = activeBoardThreadId,
  append: typeof appendToBoardThread = appendToBoardThread
): (event: AdamTurnEvent) => void {
  const repoByTurn = new Map<string, string | null>()
  return (event) => {
    if (event.source !== 'voice') {
      return
    }
    if (event.phase === 'asked') {
      const repoId = event.threadId ?? repoOf()
      repoByTurn.set(event.turnId, repoId)
      append(repoId, { role: 'user', text: event.text, voice: true })
      return
    }
    const repoId = event.threadId ?? repoByTurn.get(event.turnId)
    repoByTurn.delete(event.turnId)
    if (repoId === undefined || repoId === null) {
      console.warn('ADAM voice reply dropped: the thread it belongs to is not known.')
      return
    }
    append(repoId, { ...adamReplyMessage({ ok: true, result: event.result }), voice: true })
  }
}

/** Mounted once, app-wide, so voice turns are kept even when the Board is not open. */
export function useAdamVoiceThread(): void {
  useEffect(() => window.api.jarvis.onAdamTurn(createVoiceTurnRecorder()), [])
}
