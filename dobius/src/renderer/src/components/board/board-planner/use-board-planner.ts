import { useCallback, useEffect, useRef, useState } from 'react'
import { useConfirmationDialog } from '@/components/confirmation-dialog'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { consoleDeliveryState } from '../board-delivery/board-delivery'
import { onMissionEvent } from '../board-delivery/mission-tracker'
import type { BoardThreadMessage } from '../board-command-bar/BoardThread'
import type { BoardConductor } from '../board-route/use-board-conductor'
import type { BoardRouteData } from '../board-route/use-board-route-data'
import {
  collectAdamBoards,
  hermesAdamTransport,
  talkToAdam,
  type AdamThreadContext
} from './adam-thread'
import { missionReport } from './mission-report'
import { concernText } from './plan-concern-text'
import { boardEffects, type BoardEffectsContext } from './plan-effects-board'
import { terminalEffects } from './plan-effects-terminal'
import { withPlanTarget } from './plan-did-you-mean'
import { executePlan } from './plan-execute'
import { PlannerBreaker } from './plan-fallback'
import { runPlanner } from './plan-run'
import { screenPlan } from './plan-safety'
import { buildPlanSnapshot } from './plan-snapshot'
import { conductorPlannerTransport } from './plan-transport'
import { validatePlan } from './plan-validate'

/**
 * Board command path: utterance -> typed plan (validated, one retry, fallback
 * parser) -> app safety screen with confirmation -> execute -> per-step results
 * in the thread. Anything that is not a board order (no plan steps, or no
 * planner to ask) is conversation, and goes to ADAM's Hermes agent.
 */
export type BoardPlannerRun = {
  run: (text: string) => Promise<void>
  /** True from submit until the planner and ADAM are both done with that message. */
  busy: boolean
}

