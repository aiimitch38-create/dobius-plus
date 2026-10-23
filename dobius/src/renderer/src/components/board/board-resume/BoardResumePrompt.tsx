import React, { useEffect, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { boardResumeRegistry } from './board-resume-registry'
import {
  dismissDeferredBoardConsoles,
  resumableBoardConsoleCount,
  resumeDeferredBoardConsoles
} from './resume-deferred-consoles'

// Why: consoles restore one by one as their panes mount; wait for the burst to
// settle so the toast opens once with the full count instead of ticking up.
const SETTLE_MS = 1200

function toastId(worktreeId: string): string {
  return `board-resume:${worktreeId}`
}

function ResumeToastBody({
  worktreeId,
  count
}: {
  worktreeId: string
  count: number
}): React.JSX.Element {
  const answer = (resume: boolean): void => {
    toast.dismiss(toastId(worktreeId))
    if (resume) {
      resumeDeferredBoardConsoles(worktreeId)
    } else {
      dismissDeferredBoardConsoles(worktreeId)
    }
  }
  return (
    <div className="flex w-full flex-col gap-3">
      <p className="text-sm leading-5 text-popover-foreground/80">
        {translate('board.resume.promptDetail', '{{count}} consoles can pick up their last chat', {
          count
        })}
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => answer(false)}>
          {translate('board.resume.no', 'No')}
        </Button>
        <Button type="button" size="sm" onClick={() => answer(true)}>
          {translate('board.resume.yes', 'Yes')}
        </Button>
      </div>
    </div>
  )
}

/**
 * Board-wide "Resume all conversations?" toast for the "Ask first" reopen
 * setting. Renders nothing; it only opens, updates and closes the toast.
 */
export function BoardResumePrompt({ worktreeId }: { worktreeId: string }): null {
  const version = useSyncExternalStore(
    boardResumeRegistry.subscribe,
    boardResumeRegistry.version,
    boardResumeRegistry.version
  )
  useEffect(() => {
    const id = toastId(worktreeId)
    const timer = window.setTimeout(() => {
      const count = resumableBoardConsoleCount(worktreeId)
      if (count === 0) {
        toast.dismiss(id)
        return
      }
      toast.info(translate('board.resume.promptTitle', 'Resume all conversations?'), {
        id,
        duration: Number.POSITIVE_INFINITY,
        description: <ResumeToastBody worktreeId={worktreeId} count={count} />
      })
    }, SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [worktreeId, version])
  // Why: the question belongs to this board; leaving it closes the toast and
  // reopening the board asks again while the sessions are still parked.
  useEffect(() => () => void toast.dismiss(toastId(worktreeId)), [worktreeId])
  return null
}
