import React, { useEffect, useId } from 'react'
import { Ellipsis, Layers, X } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { AgentIcon, getAgentLabel } from '@/lib/agent-catalog'
import { cn } from '@/lib/utils'
import type { TuiAgent } from '../../../../../shared/types'
import type { BoardAgentOption } from '../board-chrome/BoardAgentPicker'
import {
  BOARD_FLOATING_PANEL_CLASS,
  BOARD_MENU_CONTENT_CLASS,
  BOARD_MENU_ROW_CLASS
} from '../board-chrome/board-surface-classes'
import { isBoardShortcutBlockedTarget } from '../board-chrome/board-tools'
import {
  BOARD_EMPTY_START_COUNTS,
  BOARD_EMPTY_START_TILES,
  boardEmptyStartMoreAgents
} from './board-empty-start'

export type BoardEmptyStartProps = {
  /** Launchable agents (enabled and detected), default first. */
  agents: readonly BoardAgentOption[]
  /** The tile shown selected; null when nothing can be launched. */
  selected: TuiAgent | null
  onSelect: (agent: TuiAgent) => void
  onSpawn: (agent: TuiAgent, count: number) => void
  onPreset: () => void
  onDismiss: () => void
  /** While a picker, studio or sheet is up, Enter and Esc belong to them. */
  suspended?: boolean
}

const TILE_CLASS =
  'flex h-[76px] flex-col items-center justify-center gap-2 rounded-[14px] border text-[13px] transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--board-accent-tint)]'
const OUTLINE_BUTTON_CLASS =
  'inline-flex h-10 items-center justify-center gap-2 rounded-full border border-[var(--board-panel-border)] bg-[var(--board-panel)] text-[13px] font-semibold text-[var(--board-text)] transition-colors hover:bg-[var(--board-panel-2)] outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--board-accent-tint)]'

function tileClass(selected: boolean, enabled: boolean): string {
  return cn(
    TILE_CLASS,
    selected
      ? 'border-[var(--board-accent)] bg-[var(--board-accent-tint)] font-semibold text-[var(--board-text)]'
      : 'border-[var(--board-panel-border)] bg-[var(--board-panel-2)] text-[var(--board-text-muted)]',
    enabled ? 'cursor-pointer hover:border-[var(--board-accent)]' : 'cursor-not-allowed opacity-50'
  )
}

/**
 * Centered start card for a board with no cards: pick the default model, then
 * spawn one, several, or start from a preset. Spawns go through the same path
 * as the "New console" and "Spawn 4" chips, so placement is identical.
 */
