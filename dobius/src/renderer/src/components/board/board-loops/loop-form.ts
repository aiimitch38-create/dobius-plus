import { translate } from '@/i18n/i18n'
import type { BoardState } from '@/store/slices/board'
import type {
  AutomationLoop,
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

export type LoopFormValues = {
  name: string
  instruction: string
  kind: LoopKind
  /** `tab:<tabId>`, `group:<groupId>`, or BOARD_TARGET_KEY for every console */
  targetKey: string
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
}

export const DEFAULT_LOOP_FORM: LoopFormValues = {
  name: '',
  instruction: '',
  kind: 'on-idle',
  targetKey: '',
  debounceSec: 5,
  pattern: '',
  cooldownSec: 60,
  goal: '',
  checkEverySec: 120,
  maxRuns: 5,
  everyMin: 15,
  stopAfterMin: 0
}

export const BOARD_TARGET_KEY = 'board:all'

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

export type LoopFormResult =
  | { ok: true; trigger: AutomationLoopTrigger }
  | { ok: false; error: string }

export function buildLoopTrigger(form: LoopFormValues): LoopFormResult {
  const target = parseTargetKey(form.targetKey)
  if (!target) {
    return { ok: false, error: translate('board.loops.error.target', 'Pick a console or group.') }
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
    if (target.type !== 'tab') {
      return {
        ok: false,
        error: translate('board.loops.error.matchTab', 'Output match watches one console.')
      }
    }
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
        tabId: target.tabId,
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
      maxRuns: Math.min(LOOP_MAX_RUNS_LIMIT, Math.max(1, Math.round(form.maxRuns)))
    }
  }
}

/** Console tab ids a target addresses on this board. */
export function loopTargetTabIds(target: AutomationLoopTarget, board: BoardState): string[] {
  if (target.type === 'tab') {
    return [target.tabId]
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

/** One line for the panel: when the loop fires next, or why it won't. */
export function describeNextFire(loop: AutomationLoop, enabled: boolean, now: number): string {
  const { state, trigger } = loop
  if (state.retiredAt !== null) {
    return translate('board.loops.next.retired', 'Finished')
  }
  if (state.paused || !enabled) {
    return translate('board.loops.next.paused', 'Paused')
  }
  if (trigger.kind === 'on-idle') {
    return translate('board.loops.next.idle', 'When the target goes idle')
  }
  if (trigger.kind === 'on-output-match') {
    return translate('board.loops.next.match', 'When output matches /{{pattern}}/', {
      pattern: trigger.pattern
    })
  }
  if (trigger.kind === 'schedule') {
    const minutes = Math.max(
      0,
      Math.ceil(((state.lastFiredAt ?? now) + trigger.everyMs - now) / 60_000)
    )
    return state.lastFiredAt === null
      ? translate('board.loops.next.scheduleStart', 'Every {{every}} min', {
          every: Math.round(trigger.everyMs / 60_000)
        })
      : translate('board.loops.next.schedule', 'Next run in {{minutes}} min', { minutes })
  }
  if (state.runCount === 0) {
    return translate('board.loops.next.goalStart', 'Starts on the next check')
  }
  const dueIn = Math.max(
    0,
    Math.round(((state.lastFiredAt ?? now) + trigger.checkEveryMs - now) / 1000)
  )
  return translate('board.loops.next.goal', 'Check in {{seconds}}s · run {{runs}} of {{max}}', {
    seconds: dueIn,
    runs: state.runCount,
    max: trigger.maxRuns
  })
}

/** Time-limit stop for the saved loop, or undefined for "no limit". */
export function loopStopAfterMs(form: Pick<LoopFormValues, 'stopAfterMin'>): number | undefined {
  const minutes = Math.round(form.stopAfterMin)
  return Number.isFinite(minutes) && minutes > 0 ? Math.max(1, minutes) * 60_000 : undefined
}
