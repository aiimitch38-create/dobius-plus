import { AgentStateDot } from '@/components/AgentStateDot'
import { AgentIcon } from '@/lib/agent-catalog'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import type { BoardCardOf } from '@/store/slices/board'
import { AGENT_STATUS_STALE_AFTER_MS } from '../../../../../shared/agent-status-types'
import { isTuiAgent } from '../../../../../shared/tui-agent-config'
import {
  consoleStatusLabel,
  consoleCardStatus,
  type ConsoleCardStatus
} from './console-card-status'
import { useConsolePane } from './use-console-pane'
import { useConsoleForeground, useConsolePaused } from './use-console-runtime'

type ConsoleCardProps = { worktreeId: string; card: BoardCardOf<'console'> }

const DOT_FOR: Partial<Record<ConsoleCardStatus, 'working' | 'waiting' | 'done' | 'idle'>> = {
  working: 'working',
  waiting: 'waiting',
  done: 'done',
  idle: 'idle'
}

export function ConsoleCardTitleAccessory({
  worktreeId,
  card
}: ConsoleCardProps): React.JSX.Element {
  const { tabExists, paneKey } = useConsolePane(worktreeId, card.tabId)
  const entry = useAppStore((s) => (paneKey ? s.agentStatusByPaneKey[paneKey] : undefined))
  const sleeping = useAppStore((s) =>
    paneKey ? Boolean(s.sleepingAgentSessionsByPaneKey[paneKey]) : false
  )
  const boardPaused = useConsolePaused(card.tabId)
  const foreground = useConsoleForeground(card.tabId)
  // Why: subscribing to the epoch re-evaluates staleness when the feed ticks.
  useAppStore((s) => s.agentStatusEpoch)
  const status = consoleCardStatus({
    tabExists,
    paused: sleeping || boardPaused,
    foreground,
    entry,
    now: Date.now(),
    staleAfterMs: AGENT_STATUS_STALE_AFTER_MS
  })
  const dot = DOT_FOR[status]
  return (
    <span className="flex shrink-0 items-center gap-2" title={consoleStatusLabel(status)}>
      {card.yolo && (
        <span
          title={translate(
            'board.console.yoloHint',
            'Permission prompts are skipped for this agent'
          )}
          className="rounded-full bg-[var(--board-danger-tint)] px-2 py-0.5 text-[10px] font-semibold tracking-[0.05em] text-[var(--board-danger-text)] uppercase"
        >
          {translate('board.console.yolo', 'Yolo')}
        </span>
      )}
      <span className="flex items-center gap-1.5 rounded-full border border-[var(--board-chip-border)] bg-[var(--board-chip)] px-2 py-0.5 text-[11px] font-medium text-[var(--board-text-muted)]">
        <AgentIcon agent={isTuiAgent(card.agentKind) ? card.agentKind : null} size={12} />
        {consoleStatusLabel(status)}
      </span>
      {dot ? (
        <AgentStateDot state={dot} />
      ) : (
        <span
          aria-label={consoleStatusLabel(status)}
          className="size-2.5 rounded-full"
          style={{
            background: status === 'gone' ? 'var(--board-danger-text)' : 'var(--board-text-muted)'
          }}
        />
      )}
    </span>
  )
}

export { ConsoleCardBody } from './ConsoleCardBody'
