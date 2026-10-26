import { translate } from '@/i18n/i18n'
import type { AutomationLoop } from '../../../../../shared/automations-types'

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