export function BoardEmptyStart({
  agents,
  selected,
  onSelect,
  onSpawn,
  onPreset,
  onDismiss,
  suspended = false
}: BoardEmptyStartProps): React.JSX.Element {
  const titleId = useId()
  const panelId = useId()
  const launchable = new Set(agents.map((a) => a.id))
  const moreAgents = boardEmptyStartMoreAgents(agents)
  const moreSelected = selected !== null && !BOARD_EMPTY_START_TILES.includes(selected)
  const notInstalled = translate('board.emptyStart.notInstalled', 'Not installed')

  // Enter spawns one console, Esc closes the card; typing in a field, console
  // or menu keeps its own keys, as does a button inside the card (native click).
  useEffect(() => {
    if (suspended) {
      return
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' && event.key !== 'Escape') {
        return
      }
      if (isBoardShortcutBlockedTarget(event.target)) {
        return
      }
      const inside =
        event.target instanceof Element && event.target.closest(`[data-board-empty-start]`)
      if (event.key === 'Escape') {
        event.preventDefault()
        onDismiss()
        return
      }
      if (!inside && selected) {
        event.preventDefault()
        onSpawn(selected, 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDismiss, onSpawn, selected, suspended])

  const tile = (agent: TuiAgent): React.JSX.Element => {
    const enabled = launchable.has(agent)
    const label = getAgentLabel(agent)
    const button = (
      <button
        key={agent}
        type="button"
        role="radio"
        aria-checked={selected === agent}
        aria-disabled={!enabled}
        aria-label={enabled ? label : `${label} (${notInstalled})`}
        onClick={() => enabled && onSelect(agent)}
        className={tileClass(selected === agent, enabled)}
      >
        <AgentIcon agent={agent} size={22} />
        <span>{label}</span>
      </button>
    )
    if (enabled) {
      return button
    }
    return (
      <Tooltip key={agent}>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {notInstalled}
        </TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div
      role="dialog"
      aria-labelledby={titleId}
      data-board-empty-start
      id={panelId}
      className={cn(
        BOARD_FLOATING_PANEL_CLASS,
        'pointer-events-auto absolute top-1/2 left-1/2 z-10 w-[460px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-[28px] p-7'
      )}
    >
      <button
        type="button"
        aria-label={translate('board.emptyStart.close', 'Close')}
        onClick={onDismiss}
        className="absolute top-4 right-4 flex size-8 cursor-pointer items-center justify-center rounded-full text-[var(--board-text-muted)] transition-colors hover:bg-[var(--board-panel-2)] hover:text-[var(--board-text)]"
      >
        <X className="size-4" />
      </button>

      <h2 id={titleId} className="text-[20px] leading-7 font-bold text-[var(--board-text)]">
        {translate('board.emptyStart.title', 'This board is empty')}
      </h2>
      <p className="mt-1 text-[13px] leading-5 text-[var(--board-text-muted)]">
        {translate('board.emptyStart.subtitle', 'Pick a default model, then spawn your agents.')}
      </p>

      <p className="mt-6 text-[11px] font-semibold tracking-[0.08em] text-[var(--board-text-muted)] uppercase">
        {translate('board.emptyStart.defaultModel', 'Default model')}
      </p>
      <div
        role="radiogroup"
        aria-label={translate('board.emptyStart.defaultModel', 'Default model')}
        className="mt-2 grid grid-cols-3 gap-2"
      >
        {BOARD_EMPTY_START_TILES.map(tile)}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={translate('board.emptyStart.more', 'More agents')}
              aria-disabled={moreAgents.length === 0}
              disabled={moreAgents.length === 0}
              className={tileClass(moreSelected, moreAgents.length > 0)}
            >
              {moreSelected && selected ? (
                <AgentIcon agent={selected} size={22} />
              ) : (
                <Ellipsis className="size-[22px]" />
              )}
              <span>
                {moreSelected && selected
                  ? getAgentLabel(selected)
                  : translate('board.emptyStart.moreTile', 'More')}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="bottom"
            align="end"
            sideOffset={6}
            data-surface="board"
            className={cn(BOARD_MENU_CONTENT_CLASS, 'max-h-[320px] w-[212px] overflow-y-auto p-2')}
          >
            {moreAgents.map((agent) => (
              <DropdownMenuItem
                key={agent.id}
                onSelect={() => onSelect(agent.id)}
                className={cn(BOARD_MENU_ROW_CLASS, 'h-[34px] gap-2.5 px-1.5')}
              >
                <span className="flex size-[26px] shrink-0 items-center justify-center rounded-[7px] border border-[var(--board-panel-border)] bg-[var(--board-panel-2)]">
                  <AgentIcon agent={agent.id} size={15} />
                </span>
                <span className="min-w-0 flex-1 truncate font-semibold">{agent.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <button
        type="button"
        disabled={selected === null}
        onClick={() => selected && onSpawn(selected, 1)}
        className="mt-5 flex h-12 w-full cursor-pointer items-center justify-center gap-2.5 rounded-full bg-[var(--board-accent)] text-[14px] font-semibold text-[var(--board-accent-fg)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--board-accent-tint)]"
      >
        {selected ? (
          <span className="flex size-6 items-center justify-center rounded-full bg-[var(--board-accent-fg)]">
            <AgentIcon agent={selected} size={14} />
          </span>
        ) : null}
        {translate('board.emptyStart.spawnOne', 'Spawn an agent')}
      </button>

      <p className="mt-4 text-center text-[12px] text-[var(--board-text-muted)]">
        {translate('board.emptyStart.orSeveral', 'or spawn several')}
      </p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {BOARD_EMPTY_START_COUNTS.map((count) => (
          <button
            key={count}
            type="button"
            disabled={selected === null}
            onClick={() => selected && onSpawn(selected, count)}
            className={cn(OUTLINE_BUTTON_CLASS, 'disabled:cursor-not-allowed disabled:opacity-50')}
          >
            {translate('board.emptyStart.spawnCount', 'Spawn {{count}}', { count })}
          </button>
        ))}
      </div>

      <button type="button" onClick={onPreset} className={cn(OUTLINE_BUTTON_CLASS, 'mt-3 w-full')}>
        <Layers className="size-4" />
        {translate('board.emptyStart.preset', 'Start from a preset')}
      </button>
    </div>
  )
}
