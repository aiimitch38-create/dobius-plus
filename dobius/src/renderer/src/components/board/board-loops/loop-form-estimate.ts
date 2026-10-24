import { translate } from '@/i18n/i18n'
import type { LoopFormValues } from './loop-form'

export type PromptsPerHour = {
  perHour: number
  consoles: number
  /** True when the number is a ceiling (goal checks, output-match cooldown), not a fixed rate. */
  upTo: boolean
}

/**
 * How many prompts per hour the loop can type, from its interval times the
 * number of consoles it targets. Null when the rate depends on the agents
 * (on-idle) or there are no consoles to send to.
 */
export function estimatePromptsPerHour(
  form: Pick<LoopFormValues, 'kind' | 'everyMin' | 'checkEverySec' | 'maxRuns' | 'cooldownSec'>,
  consoles: number
): PromptsPerHour | null {
  if (consoles <= 0) {
    return null
  }
  if (form.kind === 'schedule') {
    const perHour = 60 / Math.max(1, Math.round(form.everyMin))
    return { perHour: perHour * consoles, consoles, upTo: false }
  }
  if (form.kind === 'goal') {
    const perConsole = Math.min(3600 / Math.max(30, form.checkEverySec), Math.max(1, form.maxRuns))
    return { perHour: perConsole * consoles, consoles, upTo: true }
  }
  if (form.kind === 'on-output-match') {
    return { perHour: 3600 / Math.max(5, form.cooldownSec), consoles: 1, upTo: true }
  }
  return null
}

export function describePromptsPerHour(estimate: PromptsPerHour): string {
  const values = { rate: estimate.perHour.toFixed(1), count: estimate.consoles }
  if (estimate.consoles === 1) {
    return estimate.upTo
      ? translate('board.loops.estimate.upToOne', 'up to ≈ {{rate}} prompts/h to 1 console', values)
      : translate('board.loops.estimate.one', '≈ {{rate}} prompts/h across 1 console', values)
  }
  return estimate.upTo
    ? translate(
        'board.loops.estimate.upToMany',
        'up to ≈ {{rate}} prompts/h across {{count}} consoles',
        values
      )
    : translate(
        'board.loops.estimate.many',
        '≈ {{rate}} prompts/h across {{count}} consoles',
        values
      )
}

/**
 * The line under the loop form, for every trigger. Why: the estimate used to
 * render only when a number existed, so the default "When it goes idle"
 * trigger (and an empty target) showed nothing and QA found no estimate.
 */
export function loopEstimateLine(
  form: Pick<LoopFormValues, 'kind' | 'everyMin' | 'checkEverySec' | 'maxRuns' | 'cooldownSec'>,
  consoles: number
): string {
  if (consoles <= 0) {
    return translate(
      'board.loops.estimate.noConsoles',
      'No consoles match this target yet, so it sends nothing until one does.'
    )
  }
  const estimate = estimatePromptsPerHour(form, consoles)
  if (estimate) {
    return describePromptsPerHour(estimate)
  }
  return consoles === 1
    ? translate(
        'board.loops.estimate.onIdleOne',
        'One prompt each time the console goes idle; the rate depends on how fast the agent finishes.'
      )
    : translate(
        'board.loops.estimate.onIdleMany',
        'One prompt each time one of {{count}} consoles goes idle; the rate depends on how fast the agents finish.',
        { count: consoles }
      )
}
