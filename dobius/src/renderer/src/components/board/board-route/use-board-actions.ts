import { useCallback } from 'react'
import { toast } from 'sonner'
import { useConfirmationDialog } from '@/components/confirmation-dialog'
import { closeTerminalTab } from '@/components/terminal/terminal-tab-actions'
import { translate } from '@/i18n/i18n'
import { getAgentLabel } from '@/lib/agent-catalog'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { pauseResultText, setConsolesPaused } from '../board-delivery/pause-consoles'
import { useAppStore } from '@/store'
import type { TuiAgent } from '../../../../../shared/types'
import { boardSpawnPlacements, BOARD_CONSOLE_SIZE } from '../board-canvas/board-spawn-placement'
import type { BoardPoint } from '../board-canvas/board-viewport'
import type { BoardInsertKind } from '../board-chrome/board-tools'
import type { BoardChipId } from '../board-command-bar/board-command-chips'
import type { BoardStudioId } from '../board-studios/board-studio-ids'
import { awaitMirroredConsoleTabs } from './board-await-mirrored-tabs'
import { groupBoardCards } from './board-groupable'
import { boardInsertCard, boardInsertCardSize } from './board-insert-cards'
import { boardCardsWithClosedTabs } from './board-kill-targets'
import type { BoardConductor } from './use-board-conductor'
import type { BoardRouteData } from './use-board-route-data'

const KILL_CONFIRM_THRESHOLD = 4
// How long Kill all keeps watching pinned tabs still waiting on their own confirm.
const PINNED_CLOSE_WAIT_MS = 2 * 60 * 1000

type BoardActionsInput = {
  data: BoardRouteData
  selectedIds: ReadonlySet<string>
  conductor: BoardConductor
  openStudio: (studio: BoardStudioId) => void
  openPicker: (count: number, anchor?: DOMRect) => void
  /** A free spot in view (clear of cards and the thread) for a block of this size. */
  freeCenter: (size: { w: number; h: number }) => BoardPoint
}

export type BoardActions = {
  /** `group`: frame the new consoles as one group (canvas menu "Spawn group"). */
  spawn: (agent: TuiAgent, count: number, center: BoardPoint, group?: boolean) => void
  onChip: (id: BoardChipId, anchor?: DOMRect) => void
  onInsert: (kind: BoardInsertKind) => void
}

