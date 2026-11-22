import { RotateCcw } from 'lucide-react'
import { useConfirmationDialog } from '@/components/confirmation-dialog'
import { translate } from '@/i18n/i18n'
import type { BoardCardOf } from '@/store/slices/board'
import { restartConsoleConfirmed } from './console-actions'
import type { ConsoleCardStatus } from './console-card-status'

/** True when the card's terminal itself is gone or ended (not a paused or idle agent). */
export function consoleTerminalNotRunning(status: ConsoleCardStatus): boolean {
  return status === 'done' || status === 'gone'
}

/**
 * Why: a dead console used to look like any quiet card, so people (and agents)
 * kept sending it work. The card now says so and offers the same Restart the
 * card menu and orchestrator rows use.
 */
export function ConsoleNotRunningBadge({
  worktreeId,
  card,
  status
}: {
  worktreeId: string
  card: BoardCardOf<'console'>
  status: ConsoleCardStatus
}): React.JSX.Element | null {
  const confirm = useConfirmationDialog()
  if (!consoleTerminalNotRunning(status)) {
    return null
  }
  const restartLabel = translate('board.console.restartNamed', 'Restart {{name}}', {
    name: card.title
  })
  return (
    <span className="flex shrink-0 items-center gap-1">
      <span
        data-board-console-not-running
        className="rounded-full bg-[var(--board-danger-tint)] px-2 py-0.5 text-[10px] font-semibold tracking-[0.05em] text-[var(--board-danger-text)] uppercase"
      >
        {translate('board.console.notRunning', 'Not running')}
      </span>
      <button
        type="button"
        data-board-card-control
        aria-label={restartLabel}
        title={restartLabel}
        onClick={() => restartConsoleConfirmed(worktreeId, card, confirm)}
        className="flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-medium text-[var(--board-text)] hover:bg-[var(--board-panel-2)] [&_svg]:size-3.5"
      >
        <RotateCcw />
        {translate('board.console.restart', 'Restart')}
      </button>
    </span>
  )
}
