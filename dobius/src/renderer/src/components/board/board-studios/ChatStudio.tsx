import React from 'react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { useConsolePane } from '../console-card/use-console-pane'
import { NativeChatView } from './board-studio-lazy-pages'
import { StudioEmptyState } from './StudioEmptyState'

// Chat for the console card the user selected on the Board. Reuses the native
// chat surface bound to that card's terminal tab.
export function ChatStudio({
  worktreeId,
  chatTabId
}: {
  worktreeId: string | null
  chatTabId: string | null
}): React.JSX.Element {
  if (!worktreeId || !chatTabId) {
    return (
      <StudioEmptyState
        title={translate('board.studio.chat.selectConsole', 'Select a console card first.')}
        detail={translate(
          'board.studio.chat.selectConsoleDetail',
          'Chat follows the console you pick on the board.'
        )}
      />
    )
  }
  return <ConsoleChat worktreeId={worktreeId} tabId={chatTabId} />
}

function ConsoleChat({
  worktreeId,
  tabId
}: {
  worktreeId: string
  tabId: string
}): React.JSX.Element {
  const tab = useAppStore((s) => (s.tabsByWorktree[worktreeId] ?? []).find((t) => t.id === tabId))
  const { paneKey } = useConsolePane(worktreeId, tabId)
  if (!tab) {
    return (
      <StudioEmptyState
        title={translate('board.studio.chat.terminalGone', 'That console has no terminal anymore.')}
      />
    )
  }
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <NativeChatView
        terminalTabId={tabId}
        paneKey={paneKey ?? undefined}
        targetPtyId={tab.ptyId}
        launchAgent={tab.launchAgent}
      />
    </div>
  )
}
