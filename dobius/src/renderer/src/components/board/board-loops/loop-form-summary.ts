import { translate } from '@/i18n/i18n'
import type { BoardState } from '@/store/slices/board'
import {
  BOARD_TARGET_KEY,
  PICKED_TARGET_KEY,
  formTarget,
  isJudgedGoalForm,
  loopTargetTabIds,
  parseTargetKey,
  type LoopFormValues
} from './loop-form'

// The plain-English lines of the loop form: the accent summary in the sticky
// footer ("Every 15 min, the instruction is sent to every console on the
// board.") and the muted stop summary. Pure, so the sentences are testable.

/** What the form's target reaches right now, in words the summary can use. */
export type LoopTargetSummary =
  | { kind: 'board'; count: number }
  | { kind: 'orchestrator'; name: string; count: number }
  | { kind: 'group'; name: string; count: number }
  | { kind: 'picked'; count: number; title: string | null }
  | { kind: 'none' }

export function describeFormTarget(
  form: Pick<LoopFormValues, 'targetKey' | 'pickedTabIds'>,
  board: Pick<BoardState, 'cards' | 'groups'>
): LoopTargetSummary {
  const target = formTarget(form)
  if (!target) {
    return { kind: 'none' }
  }
  const count = loopTargetTabIds(target, board as BoardState).length
  if (form.targetKey === BOARD_TARGET_KEY) {
    return { kind: 'board', count }
  }
  if (target.type === 'orchestrator') {
    const card = board.cards.find((c) => c.id === target.cardId)
    return { kind: 'orchestrator', name: card?.kind === 'orchestrator' ? card.name : '', count }
  }
  if (target.type === 'group') {
    const group = board.groups.find((g) => g.id === target.groupId)
    return { kind: 'group', name: group?.name ?? '', count }
  }
  const tabId =
    target.type === 'tab' ? target.tabId : target.type === 'tabs' ? target.tabIds[0] : null
  const card = board.cards.find((c) => c.kind === 'console' && c.tabId === tabId)
  return { kind: 'picked', count, title: count === 1 && card ? card.title : null }
}

/** "15 min", "1 h", "1 h 30 min". */
export function formatInterval(minutes: number): string {
  const total = Math.max(1, Math.round(minutes))
  const hours = Math.floor(total / 60)
  const rest = total % 60
  if (hours === 0) {
    return translate('board.loops.interval.min', '{{count}} min', { count: rest })
  }
  if (rest === 0) {
    return translate('board.loops.interval.hours', '{{count}} h', { count: hours })
  }
  return translate('board.loops.interval.hoursMin', '{{hours}} h {{minutes}} min', {
    hours,
    minutes: rest
  })
}

/** The target as the object of "sent to …". */
function targetPhrase(target: LoopTargetSummary): string {
  switch (target.kind) {
    case 'board':
      return translate('board.loops.summary.target.board', 'every console on the board')
    case 'orchestrator':
      return translate(
        'board.loops.summary.target.orchestrator',
        'every console wired to {{name}}',
        {
          name: target.name
        }
      )
    case 'group':
      return translate('board.loops.summary.target.group', 'every console in @{{name}}', {
        name: target.name
      })
    case 'picked':
      return (
        target.title ??
        translate('board.loops.summary.target.picked', '{{count}} picked consoles', {
          count: target.count
        })
      )
    case 'none':
      return translate('board.loops.summary.target.none', 'the consoles you pick')
  }
}

