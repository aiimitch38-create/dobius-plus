import { translate } from '@/i18n/i18n'
import type { BoardState } from '@/store/slices/board'
import type {
  AutomationLoopTarget,
  AutomationLoopTrigger
} from '../../../../../shared/automations-types'
import {
  LOOP_MIN_CHECK_EVERY_MS,
  LOOP_MIN_COOLDOWN_MS,
  LOOP_MIN_DEBOUNCE_MS,
  LOOP_MAX_RUNS_LIMIT,
  LOOP_MAX_SCHEDULE_MS,
  LOOP_MIN_SCHEDULE_MS,
  validateLoopPattern
} from '../../../../../shared/automation-loops'

export type LoopKind = AutomationLoopTrigger['kind']

/** How the "When a goal is met" stop decides: a Board goal card's checklist, a
 *  command that passes, or a separate read-only agent judging a written goal. */
export type LoopStopGoalMode = 'card' | 'command' | 'judge'

export type LoopFormValues = {
  name: string
  instruction: string
  kind: LoopKind
  /** `tab:<tabId>`, `group:<groupId>`, `orchestrator:<cardId>`, BOARD_TARGET_KEY
   *  for every console, or PICKED_TARGET_KEY for the consoles in `pickedTabIds`. */
  targetKey: string
  /** "Pick consoles": the chosen console tab ids. */
  pickedTabIds: string[]
  debounceSec: number
  pattern: string
  cooldownSec: number
  goal: string
  checkEverySec: number
  maxRuns: number
  /** Schedule loops: minutes between runs. */
  everyMin: number
  /** Time-limit stop in minutes; 0 = no time limit. */
  stopAfterMin: number
  /** Run-count stop (schedule, idle, output match); 0 = no cap. */
  stopAfterRuns: number
  /** Stop once this command exits 0 in the loop's worktree; '' = none. */
  stopCommand: string
  /** Goal loops: a separate read-only judge session decides, or the console reports. */
  judge: 'agent' | 'self'
  /** Keep firing while the Board is not the visible view. */
  background: boolean
  /** "When a goal is met" stop toggle and which of its modes is in use. */
  stopGoalOn: boolean
  stopGoalMode: LoopStopGoalMode
  /** Board goal card whose completed checklist retires the loop; '' = none. */
  stopGoalCardId: string
}

export const DEFAULT_LOOP_FORM: LoopFormValues = {
  name: '',
  instruction: '',
  kind: 'on-idle',
  targetKey: '',
  pickedTabIds: [],
  debounceSec: 5,
  pattern: '',
  cooldownSec: 60,
  goal: '',
  checkEverySec: 120,
  maxRuns: 5,
  everyMin: 15,
  stopAfterMin: 0,
  stopAfterRuns: 0,
  stopCommand: '',
  judge: 'agent',
  background: true,
  stopGoalOn: false,
  stopGoalMode: 'card',
  stopGoalCardId: ''
}

export const BOARD_TARGET_KEY = 'board:all'
export const PICKED_TARGET_KEY = 'tabs:picked'
/** Run cap used when an agent-judged goal has no explicit "after N runs" stop. */
export const JUDGED_GOAL_DEFAULT_MAX_RUNS = LOOP_MAX_RUNS_LIMIT

export function parseTargetKey(key: string): AutomationLoopTarget | null {
  if (key === BOARD_TARGET_KEY) {
    return { type: 'board' }
  }
  const [type, ...rest] = key.split(':')
  const id = rest.join(':')
  if (!id) {
    return null
  }
  return type === 'tab'
    ? { type: 'tab', tabId: id }
    : type === 'group'
      ? { type: 'group', groupId: id }
      : type === 'orchestrator'
        ? { type: 'orchestrator', cardId: id }
        : null
}

/** The form's target: picked consoles collapse to one `tab` when only one is chosen. */
export function formTarget(
  form: Pick<LoopFormValues, 'targetKey' | 'pickedTabIds'>
): AutomationLoopTarget | null {
  if (form.targetKey !== PICKED_TARGET_KEY) {
    return parseTargetKey(form.targetKey)
  }
  const tabIds = [...new Set(form.pickedTabIds)]
  if (tabIds.length === 0) {
    return null
  }
  return tabIds.length === 1 ? { type: 'tab', tabId: tabIds[0] } : { type: 'tabs', tabIds }
}

/** True when the form saves as an agent-judged goal loop (schedule + "an agent judges"). */
export function isJudgedGoalForm(
  form: Pick<LoopFormValues, 'kind' | 'stopGoalOn' | 'stopGoalMode'>
): boolean {
  return form.kind === 'schedule' && form.stopGoalOn && form.stopGoalMode === 'judge'
}

export type LoopFormResult =
  | { ok: true; trigger: AutomationLoopTrigger }
  | { ok: false; error: string }

