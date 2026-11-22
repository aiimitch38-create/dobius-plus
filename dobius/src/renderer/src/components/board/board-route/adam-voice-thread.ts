import { useEffect } from 'react'
import { useAppStore } from '@/store'
import type { AdamLookingAt } from '../../../../../shared/speech-types'
import { reportUnsaved } from './board-thread-store'

// Voice and typed messages are one conversation with ADAM. Main writes every spoken
// turn into his thread itself; this file only tells main which project is on screen.

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

/**
 * Mounted once, app-wide, so main always knows which project is on screen: a
 * wake-word turn starts in main and has no other way to learn what "this project" means.
 */
export function useAdamVoiceThread(): void {
  useEffect(
    () =>
      window.api.jarvis.onAdamThreadUnsaved(
        () => void reportUnsaved(Promise.resolve({ ok: false, error: 'not-saved' }))
      ),
    []
  )
  useEffect(() => {
    let last: string | undefined
    const report = (): void => {
      const lookingAt = currentlyLookingAt()
      const next = JSON.stringify(lookingAt)
      if (next !== last) {
        last = next
        void window.api.jarvis.reportLookingAt(lookingAt).catch(() => undefined)
      }
    }
    report()
    return useAppStore.subscribe(report)
  }, [])
}
