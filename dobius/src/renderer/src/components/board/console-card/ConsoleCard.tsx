import { useEffect, useState } from 'react'
import { FileText } from 'lucide-react'
import { AgentStateDot } from '@/components/AgentStateDot'
import { AgentIcon, getAgentLabel } from '@/lib/agent-catalog'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { BoardCardOf } from '@/store/slices/board'
import { isTuiAgent } from '../../../../../shared/tui-agent-config'
import { BoardOutputViewer } from '../board-command-bar/BoardOutputViewer'
import { replyExcerpt } from '../board-delivery/mission-state'
import { useBoardCameraFocus } from '../board-canvas/board-camera-focus'
import { consoleStatusLabel, type ConsoleCardStatus } from './console-card-status'
import { useConsoleCardStatus } from './use-console-card-status'
import { ConsoleAccountBadge } from './ConsoleAccountBadge'

type ConsoleCardProps = { worktreeId: string; card: BoardCardOf<'console'> }

const DOT_FOR: Partial<Record<ConsoleCardStatus, 'working' | 'waiting' | 'done' | 'idle'>> = {
  working: 'working',
  waiting: 'waiting',
  done: 'done',
  idle: 'idle'
}

const FLASH_MS = 600

/** Card-edge ring classes per state: needs-you = accent, working = soft pulsing accent, else none. */
export function consoleStatusRingClass(status: ConsoleCardStatus): string | null {
  if (status === 'waiting') {
    return 'border-2 border-[var(--board-accent)]'
  }
  if (status === 'working') {
    return 'border-2 border-[var(--board-accent)]/40 motion-safe:animate-pulse'
  }
  return null
}

/**
 * State border + focus-mode markers. Rendered from the title bar, but absolutely
 * positioned against the card frame (the nearest positioned ancestor), so it
 * draws over the card edge without the frame knowing about console state.
 */
function ConsoleCardEdge({
  cardId,
  status
}: {
  cardId: string
  status: ConsoleCardStatus
}): React.JSX.Element | null {
  const focused = useBoardCameraFocus((s) => s.focus?.cardId === cardId)
  const arrivedAt = useBoardCameraFocus((s) => (s.focus?.cardId === cardId ? s.focus.arrivedAt : 0))
  const [flashing, setFlashing] = useState(false)
  useEffect(() => {
    if (!arrivedAt) {
      return
    }
    setFlashing(true)
    const timer = window.setTimeout(() => setFlashing(false), FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [arrivedAt])
  const ring = flashing
    ? 'border-2 border-[var(--board-accent)] shadow-[0_0_0_4px_var(--board-accent-tint)]'
    : consoleStatusRingClass(status)
  return (
    <span
      aria-hidden
      data-board-focus-target={focused ? '' : undefined}
      className={cn(
        'pointer-events-none absolute inset-0 z-10 rounded-(--board-radius-card) transition-[border-color,box-shadow] duration-200',
        ring ?? 'hidden'
      )}
    />
  )
}

export function ConsoleCardTitleAccessory({
  worktreeId,
  card
}: ConsoleCardProps): React.JSX.Element {
  const { status, lastReply } = useConsoleCardStatus(worktreeId, card.tabId)
  const [outputOpen, setOutputOpen] = useState(false)
  const dot = DOT_FOR[status]
  const seeOutput = translate('board.console.seeOutput', 'See output')
  return (
    <span
      className="flex shrink-0 items-center gap-2"
      title={consoleStatusLabel(status)}
      data-board-console-card-id={card.id}
    >
      <ConsoleCardEdge cardId={card.id} status={status} />
      {lastReply && (
        <>
          <button
            type="button"
            data-board-card-control
            aria-label={seeOutput}
            title={seeOutput}
            onClick={() => setOutputOpen(true)}
            className="flex size-6 items-center justify-center rounded-full text-[var(--board-text-muted)] hover:bg-[var(--board-panel-2)] hover:text-[var(--board-text)]"
          >
            <FileText className="size-3.5" />
          </button>
          {/* Why: React bubbles portal events up this tree; the dialog must not drag the card. */}
          <span className="contents" onPointerDown={(e) => e.stopPropagation()}>
            <BoardOutputViewer
              report={{
                agent: isTuiAgent(card.agentKind) ? getAgentLabel(card.agentKind) : card.agentKind,
                consoleTitle: card.title,
                excerpt: replyExcerpt(lastReply.text),
                full: lastReply.text,
                at: lastReply.at
              }}
              open={outputOpen}
              onOpenChange={setOutputOpen}
            />
          </span>
        </>
      )}
      <ConsoleAccountBadge worktreeId={worktreeId} card={card} />
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
