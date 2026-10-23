import React, { useState } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Plus, Users } from 'lucide-react'
import { AgentIcon } from '@/lib/agent-catalog'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { BOARD_MENU_CONTENT_CLASS, BOARD_MENU_ROW_CLASS } from './board-surface-classes'
import type { TuiAgent } from '../../../../../shared/types'
import { BoardTeamComposer } from './BoardTeamComposer'
import type { TeamSlot } from './team-composer'

export type BoardAgentOption = { id: TuiAgent; label: string }

export type BoardAgentPickerRequest = {
  /** Screen position (px, relative to the Board) the menu opens at. */
  screen: { x: number; y: number }
  count: number
  /** Chips sit at the bottom, so their menu opens upward. */
  side?: 'top' | 'bottom'
}

type BoardAgentPickerProps = {
  request: BoardAgentPickerRequest | null
  agents: readonly BoardAgentOption[]
  onPick: (agent: TuiAgent) => void
  onClose: () => void
  /** Multi-spawns (Spawn 4, group) offer a team composer: one role + agent per slot. */
  onSpawnTeam?: (slots: TeamSlot[], name: string | null) => void
}

// Why: one picker serves the Spawn tool (opens where you clicked), "New console"
// and "Spawn 4"; an invisible trigger pinned at the point anchors the menu.
export function BoardAgentPicker({
  request,
  agents,
  onPick,
  onClose,
  onSpawnTeam
}: BoardAgentPickerProps): React.JSX.Element | null {
  // Why: the composer outlives the menu (which closes when it opens), so it keeps its own state.
  const [teamCount, setTeamCount] = useState<number | null>(null)
  if (teamCount !== null && onSpawnTeam) {
    return (
      <BoardTeamComposer
        count={teamCount}
        agents={agents}
        onClose={() => setTeamCount(null)}
        onSpawn={(slots, name) => {
          setTeamCount(null)
          onSpawnTeam(slots, name)
        }}
      />
    )
  }
  if (!request) {
    return null
  }
  return (
    <DropdownMenu open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden
          className="pointer-events-none absolute size-px"
          style={{ left: request.screen.x, top: request.screen.y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={request.side ?? 'bottom'}
        align="start"
        sideOffset={6}
        data-surface="board"
        className={cn(BOARD_MENU_CONTENT_CLASS, 'w-[212px] p-2')}
      >
        {/* Reference picker (028-New-console.png): bold title, tiled icons, accent + per row. */}
        <DropdownMenuLabel className="px-1.5 pt-0.5 pb-1.5 text-[12px] font-semibold text-[var(--board-text)]">
          {request.count > 1
            ? translate('board.agentPicker.titleMany', 'Spawn {{count}} consoles', {
                count: request.count
              })
            : translate('board.agentPicker.title', 'New console')}
        </DropdownMenuLabel>
        {agents.length === 0 ? (
          <DropdownMenuItem disabled>
            {translate('board.agentPicker.none', 'No agents are enabled in Settings')}
          </DropdownMenuItem>
        ) : (
          agents.map((agent) => (
            <DropdownMenuItem
              key={agent.id}
              onSelect={() => onPick(agent.id)}
              className={cn(BOARD_MENU_ROW_CLASS, 'h-[38px] gap-2.5 px-1.5')}
            >
              <span className="flex size-[26px] shrink-0 items-center justify-center rounded-[7px] border border-[var(--board-panel-border)] bg-[var(--board-panel-2)]">
                <AgentIcon agent={agent.id} size={15} />
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold">{agent.label}</span>
              <Plus className="!size-3.5 !text-[var(--board-accent)]" />
            </DropdownMenuItem>
          ))
        )}
        {onSpawnTeam && request.count > 1 && agents.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                setTeamCount(request.count)
                onClose()
              }}
              className={cn(BOARD_MENU_ROW_CLASS, 'h-[34px] gap-2.5 px-1.5')}
            >
              <Users className="!size-3.5 !text-[var(--board-accent)]" />
              <span className="min-w-0 flex-1 truncate font-semibold">
                {translate('board.agentPicker.composeTeam', 'Compose a team…')}
              </span>
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