export function buildLoopTrigger(form: LoopFormValues): LoopFormResult {
  const target = formTarget(form)
  if (!target) {
    return {
      ok: false,
      error:
        form.targetKey === PICKED_TARGET_KEY
          ? translate('board.loops.error.pickOne', 'Pick at least one console.')
          : translate('board.loops.error.target', 'Pick a console or group.')
    }
  }
  if (form.stopGoalOn && form.stopGoalMode === 'judge') {
    if (form.kind !== 'schedule') {
      return {
        ok: false,
        error: translate(
          'board.loops.error.judgeNeedsSchedule',
          'An agent-judged goal needs "On a schedule": the judge checks after each run.'
        )
      }
    }
    if (!form.goal.trim()) {
      return { ok: false, error: translate('board.loops.error.goal', 'Describe the goal.') }
    }
    const runs = Math.round(form.stopAfterRuns)
    return {
      ok: true,
      trigger: {
        kind: 'goal',
        target,
        goal: form.goal.trim(),
        checkEveryMs: Math.max(LOOP_MIN_CHECK_EVERY_MS, Math.round(form.everyMin) * 60_000),
        maxRuns: Math.min(
          LOOP_MAX_RUNS_LIMIT,
          Number.isFinite(runs) && runs > 0 ? runs : JUDGED_GOAL_DEFAULT_MAX_RUNS
        ),
        judge: 'agent'
      }
    }
  }
  if (form.kind === 'on-idle') {
    if (!form.instruction.trim()) {
      return {
        ok: false,
        error: translate('board.loops.error.instruction', 'Write what to tell the console.')
      }
    }
    return {
      ok: true,
      trigger: {
        kind: 'on-idle',
        target,
        debounceMs: Math.max(LOOP_MIN_DEBOUNCE_MS, form.debounceSec * 1000)
      }
    }
  }
  if (form.kind === 'schedule') {
    if (!form.instruction.trim()) {
      return {
        ok: false,
        error: translate('board.loops.error.instruction', 'Write what to tell the console.')
      }
    }
    return {
      ok: true,
      trigger: {
        kind: 'schedule',
        target,
        everyMs: Math.min(
          LOOP_MAX_SCHEDULE_MS,
          Math.max(LOOP_MIN_SCHEDULE_MS, Math.round(form.everyMin) * 60_000)
        )
      }
    }
  }
  if (form.kind === 'on-output-match') {
    if (!form.instruction.trim()) {
      return {
        ok: false,
        error: translate('board.loops.error.instruction', 'Write what to tell the console.')
      }
    }
    const validated = validateLoopPattern(form.pattern)
    if (!validated.ok) {
      return {
        ok: false,
        error:
          validated.error === 'too_long'
            ? translate('board.loops.error.patternLong', 'Pattern is longer than 200 characters.')
            : validated.error === 'unsafe'
              ? translate(
                  'board.loops.error.patternUnsafe',
                  'This pattern could freeze the app (repeated groups or backreferences). Simplify it.'
                )
              : translate(
                  'board.loops.error.pattern',
                  'Enter a valid pattern (regular expression).'
                )
      }
    }
    return {
      ok: true,
      trigger: {
        kind: 'on-output-match',
        target,
        pattern: form.pattern,
        cooldownMs: Math.max(LOOP_MIN_COOLDOWN_MS, form.cooldownSec * 1000)
      }
    }
  }
  if (!form.goal.trim()) {
    return { ok: false, error: translate('board.loops.error.goal', 'Describe the goal.') }
  }
  return {
    ok: true,
    trigger: {
      kind: 'goal',
      target,
      goal: form.goal.trim(),
      checkEveryMs: Math.max(LOOP_MIN_CHECK_EVERY_MS, form.checkEverySec * 1000),
      maxRuns: Math.min(LOOP_MAX_RUNS_LIMIT, Math.max(1, Math.round(form.maxRuns))),
      judge: form.judge
    }
  }
}

/** Console tab ids a target addresses on this board. */
export function loopTargetTabIds(target: AutomationLoopTarget, board: BoardState): string[] {
  if (target.type === 'tab') {
    return [target.tabId]
  }
  if (target.type === 'tabs') {
    const onBoard = new Set(board.cards.flatMap((c) => (c.kind === 'console' ? [c.tabId] : [])))
    return target.tabIds.filter((tabId) => onBoard.has(tabId))
  }
  if (target.type === 'board') {
    return board.cards.flatMap((c) => (c.kind === 'console' ? [c.tabId] : []))
  }
  if (target.type === 'orchestrator') {
    const orchestrator = board.cards.find((c) => c.id === target.cardId)
    const wired = new Set(orchestrator?.kind === 'orchestrator' ? orchestrator.wiredCardIds : [])
    return board.cards.flatMap((c) => (c.kind === 'console' && wired.has(c.id) ? [c.tabId] : []))
  }
  const group = board.groups.find((g) => g.id === target.groupId)
  const members = new Set(group?.cardIds ?? [])
  return board.cards.flatMap((c) => (c.kind === 'console' && members.has(c.id) ? [c.tabId] : []))
}

/** True when any pane of any target tab reports fresh "working". */
export function targetIsWorking(
  statusByPaneKey: Readonly<Record<string, { state: string; updatedAt: number }>>,
  tabIds: readonly string[],
  now: number,
  staleAfterMs: number
): boolean {
  const prefixes = tabIds.map((id) => `${id}:`)
  return Object.entries(statusByPaneKey).some(
    ([paneKey, entry]) =>
      entry.state === 'working' &&
      now - entry.updatedAt <= staleAfterMs &&
      prefixes.some((p) => paneKey.startsWith(p))
  )
}

export { describeNextFire } from './loop-next-fire'
export { loopStopAfterMs, loopStopFields, type LoopStopFields } from './loop-form-stop'
