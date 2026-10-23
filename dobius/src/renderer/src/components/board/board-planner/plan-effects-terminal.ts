import { closeTerminalTab } from '@/components/terminal/terminal-tab-actions'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import {
  boardDeliveryGate,
  consoleDeliveryState,
  deliverOrder
} from '../board-delivery/board-delivery'
import { latestOrder } from '../board-delivery/board-orders'
import { consoleByName, restartConsole } from '../board-delivery/console-lifecycle'
import { pauseResultText, setConsolesPaused } from '../board-delivery/pause-consoles'
import type { PlanEffects, StepResult } from './plan-execute'
import { forwardResults, handoffTask } from '../board-handoff/forward-handoff-effects'

type TerminalEffects = Pick<
  PlanEffects,
  'deliver' | 'forward' | 'handoff' | 'lifecycle' | 'cancelLatest' | 'report' | 'loop'
>

const notBuilt = (what: string): StepResult => ({
  ok: false,
  text: translate('board.plan.notBuilt', '{{what}} is not available on the Board yet.', { what })
})

function consolesNamed(worktreeId: string, names: readonly string[]) {
  return names.flatMap((n) => consoleByName(worktreeId, n) ?? [])
}

export function terminalEffects(worktreeId: string): TerminalEffects {
  return {
    deliver: async (names, text) => {
      const lanes = consolesNamed(worktreeId, names).map((c) => ({
        tabId: c.tabId,
        name: c.title,
        text
      }))
      if (lanes.length === 0) {
        return { ok: false, text: translate('board.delivery.nobody', 'No console to send to.') }
      }
      const result = await deliverOrder({ worktreeId, summary: text, lanes })
      return { ok: result.ok, text: result.text }
    },
    forward: (input) => forwardResults(worktreeId, input),
    handoff: (input) => handoffTask(worktreeId, input),
    lifecycle: async (kind, names) => {
      const consoles = consolesNamed(worktreeId, names)
      if (consoles.length === 0) {
        return {
          ok: false,
          text: translate('board.plan.noTarget', 'No matching console on the board.')
        }
      }
      if (kind === 'pause' || kind === 'resume') {
        return pauseResultText(
          await setConsolesPaused(
            consoles.map((c) => ({ tabId: c.tabId, name: c.title })),
            kind === 'pause'
          ),
          kind === 'pause'
        )
      }
      if (kind === 'kill') {
        for (const c of consoles) {
          closeTerminalTab(c.tabId)
        }
        useAppStore.getState().removeCards(
          worktreeId,
          consoles.map((c) => c.id)
        )
        return {
          ok: true,
          text: translate('board.plan.killed', 'Closed {{names}}.', {
            names: consoles.map((c) => c.title).join(', ')
          })
        }
      }
      const restarted = consoles.filter((c) => restartConsole(worktreeId, c)).map((c) => c.title)
      return restarted.length > 0
        ? {
            ok: true,
            text: translate('board.plan.restarted', 'Restarted {{names}}.', {
              names: restarted.join(', ')
            })
          }
        : {
            ok: false,
            text: translate('board.plan.restartFailed', 'Could not restart those consoles.')
          }
    },
    cancelLatest: async () => {
      const order = latestOrder(worktreeId)
      if (!order) {
        return {
          ok: false,
          text: translate('board.plan.noOrder', 'There is no recent order to cancel.')
        }
      }
      const dropped = boardDeliveryGate().cancelOrder(order.id)
      const already = order.lanes.filter((l) => l.outcome?.kind === 'sent').map((l) => l.name)
      // Why: lanes that already got it keep working; cancel never types "stop".
      return {
        ok: true,
        text:
          already.length > 0
            ? translate(
                'board.plan.cancelledSome',
                'Dropped {{dropped}} untyped message(s). {{names}} already have it and keep working.',
                {
                  dropped,
                  names: already.join(', ')
                }
              )
            : translate('board.plan.cancelledAll', 'Dropped {{dropped}} untyped message(s).', {
                dropped
              })
      }
    },
    report: async (kind) => {
      if (kind === 'report') {
        const order = latestOrder(worktreeId)
        if (!order) {
          return {
            ok: false,
            text: translate('board.plan.noOrderReport', 'There is no recent order to report on.')
          }
        }
        // Lane by lane: whether it was typed, and what the console is doing now.
        const lines = order.lanes.map((l) => {
          const typed = l.outcome?.kind === 'sent'
          return translate('board.plan.reportLane', '{{name}}: {{delivery}}, now {{state}}', {
            name: l.name,
            delivery: typed
              ? translate('board.plan.got', 'got it')
              : translate('board.plan.notTyped', 'not typed'),
            state: consoleDeliveryState(l.tabId)
          })
        })
        return { ok: true, text: lines.join(' · ') }
      }
      const consoles = (useAppStore.getState().boardsByWorktree[worktreeId]?.cards ?? []).flatMap(
        (c) => (c.kind === 'console' ? [c] : [])
      )
      return consoles.length === 0
        ? { ok: true, text: translate('board.plan.noConsoles', 'No consoles on the board.') }
        : {
            ok: true,
            text: consoles.map((c) => `${c.title}: ${consoleDeliveryState(c.tabId)}`).join(' · ')
          }
    },
    loop: async () => notBuilt(translate('board.plan.loopFromPlanner', 'Creating a loop by voice'))
  }
}
