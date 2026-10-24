import { AgentStateDot } from '@/components/AgentStateDot'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { BOARD_MONO_CLASS } from '../board-chrome/board-surface-classes'
import {
  CONSOLE_STATUS_DOT,
  consoleStatusLabel,
  type ConsoleCardStatus
} from './console-card-status'
import { textTailLines } from './console-output-tail'
import { useConsoleCardStatus } from './use-console-card-status'
import { useConsoleOutputTail } from './use-console-output-tail'

/** The glance wired to its console's status feed and screen tail; mounted only in glance mode. */
export function ConsoleGlanceView({
  worktreeId,
  tabId,
  leafId,
  title,
  onScreen,
  scale
}: {
  worktreeId: string
  tabId: string
  leafId: string | null
  title: string
  /** Off-screen glances skip reading output; nobody can see them. */
  onScreen: boolean
  scale: number
}): React.JSX.Element {
  const { status, lastReply } = useConsoleCardStatus(worktreeId, tabId)
  const ptyId = useAppStore(
    (s) =>
      (leafId ? s.terminalLayoutsByTabId[tabId]?.ptyIdsByLeafId?.[leafId] : undefined) ??
      s.ptyIdsByTabId[tabId]?.[0] ??
      null
  )
  const lines = useConsoleOutputTail(ptyId, onScreen)
  return (
    <ConsoleGlance
      title={title}
      status={status}
      lines={lines}
      lastReply={lastReply?.text ?? null}
      scale={scale}
    />
  )
}

type ConsoleGlanceProps = {
  title: string
  status: ConsoleCardStatus
  /** Screen tail from the terminal; null until the first read lands. */
  lines: string[] | null
  /** The agent's last reply, shown when the screen has nothing readable yet. */
  lastReply: string | null
  /** Counter-scale (≤ 1) so the glance text stays a fixed on-screen size at any zoom. */
  scale: number
}

/**
 * What a console is doing, readable from the zoomed-out overview: status and
 * the last lines of output as plain text. Inert: never takes focus, and a click
 * on it is the card's click (select / fly in), not terminal input.
 */
export function ConsoleGlance({
  title,
  status,
  lines,
  lastReply,
  scale
}: ConsoleGlanceProps): React.JSX.Element {
  const needsYou = status === 'waiting'
  const dot = CONSOLE_STATUS_DOT[status]
  const shown = lines && lines.length > 0 ? lines : lastReply ? textTailLines(lastReply) : []
  return (
    <div
      data-board-console-glance
      data-needs-you={needsYou ? '' : undefined}
      aria-label={translate('board.console.glance', 'Latest output from {{title}}', { title })}
      className="absolute top-0 left-0 flex cursor-zoom-in flex-col overflow-hidden select-none"
      style={{
        width: `${scale * 100}%`,
        height: `${scale * 100}%`,
        transform: `scale(${1 / scale})`,
        transformOrigin: '0 0'
      }}
    >
      <div
        className={cn(
          'flex shrink-0 items-center gap-1.5 px-2 py-1 text-[11px] font-semibold',
          needsYou
            ? 'bg-[var(--board-accent)] text-[var(--board-accent-fg)]'
            : 'bg-[var(--board-panel-2)] text-[var(--board-text-muted)]'
        )}
      >
        {dot ? (
          <AgentStateDot state={dot} />
        ) : (
          <span className="size-2 shrink-0 rounded-full bg-[var(--board-text-muted)]" />
        )}
        <span className="truncate">{consoleStatusLabel(status)}</span>
      </div>
      <div
        className={cn(
          BOARD_MONO_CLASS,
          'flex min-h-0 flex-1 flex-col justify-end overflow-hidden px-2 py-1 text-[10px] leading-[13px] text-[var(--board-text)]',
          needsYou && 'bg-[var(--board-accent-tint)]'
        )}
      >
        {shown.length > 0 ? (
          shown.map((line, i) => (
            // Why: index keys are fine; the list is replaced wholesale each refresh.
            <div key={i} className="shrink-0 truncate whitespace-pre">
              {line}
            </div>
          ))
        ) : (
          <div className="shrink-0 text-[var(--board-text-muted)]">
            {translate('board.console.glanceEmpty', 'No output yet')}
          </div>
        )}
      </div>
    </div>
  )
}