/** One accent sentence for the footer: when it fires and who gets it. */
export function loopSummarySentence(
  form: Pick<
    LoopFormValues,
    'kind' | 'everyMin' | 'pattern' | 'stopGoalOn' | 'stopGoalMode' | 'targetKey' | 'pickedTabIds'
  >,
  target: LoopTargetSummary
): string {
  const who = targetPhrase(target)
  const single = target.kind === 'picked' && target.count === 1
  if (isJudgedGoalForm(form)) {
    return translate(
      'board.loops.summary.judged',
      'Every {{interval}}, the instruction is sent to {{target}} until a separate agent judges the goal met.',
      { interval: formatInterval(form.everyMin), target: who }
    )
  }
  if (form.kind === 'schedule' || form.kind === 'goal') {
    return translate(
      'board.loops.summary.schedule',
      'Every {{interval}}, the instruction is sent to {{target}}.',
      { interval: formatInterval(form.everyMin), target: who }
    )
  }
  if (form.kind === 'on-idle') {
    return single
      ? translate(
          'board.loops.summary.idleOne',
          'Whenever {{target}} finishes and goes idle, the instruction is sent to it.',
          { target: who }
        )
      : translate(
          'board.loops.summary.idleMany',
          'Once {{target}} have all gone idle, the instruction is sent to them.',
          { target: who }
        )
  }
  const pattern = form.pattern.trim()
  if (!pattern) {
    return translate(
      'board.loops.summary.matchEmpty',
      'The moment one of {{target}} prints matching text, that console is told.',
      { target: who }
    )
  }
  return single
    ? translate(
        'board.loops.summary.matchOne',
        'The moment {{target}} prints “{{pattern}}”, it is told.',
        { target: who, pattern }
      )
    : translate(
        'board.loops.summary.matchMany',
        'The moment one of {{target}} prints “{{pattern}}”, that console is told.',
        { target: who, pattern }
      )
}

/** The muted line in the STOP box: every active stop rule, or "no stop condition". */
export function loopStopSummary(
  form: Pick<
    LoopFormValues,
    | 'kind'
    | 'stopAfterRuns'
    | 'stopAfterMin'
    | 'stopGoalOn'
    | 'stopGoalMode'
    | 'stopGoalCardId'
    | 'stopCommand'
    | 'goal'
  >,
  goalCardTitle: string | null
): string {
  const clauses: string[] = []
  const judged = isJudgedGoalForm(form)
  if (form.stopAfterRuns > 0) {
    clauses.push(
      translate('board.loops.stop.summary.runs', 'after {{count}} runs', {
        count: Math.round(form.stopAfterRuns)
      })
    )
  }
  if (form.stopAfterMin > 0) {
    clauses.push(
      translate('board.loops.stop.summary.time', 'after {{duration}}', {
        duration: formatInterval(form.stopAfterMin)
      })
    )
  }
  if (form.stopGoalOn && form.stopGoalMode === 'card') {
    clauses.push(
      form.stopGoalCardId && goalCardTitle !== null
        ? translate('board.loops.stop.summary.card', 'once every item on “{{title}}” is checked', {
            title: goalCardTitle
          })
        : translate('board.loops.stop.summary.cardMissing', 'once a goal card you pick is complete')
    )
  }
  if (form.stopGoalOn && form.stopGoalMode === 'command') {
    clauses.push(
      form.stopCommand.trim()
        ? translate('board.loops.stop.summary.command', 'once `{{command}}` passes', {
            command: form.stopCommand.trim()
          })
        : translate('board.loops.stop.summary.commandMissing', 'once a command you enter passes')
    )
  }
  if (judged) {
    clauses.push(
      translate('board.loops.stop.summary.judged', 'once a separate agent judges the goal met')
    )
  }
  if (clauses.length === 0) {
    return translate(
      'board.loops.stop.summary.none',
      'No stop condition. The loop runs until you switch it off.'
    )
  }
  return translate('board.loops.stop.summary.some', 'Stops {{clauses}}.', {
    clauses: clauses.join(translate('board.loops.stop.summary.join', ', or '))
  })
}

/** Which TARGET row the form key belongs to. */
export function targetRowOf(targetKey: string): 'board' | 'orchestrator' | 'picked' | 'group' {
  if (targetKey === BOARD_TARGET_KEY) {
    return 'board'
  }
  if (targetKey === PICKED_TARGET_KEY || targetKey.startsWith('tab:')) {
    return 'picked'
  }
  const parsed = parseTargetKey(targetKey)
  return parsed?.type === 'orchestrator'
    ? 'orchestrator'
    : parsed?.type === 'group'
      ? 'group'
      : 'board'
}
