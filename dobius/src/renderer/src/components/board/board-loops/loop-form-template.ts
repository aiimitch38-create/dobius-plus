// Turns a loop template into the form's starting values. The user still reviews
// and saves it; nothing runs until "Create loop".
import type { BoardLoopTemplate } from './board-loop-templates'
import { BOARD_TARGET_KEY, DEFAULT_LOOP_FORM, type LoopFormValues } from './loop-form'

/**
 * `firstConsoleKey` is used where the template needs one console: "selected"
 * targets, and output-match (the engine watches one console's output).
 */
export function loopFormFromTemplate(
  template: BoardLoopTemplate,
  firstConsoleKey: string
): LoopFormValues {
  const { trigger } = template
  const wantsEveryConsole =
    template.target === 'every-console' && trigger.kind !== 'on-output-match'
  const base: LoopFormValues = {
    ...DEFAULT_LOOP_FORM,
    name: template.title,
    instruction: template.instruction,
    targetKey: wantsEveryConsole ? BOARD_TARGET_KEY : firstConsoleKey,
    // ponytail: "until a command passes" is not supported by the loop engine yet; only the time limit carries over.
    stopAfterMin: template.stop.timeLimitMinutes ?? 0
  }
  switch (trigger.kind) {
    case 'schedule':
      return { ...base, kind: 'schedule', everyMin: trigger.everyMinutes }
    case 'on-idle':
      return { ...base, kind: 'on-idle', debounceSec: Math.round(trigger.debounceMs / 1000) }
    case 'on-output-match':
      return {
        ...base,
        kind: 'on-output-match',
        pattern: trigger.pattern,
        cooldownSec: Math.round(trigger.cooldownMs / 1000)
      }
  }
}
