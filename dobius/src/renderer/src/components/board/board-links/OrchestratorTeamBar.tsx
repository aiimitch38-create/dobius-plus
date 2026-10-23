import React, { useState } from 'react'
import { Cable, Check, Plus, Users } from 'lucide-react'
import { VoiceOrb } from '@/components/dictation/VoiceOrb'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useDetectedAgents } from '@/hooks/useDetectedAgents'
import { translate } from '@/i18n/i18n'
import { getAgentLabel } from '@/lib/agent-catalog'
import { getConnectionId } from '@/lib/connection-context'
import { useAppStore } from '@/store'
import { getBoard, type BoardCardOf, type BoardCardPatch } from '@/store/slices/board'
import { filterEnabledTuiAgents } from '../../../../../shared/tui-agent-selection'
import type { TuiAgent } from '../../../../../shared/types'
import { useBoardLinkMode } from './board-link-mode'
import {
  MAX_TEAM_SIZE,
  nextTeamAgent,
  spawnWiredConsoles,
  teamGrowth,
  wiredConsoleCount
} from './orchestrator-team'

const CHIP =
  'flex h-7 items-center gap-1 rounded-full border border-[var(--board-panel-border)] px-2.5 text-[12px] font-medium text-[var(--board-text)] hover:bg-[var(--board-panel-2)] disabled:opacity-40'

function useTeamAgentOptions(worktreeId: string): TuiAgent[] {
  const defaultAgent = useAppStore((s) => s.settings?.defaultTuiAgent)
  const disabledAgents = useAppStore((s) => s.settings?.disabledTuiAgents)
  const { detectedIds } = useDetectedAgents(getConnectionId(worktreeId) ?? undefined)
  const enabled = filterEnabledTuiAgents(detectedIds ?? [], disabledAgents)
  const preferred = defaultAgent && defaultAgent !== 'blank' ? defaultAgent : null
  return preferred && enabled.includes(preferred)
    ? [preferred, ...enabled.filter((a) => a !== preferred)]
    : enabled
}

/** The agent this card's + / grow / Spawn agent launch, and the choices to cycle through. */
export function useTeamAgent(
  worktreeId: string,
  card: BoardCardOf<'orchestrator'>
): { agent: TuiAgent | undefined; options: TuiAgent[] } {
  const options = useTeamAgentOptions(worktreeId)
  const agent = (
    card.teamAgent && options.includes(card.teamAgent as TuiAgent) ? card.teamAgent : options[0]
  ) as TuiAgent | undefined
  return { agent, options }
}

function useConnecting(cardId: string): boolean {
  return useBoardLinkMode((s) => s.mode?.kind === 'wire' && s.mode.orchestratorId === cardId)
}

function toggleConnect(worktreeId: string, cardId: string, connecting: boolean): void {
  if (connecting) {
    useBoardLinkMode.getState().stop()
  } else {
    useBoardLinkMode.getState().start({ kind: 'wire', worktreeId, orchestratorId: cardId })
  }
}

/**
 * Sub-header: wiring status (the "wire them here" picker), team agent, round +
 * (spawn a wired console) and the Connect pill; a grow row once a team exists.
 */
