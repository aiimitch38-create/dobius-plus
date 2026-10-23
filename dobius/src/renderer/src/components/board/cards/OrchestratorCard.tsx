import { useState } from 'react'
import { ArrowUp, Crosshair, Pause, Play, RotateCcw, X } from 'lucide-react'
import { toast } from 'sonner'
import { useConfirmationDialog } from '@/components/confirmation-dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { getBoard, type BoardCardOf } from '@/store/slices/board'
import type { CardBodyProps } from './card-body-props'
import { useOrchestratorThread } from './use-orchestrator-thread'
import { OrchestratorEmptyState, OrchestratorTeamBar } from '../board-links/OrchestratorTeamBar'
import {
  orchestratorRefusalText,
  routeOrchestratorMessage
} from '../board-links/orchestrator-scope'
import { missionMapCanPause } from '../board-studios/mission-map-filter'
import {
  focusBoardCards,
  killConsoleConfirmed,
  restartConsoleConfirmed,
  setConsolesPausedWithToast
} from '../console-card/console-actions'
import { consoleStatusLabel } from '../console-card/console-card-status'
import { useConsoleCardStatus } from '../console-card/use-console-card-status'

export type OrchestratorMessage = {
  id: string
  role: 'user' | 'orchestrator'
  text: string
  /** Console title of a reply's sender. */
  author?: string
}