export function useBoardPlanner(input: {
  data: BoardRouteData
  conductor: BoardConductor
  context: Omit<BoardEffectsContext, 'worktreeId' | 'workspaces' | 'confirm'>
  /** Shown in the thread header; tells ADAM which project Carson is looking at. */
  projectName: string
}): BoardPlannerRun {
  const { data, conductor, context, projectName } = input
  const { append, appendReport, appendTo, showThinkingIn } = conductor
  // Why a ref and a state: the ref refuses a second run in the same tick; the state greys the composer.
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  // Read at event time so the mission subscription isn't rebuilt on every card change.
  const consolesRef = useRef(data.consoles)
  consolesRef.current = data.consoles
  const confirm = useConfirmationDialog()
  const breaker = useRef(new PlannerBreaker())

  // Mission reports: one thread row per agent reply to a Board order.
  const worktreeId = data.worktreeId
  useEffect(
    () =>
      onMissionEvent((event) => {
        if (event.kind === 'settled') {
          append({
            role: 'system',
            text: translate('board.mission.settled', '{{count}} agent(s) finished.', {
              count: event.finished
            })
          })
          return
        }
        const m = event.mission
        if (m.worktreeId !== worktreeId) {
          return
        }
        if (event.kind === 'timeout') {
          append({
            role: 'system',
            text: translate(
              'board.mission.timeout',
              '{{name}} has not answered in 20 minutes; a later reply will still show here.',
              { name: m.name }
            )
          })
          return
        }
        if (m.late) {
          append({
            role: 'system',
            text: translate('board.mission.late', '{{name}} replied late.', { name: m.name })
          })
        }
        appendReport(missionReport(m, consolesRef.current, Date.now()))
      }),
    [append, appendReport, worktreeId]
  )

  const handle = useCallback(
    async (text: string, repoId: string | null, say: (message: NewMessage) => void) => {
      const worktreeId = data.worktreeId
      say({ role: 'user', text })
      if (!worktreeId) {
        say({
          role: 'system',
          tone: 'error',
          text: translate('board.spawn.noWorkspace', 'Open a workspace before spawning consoles.')
        })
        return
      }
      const board = buildPlanSnapshot({
        board: data.board,
        workspaces: data.workspaces,
        worktreeId,
        stateOf: consoleDeliveryState
      })
      const turns = conductor.messages.flatMap((m) =>
        !m.transient && (m.role === 'user' || m.role === 'assistant')
          ? [{ role: m.role, text: m.text }]
          : []
      )
      const askAdam = (): Promise<void> =>
        talkToAdam({
          transport: hermesAdamTransport(),
          context: adamContext(projectName, board.workspace, worktreeId),
          turns,
          utterance: text,
          append: say,
          showThinking: (label) => showThinkingIn(repoId, label)
        })
      const outcome = await runPlanner({
        transport: conductorPlannerTransport(),
        breaker: breaker.current,
        board,
        turns,
        utterance: text,
        replyLanguage: navigator.language || 'en',
        now: () => Date.now()
      })
      // Why: with no planner to ask and no built-in command matched, this is talk, not a dead end.
      if (outcome.kind === 'needs-planner') {
        await askAdam()
        return
      }
      if (outcome.kind === 'rejected') {
        say({
          role: 'system',
          tone: 'error',
          text: translate('board.plan.rejected', 'I could not make a valid plan: {{reason}}', {
            reason: outcome.reason
          })
        })
        return
      }
      let plan = outcome.kind === 'plan' ? outcome.plan : null
      // The words the safety screen treats as said; a confirmed correction counts as said.
      let said = text
      if (outcome.kind === 'did-you-mean') {
        const { from, to } = outcome.suggestion
        const ok = await confirm({
          title: translate('board.plan.didYouMeanTitle', 'Did you mean {{name}}?', { name: to }),
          description: translate(
            'board.plan.didYouMeanBody',
            'Nothing on the board is called “{{from}}”. Use {{name}} instead?',
            { from, name: to }
          ),
          confirmLabel: translate('board.plan.didYouMeanAction', 'Use {{name}}', { name: to })
        })
        if (!ok) {
          say({ role: 'system', text: translate('board.plan.notSent', 'Nothing was sent.') })
          return
        }
        const fixed = validatePlan(withPlanTarget(outcome.raw, outcome.suggestion), board)
        if (!fixed.ok) {
          say({
            role: 'system',
            tone: 'error',
            text: translate('board.plan.rejected', 'I could not make a valid plan: {{reason}}', {
              reason: fixed.reason
            })
          })
          return
        }
        plan = fixed.plan
        said = `${text} ${to}`
      }
      if (!plan) {
        return
      }
      if (plan.unsafe) {
        say({
          role: 'system',
          tone: 'error',
          text: translate(
            'board.plan.unsafe',
            'Ignored: that looked like instructions hidden inside the text.'
          )
        })
        return
      }
      // Why: a plan with nothing to do is the planner making conversation; the thread's voice is ADAM's.
      if (plan.steps.length === 0) {
        await askAdam()
        return
      }
      if (plan.say) {
        say({ role: 'assistant', text: plan.say })
      }
      if (plan.detail) {
        say({ role: 'assistant', text: plan.detail })
      }
      const concerns = screenPlan(plan, said, board)
      if (concerns.length > 0) {
        const ok = await confirm({
          title: translate('board.plan.confirmTitle', 'Go ahead with this?'),
          description: concerns.map(concernText).join('\n'),
          confirmLabel: translate('board.plan.confirmAction', 'Confirm'),
          confirmVariant: concerns.some((c) => c.kind === 'destructive') ? 'destructive' : 'default'
        })
        if (!ok) {
          say({ role: 'system', text: translate('board.plan.notSent', 'Nothing was sent.') })
          return
        }
      }
      const results = await executePlan(plan, board, {
        ...boardEffects({ ...context, worktreeId, workspaces: data.workspaces, confirm }),
        ...terminalEffects(worktreeId, confirm)
      })
      for (const r of results) {
        say({ role: 'system', ...(r.ok ? {} : { tone: 'error' as const }), text: r.text })
      }
    },
    [
      confirm,
      conductor.messages,
      context,
      data.board,
      data.workspaces,
      data.worktreeId,
      projectName,
      showThinkingIn
    ]
  )

  const run = useCallback(
    async (text: string) => {
      // Why captured here: the reply belongs to the thread it was sent from, even if Carson
      // has switched projects by the time it lands.
      const repoId = data.repoId
      const say = (message: NewMessage): void => appendTo(repoId, message)
      // Why checked before any await: two submits in one tick must not both reach ADAM,
      // who runs one Hermes turn at a time.
      if (running.current) {
        say({
          role: 'system',
          text: translate(
            'board.adam.stillThinking',
            'ADAM is still working on your last message. Wait for his reply, then send this again.'
          )
        })
        return
      }
      running.current = true
      setBusy(true)
      try {
        await handle(text, repoId, say)
      } finally {
        running.current = false
        setBusy(false)
      }
    },
    [appendTo, data.repoId, handle]
  )

  return { run, busy }
}

type NewMessage = Omit<BoardThreadMessage, 'id'>

/** What ADAM is told: the board on screen, plus every other open board across projects. */
function adamContext(projectName: string, workspace: string, worktreeId: string): AdamThreadContext {
  const state = useAppStore.getState()
  return {
    lookingAt: {
      project: projectName,
      workspace,
      folder: state.getKnownWorktreeById(worktreeId)?.path ?? null
    },
    boards: collectAdamBoards({
      boardsByWorktree: state.boardsByWorktree ?? {},
      currentWorktreeId: worktreeId,
      stateOf: consoleDeliveryState,
      worktreeOf: (id) => {
        const worktree = state.getKnownWorktreeById(id)
        if (!worktree) {
          return null
        }
        return {
          project: state.repos?.find((r) => r.id === worktree.repoId)?.displayName ?? '',
          workspace:
            id === worktreeId
              ? workspace
              : worktree.displayName.trim() || worktree.branch.replace(/^refs\/heads\//, '')
        }
      }
    })
  }
}