export function OrchestratorTeamBar({
  worktreeId,
  card,
  onChange,
  status
}: {
  worktreeId: string
  card: BoardCardOf<'orchestrator'>
  onChange: (patch: BoardCardPatch) => void
  status: React.ReactNode
}): React.JSX.Element {
  const connecting = useConnecting(card.id)
  const teamSize = useAppStore((s) => wiredConsoleCount(getBoard(s, worktreeId), card))
  const { agent, options } = useTeamAgent(worktreeId, card)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [target, setTarget] = useState(String(Math.min(MAX_TEAM_SIZE, teamSize + 2)))
  const growBy = teamGrowth(teamSize, Number(target))
  const spawnLabel = translate(
    'board.orchestrator.spawnWired',
    'Spawn an agent wired to this orchestrator'
  )

  return (
    <div className="border-b border-[var(--board-panel-border)] px-3 py-2">
      <div className="flex items-center gap-1.5">
        <div className="min-w-0 flex-1">{status}</div>
        <DropdownMenu open={catalogOpen} onOpenChange={setCatalogOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={!agent}
              title={translate(
                'board.orchestrator.agentHint',
                'Click to switch the team’s agent. Right-click for the full list.'
              )}
              // Why: left click cycles (fast path); the menu opens on right-click or the keyboard.
              onPointerDown={(e) => e.button === 0 && e.preventDefault()}
              onClick={(e) => {
                e.preventDefault()
                onChange({ teamAgent: nextTeamAgent(options, agent) })
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setCatalogOpen(true)
              }}
              className="h-7 max-w-28 truncate rounded-full px-2 text-[12px] text-[var(--board-text-muted)] hover:bg-[var(--board-panel-2)] hover:text-[var(--board-text)] disabled:opacity-40"
            >
              {agent
                ? getAgentLabel(agent)
                : translate('board.orchestrator.noAgents', 'No agents found')}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={4}>
            {options.map((option) => (
              <DropdownMenuItem key={option} onSelect={() => onChange({ teamAgent: option })}>
                {getAgentLabel(option)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          disabled={!agent}
          aria-label={spawnLabel}
          title={spawnLabel}
          onClick={() => agent && spawnWiredConsoles(worktreeId, card.id, agent, 1)}
          className="flex size-7 items-center justify-center rounded-full border border-[var(--board-panel-border)] text-[var(--board-text)] hover:bg-[var(--board-panel-2)] disabled:opacity-40"
        >
          <Plus className="size-3.5" />
        </button>
        <button
          type="button"
          aria-pressed={connecting}
          onClick={() => toggleConnect(worktreeId, card.id, connecting)}
          className={
            connecting
              ? 'flex h-7 items-center gap-1 rounded-full bg-[var(--board-accent)] px-2.5 text-[12px] font-semibold text-[var(--board-accent-fg)]'
              : 'flex h-7 items-center gap-1 rounded-full border border-[var(--board-accent)] bg-[var(--board-accent-tint)] px-2.5 text-[12px] font-semibold text-[var(--board-accent)] hover:opacity-90'
          }
        >
          {connecting ? <Check className="size-3.5" /> : <Cable className="size-3.5" />}
          {connecting
            ? translate('board.orchestrator.done', 'Done')
            : translate('board.orchestrator.connect', 'Connect')}
        </button>
      </div>
      {teamSize > 0 ? (
        <div className="mt-1.5 flex items-center justify-end gap-1.5 text-[12px] text-[var(--board-text-muted)]">
          <Users className="size-3.5" />
          {translate('board.orchestrator.growTo', 'Grow the team to')}
          <input
            type="number"
            min={1}
            max={MAX_TEAM_SIZE}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            aria-label={translate('board.orchestrator.teamSize', 'Team size')}
            className="h-6 w-11 rounded-full border border-[var(--board-panel-border)] bg-transparent px-2 text-center text-[12px] text-[var(--board-text)] outline-none"
          />
          <button
            type="button"
            disabled={!agent || growBy === 0}
            onClick={() => agent && spawnWiredConsoles(worktreeId, card.id, agent, growBy)}
            className={CHIP}
          >
            {translate('board.orchestrator.grow', 'Grow')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

const silentLevel = (): number => 0

/** Empty thread: our orb, what to do next, and a direct "Spawn agent". */
export function OrchestratorEmptyState({
  worktreeId,
  card
}: {
  worktreeId: string
  card: BoardCardOf<'orchestrator'>
}): React.JSX.Element {
  const connecting = useConnecting(card.id)
  const teamSize = useAppStore((s) => wiredConsoleCount(getBoard(s, worktreeId), card))
  const { agent } = useTeamAgent(worktreeId, card)
  const title = connecting
    ? translate('board.orchestrator.connectingTitle', 'Pick consoles to wire')
    : teamSize === 0
      ? translate('board.orchestrator.noneWiredTitle', 'No agents wired')
      : translate('board.orchestrator.readyTitle', 'Ready')
  const help = connecting
    ? translate(
        'board.orchestrator.connectHint',
        'Click consoles or group names on the board, or wire them from the list above. Tap Done when finished.'
      )
    : teamSize === 0
      ? translate(
          'board.orchestrator.emptyUnwired',
          'Spawn a fresh lane below, or tap Connect and pick consoles or groups on the board.'
        )
      : translate(
          'board.orchestrator.emptyWired',
          'Type below to tell every wired console, or start with @Name to tell one.'
        )
  return (
    <div className="m-auto flex max-w-72 flex-col items-center gap-2 text-center">
      {/* Why: blend rule; Dobius's VoiceOrb stands in for the reference's orb. Idle level. */}
      <VoiceOrb size={36} getLevel={silentLevel} />
      <div className="text-[13px] font-semibold text-[var(--board-text)]">{title}</div>
      <div className="text-[12px] text-[var(--board-text-muted)]">{help}</div>
      {!connecting && teamSize === 0 ? (
        <button
          type="button"
          disabled={!agent}
          onClick={() => agent && spawnWiredConsoles(worktreeId, card.id, agent, 1)}
          className="mt-1 flex h-8 items-center gap-1 rounded-full border border-[var(--board-accent)] px-3 text-[12px] font-semibold text-[var(--board-accent)] hover:bg-[var(--board-accent-tint)] disabled:opacity-40"
        >
          <Plus className="size-3.5" />
          {translate('board.orchestrator.spawnAgent', 'Spawn agent')}
        </button>
      ) : null}
    </div>
  )
}