function WirePicker({
  worktreeId,
  card,
  onChange
}: CardBodyProps<'orchestrator'> & { worktreeId: string }): React.JSX.Element {
  const consoles = useAppStore((s) => getBoard(s, worktreeId).cards).filter(
    (c): c is BoardCardOf<'console'> => c.kind === 'console'
  )
  const wired = new Set(card.wiredCardIds)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="max-w-full truncate rounded-full py-0.5 text-left text-[12px] text-[var(--board-text-muted)] hover:text-[var(--board-text)]"
        >
          {card.wiredCardIds.length === 0
            ? translate('board.orchestrator.noneConnected', 'No consoles connected')
            : translate('board.orchestrator.connected', '{{count}} consoles connected', {
                count: card.wiredCardIds.length
              })}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4}>
        {consoles.length === 0 ? (
          <div className="px-2 py-1 text-[12px] text-muted-foreground">
            {translate('board.orchestrator.noConsoles', 'No consoles on this board.')}
          </div>
        ) : (
          consoles.map((c) => (
            <DropdownMenuCheckboxItem
              key={c.id}
              checked={wired.has(c.id)}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(checked) =>
                onChange({
                  wiredCardIds: checked
                    ? [...card.wiredCardIds, c.id]
                    : card.wiredCardIds.filter((id) => id !== c.id)
                })
              }
            >
              {c.title}
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const ROW_ACTION =
  'flex size-6 shrink-0 items-center justify-center rounded-full text-[var(--board-text-muted)] hover:bg-[var(--board-panel-2)] hover:text-[var(--board-text)] disabled:opacity-40 disabled:hover:bg-transparent [&_svg]:size-3.5'

function TeamRow({
  worktreeId,
  console: c,
  confirm
}: {
  worktreeId: string
  console: BoardCardOf<'console'>
  confirm: ReturnType<typeof useConfirmationDialog>
}): React.JSX.Element {
  const { status } = useConsoleCardStatus(worktreeId, c.tabId)
  const paused = status === 'paused'
  const focusLabel = translate('board.orchestrator.row.focus', 'Focus {{name}}', { name: c.title })
  const pauseLabel = paused
    ? translate('board.orchestrator.row.resume', 'Resume {{name}}', { name: c.title })
    : translate('board.orchestrator.row.pause', 'Pause {{name}}', { name: c.title })
  const restartLabel = translate('board.orchestrator.row.restart', 'Restart {{name}}', {
    name: c.title
  })
  const killLabel = translate('board.orchestrator.row.kill', 'Kill {{name}}', { name: c.title })
  return (
    <li className="flex items-center gap-1 text-[12px]">
      <span className="min-w-0 flex-1 truncate text-[var(--board-text)]">{c.title}</span>
      <span className="shrink-0 pr-1 text-[11px] text-[var(--board-text-muted)]">
        {consoleStatusLabel(status)}
      </span>
      <button
        type="button"
        aria-label={focusLabel}
        title={focusLabel}
        className={ROW_ACTION}
        onClick={() => focusBoardCards(worktreeId, [c.id])}
      >
        <Crosshair />
      </button>
      <button
        type="button"
        aria-label={pauseLabel}
        title={pauseLabel}
        className={ROW_ACTION}
        disabled={!paused && !missionMapCanPause(status)}
        onClick={() => void setConsolesPausedWithToast([c], !paused)}
      >
        {paused ? <Play /> : <Pause />}
      </button>
      <button
        type="button"
        aria-label={restartLabel}
        title={restartLabel}
        className={ROW_ACTION}
        onClick={() => restartConsoleConfirmed(worktreeId, c, confirm)}
      >
        <RotateCcw />
      </button>
      <button
        type="button"
        aria-label={killLabel}
        title={killLabel}
        className={`${ROW_ACTION} hover:text-[var(--board-danger-text)]`}
        onClick={() => killConsoleConfirmed(worktreeId, c, confirm)}
      >
        <X />
      </button>
    </li>
  )
}

/** One row per wired console with per-lane controls, so a team is run from its card. */
function TeamRows({
  worktreeId,
  consoles
}: {
  worktreeId: string
  consoles: readonly BoardCardOf<'console'>[]
}): React.JSX.Element | null {
  const confirm = useConfirmationDialog()
  if (consoles.length === 0) {
    return null
  }
  return (
    <ul
      aria-label={translate('board.orchestrator.rows', 'Wired consoles')}
      className="scrollbar-sleek flex max-h-36 shrink-0 flex-col gap-0.5 overflow-y-auto border-b border-[var(--board-panel-border)] px-3 py-1.5"
    >
      {consoles.map((c) => (
        <TeamRow key={c.id} worktreeId={worktreeId} console={c} confirm={confirm} />
      ))}
    </ul>
  )
}

// Why: relays only to wired consoles and shows their replies; the card never
// falls back to the focused terminal or a broadcast group.
export function OrchestratorCard({
  worktreeId,
  card,
  onChange
}: CardBodyProps<'orchestrator'> & { worktreeId: string }): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const { messages, send, note } = useOrchestratorThread(worktreeId, card.id, card.wiredCardIds)
  const boardCards = useAppStore((s) => getBoard(s, worktreeId).cards)
  const wired = card.wiredCardIds.length
  const wiredIds = new Set(card.wiredCardIds)
  const wiredConsoles = boardCards.filter(
    (c): c is BoardCardOf<'console'> => c.kind === 'console' && wiredIds.has(c.id)
  )
  const submit = async (): Promise<void> => {
    const text = draft.trim()
    if (!text || sending) {
      return
    }
    setSending(true)
    try {
      const wiredSet = new Set(card.wiredCardIds)
      const route = routeOrchestratorMessage(
        text,
        boardCards.flatMap((c) =>
          c.kind === 'console' && wiredSet.has(c.id) ? [{ cardId: c.id, title: c.title }] : []
        )
      )
      if (route.kind === 'refuse') {
        note(orchestratorRefusalText(route.reason))
      } else {
        await send(route.text, route.kind === 'one' ? [route.cardId] : undefined)
      }
      setDraft('')
    } catch (error) {
      toast.error(
        error instanceof Error && error.message === 'no_wired_consoles_running'
          ? translate('board.orchestrator.noneRunning', 'None of the wired consoles is running.')
          : error instanceof Error
            ? error.message
            : String(error)
      )
    } finally {
      setSending(false)
    }
  }
  return (
    <div className="flex size-full flex-col">
      <OrchestratorTeamBar
        worktreeId={worktreeId}
        card={card}
        onChange={onChange}
        status={<WirePicker worktreeId={worktreeId} card={card} onChange={onChange} />}
      />
      <TeamRows worktreeId={worktreeId} consoles={wiredConsoles} />
      <div className="scrollbar-sleek flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-3 text-[13px]">
        {messages.length === 0 ? (
          <OrchestratorEmptyState worktreeId={worktreeId} card={card} />
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={
                m.role === 'user'
                  ? 'self-end rounded-2xl bg-[var(--board-accent-tint)] px-3 py-1.5'
                  : 'self-start rounded-2xl bg-[var(--board-panel-2)] px-3 py-1.5'
              }
            >
              {m.author && (
                <div className="text-[11px] font-semibold text-[var(--board-text-muted)]">
                  {m.author}
                </div>
              )}
              <div className="break-words whitespace-pre-wrap">{m.text}</div>
            </div>
          ))
        )}
      </div>
      <div className="flex items-center gap-2 border-t border-[var(--board-panel-border)] p-2">
        <input
          value={draft}
          disabled={wired === 0}
          aria-label={translate('board.orchestrator.message', 'Message {{name}}', {
            name: card.name
          })}
          placeholder={translate(
            'board.orchestrator.placeholder',
            'Tell the team, or @Name to tell one console…'
          )}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          className="h-8 min-w-0 flex-1 rounded-full border border-[var(--board-panel-border)] bg-transparent px-3 text-[13px] text-[var(--board-text)] outline-none placeholder:text-[var(--board-text-muted)] disabled:opacity-50"
        />
        <button
          type="button"
          aria-label={translate('board.orchestrator.send', 'Send')}
          disabled={wired === 0 || !draft.trim() || sending}
          onClick={() => void submit()}
          className="flex size-8 items-center justify-center rounded-full bg-[var(--board-accent)] text-[var(--board-accent-fg)] disabled:opacity-40"
        >
          <ArrowUp className="size-4" />
        </button>
      </div>
    </div>
  )
}
