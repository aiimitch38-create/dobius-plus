import React from 'react'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ReviewNotesSendMenuContent } from '@/components/editor/ReviewNotesSendMenuContent'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'

// Console picker for a memory note. Reuses the notes-send menu content (running
// agents of the workspace + launch a new one), which delivers through the
// runtime terminal path, so it works for SSH workspaces too. Skips the
// NotesSendMenu wrapper on purpose: that one drives the Classic sidebar's
// send-target highlight mode.
export function PushToConsoleMenu({
  worktreeId,
  prompt
}: {
  worktreeId: string | null
  prompt: string
}): React.JSX.Element {
  const groupId = useAppStore((s) =>
    worktreeId ? (s.activeGroupIdByWorktree?.[worktreeId] ?? worktreeId) : null
  )
  const label = translate('board.studio.memory.pushToConsole', 'Push to console')
  const disabled = !worktreeId || !groupId || prompt.trim().length === 0
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          title={
            worktreeId
              ? label
              : translate(
                  'board.studio.memory.pushNeedsWorkspace',
                  'Open a workspace to push notes.'
                )
          }
        >
          <Send className="size-3.5" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      {worktreeId && groupId ? (
        <DropdownMenuContent align="end" className="min-w-[240px]">
          <ReviewNotesSendMenuContent worktreeId={worktreeId} groupId={groupId} prompt={prompt} />
        </DropdownMenuContent>
      ) : null}
    </DropdownMenu>
  )
}
