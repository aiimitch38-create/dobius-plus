import { useEffect } from 'react'
import { useAppStore } from '@/store'
import type { AdamLookingAt, AdamTurnEvent } from '../../../../../shared/speech-types'
import { adamReplyMessage } from '../board-planner/adam-thread'
import { appendToBoardThread } from './board-thread-store'

// Voice and typed messages are one conversation with ADAM, so every spoken turn
// is written into his thread too. Typed turns add their own rows.

/** The project on screen right now, for ADAM's "carson_is_looking_at". */
export function currentlyLookingAt(): AdamLookingAt | null {
  const s = useAppStore.getState()
  const worktree = s.activeWorktreeId ? s.getKnownWorktreeById(s.activeWorktreeId) : null
  if (!worktree) {
    return null
  }
  return {
    project: s.repos?.find((r) => r.id === worktree.repoId)?.displayName ?? '',
    workspace: worktree.displayName.trim() || worktree.branch.replace(/^refs\/heads\//, ''),
    folder: worktree.path ?? null
  }
}

/** Returns the handler for ADAM turn events: each voice turn becomes two thread rows. */
export function createVoiceTurnRecorder(
  append: typeof appendToBoardThread = appendToBoardThread
): (event: AdamTurnEvent) => void {
  return (event) => {
    if (event.source !== 'voice') {
      return
    }
    // Why ids from the turn: every window hears the same turn, and it must be written once.
    if (event.phase === 'asked') {
      append({ role: 'user', text: event.text, voice: true }, `${event.turnId}:asked`)
      return
    }
    append(
      { ...adamReplyMessage({ ok: true, result: event.result }), voice: true },
      `${event.turnId}:answered`
    )
  }
}

/** Mounted once, app-wide, so voice turns are kept even when the Board is not open. */
export function useAdamVoiceThread(): void {
  useEffect(() => window.api.jarvis.onAdamTurn(createVoiceTurnRecorder()), [])
}