export function useBoardActions({
  data,
  selectedIds,
  conductor,
  openStudio,
  openPicker,
  freeCenter
}: BoardActionsInput): BoardActions {
  const confirm = useConfirmationDialog()
  const { worktreeId, consoles } = data
  const { append } = conductor

  const spawn = useCallback(
    (agent: TuiAgent, count: number, center: BoardPoint, group = false) => {
      if (!worktreeId) {
        toast.error(
          translate('board.spawn.noWorkspace', 'Open a workspace before spawning consoles.')
        )
        return
      }
      const label = getAgentLabel(agent)
      const existing = consoles.filter((c) => c.agentKind === agent).length
      const knownBefore = new Set(
        (useAppStore.getState().tabsByWorktree[worktreeId] ?? []).map((t) => t.id)
      )
      const awaiting: Parameters<typeof awaitMirroredConsoleTabs>[0]['pending'] = []
      let failed = 0
      const added = new Set<string>()
      boardSpawnPlacements(center, count).forEach((position, index) => {
        const result = launchAgentInNewTab({ agent, worktreeId, launchSource: 'unknown' })
        if (!result) {
          failed += 1
          return
        }
        const card = {
          kind: 'console' as const,
          ...position,
          ...BOARD_CONSOLE_SIZE,
          title: `${label} ${existing + index + 1}`,
          agentKind: agent
        }
        // Why: host-backed launches return no tab id yet; the card is placed
        // once the host's mirrored tab arrives (CONSOLE-EMBED "await mirrored tabs").
        if (result.tabId) {
          added.add(useAppStore.getState().addCard(worktreeId, { ...card, tabId: result.tabId }))
        } else {
          awaiting.push(card)
        }
      })
      const reportFailed = (n: number): void => {
        toast.error(
          translate('board.spawn.partial', '{{failed}} of {{count}} consoles did not start.', {
            failed: n,
            count
          })
        )
      }
      if (failed > 0) {
        reportFailed(failed)
      }
      // ponytail: host-backed consoles (no tab id yet) join no group; add them when
      // awaitMirroredConsoleTabs reports the ids it binds.
      if (group) {
        groupBoardCards(worktreeId, added)
      }
      if (awaiting.length > 0) {
        awaitMirroredConsoleTabs({
          worktreeId,
          agent,
          knownBefore,
          pending: awaiting,
          onUnbound: reportFailed
        })
      }
    },
    [consoles, worktreeId]
  )

  const killAll = useCallback(async () => {
    if (!worktreeId || consoles.length === 0) {
      return
    }
    if (consoles.length >= KILL_CONFIRM_THRESHOLD) {
      const ok = await confirm({
        title: translate('board.killAll.title', 'Close {{count}} consoles?', {
          count: consoles.length
        }),
        description: translate(
          'board.killAll.description',
          'Stops every console on this board. Terminals in other workspaces are not touched.'
        ),
        confirmLabel: translate('board.killAll.confirm', 'Close all'),
        confirmVariant: 'destructive'
      })
      if (!ok) {
        return
      }
    }
    // Snapshot first: closing tabs changes the store mid-loop.
    const targets = consoles.map((c) => ({ cardId: c.id, tabId: c.tabId }))
    for (const target of targets) {
      closeTerminalTab(target.tabId)
    }
    // Why: a pinned tab asks for its own confirmation and may be kept, so a card
    // is removed only once its terminal is really gone — never leave a live
    // terminal without its card.
    const sweep = (): boolean => {
      const state = useAppStore.getState()
      const closed = boardCardsWithClosedTabs(targets, state.tabsByWorktree)
      state.removeCards(worktreeId, closed)
      return closed.length === targets.length
    }
    if (sweep()) {
      return
    }
    const unsubscribe = useAppStore.subscribe((state, prev) => {
      if (state.tabsByWorktree !== prev.tabsByWorktree && sweep()) {
        stop()
      }
    })
    const timer = setTimeout(() => stop(), PINNED_CLOSE_WAIT_MS)
    const stop = (): void => {
      unsubscribe()
      clearTimeout(timer)
    }
  }, [confirm, consoles, worktreeId])

  const setPaused = useCallback(
    async (paused: boolean) => {
      try {
        // Why: "Pause all" means the running agents on this board (Carson's
        // call), plus the crew gate so no autonomous run starts meanwhile.
        const result = await setConsolesPaused(
          consoles.map((c) => ({ tabId: c.tabId, name: c.title })),
          paused
        )
        await window.api.agents.setPaused(paused)
        const summary = pauseResultText(result, paused)
        append({ role: 'system', tone: summary.ok ? undefined : 'error', text: summary.text })
      } catch (error) {
        append({
          role: 'system',
          tone: 'error',
          text: error instanceof Error ? error.message : String(error)
        })
      }
    },
    [append, consoles]
  )

  const group = useCallback(() => {
    // Why: a group of one is just a card; frames work for any card kind, so any
    // two or more selected cards group (consoles and notes alike).
    if (!worktreeId || !groupBoardCards(worktreeId, selectedIds)) {
      toast.message(translate('board.group.needTwoCards', 'Select at least two cards to group.'))
    }
  }, [selectedIds, worktreeId])

  const onChip = useCallback(
    (id: BoardChipId, anchor?: DOMRect) => {
      switch (id) {
        case 'new-console':
          return openPicker(1, anchor)
        case 'spawn-4':
          return openPicker(4, anchor)
        case 'group':
          return group()
        case 'presets':
          return openStudio('presets')
        case 'pause-all':
          return void setPaused(true)
        case 'resume-all':
          return void setPaused(false)
        case 'kill-all':
          return void killAll()
        case 'memory':
        case 'loops':
        case 'docs':
        case 'code':
        case 'skills':
          return openStudio(id)
        case 'mission-map':
          return openStudio('mission-map')
      }
    },
    [group, killAll, openPicker, openStudio, setPaused]
  )

  const onInsert = useCallback(
    (kind: BoardInsertKind) => {
      switch (kind) {
        case 'code':
          return openStudio('code')
        case 'docs':
          // The rail item is "Markdown docs"; Documents (PDF etc.) is the Docs chip.
          return openStudio('markdown')
        case 'generate-doc':
          return openStudio('generate-doc')
        case 'loops':
          return openStudio('loops')
        case 'presets':
          return openStudio('presets')
        case 'todo':
        case 'kanban':
        case 'calendar':
        case 'orchestrator': {
          if (!worktreeId) {
            return
          }
          useAppStore
            .getState()
            .addCard(worktreeId, boardInsertCard(kind, freeCenter(boardInsertCardSize(kind))))
        }
      }
    },
    [freeCenter, openStudio, worktreeId]
  )

  return { spawn, onChip, onInsert }
}
