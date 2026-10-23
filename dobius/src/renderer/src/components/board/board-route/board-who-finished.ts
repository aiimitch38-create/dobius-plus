import { translate } from '@/i18n/i18n'

/**
 * Narrates which agents just finished a relay: one name spoken plainly, two
 * joined with "and", three or more collapsed to a count (per DEEP-BEHAVIOR-SPEC
 * §8: "the voice announces who finished").
 */
export function whoFinishedLine(names: readonly string[]): string {
  if (names.length === 0) {
    return translate('board.mission.finishedNone', 'Nothing finished yet.')
  }
  if (names.length === 1) {
    return translate('board.mission.finishedOne', '{{name}} finished.', { name: names[0] })
  }
  if (names.length === 2) {
    return translate('board.mission.finishedTwo', '{{first}} and {{second}} finished.', {
      first: names[0],
      second: names[1]
    })
  }
  return translate('board.mission.finishedMany', '{{count}} agents finished.', {
    count: names.length
  })
}
